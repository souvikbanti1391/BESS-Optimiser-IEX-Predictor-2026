import express from "express";
import path from "path";
import multer from "multer";
import { spawn, execSync } from "child_process";
import fs from "fs";
import axios from "axios";

function getPercentile(data: number[], percentile: number) {
  if (data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function runNaiveOptimization(prices: any[], config: any) {
  const {
    capacityMw,
    duration,
    cycles,
    socMin,
    socMax,
    socInit,
    etaC,
    etaD,
    degradation,
    lowPercentile,
    highPercentile,
    rollingDays
  } = config;

  const P_MAX_MW = capacityMw;
  const DURATION_HR = duration;
  const E_MAX_MWH = P_MAX_MW * DURATION_HR;
  const SOC_MIN = socMin / 100;
  const SOC_MAX = socMax / 100;
  const SOC_INIT = socInit / 100;
  const ETA_C = etaC / 100;
  const ETA_D = etaD / 100;
  const C_DEG_KWH = degradation;
  const MAX_CYCLES_PER_DAY = cycles;

  // Normalize prices to ensure we have a 'mcp' field
  const normalizedPrices = prices.map(p => ({
    ...p,
    mcp: p.mcp || p.predicted || p.forecast_MCP || p.price || 0,
    datetime: p.datetime
  }));

  let dt_hours = 1;
  if (normalizedPrices.length > 1) {
    const d1 = new Date(normalizedPrices[0].datetime).getTime();
    const d2 = new Date(normalizedPrices[1].datetime).getTime();
    dt_hours = Math.abs(d2 - d1) / (1000 * 60 * 60);
    if (dt_hours === 0) dt_hours = 1; // Fallback
  }

  const blocks_per_day = Math.round(24 / dt_hours) || 24;
  const rolling_blocks = Math.round(rollingDays * blocks_per_day);
  
  // Limit simulation to rollingDays if it's less than available data
  const T_full = Math.min(normalizedPrices.length, rolling_blocks);
  const num_days_full = (T_full * dt_hours) / 24;

  let current_SOC = SOC_INIT;
  let cumulative_discharge_energy = 0;
  let cum_profit = 0;
  const results = [];

  // Use the original rollingDays for the optimization window logic
  const optimization_window_blocks = rolling_blocks; 

  for (let start = 0; start < T_full; start += blocks_per_day) {
    const windowEnd = Math.min(start + optimization_window_blocks, normalizedPrices.length);
    const windowPrices = normalizedPrices.slice(start, windowEnd).map(p => p.mcp);
    
    const LOW_THRESHOLD = getPercentile(windowPrices, lowPercentile);
    const HIGH_THRESHOLD = getPercentile(windowPrices, highPercentile);

    for (let t = 0; t < blocks_per_day; t++) {
      const global_index = start + t;
      if (global_index >= T_full) break;

      const price = normalizedPrices[global_index].mcp;
      let charge = 0;
      let discharge = 0;
      let mode = "IDLE";

      const max_allowed_energy = MAX_CYCLES_PER_DAY * E_MAX_MWH * num_days_full;

      if (price <= LOW_THRESHOLD && current_SOC < SOC_MAX - 0.00001) {
        charge = Math.min(
          P_MAX_MW,
          ((SOC_MAX - current_SOC) * E_MAX_MWH) / dt_hours
        );
        if (charge > 0.001) mode = "CHARGE";
      } else if (
        price >= HIGH_THRESHOLD &&
        current_SOC > SOC_MIN + 0.00001 &&
        cumulative_discharge_energy < max_allowed_energy
      ) {
        discharge = Math.min(
          P_MAX_MW,
          ((current_SOC - SOC_MIN) * E_MAX_MWH) / dt_hours
        );
        if (discharge > 0.001) mode = "DISCHARGE";
      }

      current_SOC = current_SOC + (charge * ETA_C - discharge / ETA_D) * dt_hours / E_MAX_MWH;
      current_SOC = Math.max(SOC_MIN, Math.min(SOC_MAX, current_SOC));

      const profit = (
        discharge * 1000 * price * ETA_D -
        charge * 1000 * price / ETA_C -
        C_DEG_KWH * 1000 * (charge + discharge)
      ) * dt_hours;

      cum_profit += profit;
      cumulative_discharge_energy += discharge * dt_hours;

      results.push({
        datetime: normalizedPrices[global_index].datetime,
        mcp: price,
        mode: mode,
        action: mode.toLowerCase(),
        charge_mw: charge,
        discharge_mw: discharge,
        soc: current_SOC * 100,
        profit: profit,
        cum_profit: cum_profit
      });
    }
  }

  // 4. Forecast Diagnostics
  const pricesOnly = normalizedPrices.map(p => p.mcp);
  const priceMean = pricesOnly.reduce((a, b) => a + b, 0) / pricesOnly.length;
  const priceMin = Math.min(...pricesOnly);
  const priceMax = Math.max(...pricesOnly);
  const priceRange = priceMax - priceMin;
  
  const p10 = getPercentile(pricesOnly, 10);
  const p90 = getPercentile(pricesOnly, 90);
  const spreadP90P10 = p90 - p10;

  // Calculate daily spread
  const dailySpreads: number[] = [];
  for (let i = 0; i < normalizedPrices.length; i += blocks_per_day) {
    const dayPrices = normalizedPrices.slice(i, i + blocks_per_day).map(p => p.mcp);
    if (dayPrices.length > 0) {
      dailySpreads.push(Math.max(...dayPrices) - Math.min(...dayPrices));
    }
  }
  const avgDailySpread = dailySpreads.reduce((a, b) => a + b, 0) / dailySpreads.length;
  const maxDailySpread = Math.max(...dailySpreads);

  const diagnostics = {
    meanPrice: priceMean.toFixed(3),
    minPrice: priceMin.toFixed(3),
    maxPrice: priceMax.toFixed(3),
    priceRange: priceRange.toFixed(3),
    p90p10Spread: spreadP90P10.toFixed(3),
    avgDailySpread: avgDailySpread.toFixed(3),
    maxDailySpread: maxDailySpread.toFixed(3)
  };

  return {
    results,
    diagnostics,
    summary: {
      totalProfit: cum_profit.toFixed(2),
      totalCycles: (cumulative_discharge_energy / E_MAX_MWH).toFixed(2),
      avgCyclesPerDay: (cumulative_discharge_energy / E_MAX_MWH / num_days_full).toFixed(2),
      chargeDuration: (results.filter(r => r.mode === "CHARGE").length * dt_hours).toFixed(2),
      dischargeDuration: (results.filter(r => r.mode === "DISCHARGE").length * dt_hours).toFixed(2),
      idleDuration: (results.filter(r => r.mode === "IDLE").length * dt_hours).toFixed(2),
      bestDischargeWindow: results.filter(r => r.mode === "DISCHARGE").sort((a, b) => b.mcp - a.mcp)[0]?.datetime || "N/A",
      bestDischargePrice: (results.filter(r => r.mode === "DISCHARGE").sort((a, b) => b.mcp - a.mcp)[0]?.mcp || 0).toFixed(2),
      bestChargeWindow: results.filter(r => r.mode === "CHARGE").sort((a, b) => a.mcp - b.mcp)[0]?.datetime || "N/A",
      bestChargePrice: (results.filter(r => r.mode === "CHARGE").sort((a, b) => a.mcp - b.mcp)[0]?.mcp || 0).toFixed(2),
      dailyRevenue: (cum_profit / num_days_full).toFixed(2),
      weeklyRevenue: (cum_profit / num_days_full * 7).toFixed(2),
      annualRevenue: (cum_profit / num_days_full * 365).toFixed(2)
    }
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Function to check if python3 or python is available
  function checkPythonAvailability() {
    const commands = ['python3', 'python'];
    for (const cmd of commands) {
      try {
        const output = execSync(`${cmd} --version`, { stdio: 'pipe' }).toString();
        console.log(`Found Python: ${cmd} (${output.trim()})`);
        return cmd;
      } catch (e) {
        // Continue to next command
      }
    }
    console.warn('WARNING: Python 3 not found in environment. Predictor/Optimizer logic will fail.');
    return null;
  }

  // Check Python on startup
  const pythonCmd = checkPythonAvailability();

  function getPythonCommand() {
    return pythonCmd || 'python3'; // Fallback to python3
  }

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Ensure directories exist
  const uploadDir = path.join(process.cwd(), 'uploads');
  const modelDir = path.join(process.cwd(), 'models');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
  if (!fs.existsSync(modelDir)) fs.mkdirSync(modelDir);

  console.log(`Current working directory: ${process.cwd()}`);
  console.log(`Model directory: ${modelDir}`);
  if (fs.existsSync(modelDir)) {
    console.log(`Files in model directory: ${fs.readdirSync(modelDir)}`);
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    }
  });

  const upload = multer({ storage });

  // API Routes for "Heavy Tasks"
  app.post("/api/upload-model", upload.single('model'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No model file uploaded" });
    }

    const tempPath = req.file.path;
    const finalPath = path.join(modelDir, `RandomForest_pipeline_${Date.now()}.pkl`);

    try {
      fs.renameSync(tempPath, finalPath);
      res.json({ success: true, message: "Model uploaded successfully", filename: path.basename(finalPath) });
    } catch (error: any) {
      console.error("Error moving uploaded model:", error);
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      res.status(500).json({ error: "Failed to save uploaded model", details: error.message });
    }
  });

  app.post("/api/download-model", async (req, res) => {
    const { fileId } = req.body;
    if (!fileId) return res.status(400).json({ error: "No fileId provided" });

    const downloadUrl = `https://docs.google.com/uc?export=download&id=${fileId}`;
    const outputPath = path.join(modelDir, `RandomForest_pipeline_${Date.now()}.pkl`);

    try {
      // First attempt to download
      const response = await axios({
        method: 'GET',
        url: downloadUrl,
        responseType: 'stream'
      });

      // Check if it's an HTML response (virus scan warning)
      const contentType = response.headers['content-type'];
      if (contentType && contentType.includes('text/html')) {
        // We need to extract the confirm token
        const htmlResponse = await axios.get(downloadUrl);
        const confirmMatch = htmlResponse.data.match(/confirm=([0-9A-Za-z_]+)/);
        if (confirmMatch) {
          const confirmToken = confirmMatch[1];
          const finalUrl = `${downloadUrl}&confirm=${confirmToken}`;
          
          const finalResponse = await axios({
            method: 'GET',
            url: finalUrl,
            responseType: 'stream'
          });

          const writer = fs.createWriteStream(outputPath);
          finalResponse.data.pipe(writer);

          await new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(null));
            writer.on('error', reject);
          });

          return res.json({ success: true, message: "Model downloaded successfully with confirm token", filename: path.basename(outputPath) });
        }
      }

      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);

      writer.on('finish', () => {
        res.json({ success: true, message: "Model downloaded successfully", filename: path.basename(outputPath) });
      });

      writer.on('error', (err) => {
        console.error("Download stream error:", err);
        res.status(500).json({ error: "Failed to save model", details: err.message });
      });
    } catch (error: any) {
      console.error("Download error:", error);
      res.status(500).json({ error: "Failed to download from Google Drive", details: error.message });
    }
  });

  app.post("/api/fix-python", async (req, res) => {
    try {
      console.log('Fixing Python environment...');
      
      const packages = 'pandas numpy joblib scikit-learn openpyxl pulp';
      const requirementsPath = path.join(process.cwd(), 'requirements.txt');
      const installTarget = fs.existsSync(requirementsPath) ? `-r ${requirementsPath}` : packages;
      
      // Check python availability
      let pythonCmd = 'python3';
      try {
        const version = execSync('python3 --version').toString().trim();
        console.log(`Found python3: ${version}`);
      } catch (e) {
        try {
          const version = execSync('python --version').toString().trim();
          console.log(`Found python: ${version}`);
          pythonCmd = 'python';
        } catch (e2) {
          throw new Error("Neither python3 nor python found in path.");
        }
      }

      const commands = [
        `${pythonCmd} -m pip install ${installTarget} --break-system-packages --user`,
        `${pythonCmd} -m pip install ${installTarget} --break-system-packages`,
        `${pythonCmd} -m pip install ${installTarget} --user`,
        `${pythonCmd} -m pip install ${installTarget}`,
        `pip3 install ${installTarget} --break-system-packages --user`,
        `pip install ${installTarget} --break-system-packages --user`,
        `pip3 install ${installTarget} --user`,
        `pip install ${installTarget} --user`
      ];

      let installed = false;
      for (const cmd of commands) {
        try {
          console.log(`Attempting: ${cmd}`);
          execSync(cmd, { stdio: 'inherit' });
          installed = true;
          console.log(`Command succeeded: ${cmd}`);
          break;
        } catch (e: any) {
          console.log(`Command failed: ${cmd}. Error: ${e.message}`);
          if (e.stderr) console.log(`Stderr: ${e.stderr.toString()}`);
        }
      }

      if (installed) {
        return res.json({ success: true, message: "Python environment fixed successfully via direct installation" });
      }

      console.log('Direct installation failed, trying ensurepip...');
      try {
        console.log(`Attempting: ${pythonCmd} -m ensurepip --upgrade`);
        execSync(`${pythonCmd} -m ensurepip --upgrade`, { stdio: 'inherit' });
        // Try again after ensurepip
        for (const cmd of commands) {
          try {
            console.log(`Attempting after ensurepip: ${cmd}`);
            execSync(cmd, { stdio: 'inherit' });
            installed = true;
            console.log(`Command succeeded after ensurepip: ${cmd}`);
            break;
          } catch (e) {}
        }
      } catch (e: any) {
        console.log(`ensurepip failed: ${e.message}`);
      }

      if (installed) {
        return res.json({ success: true, message: "Python environment fixed successfully after ensurepip" });
      }

      console.log('Trying to download get-pip.py...');

      const getPipPath = path.join(process.cwd(), 'get-pip.py');
      
      // Only download if not already present
      if (!fs.existsSync(getPipPath)) {
        console.log('Downloading get-pip.py...');
        const getPipUrl = 'https://bootstrap.pypa.io/get-pip.py';
        const response = await axios({
          method: 'GET',
          url: getPipUrl,
          responseType: 'stream'
        });
        
        const writer = fs.createWriteStream(getPipPath);
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
          writer.on('finish', () => resolve(null));
          writer.on('error', reject);
        });
        console.log('get-pip.py downloaded successfully.');
      }
      
      // Install pip
      console.log('Installing pip using get-pip.py...');
      try {
        console.log(`Attempting: ${pythonCmd} get-pip.py --user`);
        execSync(`${pythonCmd} get-pip.py --user`, { stdio: 'inherit' });
      } catch (e: any) {
        console.log(`Installation with ${pythonCmd} get-pip.py failed: ${e.message}`);
        if (pythonCmd === 'python3') {
          console.log('Trying python get-pip.py --user...');
          try {
            execSync('python get-pip.py --user', { stdio: 'inherit' });
          } catch (e2: any) {
            console.log(`Installation with python get-pip.py failed: ${e2.message}`);
          }
        }
      }
      
      // Try to find pip in common locations
      const pipLocations = [
        `${pythonCmd} -m pip`,
        'python3 -m pip',
        'python -m pip',
        path.join(process.env.HOME || '/root', '.local/bin/pip3'),
        path.join(process.env.HOME || '/root', '.local/bin/pip'),
        'pip3',
        'pip'
      ];

      for (const pipCmd of pipLocations) {
        try {
          console.log(`Attempting installation with: ${pipCmd}`);
          execSync(`${pipCmd} install ${installTarget} --break-system-packages --user`, { stdio: 'inherit' });
          installed = true;
          break;
        } catch (e: any) {
          console.log(`Failed with ${pipCmd} and --break-system-packages, trying without...`);
          try {
            execSync(`${pipCmd} install ${installTarget} --user`, { stdio: 'inherit' });
            installed = true;
            break;
          } catch (e2: any) {
            console.log(`Failed with ${pipCmd} entirely: ${e2.message}`);
          }
        }
      }
      
      if (installed) {
        res.json({ success: true, message: "Python environment fixed successfully after installing pip" });
      } else {
        throw new Error("Could not install Python dependencies after multiple attempts.");
      }
    } catch (error: any) {
      console.error('Failed to fix Python environment:', error);
      res.status(500).json({ error: "Failed to fix Python environment", details: error.message });
    }
  });

  app.post("/api/predict", upload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { forecast_days, time_res, plot_days } = req.body;
    const dataPath = req.file.path;
    const predictScript = path.join(process.cwd(), 'api', 'predict.py');

    if (!fs.existsSync(predictScript)) {
      if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
      return res.status(500).json({ error: "Prediction script not found" });
    }

    const pythonArgs = JSON.stringify({
      forecast_days: forecast_days || 7,
      time_res: time_res || "H",
      plot_days: plot_days || 31,
      data_path: dataPath,
      model_dir: modelDir
    });

    const pythonCmd = getPythonCommand();
    const pythonProcess = spawn(pythonCmd, [
      predictScript,
      pythonArgs
    ]);

    pythonProcess.on('error', (err) => {
      console.error('Failed to start Python process:', err);
      if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to start Python process", details: err.message });
      }
    });

    let output = '';
    let error = '';

    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      error += data.toString();
    });

    pythonProcess.on('close', (code) => {
      // Clean up uploaded file
      if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);

      if (code !== 0) {
        console.error(`Python process exited with code ${code}: ${error}`);
        // Check for common errors like missing modules
        if (error.includes("ModuleNotFoundError")) {
          return res.status(500).json({ 
            error: "Python dependencies missing", 
            details: "The server is missing required Python libraries (e.g., pandas). Please try again in a moment while we fix the environment.",
            missingModule: error.split("'")[1]
          });
        }
        return res.status(500).json({ error: "Prediction failed", details: error });
      }

      try {
        const result = JSON.parse(output);
        if (result.error) {
          return res.status(500).json(result);
        }
        res.json(result);
      } catch (e) {
        console.error(`Failed to parse Python output: ${output}`);
        res.status(500).json({ error: "Invalid prediction output", details: output });
      }
    });
  });

  app.post("/api/optimize", async (req, res) => {
    const { prices, config, strategy } = req.body;
    
    if (!prices || !prices.length) {
      return res.status(400).json({ error: "No price data provided" });
    }

    if (strategy?.toUpperCase() === 'MILP') {
      const optimizeScript = path.join(process.cwd(), 'api', 'optimize.py');
      if (!fs.existsSync(optimizeScript)) {
        return res.status(500).json({ error: "MILP optimization script not found" });
      }

      const pythonCmd = getPythonCommand();
      const pythonProcess = spawn(pythonCmd, [optimizeScript]);
      let output = '';
      let error = '';

      pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`MILP optimization failed with code ${code}: ${error}`);
          if (error.includes("ModuleNotFoundError")) {
            return res.status(500).json({ 
              error: "Python dependencies missing", 
              details: error,
              missingModule: error.split("'")[1]
            });
          }
          return res.status(500).json({ error: "MILP optimization failed", details: error });
        }
        try {
          const result = JSON.parse(output);
          if (result.error) {
            return res.status(500).json({ error: "MILP optimization error", details: result.error });
          }
          res.json(result);
        } catch (e: any) {
          console.error("Failed to parse MILP output:", e);
          res.status(500).json({ error: "Failed to parse MILP output", details: e.message });
        }
      });

      pythonProcess.stdin.write(JSON.stringify({ prices, config }));
      pythonProcess.stdin.end();
    } else {
      try {
        const optimizationResults = runNaiveOptimization(prices, config);
        res.json(optimizationResults);
      } catch (error: any) {
        console.error("Optimization error:", error);
        res.status(500).json({ error: "Optimization failed", details: error.message });
      }
    }
  });

  // Catch-all for API routes to ensure they return JSON instead of HTML
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Generic error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Express error:', err);
    if (res.headersSent) {
      return next(err);
    }
    res.status(err.status || 500).json({ 
      error: err.message || 'Internal server error',
      details: typeof err === 'object' ? err : String(err)
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const viteModule = await import("vite");
    const vite = await viteModule.createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

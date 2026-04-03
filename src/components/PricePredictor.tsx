import React, { useState, useMemo, useCallback } from 'react';
import { 
  Upload, 
  TrendingUp, 
  Download, 
  Play, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Calendar,
  Send,
  Settings,
  X,
  Zap,
  GraduationCap,
  BarChart3,
  Clock,
  FileText
} from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import html2canvas from 'html2canvas';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend,
  AreaChart,
  Area
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

export default function PricePredictor({ 
  results, 
  setResults, 
  onPredict, 
  onAddToReport 
}: { 
  results: any, 
  setResults: (data: any) => void,
  onPredict: (data: any[]) => void, 
  onAddToReport: (data: any) => void 
}) {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [predictionDays, setPredictionDays] = useState(3);
  const [plotInterval, setPlotInterval] = useState(7);
  const [confidence, setConfidence] = useState(95);
  const [isFixingPython, setIsFixingPython] = useState(false);
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const [fileStats, setFileStats] = useState<{ volume: number; span: string; days: number } | null>(null);

  const handleAddToReport = async () => {
    if (!results) return;
    
    const toastId = toast.loading("Capturing results for report...");
    
    // Ultimate Style Shield: Bake computed styles to standard colors to prevent html2canvas parser errors
    const restoredStyles = new Map<HTMLElement, string>();
    const colorConverter = document.createElement('canvas').getContext('2d');
    
    const bakeStyles = (root: HTMLElement) => {
      const elements = root.getElementsByTagName('*');
      for (let j = 0; j < elements.length; j++) {
        const el = elements[j] as HTMLElement;
        try {
          const style = window.getComputedStyle(el);
          // Comprehensive list of properties to bake (layout + colors)
          const props = [
            'color', 'backgroundColor', 'borderColor', 'fill', 'stroke', 
            'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
            'outlineColor', 'stopColor', 'floodColor', 'lightingColor',
            'columnRuleColor', 'textDecorationColor', 'caretColor',
            'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'textAlign',
            'padding', 'margin', 'display', 'flexDirection', 'justifyContent', 'alignItems',
            'gap', 'width', 'height', 'position', 'top', 'left', 'right', 'bottom', 'zIndex',
            'opacity', 'visibility', 'overflow', 'borderRadius', 'boxShadow', 'borderStyle', 'borderWidth',
            'flex', 'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'alignSelf', 'justifySelf',
            'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis', 'boxSizing'
          ];
          let modified = false;
          const originalInline = el.getAttribute('style') || '';
          
          props.forEach(prop => {
            const val = style.getPropertyValue(prop);
            if (val) {
              let safeVal = val;
              // Convert oklch/oklab to safe hex
              if (val.includes('oklch') || val.includes('oklab')) {
                if (colorConverter) {
                  colorConverter.fillStyle = val;
                  safeVal = colorConverter.fillStyle;
                } else {
                  safeVal = '#334155';
                }
              }
              // Always bake the value to preserve layout when stylesheets are removed
              el.style.setProperty(prop, safeVal, 'important');
              modified = true;
            }
          });
          
          // Also check for gradients in background-image
          const bgImg = style.getPropertyValue('background-image');
          if (bgImg && (bgImg.includes('oklch') || bgImg.includes('oklab'))) {
            el.style.setProperty('background-image', 'none', 'important');
            el.style.setProperty('background-color', '#334155', 'important');
            modified = true;
          }
          
          if (modified) {
            restoredStyles.set(el, originalInline);
          }
        } catch (e) {}
      }
    };

    const removedTags: { tag: Node, nextSibling: Node | null }[] = [];
    
    try {
      const element = document.getElementById('predictor-full-content');
      if (element) {
        bakeStyles(element);
        
        // Nuclear Option: Temporarily REMOVE all style and link tags from the head
        // to prevent html2canvas from even attempting to parse them.
        const head = document.head;
        const styleRelatedTags = Array.from(head.querySelectorAll('style, link[rel="stylesheet"]'));
        
        styleRelatedTags.forEach(tag => {
          // Keep font stylesheets as they are usually safe and needed for text rendering
          if (tag instanceof HTMLLinkElement && tag.href.includes('fonts.googleapis.com')) {
            return;
          }
          removedTags.push({ tag, nextSibling: tag.nextSibling });
          try {
            head.removeChild(tag);
          } catch (e) {}
        });

        // Wait for UI to settle
        window.scrollTo(0, 0);
        await new Promise(resolve => setTimeout(resolve, 500));
        // html2canvas doesn't support oklch() or oklab() colors used by Tailwind v4
        const canvasPromise = html2canvas(element, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
          onclone: (clonedDoc) => {
            // 1. Sanitize all inline styles in the clone
            const allElements = clonedDoc.querySelectorAll('*');
            allElements.forEach(el => {
              const styleAttr = el.getAttribute('style');
              if (styleAttr && (styleAttr.includes('oklch') || styleAttr.includes('oklab'))) {
                el.setAttribute('style', styleAttr.replace(/okl(ch|ab)\s*\([\s\S]*?\)/gi, '#334155'));
              }
            });

            // 2. Remove all link and style tags in the clone to prevent parser errors
            const styleRelated = clonedDoc.querySelectorAll('style, link[rel="stylesheet"]');
            styleRelated.forEach(tag => {
              try {
                tag.parentNode?.removeChild(tag);
              } catch (e) {}
            });

            // 3. Inject a master "Light Theme" stylesheet with layout preservation
            const style = clonedDoc.createElement('style');
            style.textContent = `
              * {
                color-scheme: light !important;
                -webkit-print-color-adjust: exact !important;
              }
              body, #predictor-full-content { 
                background-color: #ffffff !important; 
                color: #0f172a !important; 
                width: 100% !important;
                max-width: 1200px !important;
                margin: 0 auto !important;
              }
              .recharts-responsive-container {
                min-height: 350px !important;
                height: 350px !important;
              }
              /* Fallback for common backgrounds */
              [class*="bg-"] { background-color: #ffffff !important; }
              [class*="text-"] { color: #0f172a !important; }
              .text-slate-400, .text-slate-500 { color: #64748b !important; }
            `;
            clonedDoc.head.appendChild(style);
          }
        });

        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Capture timed out (15s)")), 15000)
        );

        const canvas = await Promise.race([canvasPromise, timeoutPromise]) as HTMLCanvasElement;
        const imageData = canvas.toDataURL('image/png');
        onAddToReport({ ...results, imageData });
        toast.success("Added to report", { id: toastId });
      } else {
        onAddToReport(results);
        toast.error("Could not capture visualization, adding data only", { id: toastId });
      }
    } catch (error) {
      console.error("Capture error:", error);
      onAddToReport(results);
      toast.error(`Capture error: ${error instanceof Error ? error.message : String(error)}`, { id: toastId });
    } finally {
      // Restore original tags
      const head = document.head;
      removedTags.reverse().forEach(({ tag, nextSibling }) => {
        head.insertBefore(tag, nextSibling);
      });
      
      // Restore baked styles
      restoredStyles.forEach((original, el) => {
        if (original) {
          el.setAttribute('style', original);
        } else {
          el.removeAttribute('style');
        }
      });
    }
  };

  const checkBackendStatus = async () => {
    try {
      const response = await fetch('/api/health');
      const result = await response.json();
      if (result.status === 'ok') {
        toast.success("Backend is online and healthy!");
      } else {
        toast.error("Backend returned an unexpected status.");
      }
    } catch (error) {
      toast.error("Could not connect to backend. It might still be starting up.");
    }
  };

  const fixPythonEnvironment = async () => {
    setIsFixingPython(true);
    const id = toast.loading("Fixing Python environment...");
    try {
      const response = await fetch('/api/fix-python', { method: 'POST' });
      const result = await response.json();
      if (result.success) {
        toast.success("Python environment fixed successfully!", { id });
      } else {
        toast.error(result.error || "Failed to fix Python.", { id });
      }
    } catch (error) {
      toast.error("Network error while fixing Python.", { id });
    } finally {
      setIsFixingPython(false);
    }
  };

  const downloadModel = async () => {
    const fileId = "10Md37rJGwK7ww_k3ZChwdlC4IN_BhZWb";
    setIsDownloadingModel(true);
    const id = toast.loading("Downloading trained model from Google Drive (40MB+)...");
    try {
      const response = await fetch('/api/download-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId })
      });
      const result = await response.json();
      if (result.success) {
        toast.success("Model downloaded and installed successfully!", { id });
      } else {
        toast.error(result.error || "Failed to download model.", { id });
      }
    } catch (error) {
      toast.error("Network error while downloading model.", { id });
    } finally {
      setIsDownloadingModel(false);
    }
  };

  const findHeaderRow = (rows: any[][]) => {
    const keywords = ['date', 'time', 'mcp', 'price', 'datetime'];
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const row = rows[i].map(cell => String(cell).toLowerCase());
      if (keywords.some(kw => row.some(cell => cell.includes(kw)))) {
        return i;
      }
    }
    return 0;
  };

  const parseFileStats = useCallback(async (uploadedFile: File) => {
    return new Promise<{ volume: number; span: string }>((resolve, reject) => {
      const reader = new FileReader();
      
      if (uploadedFile.name.endsWith('.csv')) {
        Papa.parse(uploadedFile, {
          complete: (results) => {
            const rows = results.data as any[][];
            const stats = calculateStatsFromRows(rows);
            resolve(stats);
          },
          error: reject
        });
      } else {
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];
            const stats = calculateStatsFromRows(rows);
            resolve(stats);
          } catch (err) {
            reject(err);
          }
        };
        reader.readAsArrayBuffer(uploadedFile);
      }
    });
  }, []);

  const calculateStatsFromRows = (rows: any[][]) => {
    const headerIdx = findHeaderRow(rows);
    const headers = rows[headerIdx].map(h => String(h).toLowerCase());
    const body = rows.slice(headerIdx + 1).filter(row => row.length >= 2 && row[0] !== null && row[0] !== '');
    
    const dateIdx = headers.findIndex(h => h.includes('date') || h.includes('datetime'));
    
    if (dateIdx === -1 || body.length === 0) {
      return { volume: rows.length, span: 'Unknown', days: 0 };
    }

    const dates = body.map(row => {
      const rawDate = row[dateIdx];
      if (!rawDate) return null;
      
      // Handle Excel numeric dates
      if (typeof rawDate === 'number') {
        const date = XLSX.SSF.parse_date_code(rawDate);
        return new Date(date.y, date.m - 1, date.d);
      }
      
      const dateStr = String(rawDate).trim();
      
      // Try DD-MM-YYYY HH:mm or DD/MM/YYYY HH:mm
      const dmyMatch = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(.*)$/);
      if (dmyMatch) {
        let day = parseInt(dmyMatch[1]);
        let month = parseInt(dmyMatch[2]);
        const year = parseInt(dmyMatch[3]);
        
        // Heuristic for month/day swap
        if (month > 12 && day <= 12) {
          const temp = day;
          day = month;
          month = temp;
        }

        const timePart = dmyMatch[4].trim();
        let hour = 0, minute = 0;
        if (timePart) {
          const timeMatch = timePart.match(/(\d{1,2}):(\d{1,2})/);
          if (timeMatch) {
            hour = parseInt(timeMatch[1]);
            minute = parseInt(timeMatch[2]);
          }
        }
        return new Date(year, month - 1, day, hour, minute);
      }

      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) return d;
      
      return null;
    }).filter(d => d !== null) as Date[];

    if (dates.length === 0) return { volume: body.length, span: 'Unknown', days: 0 };

    const sorted = dates.sort((a, b) => a.getTime() - b.getTime());
    const start = sorted[0];
    const end = sorted[sorted.length - 1];
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    const formatDate = (d: Date) => {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    };

    return {
      volume: body.length,
      span: `${formatDate(start)} — ${formatDate(end)}`,
      days: diffDays + 1
    };
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    
    setFile(uploadedFile);
    try {
      const stats = await parseFileStats(uploadedFile);
      setFileStats(stats);
      toast.success("File loaded successfully.");
    } catch (err) {
      console.error(err);
      toast.error("Error parsing file stats.");
    }
  };

  const removeFile = () => {
    setFile(null);
    setResults(null);
    setFileStats(null);
  };

  const runPrediction = async () => {
    if (!file) return;
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('forecast_days', predictionDays.toString());
      formData.append('time_res', 'H');
      formData.append('plot_days', plotInterval.toString());

      const response = await fetch('/api/predict', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      if (result.error) {
        toast.error(result.error);
        return;
      }

      // Add mock confidence interval for visualization
      if (result.forecast) {
        result.forecast = result.forecast.map((p: any) => ({
          ...p,
          upper: p.mcp * (1 + (100 - confidence) / 200),
          lower: p.mcp * (1 - (100 - confidence) / 200)
        }));
      }

      setResults(result);
      if (result.forecast && onPredict) {
        onPredict(result.forecast);
      }
      toast.success("Prediction completed successfully!");
    } catch (error) {
      toast.error("Prediction failed. Please check backend.");
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadCSV = () => {
    if (!results || !results.forecast) return;
    const csv = Papa.unparse(results.forecast);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forecast_${predictionDays}d.csv`;
    a.click();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-12 space-y-12" id="predictor-full-content">
      {/* Header Section */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/30 mb-2">
          <Zap className="w-6 h-6 text-blue-500 fill-current" />
        </div>
        <h1 className="text-5xl font-bold tracking-tight text-white">
          IEX DAM Price Predictor <span className="text-blue-500">Pro</span>
        </h1>
        
        {results && (
          <div className="flex justify-center mt-2">
            <div className={cn(
              "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border",
              results.hasModel 
                ? "bg-green-500/10 text-green-500 border-green-500/20" 
                : "bg-amber-500/10 text-amber-500 border-amber-500/20"
            )}>
              <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", results.hasModel ? "bg-green-500" : "bg-amber-500")} />
              {results.modelUsed}
              {!results.hasModel && results.modelError && (
                <span className="ml-2 text-slate-500 normal-case font-normal">({results.modelError})</span>
              )}
            </div>
          </div>
        )}

        <p className="text-slate-400 max-w-2xl mx-auto text-lg leading-relaxed">
          Intelligent Forecasting Engine for Precise IEX Market Predictions
        </p>

        {/* Quick Links Block */}
        <div className="flex flex-wrap justify-center gap-4 mt-6">
          <a 
            href="https://www.iexindia.com/market-data/day-ahead-market/market-snapshot?interval=ONE_FOURTH_HOUR&dp=LAST_31_DAYS&showGraph=true&toDate=1&fromDate=1" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800/50 border border-slate-700/50 text-blue-400 hover:bg-slate-800 hover:border-blue-500/50 transition-all text-xs font-bold"
          >
            <TrendingUp className="w-3 h-3" />
            Get realtime IEX data here
          </a>
          <a 
            href="http://www.dvc.gov.in" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800/50 border border-slate-700/50 text-slate-300 hover:bg-slate-800 hover:border-slate-500/50 transition-all text-xs font-bold"
          >
            <Zap className="w-3 h-3 text-orange-500" />
            Damodar Valley Corporation
          </a>
          <a 
            href="https://npp.gov.in/dashBoard/trans-map-dashboard" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800/50 border border-slate-700/50 text-slate-300 hover:bg-slate-800 hover:border-slate-500/50 transition-all text-xs font-bold"
          >
            <BarChart3 className="w-3 h-3 text-purple-500" />
            National Power Portal
          </a>
        </div>
      </div>

      {/* Upload Area */}
      <div className="bg-[#121212] border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
        <div className="p-12">
          <AnimatePresence mode="wait">
            {!file ? (
              <motion.label 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-slate-800 rounded-2xl cursor-pointer hover:bg-slate-800/30 hover:border-blue-500/50 transition-all group"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4 group-hover:bg-blue-600/20 group-hover:scale-110 transition-all">
                    <Upload className="w-8 h-8 text-slate-400 group-hover:text-blue-500" />
                  </div>
                  <p className="mb-2 text-xl font-semibold text-slate-300">Click to upload historical data</p>
                  <p className="text-sm text-slate-500">Support for .csv, .xlsx, .xls</p>
                </div>
                <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} />
              </motion.label>
            ) : (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-800/10"
              >
                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-8 h-8 text-green-500" />
                </div>
                <h3 className="text-2xl font-bold text-slate-200 mb-1">File Loaded Successfully</h3>
                <p className="text-slate-500 mb-4">{file.name}</p>
                <button 
                  onClick={removeFile}
                  className="text-red-500 hover:text-red-400 text-sm font-medium underline underline-offset-4"
                >
                  Remove file
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Stats Bar */}
        <div className="bg-black/40 border-t border-slate-800 px-8 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-8">
            <div className="flex items-center gap-2 text-sm">
              <BarChart3 className="w-4 h-4 text-blue-500" />
              <span className="text-slate-400 font-medium uppercase tracking-wider text-[10px]">Dataset Volume:</span>
              <span className="text-slate-200 font-bold">{fileStats?.volume.toLocaleString() || '—'} rows</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-purple-500" />
              <span className="text-slate-400 font-medium uppercase tracking-wider text-[10px]">Duration:</span>
              <span className="text-slate-200 font-bold">{fileStats?.days || '—'} days</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span className="text-slate-400 font-medium uppercase tracking-wider text-[10px]">Span:</span>
              <span className="text-slate-200 font-bold">{fileStats?.span || '—'}</span>
            </div>
            {results?.detectedUnit && (
              <div className="flex items-center gap-2 text-sm">
                <Zap className="w-4 h-4 text-orange-500" />
                <span className="text-slate-400 font-medium uppercase tracking-wider text-[10px]">Unit:</span>
                <span className="text-slate-200 font-bold">{results.detectedUnit}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-widest">
              <GraduationCap className="w-3 h-3" />
              VGSOM Research Project
            </div>
          </div>
        </div>
      </div>

      {/* Configuration & Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-[#121212] border border-slate-800 rounded-3xl p-8 shadow-xl">
          <div className="flex items-center gap-2 mb-8">
            <Settings className="w-5 h-5 text-slate-400" />
            <h3 className="text-lg font-bold text-slate-200">Prediction Configuration</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
            <div className="space-y-3">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Plot Interval</label>
              <select 
                value={plotInterval}
                onChange={(e) => setPlotInterval(parseInt(e.target.value))}
                className="w-full bg-black border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:border-blue-500 outline-none transition-all appearance-none"
              >
                <option value={7}>Last 7 Days</option>
                <option value={14}>Last 14 Days</option>
                <option value={30}>Last 30 Days</option>
              </select>
            </div>

            <div className="space-y-3">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Forecast Horizon</label>
              <select 
                value={predictionDays}
                onChange={(e) => setPredictionDays(parseInt(e.target.value))}
                className="w-full bg-black border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:border-blue-500 outline-none transition-all appearance-none"
              >
                <option value={1}>Next 1 Day</option>
                <option value={2}>Next 2 Days</option>
                <option value={3}>Next 3 Days</option>
                <option value={4}>Next 4 Days</option>
                <option value={5}>Next 5 Days</option>
                <option value={6}>Next 6 Days</option>
                <option value={7}>Next 7 Days</option>
              </select>
            </div>

            <div className="space-y-3">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Confidence</label>
              <select 
                value={confidence}
                onChange={(e) => setConfidence(parseInt(e.target.value))}
                className="w-full bg-black border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:border-blue-500 outline-none transition-all appearance-none"
              >
                <option value={90}>90% (Fast)</option>
                <option value={95}>95% (Standard)</option>
                <option value={99}>99% (Conservative)</option>
              </select>
            </div>
          </div>

          <button
            disabled={!file || isProcessing}
            onClick={runPrediction}
            className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-600/20"
          >
            {isProcessing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Play className="w-5 h-5 fill-current" />
            )}
            Run Forecast
          </button>
        </div>

        <div className="bg-[#121212] border border-slate-800 rounded-3xl p-8 shadow-xl space-y-6">
          <div className="flex items-center gap-2 mb-2">
            <GraduationCap className="w-5 h-5 text-slate-400" />
            <h3 className="text-lg font-bold text-slate-200">Model Management</h3>
          </div>

          <button
            disabled={isDownloadingModel}
            onClick={downloadModel}
            className="w-full py-3 rounded-xl bg-slate-800 border border-slate-700 text-blue-400 text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-700 transition-all disabled:opacity-50"
          >
            {isDownloadingModel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Fetch Trained Model (G-Drive)
          </button>

          <div className="space-y-3">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Environment Tools</p>
            <button
              disabled={isFixingPython}
              onClick={fixPythonEnvironment}
              className="w-full py-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-slate-400 text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all disabled:opacity-50"
            >
              {isFixingPython ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
              Fix Python Dependencies
            </button>
          </div>
        </div>
      </div>

      {/* Results Section */}
      {results && (
        <div className="space-y-8">
          {/* Action Center Card */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#121212] border border-slate-800 rounded-3xl p-8 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6"
          >
            <div>
              <h3 className="text-2xl font-bold text-slate-100">Forecast Ready</h3>
              <p className="text-slate-500 text-sm">Download your data or proceed to battery optimization.</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={handleAddToReport}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-800 border border-slate-700 text-blue-400 hover:bg-slate-700 transition-all font-bold"
              >
                <FileText className="w-5 h-5" />
                Include in Report
              </button>
              <button
                onClick={downloadCSV}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition-all font-bold"
              >
                <Download className="w-5 h-5" />
                Download CSV
              </button>
              <button
                onClick={() => onPredict(results.forecast)}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-all font-bold shadow-lg shadow-blue-600/20"
              >
                <Send className="w-5 h-5" />
                Send to BESS Optimizer
              </button>
            </div>
          </motion.div>

          {/* Historical Validation Chart */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#121212] border border-slate-800 rounded-3xl p-8 shadow-xl"
          >
            <div className="mb-8">
              <h3 className="text-2xl font-bold text-slate-100">Historical Validation</h3>
              <p className="text-slate-500 text-sm">Actual vs RF Predictions (Last {plotInterval} days)</p>
            </div>
            
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={results.backtest}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                  <XAxis 
                    dataKey="datetime" 
                    tick={{ fontSize: 10, fill: '#64748b' }} 
                    minTickGap={50}
                    axisLine={{ stroke: '#475569', strokeWidth: 2 }}
                    tickFormatter={(val) => {
                      if (!val) return '';
                      try {
                        const [datePart, timePart] = val.split(' ');
                        const [year, month, day] = datePart.split('-');
                        return `${day}-${month} ${timePart}`;
                      } catch (e) {
                        return val;
                      }
                    }}
                  />
                  <YAxis 
                    tick={{ fontSize: 10, fill: '#64748b' }} 
                    axisLine={{ stroke: '#1e293b' }}
                    tickFormatter={(val) => `₹${Number(val).toFixed(2)}`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#1e293b', 
                      border: '1px solid #334155', 
                      borderRadius: '12px',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                      padding: '12px'
                    }}
                    itemStyle={{ 
                      fontSize: '12px', 
                      color: '#f1f5f9',
                      fontWeight: '500',
                      padding: '2px 0'
                    }}
                    labelStyle={{
                      fontSize: '11px',
                      color: '#94a3b8',
                      marginBottom: '8px',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}
                    formatter={(value: any, name: string) => [`₹${Number(value).toFixed(2)}`, name]}
                  />
                  <Legend 
                    verticalAlign="bottom" 
                    height={36} 
                    iconType="circle" 
                    wrapperStyle={{ fontSize: '12px', color: '#64748b', paddingTop: '10px' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="actual" 
                    stroke="#2563eb" 
                    strokeWidth={2}
                    fillOpacity={0.1} 
                    fill="#2563eb" 
                    name="Actual"
                    dot={false}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="predicted" 
                    stroke="#10b981" 
                    strokeWidth={2} 
                    fillOpacity={0.1}
                    fill="#10b981"
                    name="Predicted"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Future Forecast Chart */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-[#121212] border border-slate-800 rounded-3xl p-8 shadow-xl"
          >
            <div className="flex justify-between items-start mb-8">
              <div>
                <h3 className="text-2xl font-bold text-slate-100">Predictor Performance Metrics</h3>
                <p className="text-slate-500 text-sm">Backtest accuracy on historical data</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-black/40 p-6 rounded-2xl border border-slate-800/50 text-center flex flex-col h-full">
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">RMSE</p>
                <h4 className="text-2xl font-bold text-white mb-2">{results.metrics?.rmse.toFixed(4)}</h4>
                <p className="text-[10px] text-slate-600 mt-auto min-h-[2.5rem] flex items-center justify-center">Root Mean Square Error</p>
              </div>
              <div className="bg-black/40 p-6 rounded-2xl border border-slate-800/50 text-center flex flex-col h-full">
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">MAPE</p>
                <h4 className="text-2xl font-bold text-white mb-2">{results.metrics?.mape.toFixed(2)}%</h4>
                <p className="text-[10px] text-slate-600 mt-auto min-h-[2.5rem] flex items-center justify-center">Mean Absolute % Error</p>
              </div>
              <div className="bg-black/40 p-6 rounded-2xl border border-slate-800/50 text-center flex flex-col h-full">
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">MAE</p>
                <h4 className="text-2xl font-bold text-white mb-2">{results.metrics?.mae.toFixed(4)}</h4>
                <p className="text-[10px] text-slate-600 mt-auto min-h-[2.5rem] flex items-center justify-center">Mean Absolute Error</p>
              </div>
              <div className="bg-black/40 p-6 rounded-2xl border border-slate-800/50 text-center flex flex-col h-full">
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">Directional Accuracy</p>
                <h4 className="text-2xl font-bold text-white mb-2">{results.metrics?.dir_acc.toFixed(2)}%</h4>
                <p className="text-[10px] text-slate-600 mt-auto min-h-[2.5rem] flex items-center justify-center">Trend Prediction Accuracy</p>
              </div>
            </div>
          </motion.div>

          {/* Future Forecast Chart */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-[#121212] border border-slate-800 rounded-3xl p-8 shadow-xl"
          >
            <div className="flex justify-between items-start mb-8">
              <div>
                <h3 className="text-2xl font-bold text-slate-100">Future Price Forecast</h3>
                <p className="text-slate-500 text-sm">Next {predictionDays} days with {confidence}% Confidence Interval</p>
              </div>
              <button 
                onClick={downloadCSV}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                title="Export Forecast"
              >
                <Download className="w-5 h-5" />
              </button>
            </div>
            
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={results.forecast}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                  <XAxis 
                    dataKey="datetime" 
                    tick={{ fontSize: 10, fill: '#64748b' }} 
                    minTickGap={50}
                    axisLine={{ stroke: '#475569', strokeWidth: 2 }}
                    tickFormatter={(val) => {
                      if (!val) return '';
                      try {
                        const [datePart, timePart] = val.split(' ');
                        const [year, month, day] = datePart.split('-');
                        return `${day}-${month} ${timePart}`;
                      } catch (e) {
                        return val;
                      }
                    }}
                  />
                  <YAxis 
                    tick={{ fontSize: 10, fill: '#64748b' }} 
                    axisLine={{ stroke: '#1e293b' }}
                    tickFormatter={(val) => `₹${Number(val).toFixed(2)}`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#1e293b', 
                      border: '1px solid #334155', 
                      borderRadius: '12px',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                      padding: '12px'
                    }}
                    itemStyle={{ 
                      fontSize: '12px', 
                      color: '#f1f5f9',
                      fontWeight: '500',
                      padding: '2px 0'
                    }}
                    labelStyle={{
                      fontSize: '11px',
                      color: '#94a3b8',
                      marginBottom: '8px',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}
                    formatter={(value: any, name: string) => [`₹${Number(value).toFixed(2)}`, name]}
                  />
                  <Legend 
                    verticalAlign="bottom" 
                    height={36} 
                    iconType="circle" 
                    wrapperStyle={{ fontSize: '12px', color: '#64748b', paddingTop: '10px' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="upper" 
                    stroke="transparent" 
                    fill="#8b5cf6" 
                    fillOpacity={0.1}
                    name="Upper Bound"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="lower" 
                    stroke="transparent" 
                    fill="#8b5cf6" 
                    fillOpacity={0.1}
                    name="Lower Bound"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="mcp" 
                    stroke="#8b5cf6" 
                    strokeWidth={3} 
                    fillOpacity={0}
                    fill="#8b5cf6"
                    name="Forecasted Price"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>
      )}

      {/* Footer / Utility */}
      <div className="flex justify-center gap-4">
        <button
          onClick={checkBackendStatus}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-all text-xs font-medium"
        >
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          System Health
        </button>
        <button
          onClick={fixPythonEnvironment}
          disabled={isFixingPython}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-all text-xs font-medium disabled:opacity-50"
        >
          {isFixingPython ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4 text-orange-500" />}
          Rebuild Environment
        </button>
      </div>
    </div>
  );
}

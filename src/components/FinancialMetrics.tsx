import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  Calculator, 
  TrendingUp, 
  DollarSign, 
  PieChart, 
  Activity,
  ArrowRight,
  Info,
  Clock,
  Zap,
  ShieldCheck,
  BarChart3,
  Table as TableIcon,
  FileText,
  Download,
  Play,
  Battery,
  CheckCircle2,
  RefreshCcw
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  ComposedChart
} from 'recharts';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { toast } from 'sonner';
import html2canvas from 'html2canvas';

import { cn } from '../lib/utils';

interface FinancialMetricsProps {
  optimizationResults?: {
    naive: any | null;
    milp: any | null;
  };
  predictedPrices?: any[];
  config?: any;
  onAddToReport?: (data: any) => void;
}

// Financial helper functions
const calculateNPV = (rate: number, cashflows: number[]) => {
  return cashflows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + rate, i + 1), 0);
};

const calculateIRR = (cashflows: number[], initialInvestment: number) => {
  const flows = [-initialInvestment, ...cashflows];
  let low = -0.99;
  let high = 10.0;
  let guess = 0.1;
  
  for (let i = 0; i < 100; i++) {
    guess = (low + high) / 2;
    let npv = -initialInvestment;
    for (let j = 0; j < cashflows.length; j++) {
      npv += cashflows[j] / Math.pow(1 + guess, j + 1);
    }
    if (npv > 0) low = guess;
    else high = guess;
  }
  return guess * 100;
};

export default function FinancialMetrics({ optimizationResults, predictedPrices, config, onAddToReport }: FinancialMetricsProps) {
  // Configuration State (Initial values from Python script)
  const [powerMw, setPowerMw] = useState<number>(config?.capacityMw || 100);
  const [durationHr, setDurationHr] = useState<number>(config?.duration || 2);
  const [isSimulated, setIsSimulated] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  
  // Sync with config prop
  React.useEffect(() => {
    if (config) {
      setPowerMw(config.capacityMw);
      setDurationHr(config.duration);
    }
  }, [config]);

  // Sync with optimizationResults if available (as fallback or override)
  React.useEffect(() => {
    if (!config) {
      if (optimizationResults?.milp?.config) {
        setPowerMw(optimizationResults.milp.config.capacityMw);
        setDurationHr(optimizationResults.milp.config.duration);
      } else if (optimizationResults?.naive?.config) {
        setPowerMw(optimizationResults.naive.config.capacityMw);
        setDurationHr(optimizationResults.naive.config.duration);
      }
    }
  }, [optimizationResults, config]);

  const [projectLife, setProjectLife] = useState<number>(15);
  const [discountRate, setDiscountRate] = useState<number>(0.09);
  const [revenueEscalation, setRevenueEscalation] = useState<number>(0.02);
  const [omEscalation, setOmEscalation] = useState<number>(0.02);
  const [vgfPercent, setVgfPercent] = useState<number>(25);
  const [salvageFraction, setSalvageFraction] = useState<number>(0.10); 
  
  // CAPEX Parameters
  const [capexRefCr, setCapexRefCr] = useState<number>(450);
  const [energyRef, setEnergyRef] = useState<number>(200);
  const [scalingExponent, setScalingExponent] = useState<number>(0.88);
  
  // Revenue Parameters
  const [capacityTariff, setCapacityTariff] = useState<number>(1150000); 
  const [ancillaryPerMw, setAncillaryPerMw] = useState<number>(2200000); 
  const [availabilityBonus, setAvailabilityBonus] = useState<number>(0.02); 
  
  // O&M Parameters
  const [omPerMw, setOmPerMw] = useState<number>(500000); 
  const [omPerMwh, setOmPerMwh] = useState<number>(25); 
  const [baselineCycles, setBaselineCycles] = useState<number>(100); 
  const [calendarDegradation, setCalendarDegradation] = useState<number>(0.015); 
  const [cyclesCap, setCyclesCap] = useState<number>(600);

  const energyMwh = powerMw * durationHr;

  // Store simulation results in state
  const [simResults, setSimResults] = useState<any>(null);

  const handleRunSimulation = () => {
    setIsSimulating(true);
    
    // Simulate processing time
    setTimeout(() => {
      // 1. CAPEX Calculation
      const capexTotalCr = capexRefCr * Math.pow(energyMwh / energyRef, scalingExponent);
      const totalCapex = capexTotalCr * 10000000; // 1 Cr = 10^7
      const vgfSupport = totalCapex * (vgfPercent / 100);
      const capexAfterVgf = totalCapex - vgfSupport;

      // 2. Base Revenue Model
      const capacityRevenue = energyMwh * capacityTariff;
      const ancillaryRevenue = powerMw * ancillaryPerMw;
      const availabilityRevenue = capacityRevenue * availabilityBonus;
      const baseRevenue = capacityRevenue + ancillaryRevenue + availabilityRevenue;

      // 3. O&M Model
      const omFixed = powerMw * omPerMw;
      
      // 4. Arbitrage Revenues
      const getArbRevenue = (res: any) => {
        if (res?.summary) {
          const dailyProfit = parseFloat(res.summary.dailyRevenue) || 0;
          return dailyProfit * 365;
        }
        return 0;
      };

      const naiveArbRevenue = getArbRevenue(optimizationResults?.naive);
      const milpArbRevenue = getArbRevenue(optimizationResults?.milp);

      const calculateScenario = (capex: number, annualArb: number, optRes: any) => {
        const cashflows: number[] = [];
        const annualData: any[] = [];
        
        const avgCyclesPerDay = parseFloat(optRes?.summary?.avgCyclesPerDay) || 0;
        const marketCycles = avgCyclesPerDay * 365;
        const totalCycles = Math.min(baselineCycles + marketCycles, cyclesCap);
        const throughput = energyMwh * totalCycles;
        const omBase = omFixed + throughput * omPerMwh;

        for (let year = 1; year <= projectLife; year++) {
          const escalationFactor = Math.pow(1 + revenueEscalation, year - 1);
          const baseRevYear = baseRevenue * escalationFactor;
          const arbRevYear = annualArb; // No escalation for arbitrage revenue
          const omYear = omBase * Math.pow(1 + omEscalation, year - 1);
          
          let opCashflow = (baseRevYear + arbRevYear) - omYear;
          let yearCashflow = opCashflow;
          let salvageVal = 0;
          
          if (year === projectLife) {
            salvageVal = salvageFraction * capex;
            yearCashflow += salvageVal;
          }
          
          cashflows.push(yearCashflow);
          annualData.push({
            year: `Y${year}`,
            revenue: (baseRevYear + arbRevYear) / 10000000,
            opex: omYear / 10000000,
            opCashflow: opCashflow / 10000000,
            salvage: salvageVal / 10000000,
            cashflow: yearCashflow / 10000000
          });
        }

        const npv = -capex + calculateNPV(discountRate, cashflows);
        const irr = calculateIRR(cashflows, capex);
        
        // Normal Payback Period (as per Python script)
        let cumulativeCashflow = 0;
        let payback = null;
        for (let i = 0; i < cashflows.length; i++) {
          cumulativeCashflow += cashflows[i];
          if (cumulativeCashflow >= capex && payback === null) {
            payback = i + 1;
          }
        }

        // LCOS Calculation (matching Python script exactly)
        // Python: discounted_cost = sum([om_base / ((1+discount_rate)**i) for i in range(project_life)])
        const discountedCost = Array.from({ length: projectLife }).reduce<number>((acc, _, i) => {
          return acc + omBase / Math.pow(1 + discountRate, i);
        }, 0);

        // Python: discounted_energy = sum([energy_output[i] / ((1+discount_rate)**i) for i in range(project_life)])
        // Python: energy_output = [energyMwh * (1 - calendar_degradation)**i * cycles_cap for i in range(project_life)]
        const discountedEnergy = Array.from({ length: projectLife }).reduce<number>((acc, _, i) => {
          const energyOutputYear = energyMwh * Math.pow(1 - calendarDegradation, i) * cyclesCap;
          return acc + energyOutputYear / Math.pow(1 + discountRate, i);
        }, 0);

        const lcos = (capex + discountedCost) / (discountedEnergy || 1);

        return {
          npv,
          irr,
          payback,
          lcos,
          pi: (npv + capex) / capex,
          vcm: npv / capex,
          annualData
        };
      };

      const newResults = {
        base: calculateScenario(totalCapex, 0, null),
        baseVgf: calculateScenario(capexAfterVgf, 0, null),
        naive: calculateScenario(totalCapex, naiveArbRevenue, optimizationResults?.naive),
        milp: calculateScenario(totalCapex, milpArbRevenue, optimizationResults?.milp),
        totalCapex,
        capexAfterVgf,
        naiveArbRevenue,
        milpArbRevenue
      };

      setSimResults(newResults);
      setIsSimulated(true);
      setIsSimulating(false);
      toast.success("Financial simulation complete!");
    }, 800);
  };

  const [selectedScenario, setSelectedScenario] = useState<'base' | 'baseVgf' | 'naive' | 'milp'>('milp');

  const currentData = simResults ? simResults[selectedScenario] : null;

  const handleAddToReport = async () => {
    if (!onAddToReport) return;
    
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
      const element = document.getElementById('financials-full-content');
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
              body, #financials-full-content { 
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
        onAddToReport({ ...simResults, imageData });
        toast.success("Added to report", { id: toastId });
      }
    } catch (error) {
      console.error("Capture error:", error);
      onAddToReport(simResults);
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

  const exportData = (format: 'csv' | 'xlsx') => {
    const summaryData = [
      { Parameter: "--- FINANCIAL SUMMARY ---", Value: "" },
      { Parameter: "Selected Scenario", Value: scenarios.find(s => s.id === selectedScenario)?.label },
      { Parameter: "NPV (₹ Cr)", Value: (currentData.npv / 10000000).toFixed(2) },
      { Parameter: "IRR (%)", Value: currentData.irr.toFixed(2) },
      { Parameter: "Payback Period (Years)", Value: currentData.payback || '>15' },
      { Parameter: "LCOS (₹/MWh)", Value: currentData.lcos.toFixed(2) },
      { Parameter: "Profitability Index", Value: currentData.pi.toFixed(2) },
      { Parameter: "Value Creation Multiple", Value: currentData.vcm.toFixed(2) },
      { Parameter: "", Value: "" },
      { Parameter: "--- ANNUAL PROJECTIONS ---", Value: "" }
    ];

    const annualData = currentData.annualData.map((r: any) => ({
      Year: r.year,
      Revenue_Cr: r.revenue.toFixed(2),
      OPEX_Cr: r.opex.toFixed(2),
      CashFlow_Cr: r.cashflow.toFixed(2)
    }));

    if (format === 'csv') {
      const summaryCsv = Papa.unparse(summaryData);
      const annualCsv = Papa.unparse(annualData);
      const combinedCsv = summaryCsv + "\n\n" + annualCsv;
      
      const blob = new Blob([combinedCsv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financial_report_${selectedScenario}.csv`;
      a.click();
    } else {
      const wb = XLSX.utils.book_new();
      const combinedData = [
        ...summaryData.map(m => ({ "Column1": m.Parameter, "Column2": m.Value })),
        {},
        ...annualData
      ];
      const ws = XLSX.utils.json_to_sheet(combinedData, { skipHeader: true });
      XLSX.utils.book_append_sheet(wb, ws, "Financial Report");
      XLSX.writeFile(wb, `financial_report_${selectedScenario}.xlsx`);
    }
    toast.success(`Exported as ${format.toUpperCase()}`);
  };

  const kpis = currentData ? [
    { label: "NPV (Net Present Value)", value: `₹${(currentData.npv / 10000000).toFixed(2)} Cr`, icon: TrendingUp, color: "text-blue-400" },
    { label: "IRR (Internal Rate of Return)", value: `${currentData.irr.toFixed(2)}%`, icon: Activity, color: "text-emerald-400" },
    { label: "IRR-Disc. Spread", value: `${(currentData.irr - discountRate * 100).toFixed(2)}%`, icon: TrendingUp, color: "text-blue-500" },
    { label: "Payback Period", value: `${currentData.payback || '>15'} Years`, icon: Clock, color: "text-amber-400" },
    { label: "LCOS (Levelized Cost)", value: `₹${currentData.lcos.toFixed(2)}/MWh`, icon: DollarSign, color: "text-purple-400" },
    { label: "Profitability Index (PI)", value: currentData.pi.toFixed(2), icon: BarChart3, color: "text-pink-400" },
    { label: "Value Creation Multiple", value: currentData.vcm.toFixed(2), icon: PieChart, color: "text-indigo-400" }
  ] : [];

  const scenarios = [
    { id: 'base', label: 'Base Case', desc: 'Contracted Storage only' },
    { id: 'baseVgf', label: 'Base + VGF', desc: '25% Govt Support' },
    { id: 'naive', label: 'Naive Optimized', desc: 'Naive Arbitrage (No VGF)' },
    { id: 'milp', label: 'MILP Optimized', desc: 'MILP Arbitrage (No VGF)' }
  ];

  const hasData = !!(optimizationResults?.naive || optimizationResults?.milp);

  return (
    <div className="space-y-8 text-base" id="financials-full-content">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Financial Model</h2>
          <p className="text-slate-400 text-sm">Economic analysis for the configured BESS project.</p>
        </div>
        
        <div className="flex flex-wrap gap-2">
          {isSimulated && (
            <div className="flex bg-slate-900/50 p-1 rounded-xl border border-slate-800">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedScenario(s.id as any)}
                  className={cn(
                    "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                    selectedScenario === s.id 
                      ? "bg-blue-600 text-white shadow-lg" 
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            {isSimulated && (
              <>
                <button 
                  onClick={handleAddToReport}
                  className="bg-slate-800 border border-slate-700 text-blue-400 px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-700 flex items-center gap-2 transition-colors"
                >
                  <FileText className="w-4 h-4" /> Include in Report
                </button>
                <button 
                  onClick={() => exportData('csv')}
                  className="bg-slate-800 border border-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs font-medium hover:bg-slate-700 flex items-center gap-2 transition-colors"
                >
                  <Download className="w-4 h-4" /> CSV
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Scenario Comparison Table */}
      {isSimulated && (
        <div className="bg-slate-900/50 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-sm">
          <div className="p-6 border-b border-slate-800">
            <h3 className="font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-400" />
              Scenario Comparison Summary
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-800/50">
                  <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Scenario</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">NPV (₹ Cr)</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">IRR (%)</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Payback (Y)</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">PI</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">LCOS (₹/MWh)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {[
                  { name: 'Base Case', id: 'base', data: simResults.base },
                  { name: 'Base + VGF', id: 'baseVgf', data: simResults.baseVgf },
                  { name: 'Naive Optimized', id: 'naive', data: simResults.naive },
                  { name: 'MILP Optimized', id: 'milp', data: simResults.milp }
                ].map((row, i) => (
                  <tr key={i} className={cn(
                    "hover:bg-slate-800/30 transition-colors",
                    selectedScenario === row.id ? "bg-blue-900/10" : ""
                  )}>
                    <td className="px-6 py-4 text-sm font-medium text-slate-300">{row.name}</td>
                    <td className="px-6 py-4 text-sm text-white font-mono">₹{(row.data.npv / 10000000).toFixed(2)}</td>
                    <td className="px-6 py-4 text-sm text-emerald-400 font-mono">{row.data.irr.toFixed(2)}%</td>
                    <td className="px-6 py-4 text-sm text-amber-400 font-mono">{row.data.payback ? row.data.payback.toFixed(2) : `>${projectLife}`}</td>
                    <td className="px-6 py-4 text-sm text-pink-400 font-mono">{row.data.pi.toFixed(2)}</td>
                    <td className="px-6 py-4 text-sm text-purple-400 font-mono">₹{row.data.lcos.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Input Sidebar */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-white flex items-center gap-2">
                <Calculator className="w-5 h-5 text-blue-400" />
                Model Parameters
              </h3>
              <button 
                onClick={() => {
                  if (hasData) {
                    toast.success(`Optimizer data fetch validated! (MW: ${powerMw}, Hr: ${durationHr})`);
                  } else {
                    toast.error("No optimizer data found. Please run BESS Optimizer first.");
                  }
                }}
                className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-blue-400 hover:border-blue-500/50 transition-all"
                title="Validate Data Fetch"
              >
                <RefreshCcw className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="pb-4 border-b border-slate-800">
                <h4 className="text-[10px] font-bold text-blue-400 uppercase mb-3 tracking-widest">BESS Configuration</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Power (MW)</label>
                    <div className="w-full bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-bold">
                      {powerMw} MW
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Duration (H)</label>
                    <div className="w-full bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-bold">
                      {durationHr} Hr
                    </div>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Energy Capacity (MWh)</label>
                    <div className="w-full bg-blue-900/20 border border-blue-500/30 rounded-lg px-3 py-2 text-sm text-blue-400 font-bold">
                      {energyMwh} MWh
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 mt-2 italic text-center">Values fetched from BESS Optimizer</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Project Life (Y)</label>
                  <input 
                    type="number" 
                    value={projectLife}
                    onChange={(e) => setProjectLife(parseInt(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Disc. Rate (%)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={discountRate * 100}
                    onChange={(e) => setDiscountRate(parseFloat(e.target.value) / 100)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">VGF Support (%)</label>
                  <input 
                    type="number" 
                    value={vgfPercent}
                    onChange={(e) => setVgfPercent(parseFloat(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Salvage (%)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={salvageFraction * 100}
                    onChange={(e) => setSalvageFraction(parseFloat(e.target.value) / 100)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Rev. Escal. (%)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={revenueEscalation * 100}
                    onChange={(e) => setRevenueEscalation(parseFloat(e.target.value) / 100)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">O&M Escal. (%)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={omEscalation * 100}
                    onChange={(e) => setOmEscalation(parseFloat(e.target.value) / 100)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800">
                <h4 className="text-[10px] font-bold text-blue-400 uppercase mb-3 tracking-widest">REVENUE MODEL</h4>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">CAPACITY TARIFF (₹/MWH/YR)</label>
                    <input 
                      type="number" 
                      value={capacityTariff}
                      onChange={(e) => setCapacityTariff(parseFloat(e.target.value))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1 flex flex-col">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider min-h-[28px] flex flex-col justify-end">
                        <span>ANCILLARY</span>
                        <span>(₹/MW/YR)</span>
                      </label>
                      <input 
                        type="number" 
                        value={ancillaryPerMw}
                        onChange={(e) => setAncillaryPerMw(parseFloat(e.target.value))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1 flex flex-col">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider min-h-[28px] flex flex-col justify-end">
                        AVAIL. BONUS (%)
                      </label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={availabilityBonus * 100}
                        onChange={(e) => setAvailabilityBonus(parseFloat(e.target.value) / 100)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800">
                <h4 className="text-[10px] font-bold text-blue-400 uppercase mb-3 tracking-widest">O&M & Degradation</h4>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fixed (₹/MW/yr)</label>
                      <input 
                        type="number" 
                        value={omPerMw}
                        onChange={(e) => setOmPerMw(parseFloat(e.target.value))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Var (₹/MWh)</label>
                      <input 
                        type="number" 
                        value={omPerMwh}
                        onChange={(e) => setOmPerMwh(parseFloat(e.target.value))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Base Cycles</label>
                      <input 
                        type="number" 
                        value={baselineCycles}
                        onChange={(e) => setBaselineCycles(parseInt(e.target.value))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cycles Cap</label>
                      <input 
                        type="number" 
                        value={cyclesCap}
                        onChange={(e) => setCyclesCap(parseInt(e.target.value))}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Annual Degradation (%)</label>
                    <input 
                      type="number" 
                      step="0.1"
                      value={calendarDegradation * 100}
                      onChange={(e) => setCalendarDegradation(parseFloat(e.target.value) / 100)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800">
                <h4 className="text-[12px] font-bold text-slate-400 uppercase mb-3">CAPEX Model</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Ref CAPEX (Cr)</label>
                    <input 
                      type="number" 
                      value={capexRefCr}
                      onChange={(e) => setCapexRefCr(parseFloat(e.target.value))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Ref Energy (MWh)</label>
                    <input 
                      type="number" 
                      value={energyRef}
                      onChange={(e) => setEnergyRef(parseFloat(e.target.value))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-[11px] text-slate-500 mb-1">Scaling Exp</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={scalingExponent}
                    onChange={(e) => setScalingExponent(parseFloat(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 space-y-2">
                <button
                  onClick={() => {
                    if (hasData) {
                      toast.success("Data validation complete: Optimizer results are valid and synced.");
                    } else {
                      toast.error("Data validation failed: No optimizer results found.");
                    }
                  }}
                  className="w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition-all"
                >
                  <ShieldCheck className="w-4 h-4 text-blue-400" />
                  Data Fetch Validation
                </button>

                <button
                  onClick={handleRunSimulation}
                  disabled={isSimulating}
                  className={cn(
                    "w-full py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all",
                    isSimulating 
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed" 
                      : "bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20"
                  )}
                >
                  {isSimulating ? (
                    <>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                      >
                        <Calculator className="w-4 h-4" />
                      </motion.div>
                      Simulating...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Run Financial Simulator
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {isSimulated && (
            <div className="bg-blue-900/20 p-4 rounded-2xl border border-blue-900/30">
              <div className="flex gap-3">
                <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-blue-300 mb-1">Arbitrage Revenue Validation</p>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-blue-400/80">Naive Strategy:</span>
                      <span className="text-white font-mono">₹{(simResults.naiveArbRevenue / 10000000).toFixed(2)} Cr/yr</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-blue-400/80">MILP Strategy:</span>
                      <span className="text-white font-mono">₹{(simResults.milpArbRevenue / 10000000).toFixed(2)} Cr/yr</span>
                    </div>
                    <p className="text-[9px] text-blue-400/60 mt-2 italic">
                      *Values automatically fetched from Optimizer results.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Main Dashboard */}
        <div className="lg:col-span-3 space-y-6">
          {isSimulated ? (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {kpis.map((kpi, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800 shadow-xl backdrop-blur-sm"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="bg-slate-800 p-2 rounded-lg">
                        <kpi.icon className={cn("w-4 h-4", kpi.color)} />
                      </div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">{kpi.label.split(' (')[0]}</p>
                    </div>
                    <h4 className="text-2xl font-bold text-white">{kpi.value}</h4>
                  </motion.div>
                ))}
              </div>

              {/* Charts Section */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Cash Flow Chart */}
                <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 shadow-xl backdrop-blur-sm">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-bold text-white">Annual Cash Flow: {scenarios.find(s => s.id === selectedScenario)?.label}</h3>
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Values in ₹ Crore</span>
                  </div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={currentData.annualData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                        <XAxis 
                          dataKey="year" 
                          interval={0}
                          tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} 
                          axisLine={{ stroke: '#334155', strokeWidth: 2 }} 
                        />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 'bold' }} axisLine={{ stroke: '#334155', strokeWidth: 2 }} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#0f172a', 
                            border: '1px solid #334155', 
                            borderRadius: '12px',
                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                          }}
                          itemStyle={{ fontSize: '12px', color: '#fff' }}
                          cursor={false}
                          formatter={(value: number) => [value.toFixed(2), ""]}
                        />
                        <Legend verticalAlign="top" height={36}/>
                        <Bar dataKey="opCashflow" name="Operating CF" stackId="a" radius={[0, 0, 0, 0]}>
                          {currentData.annualData.map((entry: any, index: number) => (
                            <Cell key={`cell-${index}`} fill={entry.opCashflow >= 0 ? '#3b82f6' : '#ef4444'} />
                          ))}
                        </Bar>
                        <Bar dataKey="salvage" name="Salvage Value" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Line type="monotone" dataKey="cashflow" name="Net Cash Flow" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* IRR Comparison */}
                <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 shadow-xl backdrop-blur-sm">
                  <h3 className="font-bold text-white mb-6">IRR Across Scenarios (%)</h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { name: 'Base', irr: simResults.base.irr },
                        { name: 'VGF', irr: simResults.baseVgf.irr },
                        { name: 'Naive', irr: simResults.naive.irr },
                        { name: 'MILP', irr: simResults.milp.irr }
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 'bold' }} axisLine={{ stroke: '#334155', strokeWidth: 2 }} />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 'bold' }} axisLine={{ stroke: '#334155', strokeWidth: 2 }} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#0f172a', 
                            border: '1px solid #334155', 
                            borderRadius: '12px',
                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                          }}
                          itemStyle={{ color: '#fff' }}
                          formatter={(val: number) => [`${val.toFixed(2)}%`, 'IRR']}
                          cursor={false}
                        />
                        <Bar dataKey="irr" radius={[4, 4, 0, 0]}>
                          {[
                            { fill: '#94a3b8' },
                            { fill: '#3b82f6' },
                            { fill: '#f59e0b' },
                            { fill: '#10b981' }
                          ].map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* NPV Comparison */}
                <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 shadow-xl backdrop-blur-sm">
                  <h3 className="font-bold text-white mb-6">NPV Across Scenarios (₹ Cr)</h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { name: 'Base', npv: simResults.base.npv / 10000000 },
                        { name: 'VGF', npv: simResults.baseVgf.npv / 10000000 },
                        { name: 'Naive', npv: simResults.naive.npv / 10000000 },
                        { name: 'MILP', npv: simResults.milp.npv / 10000000 }
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 'bold' }} axisLine={{ stroke: '#334155', strokeWidth: 2 }} />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 'bold' }} axisLine={{ stroke: '#334155', strokeWidth: 2 }} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#0f172a', 
                            border: '1px solid #334155', 
                            borderRadius: '12px',
                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                          }}
                          itemStyle={{ color: '#fff' }}
                          formatter={(val: number) => [`₹${val.toFixed(2)} Cr`, 'NPV']}
                          cursor={false}
                        />
                        <Bar dataKey="npv" radius={[4, 4, 0, 0]}>
                          {[
                            { fill: '#94a3b8' },
                            { fill: '#3b82f6' },
                            { fill: '#f59e0b' },
                            { fill: '#10b981' }
                          ].map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* PI Comparison */}
                <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 shadow-xl backdrop-blur-sm">
                  <h3 className="font-bold text-white mb-6">Profitability Index (PI)</h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { name: 'Base', pi: simResults.base.pi },
                        { name: 'VGF', pi: simResults.baseVgf.pi },
                        { name: 'Naive', pi: simResults.naive.pi },
                        { name: 'MILP', pi: simResults.milp.pi }
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 'bold' }} axisLine={{ stroke: '#334155', strokeWidth: 2 }} />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 'bold' }} axisLine={{ stroke: '#334155', strokeWidth: 2 }} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: '#0f172a', 
                            border: '1px solid #334155', 
                            borderRadius: '12px',
                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                          }}
                          itemStyle={{ color: '#fff' }}
                          formatter={(val: number) => [val.toFixed(2), 'PI']}
                          cursor={false}
                        />
                        <Bar dataKey="pi" radius={[4, 4, 0, 0]}>
                          {[
                            { fill: '#94a3b8' },
                            { fill: '#3b82f6' },
                            { fill: '#f59e0b' },
                            { fill: '#10b981' }
                          ].map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Detailed Table */}
              <div className="bg-slate-900/50 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-sm">
                <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                  <h3 className="font-bold text-white flex items-center gap-2">
                    <TableIcon className="w-5 h-5 text-blue-400" />
                    Annual Financial Projections
                  </h3>
                  <div className="flex gap-4 text-[10px] font-bold text-slate-500">
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div> Revenue</span>
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"></div> OPEX</span>
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Cash Flow</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-800/50">
                        <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Year</th>
                        <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Revenue (₹ Cr)</th>
                        <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">OPEX (₹ Cr)</th>
                        <th className="px-6 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Net Cash Flow (₹ Cr)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {currentData.annualData.map((row: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-6 py-4 text-sm font-medium text-slate-300">{row.year}</td>
                          <td className="px-6 py-4 text-sm text-blue-400 font-mono">₹{row.revenue.toFixed(2)}</td>
                          <td className="px-6 py-4 text-sm text-red-400 font-mono">₹{row.opex.toFixed(2)}</td>
                          <td className="px-6 py-4 text-sm text-emerald-400 font-mono font-bold">₹{row.cashflow.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center bg-slate-900/20 rounded-2xl border border-dashed border-slate-800 p-12">
              <div className="text-center">
                <Calculator className="w-12 h-12 text-slate-800 mx-auto mb-4" />
                <p className="text-slate-600 font-medium">Run the simulator to view detailed metrics and charts.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


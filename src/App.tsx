import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  TrendingUp, 
  Battery, 
  Calculator, 
  Info,
  Upload,
  Download,
  Play,
  CheckCircle2,
  AlertCircle,
  Menu,
  X
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import Welcome from './components/Welcome';
import PricePredictor from './components/PricePredictor';
import BessOptimizer from './components/BessOptimizer';
import FinancialMetrics from './components/FinancialMetrics';
import ReportManager from './components/ReportManager';
import { cn } from './lib/utils';

export type ReportItem = {
  id: string;
  type: 'predictor' | 'naive' | 'milp' | 'financials';
  title: string;
  timestamp: string;
  data: any;
  elementId: string;
  imageData?: string; // Pre-captured image data for PDF generation
};

type Tab = 'welcome' | 'predictor' | 'optimizer' | 'financials';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('welcome');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [predictedPrices, setPredictedPrices] = useState<any[]>([]);
  const [predictorResults, setPredictorResults] = useState<any>(null);
  const [optimizationResults, setOptimizationResults] = useState<{
    naive: any | null;
    milp: any | null;
  }>({ naive: null, milp: null });
  const [optimizerConfig, setOptimizerConfig] = useState({
    capacityMw: 100,
    duration: 2,
    cycles: 1,
    socMin: 10,
    socMax: 90,
    socInit: 50,
    etaC: 95,
    etaD: 95,
    degradation: 0.5,
    lowPercentile: 25,
    highPercentile: 75,
    rollingDays: 3
  });
  const [reportItems, setReportItems] = useState<ReportItem[]>([]);

  const tabs = [
    { id: 'welcome', label: 'Welcome', icon: Info },
    { id: 'predictor', label: 'IEX Predictor', icon: TrendingUp },
    { id: 'optimizer', label: 'BESS Optimizer', icon: Battery },
    { id: 'financials', label: 'Financials', icon: Calculator },
  ];

  const handleSendToScheduler = (data: any[]) => {
    setPredictedPrices(data);
    // setActiveTab('optimizer'); // Remove automatic navigation
  };

  const addToReport = (item: Omit<ReportItem, 'id' | 'timestamp'>) => {
    const newItem: ReportItem = {
      ...item,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleString(),
    };
    setReportItems(prev => [...prev, newItem]);
    toast.success(`Added ${item.title} to report`);
  };

  const clearSession = () => {
    setPredictedPrices([]);
    setPredictorResults(null);
    setOptimizationResults({ naive: null, milp: null });
    setReportItems([]);
    setActiveTab('welcome');
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-200 font-sans">
      <Toaster position="top-right" richColors theme="dark" />
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-slate-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="font-bold text-xl tracking-tight text-white">BESS Optimiser</h1>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">Intelligent Energy Solutions</p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-1 bg-slate-900/50 p-1 rounded-xl border border-slate-800">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as Tab)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                  activeTab === tab.id 
                    ? "bg-slate-800 text-blue-400 shadow-sm" 
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          <button 
            className="md:hidden p-2 text-slate-400 hover:text-white transition-colors"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="md:hidden absolute top-16 left-0 right-0 bg-[#111111] border-b border-slate-800 z-40 p-4 shadow-2xl"
          >
            <div className="flex flex-col gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id as Tab);
                    setIsMenuOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl text-left font-medium transition-colors",
                    activeTab === tab.id ? "bg-slate-800 text-blue-400" : "text-slate-400 hover:bg-slate-900"
                  )}
                >
                  <tab.icon className="w-5 h-5" />
                  {tab.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4 md:p-8">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {activeTab === 'welcome' && (
            <Welcome 
              onNavigate={(tab: Tab) => setActiveTab(tab)} 
            />
          )}
          {activeTab === 'predictor' && (
            <PricePredictor 
              results={predictorResults}
              setResults={setPredictorResults}
              onPredict={handleSendToScheduler} 
              onAddToReport={(data) => addToReport({
                type: 'predictor',
                title: 'IEX Price Forecast',
                data,
                imageData: data.imageData,
                elementId: 'predictor-full-content'
              })}
            />
          )}
          {activeTab === 'optimizer' && (
            <BessOptimizer 
              predictedPrices={predictedPrices} 
              results={optimizationResults}
              setResults={(data, strategy) => setOptimizationResults(prev => ({ ...prev, [strategy.toLowerCase()]: data }))}
              config={optimizerConfig}
              setConfig={setOptimizerConfig}
              onSendToFinancials={() => setActiveTab('financials')}
              onAddToReport={(type, data) => addToReport({
                type: type as any,
                title: `${type.toUpperCase()} Optimization Results`,
                data,
                imageData: data.imageData,
                elementId: 'optimizer-full-content'
              })}
            />
          )}
          {activeTab === 'financials' && (
            <FinancialMetrics 
              optimizationResults={optimizationResults}
              predictedPrices={predictedPrices}
              config={optimizerConfig}
              onAddToReport={(data) => addToReport({
                type: 'financials' as any,
                title: 'Financial Model Results',
                data,
                imageData: data.imageData,
                elementId: 'financials-full-content'
              })}
            />
          )}
        </motion.div>

        {/* Report Manager Section */}
        {activeTab !== 'welcome' && (predictedPrices.length > 0 || optimizationResults.naive || optimizationResults.milp || reportItems.length > 0) && (
          <ReportManager 
            reportItems={reportItems} 
            setReportItems={setReportItems}
            onClearSession={clearSession}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800 py-8 px-4 bg-[#0a0a0a]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex flex-col items-center md:items-start gap-2">
            <p className="text-sm font-bold text-blue-400">EMBA Project @ VGSOM</p>
            <p className="text-sm text-slate-400">
              Designed by <span className="font-semibold text-slate-200">@Souvik Mukherjee</span>
            </p>
          </div>
          <div className="flex flex-col items-center md:items-end gap-1">
            <p className="text-xs text-slate-500">© 2026 All rights reserved. BESS Optimisation Platform.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

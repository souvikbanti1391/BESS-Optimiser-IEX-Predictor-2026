import React from 'react';
import { motion } from 'motion/react';
import { Battery, Zap, Shield, ArrowRight, Activity, Cpu, Database } from 'lucide-react';

export default function Welcome({ onNavigate }: { onNavigate: (tab: 'predictor' | 'optimizer' | 'financials') => void }) {
  return (
    <div className="flex flex-col items-center text-center max-w-6xl mx-auto py-12 px-4">
      {/* Hero Section with Logo and Image */}
      <div className="w-full flex flex-col md:flex-row items-center justify-between gap-8 mb-16">
        <div className="flex-1 text-left">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-900/30 border border-blue-500/30 text-blue-400 text-xs font-bold uppercase tracking-widest mb-6"
          >
            <Cpu className="w-4 h-4" />
            VGSOM EMBA Project
          </motion.div>
          <h2 className="text-5xl md:text-7xl font-extrabold text-white mb-6 tracking-tight leading-tight">
            Optimise Your <br />
            <span className="text-blue-500">Energy Future</span>
          </h2>
          <p className="text-xl text-slate-400 mb-8 leading-relaxed max-w-xl">
            Advanced IEX Market Clearing Price (MCP) forecasting and BESS scheduling. 
            Maximize arbitrage gains using ML-driven insights and MILP optimization.
          </p>
          <button
            onClick={() => onNavigate('predictor')}
            className="group flex items-center gap-2 bg-blue-600 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
          >
            Get Started
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        <div className="flex-1 relative">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative z-10"
          >
            <div className="absolute -inset-4 bg-blue-600/20 rounded-full blur-3xl opacity-30" />
            <img 
              src="/bess.jpeg" 
              alt="BESS System" 
              className="rounded-3xl shadow-2xl relative z-10 border border-slate-800 w-full object-cover h-[450px]"
            />
            {/* Battery Symbols Overlay */}
            <div className="absolute top-4 left-4 z-20 bg-black/50 backdrop-blur-md p-3 rounded-2xl border border-white/10 flex items-center gap-2">
              <Battery className="text-green-400 w-5 h-5" />
              <span className="text-xs font-bold text-white">98% Charged</span>
            </div>
            <div className="absolute bottom-4 right-4 z-20 bg-black/50 backdrop-blur-md p-3 rounded-2xl border border-white/10 flex items-center gap-2">
              <Activity className="text-blue-400 w-5 h-5" />
              <span className="text-xs font-bold text-white">Grid Connected</span>
            </div>
          </motion.div>

          {/* DVC Logo on the right side of the hero */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="absolute -top-12 -right-4 z-30 hidden lg:block"
          >
            <div className="bg-slate-900/80 backdrop-blur-xl p-4 rounded-3xl border border-slate-800 shadow-2xl">
              <img 
                src="/dvc-logo.jpeg" 
                alt="DVC Logo" 
                className="h-16 object-contain brightness-110 contrast-125" 
              />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Feature Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16 w-full">
        {[
          { icon: Zap, title: "IEX Prediction", desc: "Advanced Forecasting models for accurate price forecasting.", tab: 'predictor' },
          { icon: Battery, title: "BESS Scheduling", desc: "Intelligent charge/discharge windows based on market dynamics.", tab: 'optimizer' },
          { icon: Shield, title: "Risk Analysis", desc: "Comprehensive financial metrics including NPV, ROI, and Payback.", tab: 'financials' }
        ].map((feature, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            onClick={() => onNavigate(feature.tab as any)}
            className="bg-slate-900/50 p-8 rounded-2xl border border-slate-800 shadow-lg hover:border-blue-500/50 transition-all group text-left cursor-pointer"
          >
            <div className="bg-blue-900/30 w-14 h-14 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <feature.icon className="text-blue-400 w-7 h-7" />
            </div>
            <h3 className="font-bold text-white mb-3 text-lg">{feature.title}</h3>
            <p className="text-sm text-slate-400 leading-relaxed">{feature.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

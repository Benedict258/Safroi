import React, { useState } from 'react';
import { AnalysisResult, Risk } from '../types';
import { AlertTriangle, Info, CheckCircle2, Globe, FileText, ChevronRight, Languages } from 'lucide-react';
import { cn } from '../lib/utils';
import { translateText } from '../services/groq';
import { motion, AnimatePresence } from 'motion/react';

interface ResultViewProps {
  result: AnalysisResult;
}

export function ResultView({ result }: ResultViewProps) {
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedSummary, setTranslatedSummary] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState('Spanish');

  const handleTranslate = async () => {
    if (translatedSummary) {
      setTranslatedSummary(null);
      return;
    }
    
    setIsTranslating(true);
    try {
      const translated = await translateText(result.summary, targetLang);
      setTranslatedSummary(translated);
    } catch (error) {
      console.error(error);
      alert("Translation failed");
    } finally {
      setIsTranslating(false);
    }
  };

  const scoreColor = 
    result.risk_score <= 3 ? 'text-risk-low' : 
    result.risk_score <= 7 ? 'text-risk-medium' : 
    'text-risk-high';

  const scoreBg = 
    result.risk_score <= 3 ? 'bg-risk-low/10' : 
    result.risk_score <= 7 ? 'bg-risk-medium/10' : 
    'bg-risk-high/10';

  return (
    <div className="w-full max-w-5xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
      {/* Top Header Section */}
      <div className="flex flex-col md:flex-row gap-8 md:gap-12 items-center md:items-start text-center md:text-left">
        <div className="flex-1 space-y-4 md:space-y-6">
          <div className="flex items-center justify-center md:justify-start gap-3">
            <div className={`p-2 rounded-lg ${scoreBg} border border-white/5 overflow-hidden flex items-center justify-center w-10 h-10 md:w-11 md:h-11`}>
              {result.type === 'website' && result.url ? (
                <img 
                  src={`https://www.google.com/s2/favicons?domain=${new URL(result.url).hostname}&sz=128`}
                  alt=""
                  className="w-5 h-5 md:w-6 md:h-6 object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                  }}
                />
              ) : null}
              {result.type === 'website' ? (
                <Globe className={cn("h-5 w-5 md:h-6 md:w-6", scoreColor, result.url ? "hidden" : "")} />
              ) : (
                <FileText className={`h-5 w-5 md:h-6 md:w-6 ${scoreColor}`} />
              )}
            </div>
            <span className="text-xs md:text-sm font-bold uppercase tracking-[0.2em] text-white/40">
              {result.type === 'website' ? 'Website Analysis' : 'Contract Analysis'}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-6xl font-extrabold tracking-tight leading-tight">{result.title}</h1>
          {result.url && (
            <a href={result.url} target="_blank" rel="noopener noreferrer" className="inline-block text-white/40 hover:text-white transition-colors underline underline-offset-4 decoration-white/10 group break-all">
              {result.url}
              <ChevronRight className="inline h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform" />
            </a>
          )}
        </div>

        <div className={cn("px-8 py-6 md:px-12 md:py-10 rounded-xl flex flex-col items-center justify-center gap-1 md:gap-2 shadow-2xl border border-white/10 relative group transition-all hover:scale-105 md:hover:scale-110", scoreBg)}>
          <div className="absolute inset-0 bg-white/5 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <span className="text-[10px] md:text-sm font-bold uppercase tracking-widest text-white/40 relative z-10">Risk Score</span>
          <span className={cn("text-6xl md:text-8xl font-black font-mono leading-none tracking-tighter relative z-10", scoreColor)}>{result.risk_score}</span>
          <div className={cn("px-3 py-1 md:px-4 md:py-1.5 rounded-full text-[10px] md:text-xs font-black uppercase tracking-widest relative z-10 border border-current mt-2", scoreColor)}>
            {result.risk_score <= 3 ? 'Safe' : result.risk_score <= 7 ? 'Caution' : 'Risky'}
          </div>
        </div>
      </div>

      {/* Summary with Translation */}
      <div className="bg-[#0B1219] rounded-2xl border border-white/10 p-6 md:p-12 relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-accent-blue/5 blur-[100px] rounded-full pointer-events-none"></div>
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-6 mb-8 md:mb-10">
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Quick Summary</h2>
          <div className="flex items-center gap-2 bg-[#121923] p-1 rounded-xl border border-white/10">
             <select 
               value={targetLang || 'Spanish'}
               onChange={(e) => setTargetLang(e.target.value)}
               className="text-xs md:text-sm border-none bg-transparent rounded-lg px-3 py-1.5 md:px-4 md:py-2 focus:ring-0 text-white font-bold cursor-pointer hover:bg-white/10 transition-colors"
             >
               <option className="bg-[#050B10]">Spanish</option>
               <option className="bg-[#050B10]">French</option>
               <option className="bg-[#050B10]">German</option>
               <option className="bg-[#050B10]">Japanese</option>
             </select>
             <button 
              onClick={handleTranslate}
              disabled={isTranslating}
              className="flex items-center gap-2 text-xs md:text-sm font-bold bg-mint text-[#050B10] px-3 py-1.5 md:px-4 md:py-2 rounded-lg transition-all hover:scale-105 active:scale-95"
             >
               <Languages className="h-3.5 w-3.5 md:h-4 md:w-4" />
               {isTranslating ? '...' : translatedSummary ? 'Original' : `Translate`}
             </button>
          </div>
        </div>
        
        <p className="text-lg md:text-2xl leading-relaxed text-white/80 font-medium">
          {translatedSummary || result.summary}
        </p>
      </div>

      {/* Risks Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
        {result.risks.map((risk, index) => (
          <RiskCard key={index} risk={risk} index={index} />
        ))}
      </div>

      {/* Key Points - if available */}
      {result.key_points && (
        <div className="bg-black text-white rounded-2xl p-6 md:p-10">
          <h2 className="text-xl md:text-2xl font-bold mb-4 md:mb-6">Key Takeaways</h2>
          <ul className="space-y-3 md:space-y-4">
            {result.key_points.map((point, i) => (
              <li key={i} className="flex gap-3 md:gap-4 items-start">
                <div className="mt-1 flex h-5 w-5 md:h-6 md:w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
                   <ChevronRight className="h-3 w-3 md:h-4 md:w-4 text-white/50" />
                </div>
                <span className="text-base md:text-lg text-white/80">{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface RiskCardProps {
  risk: Risk;
  index: number;
}

const RiskCard: React.FC<RiskCardProps> = ({ risk, index }) => {
  const gradientClass = 
    risk.severity === 'low' ? 'risk-gradient-low' : 
    risk.severity === 'medium' ? 'risk-gradient-medium' : 
    'risk-gradient-high';

  const iconColor = 
    risk.severity === 'low' ? 'text-risk-low' : 
    risk.severity === 'medium' ? 'text-risk-medium' : 
    'text-risk-high';

  const Icon = risk.severity === 'high' ? AlertTriangle : risk.severity === 'medium' ? Info : CheckCircle2;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 * index }}
      className={cn("p-6 md:p-10 h-full rounded-2xl border border-white/10 flex flex-col gap-4 md:gap-6 transition-all sm:hover:scale-[1.05] hover:shadow-2xl relative overflow-hidden bg-[#0B1219] group", gradientClass)}
    >
      <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
      <div className="flex items-center justify-between relative z-10">
        <div className={cn("p-3 md:p-4 rounded-xl bg-[#050B10] border border-white/10 shadow-lg", iconColor)}>
          <Icon className="h-6 w-6 md:h-7 md:w-7" />
        </div>
        <span className={cn("text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] px-3 py-1 md:px-4 md:py-1.5 rounded-full border border-current", iconColor)}>
          {risk.severity} Risk
        </span>
      </div>
      <div className="relative z-10">
        <h3 className="text-lg md:text-2xl font-extrabold leading-tight mb-2 md:mb-3 text-white">{risk.title}</h3>
        <p className="text-white/50 text-sm md:text-base leading-relaxed font-medium">{risk.description}</p>
      </div>
      {risk.clause && (
        <div className="mt-auto pt-4 md:pt-6 border-t border-white/5 relative z-10 text-pretty">
          <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-white/20 block mb-2 md:mb-3">Original Clause</span>
          <div className="p-3 md:p-4 rounded-lg bg-black/40 border border-white/5">
            <p className="text-[10px] md:text-xs font-mono italic text-white/40 line-clamp-3 md:line-clamp-4 leading-relaxed">"{risk.clause}"</p>
          </div>
        </div>
      )}
    </motion.div>
  );
};

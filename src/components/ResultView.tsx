import React, { useState, useRef } from 'react';
import { AnalysisResult, Risk, ViewMode, Action } from '../types';
import { AlertTriangle, Info, CheckCircle2, Globe, FileText, ChevronRight, Languages, Eye, BookOpen, Tag, Camera, Volume2, Loader2, ShieldCheck } from 'lucide-react';
import { cn } from '../lib/utils';
import { translateText, speakText } from '../services/groq';
import { motion, AnimatePresence } from 'motion/react';

interface ResultViewProps {
  result: AnalysisResult;
}

export function ResultView({ result }: ResultViewProps) {
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedSummary, setTranslatedSummary] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState('Hausa');
  const [viewMode, setViewMode] = useState<ViewMode>('plain');
  const [translatedRisks, setTranslatedRisks] = useState<Record<number, { explanation: string; impact: string; title: string }> | null>(null);
  const [translatedActions, setTranslatedActions] = useState<Action[] | null>(null);
  const [speakingSection, setSpeakingSection] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSpeak = async (section: string, text: string) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (speakingSection === section) { setSpeakingSection(null); return; }
    setSpeakingSection(section);
    try {
      const audio = await speakText(text, targetLang);
      audioRef.current = audio;
      audio.play();
      audio.onended = () => setSpeakingSection(null);
    } catch { setSpeakingSection(null); }
  };

  const handleTranslate = async () => {
    if (translatedSummary) {
      setTranslatedSummary(null);
      setTranslatedRisks(null);
      setTranslatedActions(null);
      return;
    }
    setIsTranslating(true);
    try {
      const MARKER = '\n<<<SPLIT_MARKER_DO_NOT_TRANSLATE_THIS>>>\n';
      const texts: string[] = [result.summary];
      result.risks.forEach(r => {
        texts.push(r.title);
        texts.push(r.plain_explanation || r.description);
        if (r.impact_line) texts.push(r.impact_line);
      });
      // Add actions to batch
      const hasActions = result.actions && result.actions.length > 0;
      if (hasActions) {
        result.actions!.forEach(a => {
          texts.push(a.title);
          texts.push(a.advice);
        });
      }
      const combined = texts.join(MARKER);
      const translated = await translateText(
        `Translate the following text into ${targetLang}. There are sections separated by the marker "<<<SPLIT_MARKER_DO_NOT_TRANSLATE_THIS>>>". You MUST preserve these markers exactly — do not translate, modify, or remove them. Only translate the text between the markers.\n\n${combined}`,
        targetLang
      );
      const parts = translated.split('<<<SPLIT_MARKER_DO_NOT_TRANSLATE_THIS>>>').map((p: string) => p.trim());

      if (parts.length < 2) {
        console.warn('[Translate] Marker lost — displaying original text');
        setTranslatedSummary(translated.trim() || result.summary);
        setTranslatedRisks(null);
        setIsTranslating(false);
        return;
      }

      setTranslatedSummary(parts[0] || result.summary);

      let idx = 1;
      const riskTranslations: Record<number, { explanation: string; impact: string; title: string }> = {};
      result.risks.forEach((r, i) => {
        riskTranslations[i] = {
          title: parts[idx]?.trim() || r.title,
          explanation: parts[idx + 1]?.trim() || (r.plain_explanation || r.description),
          impact: r.impact_line ? (parts[idx + 2]?.trim() || r.impact_line) : '',
        };
        idx += r.impact_line ? 3 : 2;
      });
      setTranslatedRisks(riskTranslations);

      // Parse translated actions
      if (hasActions && result.actions) {
        const translatedActions = result.actions.map((a, i) => ({
          ...a,
          title: parts[idx]?.trim() || a.title,
          advice: parts[idx + 1]?.trim() || a.advice,
        }));
        idx += result.actions.length * 2;
        setTranslatedActions(translatedActions);
      }
      setTranslatedRisks(riskTranslations);
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
          <div className="flex items-center gap-2">
            <button onClick={() => handleSpeak('summary', translatedSummary || result.summary)} className={`p-1.5 rounded-lg transition-all ${speakingSection === 'summary' ? 'bg-mint text-[#050B10]' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'}`} title="Read aloud">{speakingSection === 'summary' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}</button>
            <div className="flex items-center gap-2 bg-[#121923] p-1 rounded-xl border border-white/10">
             <select 
               value={targetLang || 'Hausa'}
               onChange={(e) => setTargetLang(e.target.value)}
               className="text-xs md:text-sm border-none bg-transparent rounded-lg px-3 py-1.5 md:px-4 md:py-2 focus:ring-0 text-white font-bold cursor-pointer hover:bg-white/10 transition-colors"
             >
               <option className="bg-[#050B10]">Hausa</option>
               <option className="bg-[#050B10]">Yoruba</option>
               <option className="bg-[#050B10]">Igbo</option>
               <option className="bg-[#050B10]">English</option>
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
        </div>
        
        <p className="text-lg md:text-2xl leading-relaxed text-white/80 font-medium">
          {translatedSummary || result.summary}
        </p>
      </div>

      {/* View Mode Toggle + Risks Grid */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Flagged Clauses</h2>
        <div className="flex items-center gap-2 bg-[#121923] p-1 rounded-xl border border-white/10">
          <button onClick={() => setViewMode('legal')} className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-xs md:text-sm font-bold transition-all", viewMode === 'legal' ? "bg-white/10 text-white" : "text-white/40 hover:text-white")}>
            <BookOpen className="h-4 w-4" /> Legal View
          </button>
          <button onClick={() => setViewMode('plain')} className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-xs md:text-sm font-bold transition-all", viewMode === 'plain' ? "bg-mint text-[#050B10]" : "text-white/40 hover:text-white")}>
            <Eye className="h-4 w-4" /> Plain View
          </button>
        </div>
      </div>
      {result.highlightedImageUrl && (
        <div className="mb-6 rounded-2xl overflow-hidden border border-white/10">
          <img src={result.highlightedImageUrl} alt="Highlighted contract" className="w-full" />
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
        {result.risks.map((risk, index) => (
          <RiskCard key={index} risk={risk} index={index} viewMode={viewMode} translated={translatedRisks?.[index]} onSpeak={handleSpeak} speakingSection={speakingSection || ''} />
        ))}
      </div>

      {/* Recommended Actions */}
      {result.actions && result.actions.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-mint" />
            <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Recommended Actions</h2>
            <button onClick={() => handleSpeak('actions', result.actions!.map(a => `${a.title}. ${a.advice}`).join('. '))} className={`p-1.5 rounded-lg transition-all ${speakingSection === 'actions' ? 'bg-mint text-[#050B10]' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'}`} title="Read aloud">{speakingSection === 'actions' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {result.actions.map((action, i) => {
              const t = translatedActions?.[i];
              const title = t?.title || action.title;
              const advice = t?.advice || action.advice;
              return (
              <div key={i} className="p-5 rounded-2xl border border-mint/20 bg-mint/5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${action.urgency === 'high' ? 'text-risk-high border-risk-high/30' : action.urgency === 'medium' ? 'text-risk-medium border-risk-medium/30' : 'text-risk-low border-risk-low/30'}`}>{action.urgency} priority</span>
                  <button onClick={() => handleSpeak(`action-${i}`, `${title}. ${advice}`)} className={`p-1 rounded-lg transition-all ${speakingSection === `action-${i}` ? 'bg-mint text-[#050B10]' : 'text-white/30 hover:text-white'}`} title="Read aloud">{speakingSection === `action-${i}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}</button>
                </div>
                <h3 className="text-base md:text-lg font-extrabold text-white">{title}</h3>
                <p className="text-sm text-white/60 leading-relaxed">{advice}</p>
              </div>
              );
            })}
          </div>
        </div>
      )}

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
  viewMode: ViewMode;
  translated?: { explanation: string; impact: string; title: string } | null;
  onSpeak: (section: string, text: string) => void;
  speakingSection: string;
}

const RiskCard: React.FC<RiskCardProps> = ({ risk, index, viewMode, translated, onSpeak, speakingSection }) => {
  const gradientClass = 
    risk.severity === 'low' ? 'risk-gradient-low' : 
    risk.severity === 'medium' ? 'risk-gradient-medium' : 
    'risk-gradient-high';

  const iconColor = 
    risk.severity === 'low' ? 'text-risk-low' : 
    risk.severity === 'medium' ? 'text-risk-medium' : 
    'text-risk-high';

  const Icon = risk.severity === 'high' ? AlertTriangle : risk.severity === 'medium' ? Info : CheckCircle2;

  const explanation = translated ? translated.explanation : (viewMode === 'plain' && risk.plain_explanation ? risk.plain_explanation : risk.description);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 * index }}
      className={cn("p-6 md:p-8 h-full rounded-2xl border border-white/10 flex flex-col gap-3 md:gap-4 transition-all sm:hover:scale-[1.03] hover:shadow-2xl relative overflow-hidden bg-[#0B1219] group", gradientClass)}
    >
      <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
      <div className="flex items-center justify-between relative z-10 flex-wrap gap-2">
        <div className={cn("p-2 md:p-3 rounded-xl bg-[#050B10] border border-white/10 shadow-lg", iconColor)}>
          <Icon className="h-5 w-5 md:h-6 md:w-6" />
        </div>
        {risk.category_tag && (
          <span className="text-[9px] md:text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/50">
            <Tag className="h-3 w-3 inline mr-1" />{risk.category_tag}
          </span>
        )}
        <span className={cn("text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] px-2 py-1 rounded-full border border-current", iconColor)}>
          {risk.severity} Risk
        </span>
      </div>
      <div className="relative z-10">
        <h3 className="text-lg md:text-xl font-extrabold leading-tight mb-2 text-white">{translated?.title || risk.title}</h3>
        <p className="text-white/40 text-xs md:text-xs font-bold uppercase tracking-widest mb-2">
          {viewMode === 'plain' ? 'PLAIN LANGUAGE' : 'LEGAL EXPLANATION'}
        </p>
        <p className="text-white/60 text-sm md:text-base leading-relaxed font-medium">{explanation}</p>
      </div>
      {((risk.impact_line && !translated) || translated?.impact) && (
        <div className="mt-2 p-3 rounded-lg bg-mint/5 border border-mint/10 relative z-10">
          <p className="text-mint text-sm md:text-base font-bold italic leading-snug">"{translated?.impact || risk.impact_line}"</p>
        </div>
      )}
      <button onClick={() => onSpeak(`risk-${index}`, `${translated?.title || risk.title}. ${explanation}.${risk.impact_line ? ` ${translated?.impact || risk.impact_line}` : ''}`)} className={`mt-2 self-start flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${speakingSection === `risk-${index}` ? 'bg-mint text-[#050B10]' : 'bg-white/5 text-white/30 hover:bg-white/10 hover:text-white/60'}`}>
        {speakingSection === `risk-${index}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Volume2 className="h-3 w-3" />}
        Read aloud
      </button>
      {risk.clause && (
        <div className="mt-auto pt-4 border-t border-white/5 relative z-10 text-pretty">
          <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-white/20 block mb-2">Original Clause</span>
          <div className="p-3 rounded-lg bg-black/40 border border-white/5">
            <p className="text-[10px] md:text-xs font-mono italic text-white/40 line-clamp-3 md:line-clamp-4 leading-relaxed">"{risk.clause}"</p>
          </div>
        </div>
      )}
    </motion.div>
  );
};

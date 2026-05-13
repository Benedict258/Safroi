import React from 'react';
import { HistoryItem } from '../types';
import { Calendar, Trash2, Globe, FileText, ChevronRight, History } from 'lucide-react';
import { cn } from '../lib/utils';

interface HistoryViewProps {
  items: HistoryItem[];
  onSelectItem: (id: string) => void;
  onClear: () => void;
}

export function HistoryView({ items, onSelectItem, onClear }: HistoryViewProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 md:py-32 bg-[#0B1219] rounded-2xl border border-white/10 text-center px-6">
        <div className="h-20 w-20 md:h-24 md:w-24 flex items-center justify-center bg-white/10 rounded-full mb-6 md:mb-8">
          <History className="h-10 w-10 md:h-12 md:w-12 text-white/20" />
        </div>
        <h2 className="text-2xl md:text-3xl font-extrabold mb-3 md:mb-4">No audit history</h2>
        <p className="text-white/40 max-w-sm text-base md:text-lg font-medium">Your analyzed sites and contracts will appear here for immediate access.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-10">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-4">
        <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight italic uppercase">Your History</h2>
        <button 
          onClick={onClear}
          className="flex items-center gap-2 text-xs font-extrabold text-risk-high hover:bg-risk-high/10 px-5 py-2.5 rounded-xl border border-risk-high/20 transition-all active:scale-95"
        >
          <Trash2 className="h-4 w-4" />
          Clear All
        </button>
      </div>

      <div className="grid gap-4 md:gap-6">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelectItem(item.id)}
            className="group flex items-center gap-4 md:gap-8 p-4 md:p-8 bg-[#0B1219] rounded-2xl border border-white/10 transition-all hover:bg-[#121923] hover:border-accent-blue/30 sm:hover:scale-[1.01] text-left relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-accent-blue/5 opacity-0 group-hover:opacity-100 transition-opacity blur-3xl pointer-events-none"></div>
            
            <div className={cn(
               "h-12 w-12 md:h-16 md:w-16 flex items-center justify-center rounded-xl shrink-0 transition-all sm:group-hover:scale-110 shadow-2xl relative z-10",
               item.risk_score <= 3 ? "bg-risk-low/20 text-risk-low border border-risk-low/20" :
               item.risk_score <= 7 ? "bg-risk-medium/20 text-risk-medium border border-risk-medium/20" :
               "bg-risk-high/20 text-risk-high border border-risk-high/20"
            )}>
              {item.type === 'website' ? <Globe className="h-6 w-6 md:h-8 md:w-8" /> : <FileText className="h-6 w-6 md:h-8 md:w-8" />}
            </div>

            <div className="flex-1 min-w-0 relative z-10">
              <h3 className="text-lg md:text-xl font-extrabold truncate text-white/90 group-hover:text-white transition-colors">{item.title}</h3>
              <div className="flex flex-wrap items-center gap-3 md:gap-6 mt-1 md:mt-2 text-[10px] md:text-sm font-bold text-white/30 group-hover:text-white/40">
                <div className="flex items-center gap-1.5 md:gap-2">
                  <Calendar className="h-3.5 w-3.5 md:h-4 md:w-4" />
                  {new Date(item.timestamp).toLocaleDateString()}
                </div>
                <div className="flex items-center gap-2 px-2 py-0.5 md:px-3 md:py-1 bg-white/5 rounded-md border border-white/5 uppercase tracking-widest text-[9px] md:text-[10px]">
                  Risk Index: <span className={cn(
                    "ml-1",
                    item.risk_score <= 3 ? "text-risk-low" :
                    item.risk_score <= 7 ? "text-risk-medium" :
                    "text-risk-high"
                  )}>{item.risk_score}/10</span>
                </div>
              </div>
            </div>

            <div className="h-8 w-8 md:h-12 md:w-12 flex items-center justify-center rounded-full bg-white/5 border border-white/10 sm:group-hover:bg-accent-blue sm:group-hover:text-[#050B10] sm:group-hover:border-accent-blue transition-all relative z-10 shrink-0">
              <ChevronRight className="h-4 w-4 md:h-6 md:w-6 transition-transform group-hover:translate-x-0.5" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

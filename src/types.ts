export interface Action {
  title: string;
  advice: string;
  urgency: 'low' | 'medium' | 'high';
}

export type Severity = 'low' | 'medium' | 'high';

export type ViewMode = 'legal' | 'plain';

export interface Risk {
  title: string;
  description: string;
  severity: Severity;
  clause?: string;
  plain_explanation?: string;
  impact_line?: string;
  category_tag?: string;
}

export interface ClauseLocation {
  clauseText: string;
  severity: Severity;
  pageIndex: number;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
}

export interface AnalysisResult {
  id: string;
  timestamp: number;
  type: 'website' | 'contract';
  title: string;
  url?: string;
  summary: string;
  risk_score: number;
  risks: Risk[];
  actions?: Action[];
  key_points?: string[];
  original_text?: string;
  highlightedImageUrl?: string;
  clauseLocations?: ClauseLocation[];
  pageCount?: number;
}

export interface HistoryItem {
  id: string;
  title: string;
  type: 'website' | 'contract';
  risk_score: number;
  timestamp: number;
}

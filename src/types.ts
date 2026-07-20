export type Severity = 'low' | 'medium' | 'high';

export interface Risk {
  title: string;
  description: string;
  severity: Severity;
  clause?: string;
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
  key_points?: string[];
  original_text?: string;
}

export interface HistoryItem {
  id: string;
  title: string;
  type: 'website' | 'contract';
  risk_score: number;
  timestamp: number;
}

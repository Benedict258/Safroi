import React, { useState, useEffect } from 'react';
import { AnalysisResult, HistoryItem } from '../types';

const STORAGE_KEY = 'safroi_history';

const generateId = () => {
  try {
    return crypto.randomUUID();
  } catch (e) {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
};

export function useHistory() {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setHistory(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  const addToHistory = (result: AnalysisResult) => {
    const newItem: HistoryItem = {
      id: result.id,
      title: result.title,
      type: result.type,
      risk_score: result.risk_score,
      timestamp: result.timestamp
    };
    const updated = [newItem, ...history].slice(0, 50); // Keep last 50
    setHistory(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    localStorage.setItem(`analysis_${result.id}`, JSON.stringify(result));
  };

  const getAnalysis = (id: string): AnalysisResult | null => {
    const stored = localStorage.getItem(`analysis_${id}`);
    return stored ? JSON.parse(stored) : null;
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
    // Note: this doesn't clear individual analysis objects for simplicity
  };

  return { history, addToHistory, getAnalysis, clearHistory };
}

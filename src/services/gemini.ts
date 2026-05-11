import { AnalysisResult, Severity } from "../types";

const generateId = () => {
  try {
    return crypto.randomUUID();
  } catch (e) {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
};

const calculateRiskScore = (risks: any[]): number => {
  if (!risks || risks.length === 0) return 1;
  const weights = { low: 1, medium: 3, high: 5 };
  const total = risks.reduce((acc, r) => acc + (weights[r.severity as Severity] || 0), 0);
  const maxPossible = risks.length * 5;
  return Math.max(1, Math.min(10, Math.round((total / maxPossible) * 10)));
};

export async function analyzeWebsite(url: string): Promise<AnalysisResult> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "website", value: url })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Website analysis failed");
  }

  return response.json();
}

export async function analyzeContract(text: string, title?: string): Promise<AnalysisResult> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "contract", value: text, title })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Contract analysis failed");
  }

  const result = await response.json();
  return {
    ...result,
    risk_score: calculateRiskScore(result.risks)
  };
}

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, targetLanguage })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Translation failed");
  }

  const data = await response.json();
  return data.translatedText;
}

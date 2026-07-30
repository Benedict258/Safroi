import { AnalysisResult } from "../types";

const BASE_URL = import.meta.env.VITE_API_URL || "";

export async function analyzeWebsite(url: string): Promise<AnalysisResult> {
  const response = await fetch(`${BASE_URL}/api/analyze`, {
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
  const response = await fetch(`${BASE_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "contract", value: text, title })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Contract analysis failed");
  }

  return response.json();
}

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/translate`, {
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

export async function speakText(text: string, language: string): Promise<HTMLAudioElement> {
  const response = await fetch(`${BASE_URL}/api/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language })
  });
  if (!response.ok) throw new Error("TTS failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  return audio;
}

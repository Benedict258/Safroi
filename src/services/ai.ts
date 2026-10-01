import { GoogleGenAI } from "@google/genai";
import { createHash } from 'crypto';
import { nimChat, nimEmbed, nimConfigured, NIM_MODELS } from './nim';
import { natlasChat, natlasAvailable, NATLAS_LANGUAGES, NATLAS_MAX_INPUT_CHARS } from './natlas';

// Gemini is now an optional last-resort fallback: only used when a key is configured.
let client: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

const GEMINI_MODELS = () => [process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemma-4-26b-a4b-it", "gemma-4-31b-it"].filter(Boolean) as string[];

function warn(label: string, err: unknown) {
  console.warn(`[AI] ${label} failed:`, err instanceof Error ? err.message : err);
}

export async function analyzeText(prompt: string): Promise<string> {
  if (nimConfigured()) {
    for (const model of [NIM_MODELS.analysis, NIM_MODELS.fallback]) {
      try {
        const text = await nimChat([{ role: 'user', content: prompt }], { model, maxTokens: 8192 });
        if (text.trim().length > 5) return text;
      } catch (err) { warn(`NIM ${model}`, err); }
    }
  }
  const ai = getGeminiClient();
  if (ai) {
    for (const model of GEMINI_MODELS()) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { temperature: 0.1, maxOutputTokens: 8192 },
        });
        if (res.text && res.text.trim().length > 5) return res.text;
      } catch (err) { warn(`Gemini ${model}`, err); }
    }
  }
  throw new Error("All AI models are temporarily unavailable. Please try again in a moment.");
}

export async function analyzeImage(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
  let lastError: Error | null = null;
  if (nimConfigured()) {
    for (const model of [NIM_MODELS.vision, NIM_MODELS.fallback]) {
      try {
        return await nimChat(
          [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }] }],
          { model, maxTokens: 8192 },
        );
      } catch (err) { lastError = err instanceof Error ? err : new Error(String(err)); warn(`NIM vision ${model}`, err); }
    }
  }
  const ai = getGeminiClient();
  if (ai) {
    for (const model of GEMINI_MODELS()) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
          config: { temperature: 0.1, maxOutputTokens: 8192 },
        });
        if (res.text) return res.text;
      } catch (err) { lastError = err instanceof Error ? err : new Error(String(err)); }
    }
  }
  throw lastError || new Error("All models failed on image");
}

export function cleanTranslationOutput(raw: string, fallback: string): string {
  if (!raw) return fallback;
  let text = raw.trim();

  // If the model output markdown blocks with Option 1, extract Option 1
  const optionMatch = text.match(/(?:Option\s*1[^\n]*|\*\*Option\s*1[^\n]*)\s*\n+([^\n]+(?:\n[^\n#*-]+)*)/i);
  if (optionMatch && optionMatch[1]) {
    text = optionMatch[1].trim();
  }

  // Strip leading blockquotes
  text = text.replace(/^>+\s*/gm, '');

  // Strip trailing notes, breakdowns, vocabularies, options, etc.
  text = text.split(/\n\s*(?:---+|\*\*\*+|###|\*\*Option|\*\*Key Vocabulary|\*\*Breakdown|Key Terminology|Key Vocabulary|Note:|Notes:)/i)[0].trim();

  // Strip surrounding quotes
  text = text.replace(/^["'\s]+|["'\s]+$/g, '').trim();

  // Strip wrapping bold markers if whole text was **...**
  if (text.startsWith('**') && text.endsWith('**') && text.length > 4) {
    text = text.slice(2, -2).trim();
  }

  return text || fallback;
}

export type TranslationProvider = 'natlas' | 'nim' | 'gemini' | 'none';
export interface TranslationResult { translatedText: string; provider: TranslationProvider; }

const TRANSLATE_SYSTEM = 'You are a professional legal translator.';
const translatePrompt = (text: string, lang: string) => `Translate the following text into ${lang}.

CRITICAL RULES:
- Output ONLY the single, direct, natural, professional translation.
- NEVER provide multiple options, vocabulary breakdowns, glossaries, notes or explanations.
- Do NOT wrap the translation in quotes.

TEXT TO TRANSLATE:
${text}`;

// Translations are deterministic enough to cache; a clause explanation is often requested repeatedly.
const CACHE_MAX = 2000;
const translationCache = new Map<string, TranslationResult>();
const cacheKey = (text: string, lang: string) => createHash('sha256').update(`${lang}\n${text}`).digest('hex');

export async function translateWithMeta(text: string, targetLanguage: string): Promise<TranslationResult> {
  if (targetLanguage === 'English' || !text || text.length < 2) return { translatedText: text, provider: 'none' };
  const key = cacheKey(text, targetLanguage);
  const hit = translationCache.get(key);
  if (hit) return hit;

  const maxTokens = Math.min(2048, Math.max(256, text.length * 2));
  const messages = [
    { role: 'system' as const, content: TRANSLATE_SYSTEM },
    { role: 'user' as const, content: translatePrompt(text, targetLanguage) },
  ];
  let result: TranslationResult | null = null;

  // 1) N-ATLaS for Hausa / Yoruba / Igbo
  if (NATLAS_LANGUAGES.has(targetLanguage) && natlasAvailable() && text.length <= NATLAS_MAX_INPUT_CHARS) {
    try {
      const out = cleanTranslationOutput(await natlasChat(messages, { maxTokens }), '');
      if (out) result = { translatedText: out, provider: 'natlas' };
    } catch (err) { warn('N-ATLaS translate', err); }
  }
  // 2) NVIDIA NIM general model (the reasoning analysis model is not used here: its Hausa/Yoruba/Igbo is poor)
  if (!result && nimConfigured()) {
    try {
      const out = cleanTranslationOutput(await nimChat(messages, { model: NIM_MODELS.fallback, maxTokens, timeoutMs: 60_000 }), '');
      if (out) result = { translatedText: out, provider: 'nim' };
    } catch (err) { warn('NIM translate', err); }
  }
  // 3) Optional Gemini fallback
  const ai = !result ? getGeminiClient() : null;
  if (ai) {
    try {
      const res = await ai.models.generateContent({
        model: "gemma-4-26b-a4b-it",
        contents: [{ role: "user", parts: [{ text: translatePrompt(text, targetLanguage) }] }],
        config: { temperature: 0.1, maxOutputTokens: 2048 },
      });
      const out = cleanTranslationOutput(res.text?.trim() || '', '');
      if (out) result = { translatedText: out, provider: 'gemini' };
    } catch (err) { warn('Gemini translate', err); }
  }

  if (!result) return { translatedText: text, provider: 'none' }; // not cached: retry next time
  if (translationCache.size >= CACHE_MAX) translationCache.delete(translationCache.keys().next().value as string);
  translationCache.set(key, result);
  return result;
}

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  return (await translateWithMeta(text, targetLanguage)).translatedText;
}

export async function translateBatch(
  items: Array<{ id: string; text: string }>,
  targetLanguage: string
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  // Small concurrency: the N-ATLaS server handles one request at a time.
  const queue = [...(items || [])];
  const worker = async () => {
    for (let it = queue.shift(); it; it = queue.shift()) result[it.id] = await translateText(it.text, targetLanguage);
  };
  await Promise.all([worker(), worker()]);
  return result;
}

/** Embeddings via NVIDIA NIM. Returns [] when unavailable so callers fall back to keyword search. */
export async function generateEmbeddings(texts: string[], type: 'query' | 'passage' = 'passage'): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (nimConfigured()) {
    try { return await nimEmbed(texts, type); } catch (err) { warn('NIM embeddings', err); }
  }
  return texts.map(() => []);
}

export async function generateEmbedding(text: string, type: 'query' | 'passage' = 'passage'): Promise<number[]> {
  return (await generateEmbeddings([text], type))[0] || [];
}

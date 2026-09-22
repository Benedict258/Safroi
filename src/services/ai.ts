import { GoogleGenAI } from "@google/genai";
import { generateWithGLM5, analyzeContractWithGLM, checkImageSafety } from './nvidia-ai';

const EMBEDDING_MODELS = [
  process.env.EMBEDDING_MODEL,
  "gemini-embedding-2",
  "gemini-embedding-001",
  "gemini-embedding-2-preview"
].filter(Boolean) as string[];

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required.");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export async function analyzeText(prompt: string): Promise<string> {
  let ai: GoogleGenAI | null = null;
  try {
    ai = getClient();
  } catch (e) {
    console.warn('[AI] Gemini client error:', e);
  }

  if (ai) {
    const candidateModels = [
      process.env.GEMINI_MODEL,
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-3.8-flash",
      "gemma-4-26b-a4b-it",
      "gemma-4-31b-it"
    ].filter(Boolean) as string[];

    for (const model of candidateModels) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { temperature: 0.1, maxOutputTokens: 8192 },
        });
        const text = res.text || "";
        if (text && text.trim().length > 5) {
          return text;
        }
      } catch (err) {
        console.warn(`[AI] Model ${model} failed, trying next candidate:`, err instanceof Error ? err.message : err);
      }
    }
  }

  try {
    const nimRes = await generateWithGLM5([{ role: 'user', content: prompt }]);
    if (nimRes && nimRes.trim().length > 5) return nimRes;
  } catch (nimErr) {
    console.warn('[AI] NIM fallback failed:', nimErr);
  }

  throw new Error("All AI models are temporarily unavailable. Please try again in a moment.");
}

export async function analyzeImage(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
  const ai = getClient();
  let lastError: Error | null = null;
  const imageModels = [
    process.env.GEMINI_MODEL,
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3.8-flash",
    "gemma-4-26b-a4b-it",
    "gemma-4-31b-it"
  ].filter(Boolean) as string[];

  for (const model of imageModels) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
        config: { temperature: 0.1, maxOutputTokens: 8192 },
      });
      return res.text || "";
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
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

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  if (targetLanguage === 'English') return text;
  if (!text || text.length < 2) return text;
  try {
    const ai = getClient();
    const prompt = `You are a professional legal translator. Translate the following text into ${targetLanguage}.

CRITICAL RULES:
- Output ONLY the single, direct, natural, professional translation.
- NEVER provide multiple options (do NOT write "Option 1", "Option 2", etc.).
- NEVER provide vocabulary breakdowns, glossaries, notes, bullet points, or grammatical explanations.
- Do NOT wrap the translation in quotes or blockquotes (>).
- Output ONLY the translated text.

TEXT TO TRANSLATE:
${text}`;

    const res = await ai.models.generateContent({
      model: "gemma-4-26b-a4b-it",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.1, maxOutputTokens: 2048 },
    });
    const raw = res.text?.trim() || '';
    return cleanTranslationOutput(raw, text);
  } catch (err) {
    console.warn('[Translate] Error:', err);
    return text;
  }
}

export async function translateBatch(
  items: Array<{ id: string; text: string }>,
  targetLanguage: string
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!items || items.length === 0) return result;

  if (targetLanguage === 'English') {
    items.forEach(it => { result[it.id] = it.text; });
    return result;
  }

  try {
    const ai = getClient();
    const prompt = `You are a professional legal translator. Translate the provided list of text entries into ${targetLanguage}.

CRITICAL RULES:
- Return ONLY a valid JSON object where keys are the input "id"s and values are the single, direct, natural, high quality translations.
- Do NOT provide multiple options or alternatives.
- Do NOT include vocabulary breakdowns, glossaries, notes, bullet points, or explanations.
- Do NOT wrap translated values in quotes or blockquotes.
- Output ONLY valid JSON, no markdown outside of JSON.

INPUT ITEMS:
${JSON.stringify(items.map(it => ({ id: it.id, text: it.text })), null, 2)}`;

    const res = await ai.models.generateContent({
      model: "gemma-4-26b-a4b-it",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.1, maxOutputTokens: 4096 },
    });

    const raw = res.text?.trim() || '';
    // Extract JSON block if present
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      items.forEach(it => {
        const val = parsed[it.id];
        result[it.id] = typeof val === 'string' ? cleanTranslationOutput(val, it.text) : it.text;
      });
      return result;
    }
  } catch (err) {
    console.warn('[TranslateBatch] Batch failed, falling back to individual:', err);
  }

  // Fallback: translate individually in parallel with limit
  await Promise.all(
    items.map(async (it) => {
      result[it.id] = await translateText(it.text, targetLanguage);
    })
  );
  return result;
}

export function generateLocalVector(text: string, dims = 128): number[] {
  const vec = new Array(dims).fill(0);
  const words = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return vec;
  
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dims;
    vec[idx] += 1;
  }
  
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dims; i++) vec[i] /= norm;
  }
  return vec;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const ai = getClient();
    for (const model of EMBEDDING_MODELS) {
      try {
        const res = await ai.models.embedContent({
          model,
          contents: text,
        });
        const values = res.embeddings?.[0]?.values || (res as any).embedding?.values;
        if (values && values.length > 0) {
          return values;
        }
      } catch {
        // try next embedding model candidate
      }
    }
  } catch (err) {
    console.warn('[Embedding] AI client unavailable for embedding:', err);
  }
  return generateLocalVector(text, 128);
}

// NVIDIA NIM Integration for GLM-5.3
export async function analyzeContractNIM(
  contractText: string,
  targetLanguage: string = 'English'
): Promise<string> {
  return analyzeContractWithGLM(contractText, targetLanguage);
}

export async function checkImageSafetyNIM(
  imageBase64: string,
  mimeType: string
): Promise<{ safe: boolean; reasons?: string[] }> {
  return checkImageSafety(imageBase64, mimeType);
}


import { GoogleGenAI } from "@google/genai";

const MODEL = process.env.GEMINI_MODEL || "gemma-4-26b-a4b-it";
const FALLBACK_MODEL = "gemma-4-31b-it";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required. Get one at https://aistudio.google.com/apikey");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export async function analyzeText(prompt: string): Promise<string> {
  const ai = getClient();
  let lastError: Error | null = null;

  for (const model of [MODEL, FALLBACK_MODEL]) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature: 0.1, maxOutputTokens: 8192 },
      });
      const text = res.text || "";
      if (!text || text.length < 20) {
        console.warn(`[Gemini] ${model} returned empty/short text (${text.length} chars).`);
        if (model === FALLBACK_MODEL) throw new Error("Empty response");
        continue;
      }
      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (model === FALLBACK_MODEL) throw lastError;
      console.warn(`[Gemini] ${model} failed, trying ${FALLBACK_MODEL}...`);
    }
  }
  throw lastError || new Error("All models failed");
}

export async function analyzeImage(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
  const ai = getClient();
  let lastError: Error | null = null;

  for (const model of [MODEL, FALLBACK_MODEL]) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        }],
        config: { temperature: 0.1, maxOutputTokens: 8192 },
      });
      return res.text || "";
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (model === FALLBACK_MODEL) throw lastError;
      console.warn(`[Gemini] ${model} failed on image, trying ${FALLBACK_MODEL}...`);
    }
  }
  throw lastError || new Error("All models failed on image");
}

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  const ai = getClient();
  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [{
        role: "user",
        parts: [{ text: `Translate the following text into ${targetLanguage}. Return ONLY the translation, nothing else. TEXT:\n\n${text}` }],
      }],
      config: { temperature: 0.1, maxOutputTokens: 4096 },
    });
    return res.text?.trim() || text;
  } catch {
    return text;
  }
}

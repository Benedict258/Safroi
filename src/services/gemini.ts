import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult, Severity } from "../types";

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

const generateId = () => {
  try {
    return crypto.randomUUID();
  } catch (e) {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
};

const getHostname = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return url;
  }
};

export async function analyzeWebsite(url: string, content?: string): Promise<AnalysisResult> {
  try {
    const ai = getAI();
    const prompt = `Analyze the following website Terms of Service or Privacy Policy. 
    URL: ${url}
    ${content ? `Content: ${content}` : "Please use your built-in search grounding to find the terms of service if not provided."}

    Your job is to simplify and identify risks for a normal user.
    Return your response STRICTLY in the requested JSON format.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        toolConfig: { includeServerSideToolInvocations: true },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            risk_score: { type: Type.NUMBER },
            risks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  severity: { type: Type.STRING, enum: ["low", "medium", "high"] }
                },
                required: ["title", "description", "severity"]
              }
            }
          },
          required: ["summary", "risk_score", "risks"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    
    return {
      id: generateId(),
      timestamp: Date.now(),
      type: 'website',
      title: getHostname(url),
      url,
      ...parsed
    };
  } catch (error) {
    console.error("Website Analysis Error:", error);
    // Fallback to proxy if frontend call fails (e.g. CORS or other issues)
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
}

export async function analyzeContract(text: string, title?: string): Promise<AnalysisResult> {
  try {
    const ai = getAI();
    const prompt = `Analyze the contract below and highlight risky or important clauses.
    
    CONTRACT TEXT:
    ${text}

    Return ONLY JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            key_points: { type: Type.ARRAY, items: { type: Type.STRING } },
            risks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  clause: { type: Type.STRING },
                  risk: { type: Type.STRING },
                  severity: { type: Type.STRING, enum: ["low", "medium", "high"] }
                },
                required: ["clause", "risk", "severity"]
              }
            }
          },
          required: ["summary", "key_points", "risks"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    
    const risks = parsed.risks.map((r: any) => ({
      title: r.clause,
      description: r.risk,
      severity: r.severity
    }));

    return {
      id: generateId(),
      timestamp: Date.now(),
      type: 'contract',
      title: title || "Contract Analysis",
      summary: parsed.summary,
      key_points: parsed.key_points,
      risk_score: calculateRiskScore(risks),
      risks,
      original_text: text
    };
  } catch (error) {
    console.error("Contract Analysis Error:", error);
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
}

function calculateRiskScore(risks: any[]): number {
  if (!risks || risks.length === 0) return 1;
  const weights = { low: 1, medium: 3, high: 5 };
  const total = risks.reduce((acc, r) => acc + (weights[r.severity as Severity] || 0), 0);
  const maxPossible = risks.length * 5;
  return Math.max(1, Math.min(10, Math.round((total / maxPossible) * 10)));
}

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  try {
    const ai = getAI();
    const prompt = `Translate the following text into ${targetLanguage}. 
    Keep it simple and natural for everyday understanding.
    
    TEXT:
    ${text}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt
    });

    return response.text || text;
  } catch (error) {
    console.error("Translation Error:", error);
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
}

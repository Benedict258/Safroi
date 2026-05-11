import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import AdmZip from "adm-zip";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini on the backend for the extension proxy
let aiInstance: GoogleGenAI | null = null;
function getAI() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "") {
      throw new Error("GEMINI_API_KEY is not configured or is a placeholder");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API endpoint for health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", service: "ClauseLens API" });
  });

  // Download Chrome Extension as ZIP
  app.get("/api/download-extension", (req, res) => {
    try {
      const zip = new AdmZip();
      const extensionDir = path.join(process.cwd(), "chrome-extension");
      
      if (fs.existsSync(extensionDir)) {
        zip.addLocalFolder(extensionDir);
        const zipBuffer = zip.toBuffer();
        
        res.set({
          "Content-Type": "application/zip",
          "Content-Disposition": "attachment; filename=clauselens_extension.zip",
          "Content-Length": zipBuffer.length,
        });
        
        res.send(zipBuffer);
      } else {
        res.status(404).json({ error: "Extension files not found" });
      }
    } catch (error) {
      console.error("Download Error:", error);
      res.status(500).json({ error: "Failed to package extension" });
    }
  });

  // Proxy endpoint for AI Analysis
  app.post("/api/analyze", async (req, res) => {
    try {
      let { type, value, title, url } = req.body;
      
      // Backward compatibility for Chrome Extension
      if (url && !value) {
        value = url;
        type = 'website';
      }

      if (!value) return res.status(400).json({ error: "Value is required" });

      const ai = getAI();
      
      if (type === 'website') {
        const prompt = `Analyze the following website Terms of Service or Privacy Policy. 
        URL: ${value}
        Please use your built-in search grounding to find the terms of service.

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
        let hostname = value;
        try { hostname = new URL(value).hostname; } catch(e) {}

        res.json({
          id: Math.random().toString(36).substring(7),
          timestamp: Date.now(),
          type: 'website',
          title: hostname,
          url: value,
          ...parsed
        });
      } else {
        // Contract analysis
        const prompt = `Analyze the contract below and highlight risky or important clauses.
        
        CONTRACT TEXT:
        ${value}

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

        res.json({
          id: Math.random().toString(36).substring(7),
          timestamp: Date.now(),
          type: 'contract',
          title: title || "Contract Analysis",
          summary: parsed.summary,
          key_points: parsed.key_points,
          risks,
          original_text: value
        });
      }
    } catch (error) {
      console.error("AI Analysis Error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Analysis failed" });
    }
  });

  // Translation endpoint
  app.post("/api/translate", async (req, res) => {
    try {
      const { text, targetLanguage } = req.body;
      if (!text || !targetLanguage) return res.status(400).json({ error: "Text and targetLanguage are required" });

      const ai = getAI();
      const prompt = `Translate the following text into ${targetLanguage}. 
      Keep it simple and natural for everyday understanding.
      
      TEXT:
      ${text}`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });

      res.json({ translatedText: response.text || text });
    } catch (error) {
      console.error("Translation Error:", error);
      res.status(500).json({ error: "Translation failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

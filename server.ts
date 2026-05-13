import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import AdmZip from "adm-zip";
import fs from "fs";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Groq on the backend
let groq: OpenAI | null = null;
function getAI() {
  if (!groq) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.error("CRITICAL: GROQ_API_KEY is not defined in process.env");
      throw new Error("GROQ_API_KEY is missing. Please ensure it is set in the AI Studio Settings/Secrets menu.");
    }
    
    groq = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1"
    });
  }
  return groq;
}

// Google Search Tool via Serper.dev
async function googleSearch(query: string) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn("Search attempted but SERPER_API_KEY is missing.");
    return "Search results unavailable: API key not configured.";
  }

  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ q: query })
    });
    
    const data = await response.json();
    const results = data.organic?.slice(0, 3).map((r: any) => ({
      title: r.title,
      link: r.link,
      snippet: r.snippet
    }));
    
    return JSON.stringify(results || "No results found.");
  } catch (error) {
    console.error("Search Error:", error);
    return "Search failed due to technical error.";
  }
}

// Simple URL safety check and fetcher
async function fetchWebsiteContent(url: string) {
  try {
    const parsedUrl = new URL(url);
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0'];
    if (blockedHosts.includes(parsedUrl.hostname) || parsedUrl.hostname.startsWith('192.168.') || parsedUrl.hostname.startsWith('10.')) {
      throw new Error("Private networks are blocked for security.");
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ClauseLensBot/1.0; +https://clauselens.ai)'
      }
    });
    
    if (!response.ok) throw new Error(`Failed to fetch website: ${response.statusText}`);
    
    const text = await response.text();
    // Simple text extraction (strip tags)
    return text.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")
               .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, "")
               .replace(/<[^>]+>/g, ' ')
               .replace(/\s+/g, ' ')
               .trim()
               .substring(0, 15000); // Limit to 15k chars for prompt
  } catch (error) {
    console.error("Fetch Error:", error);
    return null;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
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
        
        // Inject dynamic config based on current request host
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');
        const config = {
          BASE_URL: `${protocol}://${host}`,
          VERSION: "2.0.0",
          MODEL: "Groq Llama-3"
        };
        
        zip.addFile("config.json", Buffer.from(JSON.stringify(config, null, 2)));
        
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
      const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
      
      if (type === 'website') {
        const content = await fetchWebsiteContent(value);
        const systemPrompt = `You are a legal risk analyzer expert. 
        Your goal is to simplify complex Terms of Service or Privacy Policies and identify potential risks for everyday users.
        ${content ? "" : "You have access to a tool called 'googleSearch' to find latest policy information if the provided content is insufficient."}
        DO NOT invent or use any other tools. 
        Return the final result as a JSON object directly following the requested schema.`;

        const userPrompt = `Analyze the following website Terms of Service or Privacy Policy. 
        URL: ${value}
        ${content ? `CONTENT: ${content}` : "The content could not be fetched directly. Please USE THE googleSearch tool to find a summary of the terms of service for this website."}

        Response must be valid JSON with this schema:
        {
          "summary": "string",
          "risk_score": number (1-10),
          "risks": [{"title": "string", "description": "string", "severity": "low"|"medium"|"high"}]
        }`;

        let chatCompletion;
        
        if (content) {
          // Path A: FAST PATH - Content already available, no tools needed
          chatCompletion = await ai.chat.completions.create({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
            model: model,
            response_format: { type: "json_object" },
            temperature: 0.1
          });
        } else {
          // Path B: SEARCH PATH - Need to use search tools
          const tools: any[] = [
            {
              type: "function",
              function: {
                name: "googleSearch",
                description: "Search Google for the latest terms or policies of a company",
                parameters: {
                  type: "object",
                  properties: {
                    query: { type: "string", description: "The search query" }
                  },
                  required: ["query"]
                }
              }
            }
          ];

          let messages: any[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ];
          
          let toolCallCompletion = await ai.chat.completions.create({
            messages,
            model: model,
            tools: tools,
            tool_choice: "auto",
            temperature: 0.1
          });

          const responseMessage = toolCallCompletion.choices[0].message;
          if (responseMessage.tool_calls) {
            messages.push(responseMessage);
            
            for (const toolCall of responseMessage.tool_calls) {
              const tc = toolCall as any;
              const functionInstanceName = tc.function.name;
              const functionArgs = JSON.parse(tc.function.arguments);
              
              if (functionInstanceName === 'googleSearch') {
                const searchResult = await googleSearch(functionArgs.query);
                messages.push({
                  tool_call_id: tc.id,
                  role: "tool",
                  name: functionInstanceName,
                  content: searchResult,
                });
              }
            }
            
            chatCompletion = await ai.chat.completions.create({
              messages,
              model: model,
              response_format: { type: "json_object" },
              temperature: 0.1
            });
          } else {
            // Fallback if it didn't use tools but still needs to return JSON
            chatCompletion = await ai.chat.completions.create({
              messages,
              model: model,
              response_format: { type: "json_object" },
              temperature: 0.1
            });
          }
        }

        const parsed = JSON.parse(chatCompletion.choices[0].message.content || "{}");
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
        const systemPrompt = `You are a legal risk analyzer expert. 
        Analyze the contract text and highlight risky or important clauses.
        Provide clear, simplified explanations for a layperson.`;

        const userPrompt = `CONTRACT TEXT:
        ${value}

        Response must be valid JSON with this schema:
        {
          "summary": "string",
          "key_points": ["string"],
          "risks": [{"clause": "string", "risk": "string", "severity": "low"|"medium"|"high"}]
        }`;

        const chatCompletion = await ai.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          model: model,
          response_format: { type: "json_object" },
          temperature: 0.1
        });

        const parsed = JSON.parse(chatCompletion.choices[0].message.content || "{}");
        const risks = (parsed.risks || []).map((r: any) => ({
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
      const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
      
      const prompt = `Translate the following text into ${targetLanguage}. 
      Keep it simple and natural for everyday understanding. Return ONLY the translated text.
      
      TEXT:
      ${text}`;

      const chatCompletion = await ai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: model
      });

      res.json({ translatedText: chatCompletion.choices[0].message.content?.trim() || text });
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

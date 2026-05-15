import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import AdmZip from "adm-zip";
import fs from "fs";
import cors from "cors";
import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail,
  updateProfile
} from "firebase/auth";

// Load Firebase config manually for better compatibility with bundlers
let firebaseConfig: any;
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } else {
    console.warn("firebase-applet-config.json not found. Backend auth proxy will be disabled.");
  }
} catch (error) {
  console.error("Error loading firebase-applet-config.json:", error);
}


// Path resolution is handled via process.cwd() for bundled compatibility

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

    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgents[0],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });
    
    if (!response.ok) return null;
    
    const html = await response.text();
    
    // Extract metadata
    let title = "";
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) title = titleMatch[1].trim();
    
    let favicon = "";
    const iconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["'][^>]*>/i) ||
                    html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["'][^>]*>/i) ||
                    html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["'][^>]*>/i) ||
                    html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    
    if (iconMatch) {
      favicon = iconMatch[1];
      if (favicon && !favicon.startsWith('http')) {
        favicon = new URL(favicon, url).href;
      }
    } else {
      // Fallback to standard /favicon.ico
      favicon = `${parsedUrl.origin}/favicon.ico`;
    }

    // Clean text for AI
    const content = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")
               .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, "")
               .replace(/<[^>]+>/g, ' ')
               .replace(/\s+/g, ' ')
               .trim()
               .substring(0, 15000);

    return { content, title, favicon };
  } catch (error) {
    console.error("Fetch Error:", error);
    return null;
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Initialize Firebase for backend auth proxy if config exists
  if (firebaseConfig) {
    try {
      initializeApp(firebaseConfig);
      console.log("Firebase initialized for backend auth.");
    } catch (error) {
      console.error("Firebase initialization failed:", error);
    }
  }

  // Professional Email Template for reference
  const getProfessionalResetEmail = (email: string) => `
    <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; background-color: #050B10; color: #FFFFFF; border-radius: 24px; border: 1px solid rgba(255, 255, 255, 0.1);">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #22E4A2; font-size: 28px; font-weight: 900; letter-spacing: -1px; margin: 0;">ClauseLens</h1>
        <p style="color: rgba(255, 255, 255, 0.6); font-size: 14px; margin-top: 8px;">Smart Contract Intelligence</p>
      </div>
      
      <div style="background-color: rgba(255, 255, 255, 0.03); padding: 32px; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.05);">
        <h2 style="font-size: 20px; font-weight: 700; margin-top: 0; margin-bottom: 16px;">Reset your password</h2>
        <p style="line-height: 1.6; color: rgba(255, 255, 255, 0.8);">Hello,</p>
        <p style="line-height: 1.6; color: rgba(255, 255, 255, 0.8);">We received a request to reset the password for your ClauseLens account (${email}). If you didn't request this, you can safely ignore this email.</p>
        
        <div style="margin: 32px 0; text-align: center;">
          <a href="{{URL}}" style="background-color: #22E4A2; color: #050B10; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 900; display: inline-block; transition: all 0.2s ease;">
            Reset Password
          </a>
        </div>
        
        <p style="font-size: 12px; color: rgba(255, 255, 255, 0.4); margin-top: 24px;">Note: This link will expire in 1 hour.</p>
      </div>
      
      <div style="text-align: center; margin-top: 32px;">
        <p style="font-size: 12px; color: rgba(255, 255, 255, 0.3);">
          &copy; 2026 ClauseLens AI. All rights reserved.<br/>
          Designed for clarity and security.
        </p>
      </div>
    </div>
  `;

  // Enable CORS for all origins, including chrome extensions
  app.use(cors({
    origin: true, // Reflect request origin
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
  app.use(express.json());

  // Logging middleware for API requests
  app.use("/api", (req, res, next) => {
    console.log(`[API] ${req.method} ${req.path} - Origin: ${req.headers.origin}`);
    next();
  });

  // API endpoint for health check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      service: "ClauseLens API",
      env: {
        hasGroqKey: !!process.env.GROQ_API_KEY,
        hasSerperKey: !!process.env.SERPER_API_KEY,
        nodeEnv: process.env.NODE_ENV
      }
    });
  });

  app.get("/api/ping", (req, res) => {
    res.send("pong"); // Simple text response for testing
  });

  // Auth Endpoints for Extension
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    
    try {
      const auth = getAuth();
      const result = await signInWithEmailAndPassword(auth, email, password);
      res.json({
        uid: result.user.uid,
        email: result.user.email,
        displayName: result.user.displayName || email.split('@')[0],
        loggedIn: true
      });
    } catch (error: any) {
      console.error("Extension login error:", error);
      res.status(401).json({ error: error.message || "Invalid credentials" });
    }
  });

  app.post("/api/auth/signup", async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: "Email, password and name required" });
    
    try {
      const auth = getAuth();
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(result.user, { displayName: name });
      res.json({
        uid: result.user.uid,
        email: result.user.email,
        displayName: name,
        loggedIn: true
      });
    } catch (error: any) {
      console.error("Extension signup error:", error);
      res.status(400).json({ error: error.message || "Signup failed" });
    }
  });

  app.post("/api/auth/reset", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    
    try {
      const auth = getAuth();
      await sendPasswordResetEmail(auth, email);
      
      // Log the professional template to server logs so the admin can see it
      console.log("Professional Email Template triggered for:", email);
      console.log("Template Preview:", getProfessionalResetEmail(email));
      
      res.json({ 
        message: "Reset link sent",
        templateRecommendation: "To align with our professional UI, we recommend updating your Firebase Console Email Template with the customized ClauseLens design."
      });
    } catch (error: any) {
      console.error("Extension reset error:", error);
      res.status(400).json({ error: error.message || "Reset failed" });
    }
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
        const fetchRest = await fetchWebsiteContent(value);
        const content = fetchRest?.content;
        const fetchedTitle = fetchRest?.title;
        const fetchedFavicon = fetchRest?.favicon;

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
          title: title || fetchedTitle || hostname,
          url: value,
          favicon: req.body.favicon || fetchedFavicon || "",
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

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled Server Error:", err);
    res.status(500).json({ 
      error: "Internal Server Error", 
      message: err.message || "An unexpected error occurred",
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

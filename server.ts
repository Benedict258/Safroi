import 'dotenv/config';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import AdmZip from "adm-zip";
import fs from "fs";
import cors from "cors";
import { connectDB } from "./src/db/index";
import { User, Analysis } from "./src/db/models";
import { ocrImage, highlightImage } from "./src/ocr/index";
import { analyzeText, analyzeImage, translateText } from "./src/services/ai";

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

function signToken(userId: string) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}


interface SearchResultItem {
  title: string;
  link: string;
  snippet: string;
}

function extractJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}


// Path resolution is handled via process.cwd() for bundled compatibility

// Gemini/Gemma AI — auto-detects GEMINI_API_KEY or GOOGLE_API_KEY
function validateEnv() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    console.warn('WARNING: GEMINI_API_KEY or GOOGLE_API_KEY not set.');
    console.warn('AI features will fail. Get a key at https://aistudio.google.com/apikey');
    return false;
  }
  console.log('Gemini API key found.');
  return true;
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
    const results = data.organic?.slice(0, 3).map((r: SearchResultItem) => ({
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

// Hardened URL safety check and fetcher
async function fetchWebsiteContent(url: string) {
  try {
    if (url.length > 2048) {
      throw new Error("URL exceeds maximum length.");
    }

    const parsedUrl = new URL(url);

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error("Only HTTP and HTTPS protocols are allowed.");
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    const isPrivate = 
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '[::1]' ||
      hostname === '[::]' ||
      hostname.match(/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|fc|fd)/) ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.match(/^0x[0-9a-f]+$/i) ||
      hostname.match(/^0[0-7]+$/);

    if (isPrivate) {
      throw new Error("Private and internal networks are blocked for security.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) return null;

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        return null;
      }

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
  validateEnv();
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Enable CORS for all origins, including chrome extensions
  app.use(cors({
    origin: (origin, callback) => {
      // Allow all origins (required for Chrome Extension support)
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
  app.use(express.json({ limit: '10mb' }));

  // Logging middleware for API requests
  app.use("/api", (req, res, next) => {
    console.log(`[API] ${req.method} ${req.path} - Origin: ${req.headers.origin}`);
    next();
  });

  // API endpoint for health check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      service: "Safroi API",
      env: {
        hasGeminiKey: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
        hasSerperKey: !!process.env.SERPER_API_KEY,
        nodeEnv: process.env.NODE_ENV
      }
    });
  });

  app.get("/api/ping", (req, res) => {
    res.send("pong"); // Simple text response for testing
  });

  // Auth (MongoDB + JWT)
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) return res.status(400).json({ error: "Email, password, and name required." });
      const existing = await User.findOne({ email: email.toLowerCase() } as any);
      if (existing) return res.status(409).json({ error: "Email already registered." });
      const id = crypto.randomUUID();
      const user = await User.create({ _id: id, email: email.toLowerCase(), displayName: name, password });
      const token = signToken(id);
      res.json({ uid: id, email: user.email, displayName: user.displayName, token, loggedIn: true });
    } catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Signup failed." }); }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: "Email and password required." });
      const user = await User.findOne({ email: email.toLowerCase() } as any);
      if (!user) return res.status(401).json({ error: "Invalid credentials." });
      const match = await (user as any).comparePassword(password);
      if (!match) return res.status(401).json({ error: "Invalid credentials." });
      const token = signToken(user._id);
      res.json({ uid: user._id, email: user.email, displayName: user.displayName, token, loggedIn: true });
    } catch (err) { res.status(401).json({ error: "Login failed." }); }
  });

  app.post("/api/auth/reset", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email required." });
      res.json({ message: "If that email exists, a reset link has been sent." });
    } catch (err) { res.status(500).json({ error: "Reset failed." }); }
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
          "Content-Disposition": "attachment; filename=safroi_extension.zip",
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

  // Gemma 4 AI Analysis
  app.post("/api/analyze", async (req, res) => {
    try {
      let { type, value, title, url } = req.body;
      if (url && !value) { value = url; type = 'website'; }
      if (!value) return res.status(400).json({ error: "Value is required" });

      const BASE_PROMPT = `You are a contract detective protecting gig workers and tenants from exploitative clauses. Return ONLY valid JSON, no markdown, no backticks.

For EACH risky clause, produce TWO explanations:
- "description": legal/technical explanation
- "plain_explanation": everyday language for someone with no legal literacy
- "impact_line": one-sentence real-world consequence (e.g. "This could mean you're let go with no notice and no final pay.")
- "category_tag": short label like "Termination Risk", "Wage Deduction", "Unpaid Overtime", "Eviction Risk"

JSON schema: {"summary":"string","risk_score":number(1-10),"risks":[{"title":"string","description":"string","severity":"low|medium|high","plain_explanation":"string","impact_line":"string","category_tag":"string"}${type === 'contract' ? `${','}"key_points":["string"]` : ''}]}`;

      if (type === 'website') {
        const fetchRest = await fetchWebsiteContent(value);
        let prompt = BASE_PROMPT + `\nURL: ${value}\nTEXT: ${fetchRest?.content || ''}`;

        if (!fetchRest?.content) {
          const searchQuery = `${value} terms of service privacy policy`;
          const searchResult = await googleSearch(searchQuery);
          prompt = BASE_PROMPT + `\nURL: ${value}\nThe page couldn't be fetched directly. Here are search results:\n${searchResult}\n\nAnalyze what you can from these search results. Return JSON.`;
        }
        const raw = await analyzeText(prompt);
        const parsed = JSON.parse(extractJSON(raw));
        let hostname = value; try { hostname = new URL(value).hostname; } catch {}
        res.json({ id: crypto.randomUUID(), timestamp: Date.now(), type: 'website', title: title || fetchRest?.title || hostname, url: value, favicon: req.body.favicon || fetchRest?.favicon || "", ...parsed });
      } else {
        const prompt = BASE_PROMPT + `\nCONTRACT TEXT:\n${value}`;
        const raw = await analyzeText(prompt);
        const parsed = JSON.parse(extractJSON(raw));
        const risks = (parsed.risks || []).map((r: any) => ({ title: r.clause || r.title, description: r.risk || r.description, severity: r.severity || 'medium', plain_explanation: r.plain_explanation, impact_line: r.impact_line, category_tag: r.category_tag }));
        res.json({ id: crypto.randomUUID(), timestamp: Date.now(), type: 'contract', title: title || "Contract Analysis", risk_score: parsed.risk_score || 1, summary: parsed.summary, key_points: parsed.key_points, risks, original_text: value });
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
      const translated = await translateText(text, targetLanguage);
      res.json({ translatedText: translated });
    } catch (error) {
      console.error("Translation Error:", error);
      res.status(500).json({ error: "Translation failed" });
    }
  });

  // OCR + Analysis endpoint for photo/contract uploads
  app.post("/api/ocr-analyze", async (req, res) => {
    try {
      const { image, useDirectImage } = req.body;
      if (!image) return res.status(400).json({ error: "Image (base64) required." });

      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const mimeType = image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';

      console.log(`[OCR] Processing image (${(imageBuffer.length / 1024).toFixed(1)} KB)...`);

      const prompt = `You are a contract detective protecting gig workers and tenants. Analyze this employment contract or lease photograph. Return ONLY valid JSON (no markdown, no backticks) with:
{"summary":"string","risk_score":number(1-10),"risks":[{"clause":"string","risk":"string","severity":"low|medium|high","plain_explanation":"string","impact_line":"string","category_tag":"string"}]}`;

      let raw: string;
      let pathUsed = 'ocr';

      if (useDirectImage) {
        console.log('[OCR] Using multimodal (direct image) path...');
        raw = await analyzeImage(base64Data, mimeType, prompt);
        pathUsed = 'multimodal';
      } else {
        const ocrResult = await ocrImage(imageBuffer);
        console.log(`[OCR] Extracted ${ocrResult.text.length} chars.`);
        raw = await analyzeText(`Analyze this employment contract or lease. Return ONLY valid JSON (no markdown, no backticks) with summary, risk_score, risks[{clause,risk,severity,plain_explanation,impact_line,category_tag}].\n\nCONTRACT TEXT:\n${ocrResult.text}`);
      }

      const parsed = JSON.parse(extractJSON(raw));
      const risks = (parsed.risks || []).map((r: any) => ({
        title: r.clause, description: r.risk, severity: r.severity || 'medium',
        plain_explanation: r.plain_explanation, impact_line: r.impact_line, category_tag: r.category_tag,
      }));

      res.json({ id: crypto.randomUUID(), timestamp: Date.now(), type: 'contract', title: "Scanned Document", summary: parsed.summary, risk_score: parsed.risk_score || 1, risks, path: pathUsed });
    } catch (err) {
      console.error("[OCR] Error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "OCR/Analysis failed." });
    }
  });

  // History API (MongoDB-backed)
  app.post("/api/history", async (req, res) => {
    try {
      const { userId, analysis } = req.body;
      if (!userId || !analysis) return res.status(400).json({ error: "userId and analysis required" });
      await Analysis.findOneAndUpdate(
        { _id: analysis.id } as any,
        {
          _id: analysis.id,
          userId,
          type: analysis.type,
          title: analysis.title,
          url: analysis.url,
          summary: analysis.summary,
          risk_score: analysis.risk_score,
          risks: analysis.risks || [],
          key_points: analysis.key_points,
          original_text: analysis.original_text,
        },
        { upsert: true, new: true }
      );
      await User.findOneAndUpdate(
        { _id: userId } as any,
        { _id: userId, email: userId, displayName: userId },
        { upsert: true, returnDocument: 'after' }
      );
      res.json({ saved: true });
    } catch (err) {
      console.error("History save error:", err);
      res.status(500).json({ error: "Failed to save analysis" });
    }
  });

  app.get("/api/history/:userId", async (req, res) => {
    try {
      const items = await Analysis.find({ userId: req.params.userId } as any)
        .select('_id type title url risk_score created_at')
        .sort({ created_at: -1 })
        .limit(50);
      res.json(items);
    } catch (err) {
      console.error("History fetch error:", err);
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  app.get("/api/history/:userId/:id", async (req, res) => {
    try {
      const item = await Analysis.findOne({ _id: req.params.id, userId: req.params.userId } as any);
      if (!item) return res.status(404).json({ error: "Not found" });
      res.json(item);
    } catch (err) {
      console.error("History detail error:", err);
      res.status(500).json({ error: "Failed to fetch analysis" });
    }
  });

  app.delete("/api/history/:userId/:id", async (req, res) => {
    try {
      await Analysis.deleteOne({ _id: req.params.id, userId: req.params.userId } as any);
      res.json({ deleted: true });
    } catch (err) {
      console.error("History delete error:", err);
      res.status(500).json({ error: "Failed to delete analysis" });
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
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled Server Error:", err);
    res.status(500).json({ 
      error: "Internal Server Error", 
      message: err.message || "An unexpected error occurred",
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    connectDB();
  });
}

startServer();

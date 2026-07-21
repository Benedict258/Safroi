import 'dotenv/config';
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { connectDB } from "./src/db/index";
import { User, Analysis } from "./src/db/models";
import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail,
  updateProfile
} from "firebase/auth";

const PORT = Number(process.env.PORT) || 8080;

// Firebase config
interface FirebaseConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId?: string;
  storageBucket: string;
  messagingSenderId: string;
  measurementId?: string;
}

interface SearchResultItem {
  title: string;
  link: string;
  snippet: string;
}

interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

let firebaseConfig: FirebaseConfig | null = null;
try {
  const configPath = path.join(process.cwd(), "firebase-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }
} catch (error) {
  console.warn("firebase-config.json not found.");
}

// AI
let groq: OpenAI | null = null;
function getAI() {
  if (!groq) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is missing.");
    groq = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
  }
  return groq;
}

function validateEnv() {
  const required = ['GROQ_API_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.warn(`WARNING: Missing environment variables: ${missing.join(', ')}.`);
    return false;
  }
  console.log('Environment validated successfully.');
  return true;
}

async function googleSearch(query: string) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return "Search results unavailable: API key not configured.";
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query })
    });
    const data = await response.json();
    const results = data.organic?.slice(0, 3).map((r: SearchResultItem) => ({
      title: r.title, link: r.link, snippet: r.snippet
    }));
    return JSON.stringify(results || "No results found.");
  } catch (error) {
    console.error("Search Error:", error);
    return "Search failed.";
  }
}

async function fetchWebsiteContent(url: string) {
  try {
    if (url.length > 2048) throw new Error("URL exceeds maximum length.");
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol))
      throw new Error("Only HTTP and HTTPS protocols are allowed.");
    const hostname = parsedUrl.hostname.toLowerCase();
    const isPrivate = 
      hostname === 'localhost' || hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' || hostname === '[::1]' || hostname === '[::]' ||
      hostname.match(/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|fc|fd)/) ||
      hostname.endsWith('.local') || hostname.endsWith('.internal') ||
      hostname.match(/^0x[0-9a-f]+$/i) || hostname.match(/^0[0-7]+$/);
    if (isPrivate) throw new Error("Private networks are blocked.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return null;
    const html = await response.text();
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
      if (favicon && !favicon.startsWith('http')) favicon = new URL(favicon, url).href;
    } else {
      favicon = `${parsedUrl.origin}/favicon.ico`;
    }
    const content = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")
               .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, "")
               .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 15000);
    return { content, title, favicon };
  } catch (error) {
    console.error("Fetch Error:", error);
    return null;
  }
}

async function startServer() {
  validateEnv();
  const app = express();

  if (firebaseConfig) {
    try { initializeApp(firebaseConfig); } catch (e) { console.error("Firebase init failed:", e); }
  }

  app.use(cors({
    origin: (origin, callback) => { callback(null, true); },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
  app.use(express.json());

  app.use("/api", (req, res, next) => {
    console.log(`[API] ${req.method} ${req.path}`);
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", service: "Safroi API",
      env: { hasGroqKey: !!process.env.GROQ_API_KEY, hasSerperKey: !!process.env.SERPER_API_KEY, nodeEnv: process.env.NODE_ENV }
    });
  });

  app.get("/api/ping", (req, res) => { res.send("pong"); });

  // Auth endpoints
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    try {
      const auth = getAuth();
      const result = await signInWithEmailAndPassword(auth, email, password);
      res.json({ uid: result.user.uid, email: result.user.email, displayName: result.user.displayName || email.split('@')[0], loggedIn: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Invalid credentials";
      res.status(401).json({ error: msg });
    }
  });

  app.post("/api/auth/signup", async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: "Email, password and name required" });
    try {
      const auth = getAuth();
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(result.user, { displayName: name });
      res.json({ uid: result.user.uid, email: result.user.email, displayName: name, loggedIn: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Signup failed";
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/auth/reset", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    try {
      const auth = getAuth();
      await sendPasswordResetEmail(auth, email);
      res.json({ message: "Reset link sent" });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Reset failed";
      res.status(400).json({ error: msg });
    }
  });

  app.get("/api/download-extension", (req, res) => {
    try {
      const zip = new AdmZip();
      const extensionDir = path.join(process.cwd(), "chrome-extension");
      if (fs.existsSync(extensionDir)) {
        zip.addLocalFolder(extensionDir);
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.get('host');
        zip.addFile("config.json", Buffer.from(JSON.stringify({ BASE_URL: `${protocol}://${host}`, VERSION: "2.0.0", MODEL: "Safroi AI Engine" }, null, 2)));
        const zipBuffer = zip.toBuffer();
        res.set({ "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=safroi_extension.zip", "Content-Length": zipBuffer.length.toString() });
        res.send(zipBuffer);
      } else {
        res.status(404).json({ error: "Extension files not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to package extension" });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      let { type, value, title, url } = req.body;
      if (url && !value) { value = url; type = 'website'; }
      if (!value) return res.status(400).json({ error: "Value is required" });
      const ai = getAI();
      const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
      if (type === 'website') {
        const fetchRest = await fetchWebsiteContent(value);
        const content = fetchRest?.content;
        const fetchedTitle = fetchRest?.title;
        const fetchedFavicon = fetchRest?.favicon;
        const systemPrompt = `You are a legal risk analyzer expert. Your goal is to simplify complex Terms of Service or Privacy Policies and identify potential risks for everyday users. ${content ? "" : "You have access to a tool called 'googleSearch' to find latest policy information if the provided content is insufficient."} DO NOT invent or use any other tools. Return the final result as a JSON object directly following the requested schema.`;
        const userPrompt = `Analyze the following website Terms of Service or Privacy Policy. URL: ${value} ${content ? `CONTENT: ${content}` : "The content could not be fetched directly. Please USE THE googleSearch tool to find a summary of the terms of service for this website."} Response must be valid JSON with this schema: {"summary": "string", "risk_score": number (1-10), "risks": [{"title": "string", "description": "string", "severity": "low"|"medium"|"high"}]}`;
        let chatCompletion;
        if (content) {
          chatCompletion = await ai.chat.completions.create({
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
            model, response_format: { type: "json_object" }, temperature: 0.1
          });
        } else {
          const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
            { type: "function", function: { name: "googleSearch", description: "Search Google for the latest terms or policies of a company", parameters: { type: "object", properties: { query: { type: "string", description: "The search query" } }, required: ["query"] } } }
          ];
          let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt }, { role: "user", content: userPrompt }
          ];
          let toolCallCompletion = await ai.chat.completions.create({ messages, model, tools, tool_choice: "auto", temperature: 0.1 });
          const responseMessage = toolCallCompletion.choices[0].message;
          if (responseMessage.tool_calls) {
            messages.push(responseMessage);
            for (const toolCall of responseMessage.tool_calls) {
              const tc = toolCall as unknown as ToolCall;
              const functionArgs = JSON.parse(tc.function.arguments);
              if (tc.function.name === 'googleSearch') {
                const searchResult = await googleSearch(functionArgs.query);
                messages.push({ tool_call_id: tc.id, role: "tool" as const, name: tc.function.name, content: searchResult } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
              }
            }
            chatCompletion = await ai.chat.completions.create({ messages, model, response_format: { type: "json_object" }, temperature: 0.1 });
          } else {
            chatCompletion = await ai.chat.completions.create({ messages, model, response_format: { type: "json_object" }, temperature: 0.1 });
          }
        }
        const parsed = JSON.parse(chatCompletion.choices[0].message.content || "{}");
        let hostname = value;
        try { hostname = new URL(value).hostname; } catch(e) {}
        res.json({ id: Math.random().toString(36).substring(7), timestamp: Date.now(), type: 'website', title: title || fetchedTitle || hostname, url: value, favicon: req.body.favicon || fetchedFavicon || "", ...parsed });
      } else {
        const systemPrompt = `You are a legal risk analyzer expert. Analyze the contract text and highlight risky or important clauses. Provide clear, simplified explanations for a layperson.`;
        const userPrompt = `CONTRACT TEXT: ${value} Response must be valid JSON with this schema: {"summary": "string", "risk_score": number (1-10), "key_points": ["string"], "risks": [{"clause": "string", "risk": "string", "severity": "low"|"medium"|"high"}]}`;
        const chatCompletion = await ai.chat.completions.create({
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          model, response_format: { type: "json_object" }, temperature: 0.1
        });
        const parsed = JSON.parse(chatCompletion.choices[0].message.content || "{}");
        const risks = (parsed.risks || []).map((r: { clause: string; risk: string; severity: string }) => ({ title: r.clause, description: r.risk, severity: r.severity }));
        res.json({ id: Math.random().toString(36).substring(7), timestamp: Date.now(), type: 'contract', title: title || "Contract Analysis", risk_score: parsed.risk_score || 1, summary: parsed.summary, key_points: parsed.key_points, risks, original_text: value });
      }
    } catch (error) {
      console.error("AI Analysis Error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Analysis failed" });
    }
  });

  app.post("/api/translate", async (req, res) => {
    try {
      const { text, targetLanguage } = req.body;
      if (!text || !targetLanguage) return res.status(400).json({ error: "Text and targetLanguage are required" });
      const ai = getAI();
      const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
      const chatCompletion = await ai.chat.completions.create({
        messages: [{ role: "user", content: `Translate the following text into ${targetLanguage}. Keep it simple and natural for everyday understanding. Return ONLY the translated text. TEXT: ${text}` }],
        model
      });
      res.json({ translatedText: chatCompletion.choices[0].message.content?.trim() || text });
    } catch (error) {
      res.status(500).json({ error: "Translation failed" });
    }
  });

  // History API (MongoDB)
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
    } catch (err) { res.status(500).json({ error: "Failed to save analysis" }); }
  });

  app.get("/api/history/:userId", async (req, res) => {
    try {
      const items = await Analysis.find({ userId: req.params.userId } as any)
        .select('_id type title url risk_score created_at')
        .sort({ created_at: -1 })
        .limit(50);
      res.json(items);
    } catch (err) { res.status(500).json({ error: "Failed to fetch history" }); }
  });

  app.get("/api/history/:userId/:id", async (req, res) => {
    try {
      const item = await Analysis.findOne({ _id: req.params.id, userId: req.params.userId } as any);
      if (!item) return res.status(404).json({ error: "Not found" });
      res.json(item);
    } catch (err) { res.status(500).json({ error: "Failed to fetch analysis" }); }
  });

  app.delete("/api/history/:userId/:id", async (req, res) => {
    try {
      await Analysis.deleteOne({ _id: req.params.id, userId: req.params.userId } as any);
      res.json({ deleted: true });
    } catch (err) { res.status(500).json({ error: "Failed to delete analysis" }); }
  });

  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled Server Error:", err);
    res.status(500).json({ error: "Internal Server Error", message: err.message });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Safroi API running on port ${PORT}`);
    connectDB();
  });
}

startServer();

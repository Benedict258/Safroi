import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import 'dotenv/config';
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { connectDB } from "./src/db/index";
import { User, Analysis } from "./src/db/models";
import { ocrImage, highlightImage } from "./src/ocr/index";
import { analyzeText, analyzeImage, translateText } from "./src/services/ai";

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const PORT = Number(process.env.PORT) || 8080;

function signToken(userId: string) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET) as { userId: string };
    (req as any).userId = decoded.userId;
    next();
  } catch { res.status(401).json({ error: "Invalid token" }); }
}

function extractJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

function validateEnv() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) { console.warn('GEMINI_API_KEY not set.'); return false; }
  console.log('Gemini API key found.');
  return true;
}

async function googleSearch(query: string) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return "Search unavailable.";
  try {
    const r = await fetch("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ q: query }) });
    const data = await r.json();
    return JSON.stringify((data.organic || []).slice(0, 3).map((r: any) => ({ title: r.title, link: r.link, snippet: r.snippet })));
  } catch { return "Search failed."; }
}

async function fetchWebsiteContent(url: string) {
  try {
    if (url.length > 2048) return null;
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;
    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.match(/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/) || hostname.endsWith('.local') || hostname.endsWith('.internal')) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120', 'Accept': 'text/html' }, signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const html = await response.text();
    let title = ""; const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i); if (tm) title = tm[1].trim();
    let favicon = ""; const im = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["'][^>]*>/i); if (im) { favicon = im[1]; if (!favicon.startsWith('http')) favicon = new URL(favicon, url).href; } else favicon = `${parsedUrl.origin}/favicon.ico`;
    const content = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "").replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, "").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 15000);
    return { content, title, favicon };
  } catch { return null; }
}

async function startServer() {
  validateEnv();
  const app = express();
  app.use(cors({ origin: (_, cb) => cb(null, true), credentials: true }));
  app.use(express.json({ limit: '10mb' }));

  app.get("/api/health", (_, res) => res.json({ status: "ok", service: "Safroi API", env: { hasGeminiKey: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY), nodeEnv: process.env.NODE_ENV } }));
  app.get("/api/ping", (_, res) => res.send("pong"));

  // Auth
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) return res.status(400).json({ error: "Email, password, and name required." });
      const existing = await User.findOne({ email: email.toLowerCase() } as any);
      if (existing) return res.status(409).json({ error: "Email already registered." });
      const id = crypto.randomUUID();
      await User.create({ _id: id, email: email.toLowerCase(), displayName: name, password });
      res.json({ uid: id, email: email.toLowerCase(), displayName: name, token: signToken(id), loggedIn: true });
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
      res.json({ uid: user._id, email: user.email, displayName: user.displayName, token: signToken(user._id), loggedIn: true });
    } catch (err) { res.status(401).json({ error: "Login failed." }); }
  });

  app.post("/api/auth/reset", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required." });
    res.json({ message: "If that email exists, a reset link has been sent." });
  });

  app.get("/api/auth/me", authMiddleware, async (req, res) => {
    const user = await User.findOne({ _id: (req as any).userId } as any);
    if (!user) return res.status(404).json({ error: "Not found." });
    res.json({ uid: user._id, email: user.email, displayName: user.displayName, loggedIn: true });
  });

  // Gemma 4 Analysis
  const BASE_PROMPT = `You are a contract detective protecting gig workers and tenants from exploitative clauses. Return ONLY valid JSON, no markdown, no backticks.
For each risky clause: "description" (legal/technical), "severity" (low|medium|high), "plain_explanation" (everyday language), "impact_line" (one-sentence consequence), "category_tag" (e.g. "Termination Risk").
Schema: {"summary":"string","risk_score":number(1-10),"risks":[{"title":"string","description":"string","severity":"low|medium|high" (must be lowercase),"plain_explanation":"string","impact_line":"string","category_tag":"string"}]}`;

  app.post("/api/analyze", async (req, res) => {
    try {
      let { type, value, title, url } = req.body;
      if (url && !value) { value = url; type = 'website'; }
      if (!value) return res.status(400).json({ error: "Value required." });

      if (type === 'website') {
        const fr = await fetchWebsiteContent(value);
        let prompt = BASE_PROMPT + `\nURL: ${value}\nTEXT: ${fr?.content || ''}`;
        if (!fr?.content) {
          const searchResult = await googleSearch(`${value} terms of service`);
          prompt = BASE_PROMPT + `\nURL: ${value}\nSearch results:\n${searchResult}\n\nAnalyze from search results.`;
        }
        const raw = await analyzeText(prompt);
        const parsed = JSON.parse(extractJSON(raw));
        let hn = value; try { hn = new URL(value).hostname; } catch {}
        res.json({ id: crypto.randomUUID(), timestamp: Date.now(), type: 'website', title: title || fr?.title || hn, url: value, ...parsed });
      } else {
        const raw = await analyzeText(BASE_PROMPT + `\nCONTRACT TEXT:\n${value}`);
        const parsed = JSON.parse(extractJSON(raw));
        const risks = (parsed.risks || []).map((r: any) => ({ title: r.clause || r.title, description: r.risk || r.description, severity: (r.severity || "medium").toLowerCase() || 'medium', plain_explanation: r.plain_explanation, impact_line: r.impact_line, category_tag: r.category_tag }));
        res.json({ id: crypto.randomUUID(), timestamp: Date.now(), type: 'contract', title: title || "Contract Analysis", risk_score: parsed.risk_score || 1, summary: parsed.summary, key_points: parsed.key_points, risks, original_text: value });
      }
    } catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : "Analysis failed." }); }
  });

  app.post("/api/translate", async (req, res) => {
    try {
      const { text, targetLanguage } = req.body;
      if (!text || !targetLanguage) return res.status(400).json({ error: "Text and language required." });
      res.json({ translatedText: await translateText(text, targetLanguage) });
    } catch { res.status(500).json({ error: "Translation failed." }); }
  });

  app.post("/api/ocr-analyze", async (req, res) => {
    try {
      const { image, useDirectImage } = req.body;
      if (!image) return res.status(400).json({ error: "Image required." });
      const base64 = image.replace(/^data:image\/\w+;base64,/, '');
      const mime = image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const prompt = `You are a contract detective protecting gig workers and tenants. Analyze this contract photo. Return ONLY valid JSON (no markdown): {"summary":"string","risk_score":number(1-10),"risks":[{"clause":"string","risk":"string","severity":"low|medium|high","plain_explanation":"string","impact_line":"string","category_tag":"string"}]}`;
      let raw: string;
      if (useDirectImage) {
        raw = await analyzeImage(base64, mime, prompt);
      } else {
        const ocr = await ocrImage(Buffer.from(base64, 'base64'));
        raw = await analyzeText(`Analyze contract. Return ONLY valid JSON with summary, risk_score, risks[].\nCONTRACT TEXT:\n${ocr.text}`);
      }
      const parsed = JSON.parse(extractJSON(raw));
      const risks = (parsed.risks || []).map((r: any) => ({ title: r.clause, description: r.risk, severity: (r.severity || "medium").toLowerCase() || 'medium', plain_explanation: r.plain_explanation, impact_line: r.impact_line, category_tag: r.category_tag }));
      res.json({ id: crypto.randomUUID(), timestamp: Date.now(), type: 'contract', title: "Scanned Document", summary: parsed.summary, risk_score: parsed.risk_score || 1, risks, path: useDirectImage ? 'multimodal' : 'ocr' });
    } catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : "OCR failed." }); }
  });

  // History
  app.post("/api/history", async (req, res) => {
    try {
      const { userId, analysis } = req.body;
      if (!userId || !analysis) return res.status(400).json({ error: "userId and analysis required." });
      await (Analysis as any).findOneAndUpdate({ _id: analysis.id }, { _id: analysis.id, userId, type: analysis.type, title: analysis.title, url: analysis.url, summary: analysis.summary, risk_score: analysis.risk_score, risks: analysis.risks || [], key_points: analysis.key_points, original_text: analysis.original_text }, { upsert: true, returnDocument: 'after' });
      res.json({ saved: true });
    } catch { res.status(500).json({ error: "Save failed." }); }
  });
  app.get("/api/history/:userId", async (req, res) => {
    try { const items = await Analysis.find({ userId: req.params.userId } as any).select('_id type title url risk_score created_at').sort({ created_at: -1 }).limit(50); res.json(items); }
    catch { res.status(500).json({ error: "Fetch failed." }); }
  });
  app.get("/api/history/:userId/:id", async (req, res) => {
    try { const item = await Analysis.findOne({ _id: req.params.id, userId: req.params.userId } as any); if (!item) return res.status(404).json({ error: "Not found." }); res.json(item); }
    catch { res.status(500).json({ error: "Fetch failed." }); }
  });
  app.delete("/api/history/:userId/:id", async (req, res) => {
    try { await Analysis.deleteOne({ _id: req.params.id, userId: req.params.userId } as any); res.json({ deleted: true }); }
    catch { res.status(500).json({ error: "Delete failed." }); }
  });

  app.listen(PORT, "0.0.0.0", () => { console.log(`Safroi API running on port ${PORT}`); connectDB().then(ok => { if (!ok) console.warn('[MongoDB] Running without database.'); }); });
}

startServer();

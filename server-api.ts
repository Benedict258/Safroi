import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import 'dotenv/config';
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { connectDB } from "./src/db/index";
import { User, Analysis } from "./src/db/models";

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
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

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
} catch {}

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
    console.warn(`Missing env vars: ${missing.join(', ')}.`);
    return false;
  }
  console.log('Environment validated.');
  return true;
}

async function googleSearch(query: string) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return "Search results unavailable.";
  try {
    const r = await fetch("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ q: query }) });
    const data = await r.json();
    const results = data.organic?.slice(0, 3).map((r: SearchResultItem) => ({ title: r.title, link: r.link, snippet: r.snippet }));
    return JSON.stringify(results || "No results.");
  } catch { return "Search failed."; }
}

async function fetchWebsiteContent(url: string) {
  try {
    if (url.length > 2048) throw new Error("URL too long.");
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error("Invalid protocol.");
    const hostname = parsedUrl.hostname.toLowerCase();
    const isPrivate = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '[::1]' || hostname === '[::]' || hostname.match(/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|fc|fd)/) || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.match(/^0x[0-9a-f]+$/i) || hostname.match(/^0[0-7]+$/);
    if (isPrivate) throw new Error("Blocked.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }, signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
    const html = await response.text();
    let title = "";
    const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (tm) title = tm[1].trim();
    let favicon = "";
    const im = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["'][^>]*>/i) || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["'][^>]*>/i) || html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["'][^>]*>/i) || html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    if (im) { favicon = im[1]; if (favicon && !favicon.startsWith('http')) favicon = new URL(favicon, url).href; }
    else favicon = `${parsedUrl.origin}/favicon.ico`;
    const content = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "").replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, "").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 15000);
    return { content, title, favicon };
  } catch { return null; }
}

async function startServer() {
  validateEnv();
  const app = express();

  app.use(cors({ origin: (_, cb) => cb(null, true), credentials: true, methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
  app.use(express.json());

  app.get("/api/health", (_, res) => res.json({ status: "ok", service: "Safroi API", env: { hasGroqKey: !!process.env.GROQ_API_KEY, hasSerperKey: !!process.env.SERPER_API_KEY, nodeEnv: process.env.NODE_ENV } }));
  app.get("/api/ping", (_, res) => res.send("pong"));

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
      const user = await User.findOne({ email: email.toLowerCase() } as any);
      if (!user) return res.json({ message: "If that email exists, a reset link has been sent." });
      const resetToken = crypto.randomBytes(32).toString('hex');
      (user as any).resetToken = resetToken;
      (user as any).resetTokenExpiry = Date.now() + 3600000;
      await user.save();
      console.log(`[Auth] Password reset for ${email}. Token: ${resetToken}`);
      res.json({ message: "Reset email sent." });
    } catch (err) { res.status(500).json({ error: "Reset failed." }); }
  });

  app.post("/api/auth/reset/confirm", async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) return res.status(400).json({ error: "Token and new password required." });
      const user = await User.findOne({ resetToken: token, resetTokenExpiry: { $gt: new Date() } } as any);
      if (!user) return res.status(400).json({ error: "Invalid or expired token." });
      user.password = password;
      (user as any).resetToken = undefined;
      (user as any).resetTokenExpiry = undefined;
      await user.save();
      res.json({ message: "Password updated." });
    } catch (err) { res.status(500).json({ error: "Reset confirmation failed." }); }
  });

  app.get("/api/auth/me", authMiddleware, async (req, res) => {
    const user = await User.findOne({ _id: (req as any).userId } as any, { password: 0, resetToken: 0, resetTokenExpiry: 0 });
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json({ uid: user._id, email: user.email, displayName: user.displayName, loggedIn: true });
  });

  app.get("/api/download-extension", (_, res) => {
    try {
      const zip = new AdmZip();
      const ed = path.join(process.cwd(), "chrome-extension");
      if (!fs.existsSync(ed)) return res.status(404).json({ error: "Not found." });
      zip.addLocalFolder(ed);
      zip.addFile("config.json", Buffer.from(JSON.stringify({ BASE_URL: `https://${process.env.APP_DOMAIN || 'localhost'}`, VERSION: "2.0.0" }, null, 2)));
      const buf = zip.toBuffer();
      res.set({ "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=safroi_extension.zip", "Content-Length": buf.length.toString() });
      res.send(buf);
    } catch { res.status(500).json({ error: "Failed." }); }
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      let { type, value, title, url } = req.body;
      if (url && !value) { value = url; type = 'website'; }
      if (!value) return res.status(400).json({ error: "Value required." });
      const ai = getAI();
      const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
      if (type === 'website') {
        const fr = await fetchWebsiteContent(value);
        const content = fr?.content;
        const sp = `You are a legal risk analyzer expert. Simplify Terms of Service and identify risks. ${content ? "" : "Use googleSearch tool if needed."} Return JSON.`;
        const up = `URL: ${value} ${content ? `CONTENT: ${content}` : "Use googleSearch tool."} Schema: {"summary":"string","risk_score":number(1-10),"risks":[{"title":"string","description":"string","severity":"low|medium|high"}]}`;
        let cc;
        if (content) {
          cc = await ai.chat.completions.create({ messages: [{ role: "system", content: sp }, { role: "user", content: up }], model, response_format: { type: "json_object" }, temperature: 0.1 });
        } else {
          const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [{ type: "function", function: { name: "googleSearch", description: "Search for policy info", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } }];
          let msgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "system", content: sp }, { role: "user", content: up }];
          let tcc = await ai.chat.completions.create({ messages: msgs, model, tools, tool_choice: "auto", temperature: 0.1 });
          const rm = tcc.choices[0].message;
          if (rm.tool_calls) { msgs.push(rm); for (const tc of rm.tool_calls) { const t = tc as unknown as ToolCall; const fa = JSON.parse(t.function.arguments); if (t.function.name === 'googleSearch') { const sr = await googleSearch(fa.query); msgs.push({ tool_call_id: t.id, role: "tool" as const, name: t.function.name, content: sr } as any); } } cc = await ai.chat.completions.create({ messages: msgs, model, response_format: { type: "json_object" }, temperature: 0.1 }); }
          else cc = await ai.chat.completions.create({ messages: msgs, model, response_format: { type: "json_object" }, temperature: 0.1 });
        }
        const parsed = JSON.parse(cc.choices[0].message.content || "{}");
        let hn = value; try { hn = new URL(value).hostname; } catch {}
        res.json({ id: crypto.randomUUID(), timestamp: Date.now(), type: 'website', title: title || fr?.title || hn, url: value, favicon: req.body.favicon || fr?.favicon || "", ...parsed });
      } else {
        const cc = await ai.chat.completions.create({ messages: [{ role: "system", content: "You are a legal risk analyzer. Return JSON." }, { role: "user", content: `CONTRACT: ${value} Schema: {"summary":"string","risk_score":number(1-10),"key_points":["string"],"risks":[{"clause":"string","risk":"string","severity":"low|medium|high"}]}` }], model, response_format: { type: "json_object" }, temperature: 0.1 });
        const parsed = JSON.parse(cc.choices[0].message.content || "{}");
        const risks = (parsed.risks || []).map((r: any) => ({ title: r.clause || r.title, description: r.risk || r.description, severity: r.severity }));
        res.json({ id: crypto.randomUUID(), timestamp: Date.now(), type: 'contract', title: title || "Contract Analysis", risk_score: parsed.risk_score || 1, summary: parsed.summary, key_points: parsed.key_points, risks, original_text: value });
      }
    } catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : "Analysis failed." }); }
  });

  app.post("/api/translate", async (req, res) => {
    try {
      const { text, targetLanguage } = req.body;
      if (!text || !targetLanguage) return res.status(400).json({ error: "Text and language required." });
      const ai = getAI();
      const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
      const cc = await ai.chat.completions.create({ messages: [{ role: "user", content: `Translate to ${targetLanguage}. Return only translation. TEXT: ${text}` }], model });
      res.json({ translatedText: cc.choices[0].message.content?.trim() || text });
    } catch { res.status(500).json({ error: "Translation failed." }); }
  });

  // History
  app.post("/api/history", async (req, res) => {
    try {
      const { userId, analysis } = req.body;
      if (!userId || !analysis) return res.status(400).json({ error: "userId and analysis required." });
      (await Analysis.findOneAndUpdate({ _id: analysis.id } as any, {  _id: analysis.id, userId, type: analysis.type, title: analysis.title, url: analysis.url, summary: analysis.summary, risk_score: analysis.risk_score, risks: analysis.risks || [], key_points: analysis.key_points, original_text: analysis.original_text }, { upsert: true, new: true, returnDocument: 'after' }) as any);
      (await User.findOneAndUpdate({ _id: userId } as any, { $setOnInsert: { _id: userId, email: userId, displayName: userId, password: '' } }, { upsert: true, returnDocument: 'after' }) as any);
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

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ error: "Server error", message: err.message }); });

  app.listen(PORT, "0.0.0.0", () => { console.log(`Safroi API running on port ${PORT}`); connectDB().then(ok => { if (!ok) console.warn('[MongoDB] Running without database.'); }); });
}

startServer();

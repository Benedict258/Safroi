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

function safeParseJSON(text: string) { try { return JSON.parse(text); } catch (e) { console.error("[JSON Parse Error]", e instanceof Error ? e.message : e, "\nRaw:", text.slice(0, 300)); return { summary: "Analysis completed. Raw response could not be parsed.", risk_score: 5, risks: [] }; } }
function extractJSON(text: string): string {
  const fences = text.match(/```(?:json)?\s*([\s\S]*?)```/g);
  if (fences && fences.length > 0) {
    const last = fences[fences.length - 1];
    const inner = last.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (inner) return inner[1].trim();
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) return match[0];
  console.error('[extractJSON] No JSON found in:', text.slice(0, 500));
  return '{}';
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

async function fetchWebsiteContent(inputUrl: string) {
  const tryFetch = async (url: string) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 10000);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/130', 'Accept': 'text/html' }, signal: c.signal, redirect: 'follow' });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.text();
    } catch { clearTimeout(t); return null; }
  };
  let pu: URL;
  try { pu = new URL(inputUrl); } catch { return null; }
  if (inputUrl.length > 2048) return null;
  const h = pu.hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.match(/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/)) return null;

  const urls = [inputUrl];
  if (!inputUrl.includes('terms') && !inputUrl.includes('privacy') && !inputUrl.includes('policy')) {
    // Agentic: crawl homepage for policy links
    const homeHtml = await tryFetch(inputUrl);
    if (homeHtml && homeHtml.length > 500) {
      const linkMatches = homeHtml.match(/href=["']([^"']*(?:terms|privacy|policy|legal|tos)[^"']*)["']/gi);
      if (linkMatches) {
        for (const l of linkMatches) {
          const href = l.replace(/href=["']/i, '').replace(/["']$/, '');
          try { const fu = href.startsWith('http') ? href : new URL(href, pu.origin).href; if (!urls.includes(fu)) urls.push(fu); } catch {}
        }
      }
    }
    urls.push(`${pu.origin}/terms`, `${pu.origin}/terms-of-service`, `${pu.origin}/privacy`, `${pu.origin}/privacy-policy`, `${pu.origin}/legal/terms`);
  }
  let combinedContent = ''; let discoveredTitle = '';
  const allUrls = [...new Set(urls)].slice(0, 8);
  for (const u of allUrls) {
    const html = await tryFetch(u);
    if (!html || html.length < 300) continue;
    let title = ""; const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i); if (tm) title = tm[1].trim();
    const content = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "").replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, "").replace(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gmi, "").replace(/<footer\b[^>]*>([\s\S]*?)<\/footer>/gmi, "").replace(/<header\b[^>]*>([\s\S]*?)<\/header>/gmi, "").replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
    combinedContent += `\n--- ${u} ---\n${content}`;
    if (!discoveredTitle && title) discoveredTitle = title;
    console.log(`[Fetch] Added ${content.length} chars from ${u}`);
  }
  if (combinedContent.length > 500) {
    console.log(`[Fetch] Returning ${combinedContent.length} chars from ${allUrls.length} pages`);
    return { content: combinedContent.substring(0, 30000), title: discoveredTitle };
  }
  console.log(`[Fetch] No content for ${inputUrl}`);
  return null;
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
  const BASE_PROMPT = `You are an impartial contract analyst. Analyze the document honestly — flag real risks where they exist, and note where clauses are fair, standard, or protective. Do not assume every clause is exploitative. Focus on what matters to workers and tenants: pay, hours, termination, liability, privacy, dispute resolution. For each clause: "description" (legal), "severity" (low|medium|high — only use high when genuinely dangerous), "plain_explanation" (everyday language), "impact_line" (one-sentence consequence), "category_tag" (e.g. "Termination Risk"). Also provide "actions": 2-4 recommended steps. Each with "title", "advice", "urgency" (low|medium|high). Return ONLY valid JSON, no markdown, no backticks.
Schema: {"summary":"string","risk_score":number(1-10),"risks":[{"title":"string","description":"string","severity":"string","plain_explanation":"string","impact_line":"string","category_tag":"string"}],"actions":[{"title":"string","advice":"string","urgency":"string"}]}`;

  function cacheKey(type: string, value: string) {
    return `${type}:${value.toLowerCase().trim().slice(0, 200)}`;
  }

  function getCached(key: string) {
    return (Analysis as any).findOne({ _id: `cache_${key}`, cacheExpiry: { $gt: new Date() } });
  }

  function setCache(key: string, data: any) {
    (Analysis as any).findOneAndUpdate(
      { _id: `cache_${key}` },
      { _id: `cache_${key}`, type: 'cache', userId: 'system', title: 'Cached Analysis', summary: '', risk_score: 0, risks: [], cachedResult: data, cacheExpiry: new Date(Date.now() + 86400000) },
      { upsert: true, returnDocument: 'after' }
    );
  }

  app.post("/api/analyze", async (req, res) => {
    try {
      let { type, value, title, url } = req.body;
      if (url && !value) { value = url; type = 'website'; }
      if (!value) return res.status(400).json({ error: "Value required." });

      // Cache check
      const ck = cacheKey(type, value);
      const cached = await getCached(ck);
      if (cached && cached.cachedResult) {
        console.log(`[Cache] HIT for ${ck}`);
        return res.json(cached.cachedResult);
      }
      console.log(`[Cache] MISS for ${ck}`);

      if (type === 'website') {
        const fr = await fetchWebsiteContent(value);
        let prompt = BASE_PROMPT + `\nURL: ${value}\nTEXT: ${fr?.content || ''}`;
        if (!fr?.content) {
          const searchResult = await googleSearch(`${value} terms of service`);
          prompt = BASE_PROMPT + `\nURL: ${value}\nSearch results:\n${searchResult}\n\nAnalyze from search results.`;
        }
        const raw = await analyzeText(prompt);
        console.log(`[Gemma] Raw response (${raw.length} chars):`, raw.slice(0, 200));
        const json = extractJSON(raw);
        console.log(`[Gemma] Extracted JSON:`, json.slice(0, 200));
        const parsed = safeParseJSON(json);
        parsed.risk_score = Math.round(Number(parsed.risk_score) || 1);
        if (parsed.risk_score < 1) parsed.risk_score = 1;
        if (parsed.risk_score > 10) parsed.risk_score = 10;
        let hn = value; try { hn = new URL(value).hostname; } catch {}
        const result = { id: crypto.randomUUID(), timestamp: Date.now(), type: 'website' as const, title: title || fr?.title || hn, url: value, ...parsed };
        setCache(ck, result);
        res.json(result);
      } else {
        const raw = await analyzeText(BASE_PROMPT + `\nCONTRACT TEXT:\n${value}`);
        const json = extractJSON(raw);
        const parsed = safeParseJSON(json);
        parsed.risk_score = Math.round(Number(parsed.risk_score) || 1);
        if (parsed.risk_score < 1) parsed.risk_score = 1;
        if (parsed.risk_score > 10) parsed.risk_score = 10;
        const risks = (parsed.risks || []).map((r: any) => ({ title: r.clause || r.title, description: r.risk || r.description, severity: (r.severity || "medium").toLowerCase() || 'medium', plain_explanation: r.plain_explanation, impact_line: r.impact_line, category_tag: r.category_tag }));
        const result = { id: crypto.randomUUID(), timestamp: Date.now(), type: 'contract' as const, title: title || "Contract Analysis", risk_score: parsed.risk_score || 1, summary: parsed.summary, key_points: parsed.key_points, risks, actions: parsed.actions, original_text: value };
        setCache(ck, result);
        res.json(result);
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

  // TTS — Google Translate free TTS (no API key needed)
  const LANG_MAP: Record<string, string> = { English: 'en', Hausa: 'ha', Yoruba: 'en', Igbo: 'en', French: 'fr', German: 'de', Japanese: 'ja' };
  app.post("/api/speak", async (req, res) => {
    try {
      const { text, language } = req.body;
      if (!text || !language) return res.status(400).json({ error: "Text and language required." });
      const langCode = LANG_MAP[language] || 'en';
      const chunks = text.match(/[\s\S]{1,180}/g) || [text];
      const audioBuffers: Buffer[] = [];
      for (const chunk of chunks.slice(0, 5)) {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${langCode}&q=${encodeURIComponent(chunk)}`;
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) continue;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 500) audioBuffers.push(buffer);
      }
      if (audioBuffers.length === 0) return res.status(500).json({ error: "TTS failed for " + language });
      res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audioBuffers.reduce((s, b) => s + b.length, 0).toString() });
      for (const buf of audioBuffers) res.write(buf);
      res.end();
    } catch { res.status(500).json({ error: "TTS failed." }); }
  });

  app.post("/api/ocr-analyze", async (req, res) => {
    try {
      const { image, useDirectImage } = req.body;
      if (!image) return res.status(400).json({ error: "Image required." });
      const base64 = image.replace(/^data:image\/\w+;base64,/, '');
      const mime = image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const prompt = `You are a contract detective protecting gig workers and tenants. Analyze this contract photo. Return ONLY valid JSON (no markdown): {"summary":"string","risk_score":number(1-10),"risks":[{"clause":"string","risk":"string","severity":"low|medium|high","plain_explanation":"string","impact_line":"string","category_tag":"string"}],"actions":[{"title":"string","advice":"string","urgency":"string"}]}`;
      let raw: string;
      if (useDirectImage) {
        raw = await analyzeImage(base64, mime, prompt);
      } else {
        const ocr = await ocrImage(Buffer.from(base64, 'base64'));
        raw = await analyzeText(`Analyze contract. Return ONLY valid JSON with summary, risk_score, risks[].\nCONTRACT TEXT:\n${ocr.text}`);
      }
      const parsed = safeParseJSON(extractJSON(raw));
      const risks = (parsed.risks || []).map((r: any) => ({ title: r.clause, description: r.risk, severity: (r.severity || "medium").toLowerCase() || 'medium', plain_explanation: r.plain_explanation, impact_line: r.impact_line, category_tag: r.category_tag }));
      res.json({ id: crypto.randomUUID(), timestamp: Date.now(), type: 'contract', title: "Scanned Document", summary: parsed.summary, risk_score: parsed.risk_score || 1, risks, path: useDirectImage ? 'multimodal' : 'ocr' });
    } catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : "OCR failed." }); }
  });

  app.get("/api/download-extension", (_, res) => {
    try {
      const zip = new AdmZip();
      const ed = path.join(process.cwd(), "chrome-extension");
      if (!fs.existsSync(ed)) return res.status(404).json({ error: "Extension files not found." });
      zip.addLocalFolder(ed);
      const buf = zip.toBuffer();
      res.set({ "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=safroi-extension.zip", "Content-Length": buf.length.toString() });
      res.send(buf);
    } catch { res.status(500).json({ error: "Failed." }); }
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

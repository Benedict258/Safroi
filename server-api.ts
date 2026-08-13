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
import mongoose from "mongoose";
import { ocrImage, highlightImage, type ClauseLocation } from "./src/ocr/index";
import { analyzeText, analyzeImage, translateText } from "./src/services/ai";
import { generateResetToken, hashResetToken, sendPasswordResetEmail } from "./src/services/email";
import { securityHeaders, corsStrict, rateLimit, rateLimitAuth } from "./src/middleware/security";
import { validate, signupSchema, loginSchema, resetSchema, resetConfirmSchema, analyzeSchema, translateSchema, speakSchema, ocrSchema } from "./src/middleware/validate";

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

function isRefusal(text: string): boolean {
  const refusalPhrases = [
    'i do not have access', 'cannot access', 'private link', 'private session',
    'authenticated', 'login required', 'sign in', 'unable to access',
    'cannot analyze', 'not available', 'behind a login', 'requires authentication',
    'do not have permission', 'cannot fetch', 'unable to fetch',
  ];
  const lower = text.toLowerCase();
  return refusalPhrases.some(p => lower.includes(p));
}

function validateEnv() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) { console.warn('GEMINI_API_KEY not set.'); }
  else { console.log('Gemini API key found.'); }
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) { console.warn('MONGODB_URI not set. History and caching will be unavailable.'); }
  else { console.log('MongoDB URI found.'); }
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
  const UAS = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', // Googlebot — gets SSR from SPAs
    'Mozilla/5.0 Chrome/130', // standard browser
  ];

  const tryFetch = async (url: string) => {
    for (const ua of UAS) {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 10000);
      try {
        const r = await fetch(url, { headers: { 'User-Agent': ua, 'Accept': 'text/html' }, signal: c.signal, redirect: 'follow' });
        clearTimeout(t);
        if (!r.ok) continue;
        const html = await r.text();
        if (html && html.length > 500 && !html.startsWith('{') && !html.includes('"type":"module"')) return html;
      } catch { clearTimeout(t); }
    }
    return null;
  };

  const tryGoogleCache = async (url: string) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 8000);
    try {
      const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}&strip=1`;
      const r = await fetch(cacheUrl, { headers: { 'User-Agent': UAS[0] }, signal: c.signal });
      clearTimeout(t);
      if (!r.ok) return null;
      const html = await r.text();
      if (html && html.length > 500 && !html.startsWith('{') && !html.includes('"use strict"') && !html.includes('function(')) return html;
      return null;
    } catch { clearTimeout(t); return null; }
  };
  let pu: URL;
  try { pu = new URL(inputUrl); } catch { return null; }
  if (inputUrl.length > 2048) return null;
  const h = pu.hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.match(/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/)) return null;

  const urls = [inputUrl];
  if (!inputUrl.includes('terms') && !inputUrl.includes('privacy') && !inputUrl.includes('policy')) {
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

    // Always try policy subdomains and root domain for any site
    const rootDomain = h.split('.').slice(-2).join('.');
    const altOrigins = new Set<string>();
    altOrigins.add(pu.origin);
    if (rootDomain !== h) {
      altOrigins.add(`https://${rootDomain}`);
      altOrigins.add(`https://www.${rootDomain}`);
      altOrigins.add(`https://policies.${rootDomain}`);
      altOrigins.add(`https://legal.${rootDomain}`);
    }
    const policyPaths = ['/terms', '/terms-of-service', '/tos', '/privacy', '/privacy-policy', '/legal/terms', '/legal/privacy', '/legal'];
    for (const origin of altOrigins) {
      for (const path of policyPaths) {
        const u = `${origin}${path}`;
        if (!urls.includes(u)) urls.push(u);
      }
    }
  }
  // Normalize + deduplicate + filter assets
  const normalizeUrl = (u: string) => { try { const p = new URL(u); p.search = ''; p.hash = ''; return p.href.replace(/\/$/, ''); } catch { return u; } };
  const allUrls = [...new Set(urls.map(normalizeUrl))]
    .filter(u => !u.match(/\.(js|css|png|jpg|svg|ico|woff|json|xml)(\?|$)/))
    .slice(0, 8);

  let combinedContent = ''; let discoveredTitle = '';
  for (const u of allUrls) {
    const html = await tryFetch(u);
    if (!html || html.length < 100) continue;
    // Skip non-policy pages (JS shells, JSON, etc.)
    if (html.startsWith('{') || html.startsWith('/*') || html.includes('"type":"module"')) continue;
    let title = ""; const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i); if (tm) title = tm[1].trim();
    const content = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "").replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, "").replace(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gmi, "").replace(/<footer\b[^>]*>([\s\S]*?)<\/footer>/gmi, "").replace(/<header\b[^>]*>([\s\S]*?)<\/header>/gmi, "").replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
    if (content.length < 200) continue;
    combinedContent += `\n--- ${u} ---\n${content}`;
    if (!discoveredTitle && title) discoveredTitle = title;
    console.log(`[Fetch] Added ${content.length} chars from ${u}`);
  }
  if (combinedContent.length > 500) {
    const capped = combinedContent.substring(0, 15000);
    console.log(`[Fetch] Returning ${capped.length} chars from ${allUrls.length} pages`);
    return { content: capped, title: discoveredTitle };
  }

  // Last resort: try Google Cache for the policy URLs
  console.log(`[Fetch] No direct content — trying Google Cache...`);
  for (const u of allUrls.slice(0, 4)) {
    const cachedHtml = await tryGoogleCache(u);
    if (!cachedHtml || cachedHtml.length < 500) continue;
    const content = cachedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 15000);
    if (content.length > 300) {
      console.log(`[Fetch] Google Cache hit: ${content.length} chars from ${u}`);
      return { content, title: '' };
    }
  }

  console.log(`[Fetch] No content for ${inputUrl}`);
  return null;
}

async function startServer() {
  validateEnv();
  const app = express();

  // Security headers
  app.use(securityHeaders);

  // CORS — restricted to known origins
  app.use(cors({ origin: corsStrict, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'], maxAge: 86400 }));
  app.use(express.json({ limit: '10mb' }));

  // Rate limiting
  app.use('/api', rateLimit(60, 60000));

  // Strip server identity
  app.use((_req, res, next) => { res.removeHeader('X-Powered-By'); next(); });

  app.get("/api/health", (_, res) => res.json({ status: "ok", service: "Safroi API", env: { hasGeminiKey: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY), nodeEnv: process.env.NODE_ENV } }));
  app.get("/api/ping", (_, res) => res.send("pong"));

  // Auth
  app.post("/api/auth/signup", rateLimitAuth(5, 300000), validate(signupSchema), async (req, res) => {
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

  app.post("/api/auth/login", rateLimitAuth(10, 300000), validate(loginSchema), async (req, res) => {
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

  app.post("/api/auth/reset", rateLimitAuth(5, 300000), validate(resetSchema), async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email required." });

      const user = await User.findOne({ email: email.toLowerCase() } as any);
      if (!user) {
        return res.json({ message: "If that email exists, a reset link has been sent." });
      }

      const { token, hash, expiresAt } = generateResetToken();
      await User.findOneAndUpdate(
        { _id: user._id } as any,
        { resetToken: hash, resetTokenExpiry: expiresAt },
      );

      await sendPasswordResetEmail(user.email, user.displayName, token);

      res.json({ message: "If that email exists, a reset link has been sent." });
    } catch (err) {
      console.error("Reset error:", err);
      res.status(500).json({ error: "Reset failed." });
    }
  });

  app.post("/api/auth/reset/confirm", validate(resetConfirmSchema), async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) return res.status(400).json({ error: "Token and new password required." });
      if (newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

      const hash = hashResetToken(token);
      const user = await User.findOne({ resetToken: hash } as any);

      if (!user || !user.resetTokenExpiry || new Date(user.resetTokenExpiry) < new Date()) {
        return res.status(400).json({ error: "Invalid or expired reset token." });
      }

      await User.findOneAndUpdate(
        { _id: user._id } as any,
        { password: newPassword, resetToken: null, resetTokenExpiry: null },
      );

      res.json({ message: "Password reset successful. You can now sign in." });
    } catch (err) {
      console.error("Reset confirm error:", err);
      res.status(500).json({ error: "Reset confirmation failed." });
    }
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
    const normalized = value.replace(/\/+$/, '').toLowerCase().trim().slice(0, 200);
    return `${type}:${normalized}`;
  }

  function getCached(key: string) {
    if (mongoose.connection.readyState !== 1) return null;
    try { return (Analysis as any).findOne({ _id: `cache_${key}`, cacheExpiry: { $gt: new Date() } }); }
    catch { return null; }
  }

  function setCache(key: string, data: any) {
    if (mongoose.connection.readyState !== 1) return;
    try { (Analysis as any).findOneAndUpdate({ _id: `cache_${key}` }, { _id: `cache_${key}`, type: 'cache', userId: 'system', title: 'Cached', summary: '', risk_score: 0, risks: [], cachedResult: data, cacheExpiry: new Date(Date.now() + 86400000) }, { upsert: true, returnDocument: 'after' }); } catch {}
  }

  app.post("/api/analyze", validate(analyzeSchema), async (req, res) => {
    try {
      let { type, value, title, url } = req.body;
      if (url && !value) { value = url; type = 'website'; }
      if (!value) return res.status(400).json({ error: "Value required." });

      // Extract root domain for deep links (e.g. claude.ai/chat/xxx → claude.ai)
      if (type === 'website' && value.startsWith('http')) {
        try {
          const parsed = new URL(value);
          if (parsed.pathname.length > 1 && !parsed.pathname.match(/\/(terms|privacy|policy|legal|tos)/i)) {
            console.log(`[Analyze] Deep URL detected, extracting root: ${value} → ${parsed.origin}`);
            value = parsed.origin;
          }
        } catch {}
      }

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
        console.log(`[Gemma] Raw (${raw.length} chars):`, raw.slice(0, 300));
        if (isRefusal(raw)) return res.status(422).json({ error: "This page cannot be analyzed. It may require login, be a private link, or not contain public policy content.", refusal: true });
        const json = extractJSON(raw);
        console.log(`[Gemma] Extracted JSON:`, json.slice(0, 200));
        const parsed = safeParseJSON(json);
        parsed.risk_score = Math.round(Number(parsed.risk_score) || 1);
        if (parsed.risk_score < 1) parsed.risk_score = 1;
        if (parsed.risk_score > 10) parsed.risk_score = 10;
        let hn = value; try { hn = new URL(value).hostname; } catch {}
        parsed.risk_score = Math.round(Number(parsed.risk_score)) || 1;
        if (parsed.risk_score < 1) parsed.risk_score = 1;
        if (parsed.risk_score > 10) parsed.risk_score = 10;
        const status = (parsed.summary || '').toLowerCase().includes('enable javascript') || (parsed.summary || '').toLowerCase().includes('does not contain') || (parsed.summary || '').toLowerCase().includes('placeholder') ? 'limited' : 'ok';
        const result = { id: crypto.randomUUID(), timestamp: Date.now(), type: 'website' as const, title: title || fr?.title || hn, url: value, status, ...parsed };
        setCache(ck, result);
        res.json(result);
      } else {
        const raw = await analyzeText(BASE_PROMPT + `\nCONTRACT TEXT:\n${value}`);
        if (isRefusal(raw)) return res.status(422).json({ error: "Cannot analyze this text — it does not appear to be a contract or policy document.", refusal: true });
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

  app.post("/api/translate", validate(translateSchema), async (req, res) => {
    try {
      const { text, targetLanguage } = req.body;
      if (!text || !targetLanguage) return res.status(400).json({ error: "Text and language required." });
      res.json({ translatedText: await translateText(text, targetLanguage) });
    } catch { res.status(500).json({ error: "Translation failed." }); }
  });

  // TTS — Google Translate free TTS (no API key needed)
  const LANG_MAP: Record<string, string> = { English: 'en', Hausa: 'ha', Yoruba: 'en', Igbo: 'en', French: 'fr', German: 'de', Japanese: 'ja' };
  app.post("/api/speak", validate(speakSchema), async (req, res) => {
    try {
      const { text, language } = req.body;
      if (!text || !language) return res.status(400).json({ error: "Text and language required." });
      const langCode = LANG_MAP[language] || 'en';
      const chunks = text.match(/[\s\S]{1,200}/g) || [text];
      const audioBuffers: Buffer[] = [];
      for (const chunk of chunks.slice(0, 8)) {
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

  app.post("/api/ocr-analyze", validate(ocrSchema), async (req, res) => {
    try {
      const { image, useDirectImage } = req.body;
      if (!image) return res.status(400).json({ error: "Image required." });
      const base64 = image.replace(/^data:image\/\w+;base64,/, '');
      const mime = image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const prompt = `You are a contract detective protecting gig workers and tenants. Analyze this contract photo. Return ONLY valid JSON (no markdown): {"summary":"string","risk_score":number(1-10),"risks":[{"clause":"string","risk":"string","severity":"low|medium|high","plain_explanation":"string","impact_line":"string","category_tag":"string"}],"actions":[{"title":"string","advice":"string","urgency":"string"}]}`;
      let raw: string;
      let ocrResult: { text: string; words: any[]; pageCount: number } | null = null;
      if (useDirectImage) {
        raw = await analyzeImage(base64, mime, prompt);
      } else {
        ocrResult = await ocrImage(Buffer.from(base64, 'base64'));
        console.log(`[OCR] Extracted ${ocrResult.text.length} chars from ${ocrResult.pageCount} page(s)`);
        raw = await analyzeText(`Analyze this employment contract or lease. Return ONLY valid JSON with summary, risk_score, risks[{clause,risk,severity,plain_explanation,impact_line,category_tag}].\n\nCONTRACT TEXT:\n${ocrResult.text}`);
      }
      const parsed = safeParseJSON(extractJSON(raw));
      const risks = (parsed.risks || []).map((r: any) => ({ title: r.clause, description: r.risk, severity: (r.severity || "medium").toLowerCase() || 'medium', plain_explanation: r.plain_explanation, impact_line: r.impact_line, category_tag: r.category_tag }));

      let clauseLocations: ClauseLocation[] | undefined;
      if (ocrResult && !useDirectImage) {
        const clauses = risks.map((r: any) => ({ text: r.title || r.description || '', severity: (r.severity || 'medium') as 'low' | 'medium' | 'high' }));
        const { locations } = await highlightImage(
          Buffer.from(base64, 'base64'),
          ocrResult.words,
          clauses
        );
        clauseLocations = locations;
      }

      res.json({
        id: crypto.randomUUID(), timestamp: Date.now(), type: 'contract', title: "Scanned Document",
        summary: parsed.summary, risk_score: parsed.risk_score || 1, risks, path: useDirectImage ? 'multimodal' : 'ocr',
        clauseLocations, pageCount: ocrResult?.pageCount || 1,
      });
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

  // Global error handler — never leak stack traces in production
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled Server Error:", err);
    res.status(500).json({
      error: "Internal Server Error",
      message: process.env.NODE_ENV === 'production' ? "An unexpected error occurred" : (err.message || "An unexpected error occurred"),
    });
  });

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Safroi API running on port ${PORT}`);
    connectDB().then(ok => { if (!ok) console.warn('[MongoDB] Running without database.'); });
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    server.close(() => {
      console.log('[Shutdown] HTTP server closed.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[Shutdown] Forced exit after timeout.');
      process.exit(1);
    }, 10000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();

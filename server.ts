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

// Robust website content fetcher with ToS/Privacy page detection
async function fetchWebsiteContent(inputUrl: string) {
  const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  ];

  const tryFetch = async (url: string, ua: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': ua, 'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9', 'Accept-Language': 'en-US,en;q=0.9' },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);
      if (!response.ok) return null;
      const ct = response.headers.get('content-type') || '';
      if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
      return await response.text();
    } catch (err) {
      clearTimeout(timeout);
      console.log(`[Fetch] Failed: ${url} — ${err instanceof Error ? err.message : err}`);
      return null;
    }
  };

  let parsedUrl: URL;
  try { parsedUrl = new URL(inputUrl); } catch { return null; }
  if (inputUrl.length > 2048) return null;
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;

  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '[::1]' || hostname === '[::]' || hostname.match(/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|fc|fd)/) || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.match(/^0x[0-9a-f]+$/i) || hostname.match(/^0[0-7]+$/)) {
    console.log(`[Fetch] Blocked private host: ${hostname}`);
    return null;
  }

  // Agentic: crawl homepage for ToS/Privacy links before trying common paths
  if (!inputUrl.toLowerCase().includes('terms') && !inputUrl.toLowerCase().includes('privacy') && !inputUrl.toLowerCase().includes('policy') && !inputUrl.toLowerCase().includes('legal') && !inputUrl.toLowerCase().includes('tos')) {
    console.log(`[Fetch] Crawling homepage ${inputUrl} for policy links...`);
    const homeHtml = await tryFetch(inputUrl, USER_AGENTS[0]);
    if (homeHtml && homeHtml.length > 500) {
      const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
      let match;
      const policyLinks: string[] = [];
      while ((match = linkPattern.exec(homeHtml)) !== null) {
        const href = match[1];
        const text = match[2].toLowerCase();
        if (text.includes('terms') || text.includes('privacy') || text.includes('policy') || text.includes('legal') || text.includes('tos') || text.includes('conditions')) {
          try {
            const fullUrl = href.startsWith('http') ? href : new URL(href, parsedUrl.origin).href;
            if (!policyLinks.includes(fullUrl)) policyLinks.push(fullUrl);
          } catch {}
        }
      }
      if (policyLinks.length > 0) {
        console.log(`[Fetch] Found ${policyLinks.length} policy links:`, policyLinks.slice(0, 5));
        // Also check href attributes for common paths even if link text isn't explicit
        const hrefPolicyLinks: string[] = [];
        const allLinks = homeHtml.match(/href=["']([^"']*(?:terms|privacy|policy|legal|tos)[^"']*)["']/gi);
        if (allLinks) {
          for (const l of allLinks) {
            const href = l.replace(/href=["']/i, '').replace(/["']$/, '');
            try {
              const fullUrl = href.startsWith('http') ? href : new URL(href, parsedUrl.origin).href;
              if (!policyLinks.includes(fullUrl) && !hrefPolicyLinks.includes(fullUrl)) hrefPolicyLinks.push(fullUrl);
            } catch {}
          }
        }
        const allPolicyUrls = [...new Set([...policyLinks, ...hrefPolicyLinks])];
        console.log(`[Fetch] Total policy URLs discovered: ${allPolicyUrls.length}`);

        // Fetch all discovered policy pages in parallel
        const policyUrls = allPolicyUrls.slice(0, 5);
        const results = await Promise.all(policyUrls.map(async (policyUrl) => {
          const policyHtml = await tryFetch(policyUrl, USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);
          if (!policyHtml || policyHtml.length <= 300) return null;
          const cleaned = policyHtml
            .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, '')
            .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, '')
            .replace(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gmi, '')
            .replace(/<footer\b[^>]*>([\s\S]*?)<\/footer>/gmi, '')
            .replace(/<header\b[^>]*>([\s\S]*?)<\/header>/gmi, '')
            .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ')
            .replace(/\s+/g, ' ').trim();
          let pageTitle = '';
          const tm = policyHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (tm) pageTitle = tm[1].trim();
          console.log(`[Fetch] ${policyUrl}: ${cleaned.length} chars`);
          return { url: policyUrl, text: cleaned, title: pageTitle };
        }));
        const valid = results.filter(Boolean) as NonNullable<typeof results[number]>[];
        const combinedContent = valid.map(r => `\n--- PAGE: ${r.url} ---\n${r.text}`).join('');
        const discoveredTitle = valid[0]?.title || '';
        console.log(`[Fetch] Parallel: ${valid.length}/${policyUrls.length} pages fetched, ${combinedContent.length} chars total`);

        if (combinedContent.length > 500) {
          const finalContent = combinedContent.substring(0, 30000);
          const favicon = `${parsedUrl.origin}/favicon.ico`;
          console.log(`[Fetch] Agentic: returning ${finalContent.length} chars from ${valid.length} policy pages`);
          return { content: finalContent, title: discoveredTitle || parsedUrl.hostname, favicon };
        }
      }
    }
  }

  // Try the URL directly, then common ToS/Privacy paths
  const urlsToTry = [inputUrl];
  if (!inputUrl.toLowerCase().includes('terms') && !inputUrl.toLowerCase().includes('privacy') && !inputUrl.toLowerCase().includes('policy') && !inputUrl.toLowerCase().includes('legal') && !inputUrl.toLowerCase().includes('tos')) {
    urlsToTry.push(
      `${parsedUrl.origin}/terms`,
      `${parsedUrl.origin}/terms-of-service`,
      `${parsedUrl.origin}/tos`,
      `${parsedUrl.origin}/privacy`,
      `${parsedUrl.origin}/privacy-policy`,
      `${parsedUrl.origin}/legal/terms`,
      `${parsedUrl.origin}/legal/privacy`,
    );
  }

  for (const url of urlsToTry) {
    for (const ua of USER_AGENTS) {
      const html = await tryFetch(url, ua);
      if (!html || html.length < 500) continue;

      console.log(`[Fetch] Got ${html.length} chars from ${url}`);

      let title = "";
      const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (tm) title = tm[1].trim();

      let favicon = "";
      const im = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["'][^>]*>/i) || html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
      if (im) { favicon = im[1]; if (favicon && !favicon.startsWith('http')) favicon = new URL(favicon, parsedUrl.origin).href; }
      else favicon = `${parsedUrl.origin}/favicon.ico`;

      const content = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, "")
        .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, "")
        .replace(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gmi, "")
        .replace(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gmi, "")
        .replace(/<footer\b[^>]*>([\s\S]*?)<\/footer>/gmi, "")
        .replace(/<header\b[^>]*>([\s\S]*?)<\/header>/gmi, "")
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#?\w+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 30000);

      // Check if content looks like a policy (contains common legal terms)
      const isLikelyPolicy = content.toLowerCase().includes('terms of') || content.toLowerCase().includes('privacy policy') || content.toLowerCase().includes('terms and conditions') || content.toLowerCase().includes('user agreement') || content.toLowerCase().includes('data collection');

      if (isLikelyPolicy || urlsToTry.length === 1) {
        console.log(`[Fetch] Using content from ${url} (${content.length} chars, likelyPolicy: ${isLikelyPolicy})`);
        return { content, title, favicon };
      }
      console.log(`[Fetch] ${url} didn't look like a policy page, trying next...`);
    }
  }

  console.log(`[Fetch] No policy content found for ${inputUrl}`);
  return null;
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
  function cacheKey(type: string, value: string) { return `${type}:${value.toLowerCase().trim().slice(0, 200)}`; }
  function getCached(key: string) { return (Analysis as any).findOne({ _id: `cache_${key}`, cacheExpiry: { $gt: new Date() } }); }
  function setCache(key: string, data: any) { (Analysis as any).findOneAndUpdate({ _id: `cache_${key}` }, { _id: `cache_${key}`, type: 'cache', userId: 'system', title: 'Cached', summary: '', risk_score: 0, risks: [], cachedResult: data, cacheExpiry: new Date(Date.now() + 86400000) }, { upsert: true, returnDocument: 'after' }); }

  app.post("/api/analyze", async (req, res) => {
    try {
      let { type, value, title, url } = req.body;
      if (url && !value) { value = url; type = 'website'; }
      if (!value) return res.status(400).json({ error: "Value is required" });

      const ck = cacheKey(type, value);
      const cached = await getCached(ck);
      if (cached && cached.cachedResult) { console.log(`[Cache] HIT`); return res.json(cached.cachedResult); }

      const BASE_PROMPT = `You are an impartial contract analyst. Analyze the document honestly — flag real risks where they exist, note where clauses are fair, standard, or protective. Focus on pay, hours, termination, liability, privacy, dispute resolution. For each clause: "description" (legal), "severity" (low|medium|high — only high when genuinely dangerous), "plain_explanation" (everyday language), "impact_line" (one-sentence consequence), "category_tag" (e.g. "Termination Risk"). Also provide "actions": 2-4 recommended steps ("title","advice","urgency"). Return ONLY valid JSON, no markdown, no backticks. Schema: {"summary":"string","risk_score":number(1-10),"risks":[{"title":"string","description":"string","severity":"low|medium|high","plain_explanation":"string","impact_line":"string","category_tag":"string"}],"actions":[{"title":"string","advice":"string","urgency":"string"}]}`;

      if (type === 'website') {
        const fetchRest = await fetchWebsiteContent(value);
        let prompt = BASE_PROMPT + `\nURL: ${value}\nTEXT: ${fetchRest?.content || ''}`;

        if (!fetchRest?.content) {
          const searchQuery = `${value} terms of service privacy policy`;
          const searchResult = await googleSearch(searchQuery);
          prompt = BASE_PROMPT + `\nURL: ${value}\nThe page couldn't be fetched directly. Here are search results:\n${searchResult}\n\nAnalyze what you can from these search results. Return JSON.`;
        }
        const raw = await analyzeText(prompt);
        console.log(`[Gemma] Website raw (${raw.length} chars):`, raw.slice(0, 200));
        const json = extractJSON(raw);
        console.log(`[Gemma] Extracted JSON:`, json.slice(0, 200));
        const parsed = safeParseJSON(json);
        parsed.risk_score = Math.round(Number(parsed.risk_score || 5));
        if (parsed.risk_score < 1) parsed.risk_score = 1;
        if (parsed.risk_score > 10) parsed.risk_score = 10;
        let hostname = value; try { hostname = new URL(value).hostname; } catch {}
        const result = { id: crypto.randomUUID(), timestamp: Date.now(), type: 'website' as const, title: title || fetchRest?.title || hostname, url: value, favicon: req.body.favicon || fetchRest?.favicon || "", ...parsed };
        setCache(ck, result);
        res.json(result);
      } else {
        const prompt = BASE_PROMPT + `\nCONTRACT TEXT:\n${value}`;
        const raw = await analyzeText(prompt);
        console.log(`[Gemma] Contract raw (${raw.length} chars):`, raw.slice(0, 200));
        const json = extractJSON(raw);
        console.log(`[Gemma] Extracted JSON:`, json.slice(0, 200));
        const parsed = safeParseJSON(json);
        parsed.risk_score = Math.round(Number(parsed.risk_score || 5));
        if (parsed.risk_score < 1) parsed.risk_score = 1;
        if (parsed.risk_score > 10) parsed.risk_score = 10;
        const risks = (parsed.risks || []).map((r: any) => ({ title: r.clause || r.title, description: r.risk || r.description, severity: (r.severity || "medium").toLowerCase() || 'medium', plain_explanation: r.plain_explanation, impact_line: r.impact_line, category_tag: r.category_tag }));
        const result = { id: crypto.randomUUID(), timestamp: Date.now(), type: 'contract' as const, title: title || "Contract Analysis", risk_score: parsed.risk_score || 1, summary: parsed.summary, key_points: parsed.key_points, risks, actions: parsed.actions, original_text: value };
        setCache(ck, result);
        res.json(result);
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

  // TTS voice narration
  const LANG_MAP: Record<string, string> = { English: 'en', Hausa: 'ha', Yoruba: 'en', Igbo: 'en', French: 'fr', German: 'de', Japanese: 'ja' };
  app.post("/api/speak", async (req, res) => {
    try {
      const { text, language } = req.body;
      if (!text || !language) return res.status(400).json({ error: "Text and language required." });
      const langCode = LANG_MAP[language] || 'en';
      const chunks = text.match(/[\s\S]{1,180}/g) || [text];
      const audioBuffers: Buffer[] = [];
      for (const chunk of chunks.slice(0, 5)) {
        const r = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${langCode}&q=${encodeURIComponent(chunk)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 500) audioBuffers.push(buf);
      }
      if (audioBuffers.length === 0) return res.status(500).json({ error: "TTS failed." });
      res.set({ 'Content-Type': 'audio/mpeg' });
      for (const buf of audioBuffers) res.write(buf);
      res.end();
    } catch { res.status(500).json({ error: "TTS failed." }); }
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
{"summary":"string","risk_score":number(1-10),"risks":[{"clause":"string","risk":"string","severity":"low|medium|high","plain_explanation":"string","impact_line":"string","category_tag":"string"}],"actions":[{"title":"string","advice":"string","urgency":"string"}]}`;

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

      const parsed = safeParseJSON(extractJSON(raw));
      const risks = (parsed.risks || []).map((r: any) => ({
        title: r.clause, description: r.risk, severity: (r.severity || "medium").toLowerCase() || 'medium',
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

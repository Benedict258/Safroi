# Safroi

**AI against exploitative contracts, across Africa — closing the silence where legal advice never existed.**

Safroi scans contracts, leases, and website terms of service, flags exploitative or high-risk clauses, and explains them in plain language — in English, Hausa, Yoruba, Igbo, and more. It exists to protect the majority of Africa's workforce who sign agreements every day without a lawyer, an HR department, or anyone to ask "is this normal?" first.

Built for the **AI for Africa Hackathon — Minna 2026**, AI for Social Impact track (SDG 8, SDG 10).

---

## How Gemma 4 Is Used

Every risk-analysis, plain-language explanation, and translation call in Safroi runs through **Gemma 4 (`gemma-4-26b-a4b-it`)**, accessed via the **Gemini API**. Specifically:

- **Clause risk analysis** — given extracted contract or webpage text, Gemma 4 identifies individual clauses, classifies each as high/medium/low risk, and returns a **schema-constrained response**: a legal/technical explanation, a plain-language explanation, a one-sentence real-world impact statement, and a category tag (e.g. "Termination Risk"). The prompt frames the model as an impartial contract analyst — "flag real risks where they exist, and note where clauses are fair, standard, or protective. Do not assume every clause is exploitative." See `server-api.ts:216-219` for the exact prompt.
- **Translation** — plain-language explanations are translated into supported languages (prioritizing Hausa, Yoruba, and Igbo) via the same Gemma 4 model via `src/services/ai.ts:71-86`.
- **Website/policy analysis (browser extension)** — the extension calls the same backend API endpoint (`/api/analyze`) as the web app, running through the identical Gemma 4 pipeline. Extension service worker at `chrome-extension/background.js:142-150`.

No fine-tuning, no RAG — reliability comes from **schema-constrained output**, **role framing** (the model is prompted to reason as an impartial contract reviewer, not a generic assistant), and explicit tone constraints.

---

## Features

### Working (verified)
- Contract/document scanning — photo upload, OCR text extraction via Tesseract.js, Gemma 4 clause-by-clause risk analysis
- Visual highlighting on scanned images — red (high risk), amber (caution), green (safe) via Sharp image compositing
- Dual explanation per flagged clause — legal/technical wording + plain-language explanation + impact statement + category tag
- Recommended Actions — 2-4 actionable steps with urgency badges (high/medium/low)
- Legal View / Plain View toggle (single toggle, applies across all clause cards)
- Translation into 7 languages (Hausa, Yoruba, Igbo, English, French, German, Japanese) — individual parallel calls, not batched
- Text-to-speech — **English and Hausa confirmed working** (real audio verified via live test, using Google Translate TTS, no API key required)
- Browser extension — auto-scans a visited site's terms/privacy policy, agentic discovery of `/terms` and `/privacy` pages via homepage link extraction, risk-colored badge (green/amber/red dot) on the extension icon
- Extension: Legal/Plain toggle, category tags, impact lines, Recommended Actions
- Extension: "Read Aloud" button on summary
- Extension: policy-update banner (hash-based change detection — score delta displayed as ↑↓→)
- Response caching (24h, MongoDB) to reduce repeat-analysis latency
- Smart URL extraction — deep links (e.g., `claude.ai/chat/xxx`) auto-extracted to root domain for analysis

### Partially working / known limitations
- **Text-to-speech in Yoruba and Igbo currently falls back to English audio** — the free Google Translate TTS service does not support these languages directly. Translated text displays correctly; spoken audio is in English for these two languages.
- **Policy-update tracking** (hash-based change detection in the extension) is implemented but has not been validated against a real, observed policy change on a live site — logic is in place, real-world verification pending.
- **Extension does not currently support translation or the language selector** — these features are web-app-only.
- **PDF multi-page clause location** was descoped — the current OCR pipeline extracts text but does not map clauses to specific PDF page coordinates. Photo uploads are highlighted on the rendered image; PDF annotation is not yet implemented.
- **SPA (Single Page Application) websites** that require JavaScript to render their terms pages (e.g., Render's dashboard) cannot be crawled by plain HTTP fetch. A Googlebot User-Agent header and Google Cache fallback have been added as mitigations, but some JS-only pages remain inaccessible without a headless browser.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend (dev) | Node.js 20+, TypeScript, Express (`server.ts`) |
| Backend (prod) | Node.js 20+, TypeScript, Express (`server-api.ts`, deployed on Render) |
| Frontend (web app) | React 19, TypeScript, Vite 6, Tailwind CSS 4 (deployed on Vercel) |
| Browser extension | Chrome Extension Manifest V3 (`chrome-extension/manifest.json:2`), vanilla JS |
| OCR | Tesseract.js (`src/ocr/index.ts`) |
| AI Model | Gemma 4 (`gemma-4-26b-a4b-it`) with fallback to `gemma-4-31b-it`, via Gemini API / Google GenAI SDK (`@google/genai`) |
| Text-to-Speech | Google Translate TTS (free tier, no API key required) |
| Caching | MongoDB (24h TTL) |
| Authentication | JWT + bcrypt (custom auth service, `src/services/auth.ts`) |

---

## Setup & Running Locally

Three options — fastest first:

### Option A — Pull & Run (Docker Hub, no clone, no build)
```bash
curl -O https://raw.githubusercontent.com/Benedict258/Safroi-roi/main/docker-compose.pull.yml
curl -O https://raw.githubusercontent.com/Benedict258/Safroi-roi/main/.env.docker && mv .env.docker .env
# edit .env — paste your GEMINI_API_KEY
docker compose -f docker-compose.pull.yml up
```
No git clone needed. Pulls pre-built images from Docker Hub. Backend on `:8080`, frontend on `:3000`. MongoDB included automatically.

**Docker Hub images:** `benedict258/safroi-backend:v1.0` | `benedict258/safroi-frontend:v1.0`

### Option B — Build Locally (Docker)
```bash
git clone https://github.com/Benedict258/Safroi-roi.git && cd Safroi-roi
cp .env.example .env   # then edit .env — set GEMINI_API_KEY and MONGODB_URI
docker compose up
```
Builds both images from the Dockerfiles in this repo.

### Option C — Manual (no Docker)
```bash
git clone https://github.com/Benedict258/Safroi-roi.git && cd Safroi-roi
npm install
cp .env.example .env   # then edit .env
npm run dev
```
Requires Node.js 20+ and a running MongoDB instance. Backend + frontend served together on `http://localhost:3000`.

### Environment Variables
Create a `.env` file (copy from `.env.example`) with:
```
GEMINI_API_KEY=your_key_here
MONGODB_URI=mongodb://localhost:27017/safroi     # for Docker: mongodb://mongodb:27017/safroi
PORT=3000
```
Generate a Gemini API key at [Google AI Studio](https://aistudio.google.com) — confirm the key is issued as a current **auth key**, not a legacy standard key.

### Load the browser extension (all options)
1. Open Chrome → `chrome://extensions` → Enable **Developer mode**
2. Click **Load unpacked** → select the `chrome-extension/` directory

### Verify it's working
- Upload a test contract and confirm real Gemma 4 analysis (risk score, flagged clauses, plain-language explanations, recommended actions)
- Visit any website with the extension enabled and confirm the badge color updates

---

## Demo

- **Live demo (web app):** `https://safroi.vercel.app`
- **Live API (backend):** `https://safroi.onrender.com`
- **API health check:** `https://safroi.onrender.com/api/health`
- **Extension download:** `https://safroi.onrender.com/api/download-extension`

---

## Project Structure

```
/                       — Root (single-package monolith)
├── server.ts            — Dev server (Express + Vite middleware)
├── server-api.ts         — Production API server (deployed on Render)
├── .env.example          — Environment variable template
├── package.json          — Dependencies and scripts
├── tsconfig.json         — TypeScript configuration
├── vite.config.ts        — Vite configuration
├── vercel.json           — Vercel deployment config
│
├── src/
│   ├── App.tsx           — React root component
│   ├── main.tsx          — React entry point
│   ├── types.ts          — TypeScript interfaces
│   ├── components/       — UI components (Header, ResultView, etc.)
│   ├── services/
│   │   ├── ai.ts         — Gemma 4 client (Google GenAI SDK)
│   │   ├── auth.ts       — JWT authentication service
│   │   └── groq.ts       — Frontend API calls (filename is historical — no Groq code)
│   ├── db/
│   │   ├── index.ts      — MongoDB connection pool
│   │   └── models.ts     — User + Analysis models
│   ├── ocr/
│   │   └── index.ts      — Tesseract.js OCR pipeline
│   ├── hooks/
│   │   └── useHistory.ts — Client-side analysis history
│   └── lib/
│       └── utils.ts      — Tailwind class merge utility
│
├── chrome-extension/     — Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js     — Service worker (auto-scan, caching)
│   ├── content.js        — Auth state sync
│   ├── popup.html        — Popup UI
│   ├── popup.js          — Popup logic
│   └── config.json       — Default configuration
│
└── public/               — Static assets
```

---

## Attribution

No third-party reference code was used in this project beyond standard open-source libraries listed in `package.json`.

---

## Team

- **Benedict Isaac** — Full-stack development, AI integration, prompt engineering
- **Amanda Adewumi** — Product direction, UX design

---

## License

MIT — pending final confirmation before publishing. No license file currently in the repository.

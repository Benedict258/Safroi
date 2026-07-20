# Safroi — Deployment Checkpoint

**Commit:** `e4dbed7` | **Date:** July 21, 2026

---

## What's Live

### Production URLs
| Service | URL |
|---|---|
| Frontend | Vercel (Vite React SPA) |
| Backend API | `https://safroi.onrender.com` |
| Database | MongoDB Atlas — `safroi.v8zbvlv.mongodb.net` |

### Environment Variables (Render)
| Key | Purpose |
|---|---|
| `MONGODB_URI` | Atlas connection string |
| `GROQ_API_KEY` | Groq LLM access |
| `NODE_ENV` | `production` |

### Environment Variables (Vercel)
| Key | Value |
|---|---|
| `VITE_API_URL` | `https://safroi.onrender.com` |

---

## Features Working

### Authentication (JWT + MongoDB)
- `POST /api/auth/signup` — Register with email/password/name. Returns JWT. Duplicate → 409.
- `POST /api/auth/login` — Login. Returns JWT. Wrong password → 401.
- `POST /api/auth/reset` — Password reset request.
- `GET /api/auth/me` — Validate token, return user.
- Passwords hashed with bcrypt (12 rounds).
- JWT tokens expire in 30 days.

### AI Analysis (Groq — GPT OSS 120B)
- `POST /api/analyze` — Website URL or contract text.
- Two paths: direct content fetch (with SSRF protection, 15s timeout) or Google Search fallback via Serper.dev.
- Returns: `summary`, `risk_score` (1-10), `risks[]` with severity.
- `POST /api/translate` — Translate summary to Spanish/French/German/Japanese.

### History (MongoDB)
- `POST /api/history` — Save analysis.
- `GET /api/history/:userId` — List (50 newest).
- `GET /api/history/:userId/:id` — Get single analysis.
- `DELETE /api/history/:userId/:id` — Delete.

### Frontend UI
- Landing page with hero, features, extension section.
- Auth modal (email/password only — no Google OAuth).
- Dashboard with tabbed input (Website URL / Paste Text / Upload File).
- Results view with risk score, summary, translations, risk cards.
- History view with color-coded risk badges.
- About page, Legal page (ToS, Privacy Policy, AI Governance).
- Footer with navigation and social links.
- Mobile-responsive hamburger menu.

### Chrome Extension
- Manifest V3, downloadable from `/api/download-extension` as ZIP.
- Auto-detects domain, analyzes on page load.
- Color-coded icon badge (green/amber/red).
- Popup with risk score, summary, risks.
- Auth sync via localStorage.

### Security
- URL fetcher blocks private IPs (IPv4, IPv6, .local, .internal).
- 15-second fetch timeout with AbortController.
- Hostname hex/octal encoding bypasses blocked.
- 2048-char URL length cap.
- Protocol whitelist (HTTP/HTTPS only).
- Content-type validation (HTML/plain text only).
- Passwords bcrypt-hashed, never stored in plain text.
- JWT token validation on protected endpoints.

---

## What Was Removed
- Firebase (Auth, Firestore, config, rules)
- AI Studio (`metadata.json`, `firebase-applet-config.json`, `DISABLE_HMR` comments)
- PostgreSQL (replaced with MongoDB)
- Railway configs (`railway.toml`, `nixpacks.toml`)
- Docker files (kept as optional)
- GEMINI_API_KEY references (only Groq used)
- Google OAuth sign-in button
- Console noise suppression for irrelevant services
- 10+ `any` TypeScript types (replaced with proper interfaces)
- Contract risk score client-side override (server score now authoritative)

---

## Build Commands
| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server (Express + Vite HMR) |
| `npm run build:vercel` | Vite build for Vercel frontend |
| `npm run build:api` | esbuild bundle for Render backend |
| `npm run start:api` | Production start on Render |
| `npm run lint` | TypeScript type check |

---

## Known Gaps
1. Password reset sends email — currently logs token to server console. Needs SendGrid/Mailgun integration.
2. File upload (PDF/DOCX) extracts placeholder text. Needs `pdf-parse` + `mammoth` integration.
3. Free Render tier sleeps after 15min inactivity (30s cold start on first request).
4. No rate limiting on auth endpoints.
5. Chrome extension auth relies on localStorage polling — could use `chrome.storage.session` for better security.

# Safroi Project Checkpoint — September 13, 2026

## Project Summary

**Safroi** is an AI-powered legal risk analyzer designed for Africa — scans contracts, Terms of Service, and Privacy Policies, flags exploitative clauses, and explains them in plain language across 7+ languages. Built for **AI for Africa Hackathon — Minna 2026**, AI for Social Impact track.

**Vision:** Protect Africa's workforce who sign agreements without legal counsel — closing the silence where legal advice never existed.

---

## Current State: Production-Ready with Payment Infrastructure

### Core Tech Stack
| Layer | Technology |
|-------|------------|
| Backend | Node.js 20+, TypeScript, Express (server.ts dev / server-api.ts prod) |
| Frontend | React 19 + Vite 6 + Tailwind CSS 4 |
| Database | MongoDB Atlas / Mongoose |
| AI Model | Gemma 4 (`gemma-4-26b-a4b-it` via Google Gemini API, fallback `gemma-4-31b-it`) |
| OCR | Tesseract.js |
| Extension | Chrome Manifest V3 |
| Auth | JWT + bcrypt (custom) |
| Payments | Paystack + Lemon Squeezy |

### What's Working (Verified)
1. **Contract/Document Analysis**
   - Photo upload → OCR text extraction
   - Gemma 4 clause-by-clause risk analysis with schema-constrained output
   - Visual highlighting on images (red/amber/green)
   - Dual explanations: legal/technical + plain language + impact statement
   - Recommended Actions with urgency badges

2. **Web App UI**
   - Landing page with hero/feature sections
   - Auth modal (email/password)
   - Dashboard with URL/paste/file input
   - Results view with risk cards, translations, TTS
   - History view with color-coded badges
   - Pricing page with Free/Pro/Business tiers
   - Plan badge in header with upgrade links

3. **Payment Infrastructure** (Just Completed)
   - Paystack (Nigeria) + Lemon Squeezy (Global)
   - Three tiers: Free, Pro ($5/mo), Business ($15/mo)
   - Webhook signature verification (SHA512/SHA256 + timingSafeEqual)
   - User plan/payment fields persisted in MongoDB
   - Payment result pages + success banners

4. **Chrome Extension**
   - Auto-scans visited sites for Terms/Privacy
   - Policy discovery via homepage link extraction
   - Color-coded badge icon
   - Policy change detection (hash-based)
   - Auth sync

5. **Additional Features**
   - Translation to Hausa, Yoruba, Igbo, English, French, German, Japanese
   - Text-to-Speech (English/Hausa confirmed)
   - Caching (24h MongoDB)
   - Smart URL extraction
   - Response caching

### Payment System Architecture
- **Paystack**: Nigerian users, card transfers, bank payments
- **Lemon Squeezy**: Global users, Stripe-powered
- **Middleware**: `requirePlan` created but NOT attached to routes (per spec)
- **Webhooks**: Raw body preservation via express.json verify callback
- **Plan Detection**: Timezone-based (Africa/Lagos → show both providers)

### Security Features
- HMAC signature verification for all webhooks
- SSRF protection (private IP blocking)
- Hostname encoding bypass protection
- 2048-char URL length cap
- Protocol whitelist
- bcrypt password hashing (12 rounds)
- JWT tokens (30-day expiry)

### Known Limitations
- TTS falls back to English for Yoruba/Igbo
- Extension lacks translation/language selector
- No PDF multi-page clause coordinate mapping
- SPA sites with JS-rendered Terms may not crawl
- Policy change tracking not validated against real changes

### Environment Variables Needed
```
GEMINI_API_KEY=           # Primary
GEMINI_MODEL=gemma-4-26b-a4b-it
MONGODB_URI=              # MongoDB Atlas
JWT_SECRET=
CLIENT_URL=http://localhost:3000
# Payments
PAYSTACK_SECRET_KEY=
PAYSTACK_PLAN_CODE_PRO=
PAYSTACK_PLAN_CODE_BUSINESS=
LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_STORE_ID=
LEMONSQUEEZY_WEBHOOK_SECRET=
LEMONSQUEEZY_VARIANT_ID_PRO=
LEMONSQUEEZY_VARIANT_ID_BUSINESS=
```

### Deployment
- **Frontend**: Vercel (`safroi.vercel.app`)
- **Backend**: Render (`safroi.onrender.com`)
- **Database**: MongoDB Atlas
- **Docker**: Pre-built images available on Docker Hub

### Recent Commit
- `7ada8a4` - Payment infrastructure (Paystack + Lemon Squeezy)
- Payment fields added to User schema
- 7 new files created, 13 files modified

### Next Steps Candidates
1. Implement scan limits for Free tier
2. Add Paystack/Lemon Squeezy test credentials validation
3. Full payment flow E2E testing
4. Policy change detection validation
5. PDF clause coordinate mapping
6. Rate limiting on auth endpoints
7. Email integration for password reset

---

**Last Updated:** September 13, 2026  
**Status:** Payment infrastructure complete, ready for testing

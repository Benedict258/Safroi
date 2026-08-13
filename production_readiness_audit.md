# Autonomous AI Builder Instruction Set: SEO, Security Hardening, & Deployment Audit

> **Target:** AI Coding Agent / Automated Builder  
> **Task:** Perform an end-to-end SEO optimization, Security Audit & Remediation, and Production Deployment Audit on the codebase. Execute changes step-by-step, verify each change, and log findings.

---

## 📋 Execution Protocol for the AI Builder
1. **Analyze First:** Read the repository structure, config files, package dependencies, and framework setup before making modifications.
2. **Incremental Execution:** Perform changes phase-by-phase. Run build checks and tests after each phase to ensure no regression.
3. **Non-Destructive Fixes:** Always preserve existing business logic while refactoring for security or performance.
4. **Reporting:** Record every modified file, vulnerability fixed, and SEO tag added in an `AUDIT_LOG.md` file upon completion.

---

## Phase 1: SEO Optimization Audit & Execution

### 1.1 Meta Data & Social Graph
- [ ] **Title & Description:** Ensure every page/route has a unique, descriptive `<title>` (50-60 chars) and `<meta name="description">` (150-160 chars).
- [ ] **OpenGraph Tags:** Implement `og:title`, `og:description`, `og:image`, `og:url`, `og:type`, and `og:site_name`.
- [ ] **Twitter Cards:** Add `twitter:card` (e.g., `summary_large_image`), `twitter:title`, `twitter:description`, and `twitter:image`.
- [ ] **Favicon & Icons:** Verify presence of `/favicon.ico`, high-res PNG icons, and `apple-touch-icon`.

### 1.2 Search Engine Indexing & Crawling
- [ ] **Robots.txt:** Audit or create `robots.txt` ensuring key public routes are allowed and sensitive admin/API routes (`/api/*`, `/admin/*`, `/dashboard/*`) are disallowed.
- [ ] **Dynamic Sitemap (`sitemap.xml`):** Generate an automated dynamic XML sitemap listing all indexable canonical URLs with correct `<lastmod>` timestamps.
- [ ] **Canonical URLs:** Ensure `<link rel="canonical" href="...">` is injected on all renderable pages to eliminate duplicate content issues.
- [ ] **Language & Viewport:** Ensure `<html lang="en">` (or appropriate locale) and `<meta name="viewport" content="width=device-width, initial-scale=1">` exist.

### 1.3 Content Structure & Semantics
- [ ] **Heading Hierarchy:** Verify each page has exactly **one** `<h1>` tag followed by logical `<h2>` to `<h6>` nesting without skipping levels.
- [ ] **Image Optimization:** 
  - Ensure all `<img>` tags have descriptive `alt` attributes.
  - Implement native lazy loading (`loading="lazy"`) or framework-specific image wrappers (e.g., `next/image`).
  - Convert static images to WebP or AVIF formats where applicable.
- [ ] **Structured Data (JSON-LD):** Inject schema markup (e.g., `Organization`, `WebSite`, `SoftwareApplication`, or `Article`) via `<script type="application/ld+json">`.

---

## Phase 2: Security Audit & Vulnerability Remediation

### 2.1 Dependency & Code Vulnerability Scanning
- [ ] **Dependency Audit:** Run package manager security audits (`npm audit`, `pnpm audit`, `yarn audit`, or `pip audit`). Fix all high and critical vulnerabilities.
- [ ] **Secret Leakage Prevention:** Scan repository for hardcoded keys, passwords, API tokens, or JWT secrets. Move all sensitive values to environment variables (`.env`).
- [ ] **Gitignore Check:** Ensure `.env`, `.env.local`, build artifacts, and sensitive logs are present in `.gitignore`.

### 2.2 Input Validation & Injection Prevention
- [ ] **SQL / NoSQL Injection:** Ensure all database queries use parameterized statements, prepared statements, or an ORM (e.g., Prisma, Drizzle, SQLAlchemy, Mongoose).
- [ ] **Cross-Site Scripting (XSS):** Sanitize all user-supplied inputs before rendering. Ensure no unescaped html insertion (`dangerouslySetInnerHTML` or `v-html`) is used without sanitization (e.g., DOMPurify).
- [ ] **Request Validation:** Add schema-based input validation (e.g., Zod, Yup, Joi, or Pydantic) on all API endpoints accepting user input (`POST`, `PUT`, `PATCH`).

### 2.3 Authentication, Authorization & Session Management
- [ ] **Route Guarding:** Audit all private/protected routes and API handlers to ensure access tokens or session cookies are strictly validated before returning sensitive data.
- [ ] **Role-Based Access Control (RBAC):** Confirm user privileges (e.g., user vs. admin) are evaluated server-side, not relied upon from client state.
- [ ] **Cookie Security:** Set session cookies with `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict`), and appropriate `Path`/`Domain` attributes.

### 2.4 API Security & Network Hardening
- [ ] **Security Headers:** Configure HTTP security headers (e.g., via middleware, server config, or `helmet`):
  - `Content-Security-Policy` (CSP)
  - `Strict-Transport-Security` (HSTS: `max-age=31536000; includeSubDomains`)
  - `X-Frame-Options: DENY` or `SAMEORIGIN`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy`
- [ ] **CORS Configuration:** Restrict Cross-Origin Resource Sharing (CORS) to explicitly allowed origin domains rather than wildcard `*`.
- [ ] **Rate Limiting:** Implement API rate limiting on public endpoints and login/authentication routes to prevent brute-force and DDoS attacks.
- [ ] **Information Disclosure:** Strip standard server identity headers (`X-Powered-By`, `Server`). Ensure error responses in production do not reveal backend stack traces or internal system details.

---

## Phase 3: Production Deployment Readiness Audit

### 3.1 Build & Environment Audit
- [ ] **Clean Compilation:** Run full project build scripts (`npm run build`, `tsc`, or framework build commands). Ensure zero build errors and zero TypeScript / linter blockages.
- [ ] **Environment Variable Validation:** Ensure a missing environment variable validator exists (e.g., checking `process.env` at server startup to prevent runtime crashes).
- [ ] **Node / Runtime Version:** Ensure specified runtime versions (`.nvmrc`, `package.json` `engines`, `Dockerfile`) match the target hosting platform.

### 3.2 Performance & Asset Management
- [ ] **Bundle Optimization:** Tree-shake unused dependencies, remove dead code, and implement code splitting / dynamic imports for heavy components.
- [ ] **Caching & Compression:** Verify static assets are configured with long-term cache headers (`Cache-Control: public, max-age=31536000, immutable`) and dynamic responses enable Gzip / Brotli compression.
- [ ] **Database & Connections:** Audit connection pooling for serverless/edge environments. Ensure database indexes exist for heavily queried columns.

### 3.3 Reliability & Monitoring
- [ ] **Health Check Endpoint:** Implement a dedicated `/api/health` or `/healthz` route that reports system status (e.g., DB connectivity check).
- [ ] **Error Tracking:** Verify error monitoring integration (e.g., Sentry, LogRocket, Datadog) is initialized with production environment key.
- [ ] **Graceful Shutdown:** Ensure server processes handle `SIGTERM` and `SIGINT` signals gracefully to close database pools and finish active requests.

---

## Phase 4: Verification & Log Output
Upon finishing the tasks above:
1. Run the test suite (`npm test`, `pytest`, etc.) to confirm no regressions.
2. Generate an `AUDIT_LOG.md` detailing:
   - All files modified
   - Fixed security vulnerabilities
   - Added SEO elements
   - Status of production readiness checks

# Render Backend Deployment Guide

## Prerequisites
- Render account
- Git repository connected to Render
- MongoDB Atlas connection string
- API keys configured

## Environment Variables Required

Set these in Render Dashboard > Environment:

| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Gemini AI for embeddings |
| `GROQ_API_KEY` | Groq for text analysis |
| `JWT_SECRET` | Generate random 32+ char string |
| `NODE_ENV` | production |
| `PORT` | 8080 (Render sets automatically) |
| `PAYSTACK_SECRET_KEY` | Paystack payments |
| `LEMORNSQUEEZY_API_KEY` | Lemon Squeezy payments |
| `EMAIL_HOST`, `EMAIL_USER`, `EMAIL_PASS` | Email service |
| `FRONTEND_URL` | Your Vercel frontend URL |

## Render Configuration

### Option 1: Blue/Green Deploy via render.yaml (Recommended)

1. Commit `render.yaml` to repo
2. In Render Dashboard, create new Web Service
3. Connect GitHub repo
4. Select `render.yaml` config
5. Add environment variables
6. Deploy

### Option 2: Manual Configuration

1. **Build Command**:
```bash
npm install && npm run build:api
```

2. **Start Command**:
```bash
npm start:api
# OR: node dist/server-api.cjs
```

3. **Environment**: Node
4. **Node Version**: 20.x or higher

## Deployment Steps

### Quick Deploy

```bash
# 1. Commit all changes
git add .
git commit -m "Prepare for Render deployment"
git push origin main

# 2. Render will auto-deploy via webhook
```

### Manual Build Test (Local)

```bash
# Test build locally
npm install
npm run build:api

# Verify output
ls -la dist/server-api.cjs

# Test start (requires env vars)
npm start:api
```

### Verify Deployment

1. Check Render logs: `Deploy Logs` tab
2. Test health endpoint: `https://safroi.onrender.com/health`
3. Test API: `https://safroi.onrender.com/api/documents`
4. Check frontend can connect

## Common Issues

### Build Fails - Missing Dependencies
```bash
npm install --production=false
```
The build needs dev dependencies for esbuild

### Module Not Found
Ensure `type: "module"` in package.json and esbuild target is correct

### MongoDB Connection Error
Check `MONGODB_URI` is correct and Atlas allows Render IPs
Add `ssl=true` and `retryWrites=true` to URI

### Environment Variables Not Loading
Render injects PORT automatically, use `process.env.PORT || 8080`

### Large Payload Failures
Server already configured for 50mb payloads
Check Render request size limits (max 6mb for free tier)

## New Document Chat Dependencies

Recent changes added:
- `pdf-parse` - PDF text extraction
- `mammoth` - DOCX text extraction  
- `uuid` - ID generation

These are in `package.json` and will install via `npm install`

## Rollback

If deployment fails:
1. Go to Render Dashboard > safroi-backend
2. Click `...` > `Rollback`
3. Select previous successful deploy

## Post-Deployment

1. Update frontend `VITE_API_URL` to new backend URL
2. Test document upload with PDF/DOCX
3. Test chat functionality
4. Verify auto-save from analysis works

# Document Chat (RAG) Implementation Plan

**Feature**: Upload URL / Paste Text / Upload File → Chat with Document  
**Tab Position**: After "Upload File" in AnalysisForm  
**Status**: Planning Phase

---

## 1. Overview

Enable users to chat with their uploaded documents, pasted text, or website content via Retrieval-Augmented Generation (RAG). Answers must be grounded strictly in the document content with no hallucination.

**Requirements**:
- Support: PDF, DOCX, TXT, Images (OCR), Website URLs, Paste Text
- Chat history isolated per document
- Chat history persisted in MongoDB
- RAG-only (no external knowledge)
- No plan restrictions for now
- Integrate with existing Safroi stack

---

## 2. Architecture

### Data Flow
```
User Input (File/URL/Text) → Extract Text → Chunk → Embed → Store
                                    ↓
User Question → Embed Query → Cosine Similarity Search → Top K Chunks → Grounding Prompt → Gemma 4 → Answer with Sources
```

### Tech Stack
- Backend: Express + TypeScript + MongoDB
- AI: Gemma 4 via `@google/genai` (`gemma-4-26b-a4b-it`)
- Embeddings: Gemini `text-embedding-004` (768 dim)
- OCR: Existing Tesseract.js pipeline
- Web Scrape: Existing `fetchWebsiteContent`
- Frontend: React 19, Tailwind CSS 4

**No external vector DB for v1** — brute-force cosine similarity over document chunks (~200 chunks max per doc = <50ms)

---

## 3. Database Schema

### New Models in `src/db/models.ts`

```typescript
// Document metadata
const documentSchema = new mongoose.Schema({
  _id: String,
  userId: { type: String, required: true, index: true },
  title: String,
  sourceType: { type: String, enum: ['upload','url','text','image'], required:true },
  sourceUrl: String,
  fileName: String,
  mimeType: String,
  status: { type: String, enum: ['processing','ready','failed'], default:'processing' },
  text: String,               // Full text for preview/fallback
  tokenCount: Number,
  created_at: { type: Date, default: Date.now }
},{ versionKey:false });

// Document chunks with embeddings
const chunkSchema = new mongoose.Schema({
  _id: String,
  documentId: { type: String, required: true, index: true },
  chunkIndex: Number,
  text: String,
  embedding: [Number],        // 768-dim Gemini embedding
  tokenCount: Number
},{ versionKey:false });

// Chat session per document per user
const chatSessionSchema = new mongoose.Schema({
  _id: String,
  documentId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  title: String,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
},{ versionKey:false });

// Chat messages
const chatMessageSchema = new mongoose.Schema({
  _id: String,
  sessionId: { type: String, required: true, index: true },
  role: { type: String, enum:['user','assistant'], required:true },
  content: String,
  sources: [{ chunkId: String, text: String, score: Number }],
  created_at: { type: Date, default: Date.now }
},{ versionKey:false });
```

---

## 4. Implementation Phases

### Phase 1: Backend — Ingestion Pipeline

**New file**: `src/services/document.ts`

**Functions**:
- `extractText(buffer, mimeType)` — Route to parser:
  - PDF → `pdf-parse`
  - DOCX → `mammoth`
  - TXT → utf8
  - Image → reuse existing OCR
- `chunkText(text)` — ~800-1000 tokens per chunk, 150 token overlap
- `generateEmbedding(text)` — Use Gemini `text-embedding-004`
- `ingestDocument(userId, sourceType, content)` — Orchestrates extract → chunk → embed → save

**New router**: `src/routes/documents.ts`

Endpoints:
```
POST /api/documents/ingest
Body: { type:'upload'|'url'|'text'|'image', value:string, fileName?, mimeType? }
→ Returns { documentId, title, chunkCount }

GET /api/documents
→ List user documents

GET /api/documents/:id
→ Document metadata + preview

DELETE /api/documents/:id
→ Cascade delete chunks + sessions + messages
```

### Phase 2: Backend — Chat API

Endpoints:
```
POST /api/documents/:id/chat
Body: { message:string }
→ Embed query → cosine similarity vs chunks → top 5 → build grounded prompt → Gemma 4
→ Save user + assistant messages with sources
→ Return { reply, sources }

GET /api/documents/:id/chat/history
→ Return messages sorted by created_at
```

**RAG Prompt Template**:
```
You must answer using ONLY the following context. If answer not present, say "Not found in document".

Context:
[1] {{chunk1}}
[2] {{chunk2}}
...

Question: {{userMessage}}

Cite sources like [1][3] at end of sentences. Do not hallucinate.
```

### Phase 3: Frontend — UI Updates

**Files Modified**:
- `src/components/AnalysisForm.tsx` — Add 4th tab "Document Chat"
- `src/components/DocumentChat.tsx` — New component

**AnalysisForm Changes**:
- Tabs: Website URL | Paste Text | Upload File | **Document Chat**
- New tab shows document selector dropdown
- Empty state: "Upload/create a document first"

**Document Chat UI**:
- Left sidebar: Document list
- Main: Chat history with message bubbles
- Sources panel below assistant messages
- Input field with Send button
- Auto-scroll, loading skeletons, error states

**New Components**:
- `components/DocumentList.tsx`
- `components/DocumentChat.tsx`
- `hooks/useDocumentChat.ts`

### Phase 4: Integration

1. Add new npm packages:
   ```json
   "pdf-parse": "^1.x",
   "mammoth": "^1.x"
   ```
2. Update `src/services/ai.ts` to add `generateEmbedding()` function
3. Extend MongoDB models
4. Create routes
5. Update frontend components
6. Test with sample documents

---

## 5. File Structure

```
src/
├── routes/
│   ├── documents.ts          # New: Document + chat routes
│   └── ...
├── services/
│   ├── document.ts           # New: Extraction, chunking, embedding
│   ├── ai.ts                 # Add generateEmbedding()
│   └── ...
├── models.ts                 # Add Document, Chunk, ChatSession, ChatMessage
├── components/
│   ├── DocumentChat.tsx      # New
│   ├── DocumentList.tsx      # New
│   └── AnalysisForm.tsx      # Modify tabs
└── types/
    └── rag.ts                # New: TypeScript interfaces
```

---

## 6. Security & Limits

- JWT required on all document endpoints
- File size limit: 10MB
- MIME whitelist: PDF, DOCX, TXT, PNG, JPG, JPEG
- Rate limiting already exists
- Prompt injection guard via system prompt grounding
- Cap chunks per document: 500 max (v1)

---

## 7. Testing Checklist

- [ ] PDF upload → text extraction → chat works
- [ ] DOCX upload → works
- [ ] Image upload → OCR → chat works
- [ ] URL input → scrape → chat works
- [ ] Paste text → chat works
- [ ] Chat history persists per document
- [ ] Chat history isolated per user
- [ ] Answers cite sources correctly
- [ ] "Not found in document" for ungrounded questions
- [ ] Switching documents switches chat context
- [ ] Document deletion cascades cleanup

---

## 8. Timeline Estimate

- Phase 1 (Ingestion): 2-3 hours
- Phase 2 (Chat API): 2-3 hours
- Phase 3 (Frontend): 3-4 hours
- Phase 4 (Integration/Test): 1-2 hours

**Total**: ~8-12 hours

---

## Notes

- Reuse existing OCR pipeline from `src/ocr/index.ts`
- Reuse existing web scraper from `server.ts`
- Reuse existing JWT auth from `src/services/auth.ts`
- No external vector DB needed for v1
- Embeddings stored in MongoDB as numbers array
- Cosine similarity implemented in Node.js with simple math
- Chat tab appears after Upload File in AnalysisForm

---

**Ready to implement?**

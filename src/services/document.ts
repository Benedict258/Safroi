import { v4 as uuidv4 } from 'uuid';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { generateEmbedding, analyzeText } from './ai';
import { ocrImage } from './ocr';
import { fetchWebsiteContent } from './web';
import { documentStore, StoredDocument, StoredChunk } from './documentStore';

function tokenCount(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  try {
    if (mimeType === 'text/plain') {
      return buffer.toString('utf-8');
    }
    if (mimeType === 'application/pdf') {
      const data = await pdfParse(buffer);
      return data.text;
    }
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    if (mimeType.startsWith('image/')) {
      const base64 = buffer.toString('base64');
      return await ocrImage(base64, mimeType);
    }
    throw new Error(`Unsupported mime type: ${mimeType}`);
  } catch (err) {
    console.error('[Document] Extract error:', err);
    throw err;
  }
}

export function chunkText(text: string, chunkSize = 800, overlap = 150): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';
  
  for (const sentence of sentences) {
    const candidate = current + (current ? ' ' : '') + sentence;
    if (tokenCount(candidate) > chunkSize && current) {
      chunks.push(current);
      const words = current.split(' ');
      const overlapWords = words.slice(-Math.floor(overlap / 1.3));
      current = overlapWords.join(' ') + ' ' + sentence;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks.filter(c => c.trim().length > 0);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function ingestDocument(userId: string, params: {
  sourceType: 'upload' | 'url' | 'text' | 'image' | 'analysis';
  value: string;
  fileName?: string;
  mimeType?: string;
  title?: string;
}): Promise<{ documentId: string; title: string; chunkCount: number }> {
  const documentId = uuidv4();
  let text = '';
  let title = params.title || 'Untitled Document';

  try {
    if (params.sourceType === 'url') {
      const result = await fetchWebsiteContent(params.value);
      text = result.content;
      title = title || result.title || 'Web Page';
    } else if (params.sourceType === 'text' || params.sourceType === 'analysis') {
      text = params.value;
    } else {
      const buffer = Buffer.from(params.value, 'base64');
      text = await extractText(buffer, params.mimeType || 'text/plain');
    }

    if (!text || text.trim().length < 10) {
      throw new Error('No readable text could be extracted from the document');
    }

    const doc: StoredDocument = {
      _id: documentId,
      userId,
      title,
      sourceType: params.sourceType,
      sourceUrl: params.sourceType === 'url' ? params.value : undefined,
      fileName: params.fileName,
      mimeType: params.mimeType,
      status: 'processing',
      text: text.slice(0, 8000),
      tokenCount: tokenCount(text),
      created_at: new Date()
    };
    await documentStore.saveDocument(doc);

    const textChunks = chunkText(text);
    const chunkDocs: StoredChunk[] = [];
    
    for (let i = 0; i < textChunks.length; i++) {
      const chunkStr = textChunks[i];
      let embedding: number[] = [];
      try {
        embedding = await generateEmbedding(chunkStr);
      } catch (embErr) {
        console.warn(`[Document] Embedding failed for chunk ${i}:`, embErr);
      }
      chunkDocs.push({
        _id: uuidv4(),
        documentId,
        chunkIndex: i,
        text: chunkStr,
        embedding,
        tokenCount: tokenCount(chunkStr)
      });
    }
    
    await documentStore.saveChunks(documentId, chunkDocs);
    await documentStore.updateDocumentStatus(documentId, 'ready');

    return { documentId, title, chunkCount: textChunks.length };
  } catch (err) {
    console.error('[Document] Ingestion failed:', err);
    await documentStore.updateDocumentStatus(documentId, 'failed');
    throw err;
  }
}

export async function findRelevantChunks(documentId: string, query: string, topK = 5) {
  const chunks = await documentStore.getChunks(documentId);
  if (!chunks || chunks.length === 0) return [];

  let queryEmbedding: number[] = [];
  try {
    queryEmbedding = await generateEmbedding(query);
  } catch (err) {
    console.warn('[Document] Query embedding failed:', err);
  }

  const queryTerms = query.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);

  const scored = chunks.map(chunk => {
    let embSim = 0;
    if (queryEmbedding.length > 0 && chunk.embedding && chunk.embedding.length > 0) {
      embSim = cosineSimilarity(queryEmbedding, chunk.embedding);
    }

    let lexScore = 0;
    if (queryTerms.length > 0) {
      const chunkLower = chunk.text.toLowerCase();
      let matches = 0;
      for (const t of queryTerms) {
        if (chunkLower.includes(t)) matches++;
      }
      lexScore = matches / queryTerms.length;
    }

    const finalScore = (embSim * 0.65) + (lexScore * 0.35);
    return {
      ...chunk,
      score: Math.max(finalScore, embSim, lexScore)
    };
  });

  // Sort descending by relevance
  scored.sort((a, b) => b.score - a.score);

  // If few total chunks, return up to topK so context is rich
  if (chunks.length <= topK) {
    return scored;
  }

  // Filter chunks with non-trivial score, but ensure at least 2 top chunks if available
  const filtered = scored.filter(c => c.score > 0.12);
  return (filtered.length > 0 ? filtered : scored.slice(0, 2)).slice(0, topK);
}

export async function chatWithDocument(documentId: string, userId: string, message: string) {
  const relevantChunks = await findRelevantChunks(documentId, message, 5);
  
  if (relevantChunks.length === 0) {
    return { 
      reply: 'I could not find relevant information in this document to answer your question. Please verify the document text or try rephrasing.', 
      sources: [] 
    };
  }

  const context = relevantChunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');
  
  const prompt = `You are Safroi AI, a precise legal and document contract intelligence assistant.
Answer the user's question accurately using ONLY the provided document excerpts below.

DOCUMENT EXCERPTS:
${context}

USER QUESTION:
${message}

GUIDELINES:
1. Provide a direct, helpful, and concise answer.
2. Ground your facts strictly in the excerpts above.
3. Cite sources using [1], [2] at the end of statements based on that excerpt.
4. If the provided excerpts do not contain enough information, explain what is missing rather than guessing.`;

  const reply = await analyzeText(prompt);
  
  return {
    reply,
    sources: relevantChunks.map(c => ({
      chunkId: c._id,
      text: c.text,
      score: c.score
    }))
  };
}

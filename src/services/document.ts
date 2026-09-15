import { v4 as uuidv4 } from 'uuid';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { Document, Chunk } from '../db/models';
import { generateEmbedding, analyzeText } from './ai';
import { ocrImage } from './ocr';
import { fetchWebsiteContent } from './web';

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
  if (a.length !== b.length) return 0;
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
      text = await extractText(buffer, params.mimeType || '');
    }

    if (!text || text.trim().length < 10) {
      throw new Error('No text extracted from document');
    }

    const doc = new Document({
      _id: documentId,
      userId,
      title,
      sourceType: params.sourceType,
      sourceUrl: params.sourceType === 'url' ? params.value : undefined,
      fileName: params.fileName,
      mimeType: params.mimeType,
      status: 'processing',
      text: text.slice(0, 5000),
      tokenCount: tokenCount(text)
    });
    await doc.save();

    const chunks = chunkText(text);
    const chunkDocs = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const embedding = await generateEmbedding(chunkText);
      const chunk = new Chunk({
        _id: uuidv4(),
        documentId,
        chunkIndex: i,
        text: chunkText,
        embedding,
        tokenCount: tokenCount(chunkText)
      });
      chunkDocs.push(chunk);
    }
    
    await Chunk.insertMany(chunkDocs);

    await Document.findByIdAndUpdate(documentId, { status: 'ready' });

    return { documentId, title, chunkCount: chunks.length };
  } catch (err) {
    await Document.findByIdAndUpdate(documentId, { status: 'failed' });
    throw err;
  }
}

export async function findRelevantChunks(documentId: string, query: string, topK = 5) {
  const queryEmbedding = await generateEmbedding(query);
  const chunks = await Chunk.find({ documentId }).lean();
  
  const scored = chunks.map(chunk => ({
    ...chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding || [])
  })).filter(c => c.score > 0.3).sort((a, b) => b.score - a.score).slice(0, topK);
  
  return scored;
}

export async function chatWithDocument(documentId: string, userId: string, message: string) {
  const relevantChunks = await findRelevantChunks(documentId, message, 5);
  
  if (relevantChunks.length === 0) {
    return { reply: 'Not found in document', sources: [] };
  }

  const context = relevantChunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');
  
  const prompt = `You must answer using ONLY the following context. If answer not present, say "Not found in document".

Context:
${context}

Question: ${message}

Cite sources like [1][3] at end of sentences. Do not hallucinate.`;

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

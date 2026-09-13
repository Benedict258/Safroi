export type DocumentSourceType = 'upload' | 'url' | 'text' | 'image';

export interface Document {
  _id: string;
  userId: string;
  title: string;
  sourceType: DocumentSourceType;
  sourceUrl?: string;
  fileName?: string;
  mimeType?: string;
  status: 'processing' | 'ready' | 'failed';
  text?: string;
  tokenCount?: number;
  created_at: Date;
}

export interface Chunk {
  _id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
  tokenCount: number;
}

export interface ChatSession {
  _id: string;
  documentId: string;
  userId: string;
  title?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ChatMessageSource {
  chunkId: string;
  text: string;
  score: number;
}

export interface ChatMessage {
  _id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatMessageSource[];
  created_at: Date;
}

export interface DocumentIngestRequest {
  type: DocumentSourceType;
  value: string;
  fileName?: string;
  mimeType?: string;
  title?: string;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  reply: string;
  sources: ChatMessageSource[];
}

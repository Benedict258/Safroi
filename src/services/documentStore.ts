import mongoose from 'mongoose';
import { Document, Chunk, ChatSession, ChatMessage } from '../db/models';

export interface StoredDocument {
  _id: string;
  userId: string;
  title: string;
  sourceType: 'upload' | 'url' | 'text' | 'image' | 'analysis';
  sourceUrl?: string;
  fileName?: string;
  mimeType?: string;
  status: 'processing' | 'ready' | 'failed';
  text?: string;
  tokenCount?: number;
  created_at: Date;
}

export interface StoredChunk {
  _id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
  tokenCount?: number;
}

export interface StoredSession {
  _id: string;
  documentId: string;
  userId: string;
  title?: string;
  created_at: Date;
  updated_at: Date;
}

export interface StoredMessage {
  _id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ chunkId?: string; text?: string; score?: number }>;
  created_at: Date;
}

interface GlobalDocStore {
  documents: Map<string, StoredDocument>;
  chunks: Map<string, StoredChunk[]>;
  sessions: Map<string, StoredSession>;
  messages: Map<string, StoredMessage[]>;
}

// Global in-memory storage fallback
const globalStore: GlobalDocStore = (global as any).__safroi_doc_store || {
  documents: new Map<string, StoredDocument>(),
  chunks: new Map<string, StoredChunk[]>(),
  sessions: new Map<string, StoredSession>(),
  messages: new Map<string, StoredMessage[]>(),
};
(global as any).__safroi_doc_store = globalStore;

const isDbReady = () => mongoose.connection && mongoose.connection.readyState === 1;

export const documentStore = {
  async saveDocument(doc: StoredDocument): Promise<StoredDocument> {
    globalStore.documents.set(doc._id, { ...doc });
    if (isDbReady()) {
      try {
        await (Document as any).findOneAndUpdate({ _id: doc._id }, doc, { upsert: true, new: true });
      } catch (err) {
        console.warn('[DocStore] Failed to persist doc to MongoDB:', err);
      }
    }
    return doc;
  },

  async updateDocumentStatus(id: string, status: 'processing' | 'ready' | 'failed'): Promise<void> {
    const doc = globalStore.documents.get(id);
    if (doc) {
      doc.status = status;
      globalStore.documents.set(id, doc);
    }
    if (isDbReady()) {
      try {
        await (Document as any).findByIdAndUpdate(id, { status });
      } catch (err) {
        console.warn('[DocStore] Failed to update doc status in MongoDB:', err);
      }
    }
  },

  async findDocumentsByUser(userId: string): Promise<StoredDocument[]> {
    if (isDbReady()) {
      try {
        const docs = (await (Document as any).find({ userId }).sort({ created_at: -1 }).limit(50).lean()) as StoredDocument[];
        if (docs && docs.length > 0) {
          for (const d of docs) {
            globalStore.documents.set(d._id, d);
          }
          return docs;
        }
      } catch (err) {
        console.warn('[DocStore] MongoDB read error, falling back to memory:', err);
      }
    }
    return Array.from(globalStore.documents.values())
      .filter((d: StoredDocument) => d.userId === userId)
      .sort((a: StoredDocument, b: StoredDocument) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async findDocumentById(id: string, userId?: string): Promise<StoredDocument | null> {
    if (isDbReady()) {
      try {
        const query: any = { _id: id };
        if (userId) query.userId = userId;
        const doc = (await (Document as any).findOne(query).lean()) as StoredDocument | null;
        if (doc) {
          globalStore.documents.set(doc._id, doc);
          return doc;
        }
      } catch (err) {
        console.warn('[DocStore] MongoDB find error:', err);
      }
    }
    const doc = globalStore.documents.get(id);
    if (!doc) return null;
    if (userId && doc.userId !== userId) return null;
    return doc;
  },

  async deleteDocument(id: string, userId: string): Promise<boolean> {
    globalStore.documents.delete(id);
    globalStore.chunks.delete(id);
    
    const sessionIdsToDelete: string[] = [];
    for (const [sId, sess] of globalStore.sessions.entries()) {
      if (sess.documentId === id) {
        sessionIdsToDelete.push(sId);
      }
    }
    for (const sId of sessionIdsToDelete) {
      globalStore.sessions.delete(sId);
      globalStore.messages.delete(sId);
    }

    if (isDbReady()) {
      try {
        const sessionIds = await (ChatSession as any).find({ documentId: id }).distinct('_id');
        await (ChatMessage as any).deleteMany({ sessionId: { $in: sessionIds } });
        await (ChatSession as any).deleteMany({ documentId: id });
        await (Chunk as any).deleteMany({ documentId: id });
        await (Document as any).deleteOne({ _id: id, userId });
      } catch (err) {
        console.warn('[DocStore] MongoDB delete error:', err);
      }
    }
    return true;
  },

  async saveChunks(documentId: string, chunks: StoredChunk[]): Promise<void> {
    globalStore.chunks.set(documentId, chunks);
    if (isDbReady()) {
      try {
        await (Chunk as any).insertMany(chunks);
      } catch (err) {
        console.warn('[DocStore] Failed to insert chunks to MongoDB:', err);
      }
    }
  },

  async getChunks(documentId: string): Promise<StoredChunk[]> {
    if (isDbReady()) {
      try {
        const chunks = await (Chunk as any).find({ documentId }).lean();
        if (chunks && chunks.length > 0) {
          globalStore.chunks.set(documentId, chunks);
          return chunks;
        }
      } catch (err) {
        console.warn('[DocStore] MongoDB getChunks error:', err);
      }
    }
    return globalStore.chunks.get(documentId) || [];
  },

  async findOrCreateSession(documentId: string, userId: string, title?: string): Promise<StoredSession> {
    if (isDbReady()) {
      try {
        const session = await (ChatSession as any).findOne({ documentId, userId }).lean();
        if (session) {
          globalStore.sessions.set(session._id, session);
          return session;
        }
        const newId = 'sess_' + Math.random().toString(36).substring(2, 11);
        const newSession = new ChatSession({
          _id: newId,
          documentId,
          userId,
          title: (title || 'Document Chat').slice(0, 50),
          created_at: new Date(),
          updated_at: new Date(),
        });
        await newSession.save();
        const obj = newSession.toObject ? newSession.toObject() : newSession;
        globalStore.sessions.set(newId, obj);
        return obj;
      } catch (err) {
        console.warn('[DocStore] Session DB error, using in-memory:', err);
      }
    }

    for (const sess of globalStore.sessions.values()) {
      if (sess.documentId === documentId && sess.userId === userId) {
        return sess;
      }
    }

    const newId = 'sess_' + Math.random().toString(36).substring(2, 11);
    const newSession: StoredSession = {
      _id: newId,
      documentId,
      userId,
      title: (title || 'Document Chat').slice(0, 50),
      created_at: new Date(),
      updated_at: new Date(),
    };
    globalStore.sessions.set(newId, newSession);
    return newSession;
  },

  async saveMessage(msg: StoredMessage): Promise<StoredMessage> {
    const list = globalStore.messages.get(msg.sessionId) || [];
    list.push(msg);
    globalStore.messages.set(msg.sessionId, list);

    if (isDbReady()) {
      try {
        const m = new ChatMessage(msg);
        await m.save();
      } catch (err) {
        console.warn('[DocStore] Save message DB error:', err);
      }
    }
    return msg;
  },

  async getMessages(sessionId: string): Promise<StoredMessage[]> {
    if (isDbReady()) {
      try {
        const msgs = await (ChatMessage as any).find({ sessionId }).sort({ created_at: 1 }).lean();
        if (msgs && msgs.length > 0) {
          globalStore.messages.set(sessionId, msgs);
          return msgs;
        }
      } catch (err) {
        console.warn('[DocStore] Get messages DB error:', err);
      }
    }
    return globalStore.messages.get(sessionId) || [];
  }
};

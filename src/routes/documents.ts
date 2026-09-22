import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ingestDocument, chatWithDocument } from '../services/document';
import { documentStore, StoredMessage } from '../services/documentStore';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/ingest', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.uid;
    const { type, value, fileName, mimeType, title } = req.body;

    if (!type || !value) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await ingestDocument(userId, {
      sourceType: type,
      value,
      fileName,
      mimeType,
      title
    });

    res.json(result);
  } catch (err: any) {
    console.error('[Documents] Ingest error:', err);
    res.status(500).json({ error: err.message || 'Failed to ingest document' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.uid;
    const docs = await documentStore.findDocumentsByUser(userId);
    res.json(docs);
  } catch (err: any) {
    console.error('[Documents] Fetch documents error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch documents' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.uid;
    const doc = await documentStore.findDocumentById(req.params.id, userId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch document' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.uid;
    const doc = await documentStore.findDocumentById(req.params.id, userId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await documentStore.deleteDocument(req.params.id, userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete document' });
  }
});

router.post('/:id/chat', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.uid;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message required' });
    }

    const doc = await documentStore.findDocumentById(req.params.id, userId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const session = await documentStore.findOrCreateSession(req.params.id, userId, message);

    const userMsg: StoredMessage = {
      _id: uuidv4(),
      sessionId: session._id,
      role: 'user',
      content: message.trim(),
      created_at: new Date()
    };
    await documentStore.saveMessage(userMsg);

    const { reply, sources } = await chatWithDocument(req.params.id, userId, message.trim());

    const assistantMsg: StoredMessage = {
      _id: uuidv4(),
      sessionId: session._id,
      role: 'assistant',
      content: reply,
      sources,
      created_at: new Date()
    };
    await documentStore.saveMessage(assistantMsg);

    res.json({ reply, sources });
  } catch (err: any) {
    console.error('[Documents] Chat error:', err);
    res.status(500).json({ error: err.message || 'Failed to process chat' });
  }
});

router.get('/:id/chat/history', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.uid;
    const doc = await documentStore.findDocumentById(req.params.id, userId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const session = await documentStore.findOrCreateSession(req.params.id, userId);
    const messages = await documentStore.getMessages(session._id);
    res.json({ messages });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch chat history' });
  }
});

export default router;

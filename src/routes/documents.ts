import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Document, ChatSession, ChatMessage } from '../db/models';
import { ingestDocument, chatWithDocument, findRelevantChunks } from '../services/document';
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
  } catch (err) {
    console.error('[Documents] Ingest error:', err);
    res.status(500).json({ error: 'Failed to ingest document' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.uid;
    const docs = await Document.find({ userId }).sort({ created_at: -1 }).limit(50);
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.uid;
    const doc = await Document.findOne({ _id: req.params.id, userId });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.uid;
    const doc = await Document.findOne({ _id: req.params.id, userId });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await ChatMessage.deleteMany({ sessionId: { $in: await ChatSession.find({ documentId: req.params.id }).distinct('_id') } });
    await ChatSession.deleteMany({ documentId: req.params.id });
    await Document.deleteOne({ _id: req.params.id });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

router.post('/:id/chat', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.uid;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    const doc = await Document.findOne({ _id: req.params.id, userId });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    let session = await ChatSession.findOne({ documentId: req.params.id, userId });
    if (!session) {
      session = new ChatSession({
        _id: uuidv4(),
        documentId: req.params.id,
        userId,
        title: message.slice(0, 50),
        updated_at: new Date()
      });
      await session.save();
    }

    const userMsg = new ChatMessage({
      _id: uuidv4(),
      sessionId: session._id,
      role: 'user',
      content: message
    });
    await userMsg.save();

    const { reply, sources } = await chatWithDocument(req.params.id, userId, message);

    const assistantMsg = new ChatMessage({
      _id: uuidv4(),
      sessionId: session._id,
      role: 'assistant',
      content: reply,
      sources
    });
    await assistantMsg.save();

    await ChatSession.findByIdAndUpdate(session._id, { updated_at: new Date() });

    res.json({ reply, sources });
  } catch (err) {
    console.error('[Documents] Chat error:', err);
    res.status(500).json({ error: 'Failed to process chat' });
  }
});

router.get('/:id/chat/history', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.uid;
    const doc = await Document.findOne({ _id: req.params.id, userId });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const session = await ChatSession.findOne({ documentId: req.params.id, userId });
    if (!session) return res.json({ messages: [] });

    const messages = await ChatMessage.find({ sessionId: session._id }).sort({ created_at: 1 });
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

export default router;

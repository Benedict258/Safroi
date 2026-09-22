import { useState, useCallback } from 'react';

const BASE_URL = "https://safroi.onrender.com";

interface ChatMessage {
  _id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ chunkId: string; text: string; score: number }>;
  created_at: string;
}

export function useDocumentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (documentId: string, message: string, token: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch(`${BASE_URL}/api/documents/${documentId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to send message');
      }

      const data = await res.json();
      
      const newMessages: ChatMessage[] = [
        { _id: 'temp-user', role: 'user', content: message, created_at: new Date().toISOString() },
        { _id: 'temp-assistant', role: 'assistant', content: data.reply, sources: data.sources, created_at: new Date().toISOString() }
      ];
      
      setMessages(prev => [...prev, ...newMessages]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (documentId: string, token: string) => {
    try {
      const res = await fetch(`${BASE_URL}/api/documents/${documentId}/chat/history`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }, []);

  return { messages, loading, error, sendMessage, loadHistory, setMessages };
}

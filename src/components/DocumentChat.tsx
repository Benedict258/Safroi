import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, FileText } from 'lucide-react';
import { useDocumentChat } from '../hooks/useDocumentChat';
import type { AuthUser } from '../services/auth';

const BASE_URL = import.meta.env.VITE_API_URL || '';

interface Document {
  _id: string;
  title: string;
  status: string;
}

interface DocumentChatProps {
  user: AuthUser;
}

export function DocumentChat({ user }: DocumentChatProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const { messages, loading, error, sendMessage, loadHistory } = useDocumentChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchDocuments();
  }, []);

  useEffect(() => {
    if (selectedDoc && user.token) {
      loadHistory(selectedDoc, user.token);
    }
  }, [selectedDoc]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchDocuments = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/documents`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      });
      if (res.ok) {
        const docs = await res.json();
        setDocuments(docs);
        if (docs.length > 0 && !selectedDoc) {
          setSelectedDoc(docs[0]._id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !selectedDoc || loading) return;
    
    await sendMessage(selectedDoc, input, user.token);
    setInput('');
  };

  if (documents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <FileText className="h-12 w-12 text-white/20 mx-auto mb-4" />
          <p className="text-white/40 font-bold">No documents yet</p>
          <p className="text-white/20 text-sm mt-2">Upload a document first to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[600px] flex rounded-2xl bg-[#0B1219] border border-white/10 overflow-hidden">
      <div className="w-64 border-r border-white/10 p-4 overflow-y-auto">
        <h3 className="text-sm font-black uppercase tracking-widest text-white/40 mb-3">Documents</h3>
        <div className="space-y-2">
          {documents.map(doc => (
            <button
              key={doc._id}
              onClick={() => setSelectedDoc(doc._id)}
              className={`w-full text-left p-3 rounded-xl text-sm font-bold transition-all ${
                selectedDoc === doc._id 
                  ? 'bg-mint/10 text-mint border border-mint/20' 
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              <div className="truncate">{doc.title}</div>
              <div className="text-[10px] font-black uppercase tracking-widest text-white/30 mt-1">
                {doc.status}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-white/40 font-bold">Ask a question about your document</p>
              <p className="text-white/20 text-sm mt-2">Answers are grounded in the document content only</p>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl p-4 ${
                  msg.role === 'user' 
                    ? 'bg-mint text-[#050B10] font-bold' 
                    : 'bg-white/5 text-white/80 font-medium'
                }`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/10">
                      <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2">Sources</p>
                      <div className="space-y-2">
                        {msg.sources.map((s, idx) => (
                          <div key={idx} className="text-xs text-white/60 bg-black/20 rounded-lg p-2">
                            <p className="font-bold text-white/80 mb-1">[{idx + 1}] Score: {(s.score * 100).toFixed(0)}%</p>
                            <p className="text-white/50 line-clamp-3">{s.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white/5 rounded-2xl p-4">
                <Loader2 className="h-4 w-4 animate-spin text-mint" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-white/10">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask about your document..."
              className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 font-medium focus:outline-none focus:border-mint/50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="px-4 py-3 rounded-xl bg-mint text-[#050B10] font-black disabled:opacity-50 disabled:cursor-not-allowed hover:bg-mint/90 transition-all"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          {error && <p className="text-red-400 text-xs font-bold mt-2">{error}</p>}
        </div>
      </div>
    </div>
  );
}

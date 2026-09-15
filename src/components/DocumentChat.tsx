import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, FileText, Upload } from 'lucide-react';
import { useDocumentChat } from '../hooks/useDocumentChat';
import type { AuthUser } from '../services/auth';

const BASE_URL = import.meta.env.VITE_API_URL || '';

interface Document {
  _id: string;
  title: string;
  status: string;
  sourceType?: string;
}

interface DocumentChatProps {
  user: AuthUser;
  initialDocId?: string | null;
  showFromAnalysisBanner?: boolean;
}

export function DocumentChat({ user, initialDocId, showFromAnalysisBanner }: DocumentChatProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showBanner, setShowBanner] = useState(!!showFromAnalysisBanner);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { messages, loading, error, sendMessage, loadHistory, setMessages } = useDocumentChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchDocuments();
  }, []);

  useEffect(() => {
    if (selectedDoc && user.token) {
      setHistoryLoading(true);
      setMessages([]);
      loadHistory(selectedDoc, user.token);
      // Simulate loading completion after history loads
      // Note: loadHistory doesn't expose loading state, so we clear after a short delay
      const timer = setTimeout(() => setHistoryLoading(false), 500);
      return () => clearTimeout(timer);
    }
  }, [selectedDoc, user.token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchDocuments = async () => {
    setDocumentsLoading(true);
    setDocumentsError(null);
    try {
      const res = await fetch(`${BASE_URL}/api/documents`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      });
      if (!res.ok) {
        throw new Error('Failed to fetch documents');
      }
      const docs = await res.json();
      setDocuments(docs);
      if (initialDocId && docs.find(d => d._id === initialDocId)) {
        setSelectedDoc(initialDocId);
      } else if (docs.length > 0 && !selectedDoc) {
        setSelectedDoc(docs[0]._id);
      } else if (docs.length > 0 && selectedDoc && !docs.find(d => d._id === selectedDoc)) {
        setSelectedDoc(docs[0]._id);
      }
    } catch (err) {
      console.error('Failed to fetch documents:', err);
      setDocumentsError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setDocumentsLoading(false);
    }
  };

  // Poll for document processing status
  useEffect(() => {
    if (documents.some(d => d.status === 'processing')) {
      const interval = setInterval(() => {
        fetchDocuments();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [documents, user.token]);

  const handleSend = async () => {
    if (!input.trim() || !selectedDoc || loading) return;
    
    await sendMessage(selectedDoc, input, user.token);
    setInput('');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/jpg'
    ];

    if (!allowedTypes.includes(file.type)) {
      setUploadError('Unsupported file type. Please upload PDF, DOCX, TXT, or images.');
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const payload = {
            type: 'upload',
            value: base64,
            fileName: file.name,
            mimeType: file.type,
            title: file.name.replace(/\.[^/.]+$/, '')
          };

          const res = await fetch(`${BASE_URL}/api/documents/ingest`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${user.token}`
            },
            body: JSON.stringify(payload)
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || 'Upload failed');
          }

          const result = await res.json();
          // Refresh documents and auto-select new one
          await fetchDocuments();
          setSelectedDoc(result.documentId);
          // Clear file input
          if (fileInputRef.current) fileInputRef.current.value = '';
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
          setUploading(false);
        }
      };
      reader.onerror = () => {
        setUploadError('Failed to read file');
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setUploadError('Upload failed');
      setUploading(false);
    }
  };

  if (documentsLoading) {
    return (
      <div className="h-[600px] flex items-center justify-center rounded-2xl bg-[#0B1219] border border-white/10">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-mint mx-auto mb-4" />
          <p className="text-white/40 font-bold">Loading documents...</p>
        </div>
      </div>
    );
  }

  if (documentsError) {
    return (
      <div className="h-[600px] flex items-center justify-center rounded-2xl bg-[#0B1219] border border-white/10">
        <div className="text-center max-w-sm">
          <FileText className="h-12 w-12 text-red-400/20 mx-auto mb-4" />
          <p className="text-white/40 font-bold mb-2">Failed to load documents</p>
          <p className="text-white/20 text-sm mb-4">{documentsError}</p>
          <button
            onClick={fetchDocuments}
            className="px-4 py-2 rounded-xl bg-mint text-[#050B10] font-black"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (documents.length === 0 && !uploading) {
    return (
      <div className="h-[600px] flex items-center justify-center rounded-2xl bg-[#0B1219] border border-white/10">
        <div className="text-center">
          <FileText className="h-12 w-12 text-white/20 mx-auto mb-4" />
          <p className="text-white/40 font-bold">No documents yet</p>
          <p className="text-white/20 text-sm mt-2 mb-4">Upload a document first to start chatting</p>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 rounded-xl bg-mint text-[#050B10] font-black inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            Upload Document
          </button>
          <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" onChange={handleFileSelect} />
          {uploading && <p className="text-mint text-sm mt-3 font-bold">Processing document...</p>}
          {uploadError && (
            <div className="mt-3">
              <p className="text-red-400 text-xs font-bold">{uploadError}</p>
              <button onClick={() => setUploadError(null)} className="text-white/40 text-xs mt-1 hover:text-white">Dismiss</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {showBanner && (
        <div className="mb-4 p-4 rounded-xl bg-mint/10 border border-mint/20 flex items-center justify-between">
          <p className="text-mint text-sm font-bold">New document from analysis added to Document Chat</p>
          <button onClick={() => setShowBanner(false)} className="text-mint/60 hover:text-mint text-xs font-bold uppercase">Dismiss</button>
        </div>
      )}
      <div className="h-[600px] flex rounded-2xl bg-[#0B1219] border border-white/10 overflow-hidden">
      <div className="w-64 border-r border-white/10 p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-black uppercase tracking-widest text-white/40">Documents</h3>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors disabled:opacity-50"
            title="Upload document"
          >
            <Upload className="h-4 w-4" />
          </button>
        </div>
        <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" onChange={handleFileSelect} />
        {uploading && (
          <div className="flex items-center gap-2 text-mint text-xs font-bold mb-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processing document...
          </div>
        )}
        {uploadError && (
          <div className="mb-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-red-400 text-xs font-bold">{uploadError}</p>
            <button onClick={() => setUploadError(null)} className="text-red-300 text-[10px] mt-1 hover:underline">Dismiss</button>
          </div>
        )}
        <div className="space-y-2">
          {documents.map(doc => {
            const isProcessing = doc.status === 'processing';
            const isFailed = doc.status === 'failed';
            const statusColor = isProcessing ? 'text-amber-400' : isFailed ? 'text-red-400' : 'text-emerald-400';
            const isFromAnalysis = doc.sourceType === 'analysis';
            return (
              <button
                key={doc._id}
                onClick={() => !isProcessing && setSelectedDoc(doc._id)}
                disabled={isProcessing}
                className={`w-full text-left p-3 rounded-xl text-sm font-bold transition-all ${
                  selectedDoc === doc._id 
                    ? 'bg-mint/10 text-mint border border-mint/20' 
                    : 'bg-white/5 text-white/60 hover:bg-white/10'
                } ${isProcessing ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <div className="truncate flex-1">{doc.title}</div>
                  {isFromAnalysis && (
                    <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-mint/20 text-mint border border-mint/30 flex-shrink-0">
                      From Analysis
                    </span>
                  )}
                  {isProcessing && <Loader2 className="h-3 w-3 animate-spin text-amber-400 flex-shrink-0" />}
                  {isFailed && <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
                </div>
                <div className={`text-[10px] font-black uppercase tracking-widest mt-1 ${statusColor}`}>
                  {isProcessing ? 'Processing...' : isFailed ? 'Failed' : doc.status}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {(() => {
            const selectedDocument = documents.find(d => d._id === selectedDoc);
            const isDocProcessing = selectedDocument?.status === 'processing';
            const isDocFailed = selectedDocument?.status === 'failed';
            
            if (isDocProcessing) {
              return (
                <div className="text-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-amber-400 mx-auto mb-4" />
                  <p className="text-white/40 font-bold">Document is processing</p>
                  <p className="text-white/20 text-sm mt-2">Please wait while we index your document. This may take a few moments.</p>
                </div>
              );
            }
            
            if (isDocFailed) {
              return (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 text-red-400/20 mx-auto mb-4" />
                  <p className="text-white/40 font-bold">Document processing failed</p>
                  <p className="text-white/20 text-sm mt-2 mb-4">Try uploading the document again</p>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 rounded-xl bg-mint text-[#050B10] font-black inline-flex items-center gap-2"
                  >
                    <Upload className="h-4 w-4" />
                    Re-upload
                  </button>
                </div>
              );
            }
            
            if (historyLoading) {
              return (
                <div className="space-y-4">
                  {[1,2,3].map(i => (
                    <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
                      <div className="max-w-[80%] rounded-2xl p-4 bg-white/5 animate-pulse">
                        <div className="h-4 bg-white/10 rounded w-48 mb-2"></div>
                        <div className="h-4 bg-white/10 rounded w-32"></div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            }
            
            if (messages.length === 0) {
              return (
                <div className="text-center py-12">
                  <p className="text-white/40 font-bold">Ask a question about your document</p>
                  <p className="text-white/20 text-sm mt-2">Answers are grounded in the document content only</p>
                </div>
              );
            }
            
            return messages.map((msg, i) => (
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
            ));
          })()}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white/5 rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin text-mint" />
                  <p className="text-white/60 text-sm font-medium">Thinking...</p>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-white/10">
          {(() => {
            const selectedDocument = documents.find(d => d._id === selectedDoc);
            const isDocProcessing = selectedDocument?.status === 'processing';
            const isDocFailed = selectedDocument?.status === 'failed';
            const isInputDisabled = isDocProcessing || isDocFailed || !selectedDoc || loading;
            
            return (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !isInputDisabled && handleSend()}
                    placeholder={
                      isDocProcessing 
                        ? "Document is processing..." 
                        : isDocFailed
                        ? "Document processing failed"
                        : !selectedDoc
                        ? "Select a document first..."
                        : "Ask about your document..."
                    }
                    disabled={isInputDisabled}
                    className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 font-medium focus:outline-none focus:border-mint/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || loading || isDocProcessing || isDocFailed || !selectedDoc}
                    className="px-4 py-3 rounded-xl bg-mint text-[#050B10] font-black disabled:opacity-50 disabled:cursor-not-allowed hover:bg-mint/90 transition-all"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
                {error && (
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-red-400 text-xs font-bold">{error}</p>
                    <button 
                      onClick={() => selectedDoc && sendMessage(selectedDoc, input, user.token)}
                      className="text-red-300 text-xs hover:underline font-bold"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {isDocProcessing && (
                  <p className="text-amber-400 text-xs font-bold mt-2">Chat is disabled while document is processing</p>
                )}
                {isDocFailed && (
                  <p className="text-red-400 text-xs font-bold mt-2">Please re-upload the document to continue chatting</p>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
    </>
  );
}

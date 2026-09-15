import React, { useEffect, useState } from 'react';
import { DocumentChat } from '../components/DocumentChat';
import type { AuthUser } from '../services/auth';

interface DocumentChatPageProps {
  user: AuthUser | null;
  onNavigate: (view: string) => void;
}

export function DocumentChatPage({ user, onNavigate }: DocumentChatPageProps) {
  const [initialDocId, setInitialDocId] = useState<string | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const docId = params.get('docId');
    const fromAnalysis = params.get('fromAnalysis');
    if (docId) setInitialDocId(docId);
    if (fromAnalysis === '1') setShowBanner(true);
    // Clean URL
    if (docId || fromAnalysis) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  if (!user) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-black uppercase italic mb-4">Sign in to chat with documents</h2>
        <button
          onClick={() => onNavigate('home')}
          className="px-6 py-3 rounded-xl bg-mint text-[#050B10] font-black"
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight italic uppercase">
          Chat with <span className="text-mint">Documents</span>
        </h1>
        <p className="text-white/40 text-lg mt-2">
          Ask questions about your contracts, terms, and documents. Answers are grounded in your document content.
        </p>
      </div>
      
      <DocumentChat user={user} initialDocId={initialDocId} showFromAnalysisBanner={showBanner} />
    </div>
  );
}

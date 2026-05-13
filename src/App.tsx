import React, { useState } from 'react';
import { Header } from './components/Header';
import { AnalysisForm } from './components/AnalysisForm';
import { ResultView } from './components/ResultView';
import { HistoryView } from './components/HistoryView';
import { Legal } from './components/Legal';
import { analyzeWebsite, analyzeContract } from './services/groq';
import { AnalysisResult } from './types';
import { useHistory } from './hooks/useHistory';
import { Shield, Lock, Zap, MousePointer2, LogIn, User as UserIcon, X } from 'lucide-react';
import { cn } from './lib/utils';
import { auth, signInWithGoogle, logout } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

export default function App() {
  const [activeView, setActiveView] = useState<'home' | 'dashboard' | 'history' | 'about' | 'legal'>('home');
  const [currentResult, setCurrentResult] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { history, addToHistory, getAnalysis, clearHistory } = useHistory();

  React.useEffect(() => {
    document.title = "ClauseLens | Protecting your Digital FootPrint";
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthLoading(false);
      if (user) {
        setShowAuthModal(false);
        localStorage.setItem('clauselens_auth_status', JSON.stringify({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          loggedIn: true
        }));
      } else {
        localStorage.removeItem('clauselens_auth_status');
      }
    });

    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('url');
    if (urlParam) {
      if (user) {
        handleAnalyze({ type: 'website', value: urlParam });
        setActiveView('dashboard');
      } else {
        setShowAuthModal(true);
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return () => unsubscribe();
  }, [user]);

  const handleAnalyze = async (data: { type: 'website' | 'contract', value: string, fileName?: string }) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    setIsLoading(true);
    setCurrentResult(null);
    setActiveView('dashboard');
    try {
      let result: AnalysisResult;
      if (data.type === 'website') {
        result = await analyzeWebsite(data.value);
      } else {
        result = await analyzeContract(data.value, data.fileName);
      }
      setCurrentResult(result);
      addToHistory(result);
    } catch (error) {
      console.error(error);
      alert("Analysis failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectHistoryItem = (id: string) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    const analysis = getAnalysis(id);
    if (analysis) {
      setCurrentResult(analysis);
      setActiveView('dashboard');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-[#050B10] text-white relative overflow-hidden">
      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#050B10]/80 backdrop-blur-sm" onClick={() => setShowAuthModal(false)}></div>
          <div className="relative bg-[#0B1219] border border-white/10 rounded-3xl p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <button 
              onClick={() => setShowAuthModal(false)}
              className="absolute top-4 right-4 p-2 hover:bg-white/5 rounded-full transition-colors"
            >
              <X className="h-5 w-5 text-white/40" />
            </button>
            <div className="space-y-6 text-center">
              <div className="w-20 h-20 bg-mint/10 text-mint rounded-2xl mx-auto flex items-center justify-center">
                <LogIn className="h-10 w-10" />
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-black italic uppercase">Access Required</h2>
                <p className="text-white/40 font-medium leading-relaxed">
                  Join the ClauseLens community to analyze policies and secure your digital footprint.
                </p>
              </div>
              <button 
                onClick={() => {
                  signInWithGoogle();
                }}
                className="w-full flex items-center justify-center gap-3 rounded-xl bg-white px-8 py-4 text-lg font-black text-black transition-all hover:scale-[1.02] active:scale-95 shadow-[0_0_30px_rgba(255,255,255,0.1)]"
              >
                <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
                Sign in with Google
              </button>
              <p className="text-[10px] text-white/20 font-bold uppercase tracking-widest leading-loose">
                By signing in, you agree to our <br/>
                <button onClick={() => { setShowAuthModal(false); setActiveView('legal'); }} className="text-white/40 hover:text-mint transition-colors underline decoration-white/10 underline-offset-2">Terms</button> and <button onClick={() => { setShowAuthModal(false); setActiveView('legal'); }} className="text-white/40 hover:text-mint transition-colors underline decoration-white/10 underline-offset-2">Privacy Policy</button>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Background Accents */}
      <div className="absolute inset-0 bg-grid-pattern opacity-20 pointer-events-none"></div>
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent-blue/10 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent-blue/10 blur-[120px] rounded-full pointer-events-none"></div>

      <Header onNavigate={setActiveView} activeView={activeView} user={user} onLogin={signInWithGoogle} onLogout={logout} />
      
      <main className="relative z-10 mx-auto max-w-7xl px-4 pt-48 pb-12 sm:px-6 lg:px-8">
        {activeView === 'home' && (
          <LandingPage onStart={() => setActiveView('dashboard')} user={user} onLogin={signInWithGoogle} />
        )}

        {activeView === 'dashboard' && (
          <div className="space-y-12">
            {!currentResult && (
              <div className="text-center max-w-4xl mx-auto space-y-6 mb-16">
                <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight leading-tight">
                  Understand what <br />
                  <span className="text-accent-blue">you’re agreeing to.</span>
                </h1>
                <p className="text-xl text-white/40 font-medium">Upload a contract or paste a website URL to start the analysis.</p>
                
                {!user && (
                   <div className="pt-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
                     <button 
                       onClick={signInWithGoogle}
                       className="inline-flex items-center gap-3 rounded-xl bg-white px-8 py-4 text-lg font-black text-black transition-all hover:scale-105 active:scale-95"
                     >
                       <LogIn className="h-5 w-5" />
                       Sign in to start
                     </button>
                   </div>
                )}
              </div>
            )}
            
            {!currentResult && (
              <div id="analyzer-form" className="scroll-mt-32">
                <AnalysisForm onAnalyze={handleAnalyze} isLoading={isLoading} />
              </div>
            )}
            
            {currentResult && (
              <div className="space-y-8">
                <button 
                  onClick={() => setCurrentResult(null)}
                  className="text-sm font-bold uppercase tracking-widest text-[#999999] hover:text-white transition-colors flex items-center gap-2"
                >
                  ← Back to analyzer
                </button>
                <ResultView result={currentResult} />
              </div>
            )}
          </div>
        )}

        {activeView === 'history' && (
          <HistoryView 
            items={history} 
            onSelectItem={handleSelectHistoryItem}
            onClear={clearHistory}
          />
        )}

        {activeView === 'about' && <About />}
        {activeView === 'legal' && <Legal onBack={() => setActiveView('home')} />}
      </main>

      <footer className="border-t border-white/10 bg-[#050B10] py-16 mt-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-8 mb-12">
            <div className="space-y-4 text-center md:text-left">
              <div className="text-2xl font-black italic uppercase">Clause<span className="text-mint">Lens</span></div>
              <p className="text-white/40 max-w-xs font-medium">Built by <span className="text-white">TeamSuiaah</span> to protect your digital footprint.</p>
            </div>
            <div className="flex gap-12">
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-white/20">Product</h4>
                <ul className="space-y-2 text-sm font-bold">
                  <li><button onClick={() => setActiveView('dashboard')} className="hover:text-mint transition-colors">Analyzer</button></li>
                  <li><button onClick={() => setActiveView('history')} className="hover:text-mint transition-colors">History</button></li>
                  <li><button onClick={() => setActiveView('about')} className="hover:text-mint transition-colors">About</button></li>
                </ul>
              </div>
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-white/20">Legal</h4>
                <ul className="space-y-2 text-sm font-bold">
                  <li><button onClick={() => setActiveView('legal')} className="hover:text-mint transition-colors underline-offset-4 decoration-mint/30">Terms of Service</button></li>
                  <li><button onClick={() => setActiveView('legal')} className="hover:text-mint transition-colors underline-offset-4 decoration-mint/30">Privacy Policy</button></li>
                </ul>
              </div>
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-white/20">Suirify Ecosystem</h4>
                <ul className="space-y-2 text-sm font-bold">
                  <li><a href="https://testnet.suirify.com" target="_blank" rel="noopener noreferrer" className="hover:text-accent-blue transition-colors flex items-center gap-2">Suirify Dashboard <Zap className="h-3 w-3" /></a></li>
                  <li><a href="https://x.com/SuirifyProtocol" target="_blank" rel="noopener noreferrer" className="hover:text-accent-blue transition-colors">X: Suirify Protocol</a></li>
                  <li><a href="https://x.com/TeamSuiaah" target="_blank" rel="noopener noreferrer" className="hover:text-accent-blue transition-colors">X: Team Suiaah</a></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="pt-8 border-t border-white/5 text-center text-white/10 text-xs font-bold tracking-widest uppercase">
            <p>© 2026 ClauseLens by TeamSuiaah. Integration with Suirify Platform. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function LandingPage({ onStart, user, onLogin }: { onStart: () => void, user: User | null, onLogin: () => void }) {
  return (
    <div className="space-y-32">
      {/* Hero Section */}
      <div className="text-center space-y-10 max-w-5xl mx-auto">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-mint text-sm font-bold tracking-widest uppercase">
            <Shield className="h-4 w-4" />
            AI-Powered Legal Intelligence
          </div>
          <h1 className="text-7xl md:text-8xl font-extrabold tracking-tight leading-[0.9]">
            Protecting your <br />
            <span className="text-accent-blue">digital footprint</span> <br />
            on the internet.
          </h1>
          <p className="text-xl md:text-2xl text-white/40 max-w-3xl mx-auto font-medium leading-relaxed">
            Stop blindly clicking "I Agree". Understand the fine print, identify data risks, and take control of your privacy instantly.
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 pt-4">
          <button 
            onClick={user ? onStart : onLogin}
            className="w-full sm:w-auto rounded-xl bg-mint px-10 py-5 text-xl font-black text-[#050B10] transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(34,228,162,0.3)] active:scale-95"
          >
            {user ? 'Launch Analyzer' : 'Get Started Free'}
          </button>
          <button 
            onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
            className="w-full sm:w-auto rounded-xl bg-white/5 border border-white/10 px-10 py-5 text-xl font-bold text-white transition-all hover:bg-white/10"
          >
            How it Works
          </button>
        </div>
      </div>

      <Features />

      {/* How it Works Section */}
      <div id="how-it-works" className="space-y-20 pt-10">
        <div className="text-center space-y-4">
          <h2 className="text-4xl md:text-5xl font-black tracking-tight uppercase italic">The Analysis Process</h2>
          <p className="text-white/40 text-lg font-medium">Three simple steps to legal clarity.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
          {/* Connector Line (Desktop) */}
          <div className="hidden md:block absolute top-[100px] left-[15%] right-[15%] h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
          
          <div className="relative z-10 space-y-6 text-center">
            <div className="w-20 h-20 bg-mint text-[#050B10] rounded-2xl mx-auto flex items-center justify-center text-3xl font-black shadow-[0_0_30px_rgba(34,228,162,0.2)]">1</div>
            <h3 className="text-2xl font-bold">Input</h3>
            <p className="text-white/40 font-medium leading-relaxed px-4">Paste a website URL, upload a PDF/DOCX contract, or simply paste the raw text of any policy.</p>
          </div>

          <div className="relative z-10 space-y-6 text-center">
            <div className="w-20 h-20 bg-accent-blue text-white rounded-2xl mx-auto flex items-center justify-center text-3xl font-black shadow-[0_0_30px_rgba(56,189,248,0.2)]">2</div>
            <h3 className="text-2xl font-bold">Deconstruct</h3>
            <p className="text-white/40 font-medium leading-relaxed px-4">Llama-3.3 parses the legal jargon, cross-referencing with global privacy standards and security benchmarks.</p>
          </div>

          <div className="relative z-10 space-y-6 text-center">
            <div className="w-20 h-20 bg-white/10 text-white rounded-2xl mx-auto flex items-center justify-center text-3xl font-black">3</div>
            <h3 className="text-2xl font-bold">Risk Score</h3>
            <p className="text-white/40 font-medium leading-relaxed px-4">Get an instant 0-10 risk rating with categorized red flags, translations, and simplified explanations.</p>
          </div>
        </div>
      </div>

      {/* Extension Section */}
      <div className="bg-[#0B1219] border border-white/10 rounded-2xl p-12 md:p-20 overflow-hidden relative group">
        <div className="absolute top-0 right-0 w-1/2 h-full bg-accent-blue/5 blur-[120px] rounded-full pointer-events-none group-hover:bg-accent-blue/10 transition-colors"></div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center relative z-10">
          <div className="space-y-8">
            <div className="inline-flex px-4 py-2 rounded-full bg-mint/10 text-mint text-xs font-bold tracking-[.2em] uppercase">On-the-go Protection</div>
            <h2 className="text-5xl md:text-6xl font-black leading-tight italic uppercase">Browser <br />Extension</h2>
            <p className="text-xl text-white/40 font-medium leading-relaxed">
              Don't leave protection at the dashboard. Our Chrome Extension scans policies in real-time as you browse. Features a primary <span className="text-mint font-bold italic">toggle</span> to activate protection only when you need it.
            </p>
            
            <div className="space-y-6">
              <h4 className="font-bold text-white/60 uppercase tracking-widest text-sm">How to install (Developer Mode):</h4>
              <ol className="space-y-4">
                {[
                  "Download the 'chrome-extension' folder from the source.",
                  "Open Chrome and navigate to chrome://extensions",
                  "Enable 'Developer Mode' toggle in the top right.",
                  "Click 'Load unpacked' and select the extension folder."
                ].map((step, idx) => (
                  <li key={idx} className="flex gap-4 items-start text-white/50 text-base font-medium">
                    <span className="text-mint font-black">0{idx + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="relative">
            <div className="bg-[#050B10] rounded-2xl border border-white/10 p-4 shadow-2xl scale-110 lg:rotate-6">
              {/* Mock Extension UI */}
              <div className="bg-[#0B1219] rounded-xl overflow-hidden border border-white/5">
                <div className="bg-white/5 p-4 flex items-center justify-between border-b border-white/5">
                  <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-400/20"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-400/20"></div>
                    <div className="w-3 h-3 rounded-full bg-mint/20"></div>
                  </div>
                  <div className="text-[10px] text-white/20 font-bold uppercase tracking-widest">ClauseLens Proxy</div>
                </div>
                <div className="p-8 space-y-6">
                  <div className="flex justify-between items-center">
                    <div className="w-12 h-12 rounded-full bg-risk-high shadow-[0_0_20px_rgba(239,68,68,0.4)]"></div>
                    <div className="text-right">
                      <div className="text-3xl font-black text-risk-high italic">8.4</div>
                      <div className="text-[10px] text-white/20 font-bold">HIGH RISK SCORE</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="h-4 w-full bg-white/5 rounded-full"></div>
                    <div className="h-4 w-[80%] bg-white/5 rounded-full"></div>
                    <div className="h-4 w-[60%] bg-white/5 rounded-full"></div>
                  </div>
                  <button className="w-full py-4 bg-white/5 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest text-white/40">View Analysis</button>
                </div>
              </div>
            </div>
            {/* Floating elements */}
            <div className="absolute -top-10 -left-10 w-32 h-32 bg-mint/10 blur-3xl rounded-full"></div>
            <div className="absolute -bottom-10 -right-10 w-48 h-48 bg-accent-blue/10 blur-3xl rounded-full"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Features() {
  const features = [
    {
      title: "Extremely Fast",
      desc: "Powered by Groq's LPU technology for near-instant legal grounding.",
      icon: <Zap className="h-6 w-6" />,
      color: "text-accent-blue",
      bg: "bg-accent-blue/10"
    },
    {
      title: "Modern AI",
      desc: "Leverages Llama-3.3 models for superior reasoning and speed.",
      icon: <Shield className="h-6 w-6" />,
      color: "text-white",
      bg: "bg-white/10"
    },
    {
      title: "Privacy First",
      desc: "Your data is analyzed locally and never stored on third-party servers.",
      icon: <Lock className="h-6 w-6" />,
      color: "text-risk-low",
      bg: "bg-risk-low/10"
    },
    {
      title: "Chrome Extension",
      desc: "Analyze any site directly from your browser without leaving the tab.",
      icon: <MousePointer2 className="h-6 w-6" />,
      color: "text-mint",
      bg: "bg-mint/10"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 pt-12">
      {features.map((f, i) => (
        <div key={i} className="group p-10 bg-[#0B1219] rounded-2xl border border-white/10 space-y-6 transition-all hover:bg-[#121923] hover:-translate-y-2">
          <div className={cn("inline-flex p-4 rounded-lg transition-transform group-hover:scale-110", f.bg, f.color)}>
            {f.icon}
          </div>
          <h3 className="text-2xl font-bold tracking-tight">{f.title}</h3>
          <p className="text-white/40 leading-relaxed font-medium">{f.desc}</p>
        </div>
      ))}
    </div>
  );
}

function About() {
  return (
    <div className="max-w-4xl mx-auto space-y-20 py-10">
      <div className="space-y-8 text-center">
        <h1 className="text-6xl font-black tracking-tight italic uppercase">About <br /> Clause<span className="text-mint">Lens</span></h1>
        <p className="text-2xl text-white/40 leading-relaxed italic max-w-2xl mx-auto">
          "Most people don't read the terms. We think they should know what's in them."
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
        <div className="p-10 bg-[#0B1219] rounded-2xl border border-white/10 space-y-6">
          <h2 className="text-3xl font-bold tracking-tight">Our Mission</h2>
          <p className="text-lg text-white/60 leading-relaxed font-medium">
            ClauseLens was born out of a simple frustration: the sheer length and complexity of modern legal documents. Built by <span className="text-mint font-bold italic">TeamSuiaah</span>, we believe that understanding your rights shouldn't require a law degree.
          </p>
        </div>
        <div className="p-10 bg-[#0B1219] rounded-2xl border border-white/10 space-y-6">
          <h2 className="text-3xl font-bold tracking-tight">Suirify Integration</h2>
          <p className="text-lg text-white/60 leading-relaxed font-medium">
            Seamlessly connected with the <a href="https://testnet.suirify.com" className="text-accent-blue hover:underline decoration-accent-blue/30 underline-offset-4">Suirify Ecosystem</a>, ClauseLens acts as your personal digital guardian. We ensure your footprint remains secure while you explore the open internet.
          </p>
        </div>
      </div>
    </div>
  );
}

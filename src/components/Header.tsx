import React, { useState } from 'react';
import { Info, Menu, LogIn, LogOut, User as UserIcon, X } from 'lucide-react';
import { User } from 'firebase/auth';

interface HeaderProps {
  onNavigate: (view: 'home' | 'dashboard' | 'history' | 'about') => void;
  activeView: string;
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
}

export function Header({ onNavigate, activeView, user, onLogin, onLogout }: HeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleDownload = () => {
    window.location.href = '/api/download-extension';
  };

  const menuItems = [
    { label: 'Analyzer', view: 'dashboard' as const },
    { label: 'History', view: 'history' as const },
    { label: 'About', view: 'about' as const },
  ];

  return (
    <header className="fixed top-0 z-50 w-full flex justify-center py-3 md:py-6 px-4">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between bg-[#050B10]/95 backdrop-blur-xl md:bg-transparent rounded-2xl px-4 md:px-0">
        <div 
          className="flex items-center gap-2 cursor-pointer group relative z-50" 
          onClick={() => { onNavigate('home'); setIsMenuOpen(false); }}
        >
          <span className="text-xl md:text-2xl font-black italic uppercase tracking-tighter text-white">
            Saf<span className="text-mint">r</span><span className="text-accent-blue">o</span><span className="text-mint">i</span>
          </span>
        </div>
        
        {/* Desktop Nav */}
        <nav className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-1 bg-[#121923] border border-white/10 p-1.5 rounded-full shadow-2xl">
          {menuItems.map((item) => (
            <button 
              key={item.view}
              onClick={() => onNavigate(item.view)}
              aria-label={`Navigate to ${item.label}`}
              className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${activeView === item.view ? 'bg-white/5 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 md:gap-4 relative z-50">
          <button 
            onClick={handleDownload}
            className="hidden sm:block rounded-lg bg-white/5 border border-white/10 px-4 py-2 text-xs font-bold text-white/60 transition-all hover:bg-white/10 hover:text-white"
          >
            Extension
          </button>
          
          {user ? (
            <div className="flex items-center gap-2 md:gap-3">
              <div className="hidden xs:flex flex-col items-end">
                <span className="text-[10px] md:text-xs font-bold text-white leading-none truncate max-w-[100px]">{user.displayName}</span>
                <button onClick={onLogout} className="text-[9px] md:text-[10px] font-black text-white/40 uppercase hover:text-red-400 transition-colors tracking-widest">Logout</button>
              </div>
              {user.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="h-8 w-8 md:h-10 md:w-10 rounded-lg border border-white/10" />
              ) : (
                <div className="h-8 w-8 md:h-10 md:w-10 rounded-lg bg-mint/20 flex items-center justify-center border border-white/10">
                  <UserIcon className="h-4 w-4 md:h-5 md:w-5 text-mint" />
                </div>
              )}
            </div>
          ) : (
            <button 
              onClick={onLogin}
              className="rounded-lg bg-mint px-3 py-1.5 md:px-4 md:py-2 text-[10px] md:text-sm font-extrabold text-[#050B10] transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5 md:gap-2"
            >
              <LogIn className="h-3.5 w-3.5 md:h-4 md:w-4" />
              <span>Sign In</span>
            </button>
          )}

          {/* Mobile Menu Button */}
          <button 
            className="md:hidden p-2 text-white/80 hover:text-white bg-white/5 rounded-lg active:scale-95 transition-all"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="Toggle Menu"
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-40 bg-[#050B10] md:hidden animate-in fade-in duration-300">
          <div className="flex flex-col h-full pt-32 px-6 pb-12">
            <nav className="flex flex-col gap-4 flex-1">
              {menuItems.map((item) => (
                <button
                  key={item.view}
                  onClick={() => { onNavigate(item.view); setIsMenuOpen(false); }}
                  className={`w-full text-left px-8 py-5 rounded-2xl text-xl font-black uppercase italic tracking-wider transition-all border ${activeView === item.view ? 'bg-mint text-[#050B10] border-mint' : 'bg-white/5 text-white/60 hover:text-white border-white/5'}`}
                >
                  {item.label}
                </button>
              ))}
              <button 
                onClick={handleDownload}
                className="w-full text-left px-8 py-5 rounded-2xl text-xl font-black uppercase italic tracking-wider bg-white/5 text-white/60 border border-white/5"
              >
                Get Extension
              </button>
            </nav>
            
            {user && (
              <div className="pt-8 border-t border-white/10 mt-8">
                <button 
                  onClick={() => { onLogout(); setIsMenuOpen(false); }}
                  className="w-full text-center px-8 py-5 rounded-2xl text-lg font-black uppercase italic tracking-wider bg-red-500/10 text-red-500 border border-red-500/20"
                >
                  Confirm Logout
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}


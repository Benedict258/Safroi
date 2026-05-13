import React from 'react';
import { Info, Menu, LogIn, LogOut, User as UserIcon } from 'lucide-react';
import { User } from 'firebase/auth';

interface HeaderProps {
  onNavigate: (view: 'home' | 'dashboard' | 'history' | 'about') => void;
  activeView: string;
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
}

export function Header({ onNavigate, activeView, user, onLogin, onLogout }: HeaderProps) {
  const handleDownload = () => {
    window.location.href = '/api/download-extension';
  };

  return (
    <header className="fixed top-0 z-50 w-full flex justify-center py-6 px-4">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between">
        <div 
          className="flex items-center gap-2 cursor-pointer group" 
          onClick={() => onNavigate('home')}
        >
          <span className="text-2xl font-black italic uppercase tracking-tighter text-white">
            Clause<span className="text-mint">Lens</span>
          </span>
        </div>
        
        <nav className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-1 bg-[#121923] border border-white/10 p-1.5 rounded-full shadow-2xl">
          <button 
            onClick={() => onNavigate('dashboard')}
            className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${activeView === 'dashboard' ? 'bg-white/5 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
          >
            Analyzer
          </button>
          <button 
            onClick={() => onNavigate('history')}
            className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${activeView === 'history' ? 'bg-white/5 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
          >
            History
          </button>
          <button 
            onClick={() => onNavigate('about')}
            className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${activeView === 'about' ? 'bg-white/5 text-white' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
          >
            About
          </button>
        </nav>

        <div className="flex items-center gap-4">
          <button 
            onClick={handleDownload}
            className="hidden sm:block rounded-lg bg-white/5 border border-white/10 px-4 py-2 text-xs font-bold text-white/60 transition-all hover:bg-white/10 hover:text-white"
          >
            Extension
          </button>
          
          {user ? (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-bold text-white leading-none">{user.displayName}</span>
                <button onClick={onLogout} className="text-[10px] font-black text-white/40 uppercase hover:text-red-400 transition-colors tracking-widest">Logout</button>
              </div>
              {user.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="h-10 w-10 rounded-lg border border-white/10" />
              ) : (
                <div className="h-10 w-10 rounded-lg bg-mint/20 flex items-center justify-center border border-white/10">
                  <UserIcon className="h-5 w-5 text-mint" />
                </div>
              )}
            </div>
          ) : (
            <button 
              onClick={onLogin}
              className="rounded-lg bg-mint px-4 py-2 text-sm font-extrabold text-[#050B10] transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
            >
              <LogIn className="h-4 w-4" />
              Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

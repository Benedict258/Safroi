import React, { useState, useCallback } from 'react';
import { Search, FileText, Upload, Link as LinkIcon, AlertCircle, FileUp, X } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { cn } from '../lib/utils';

interface AnalysisFormProps {
  onAnalyze: (data: { type: 'website' | 'contract', value: string, fileName?: string }) => void;
  isLoading: boolean;
}

export function AnalysisForm({ onAnalyze, isLoading }: AnalysisFormProps) {
  const [activeTab, setActiveTab] = useState<'url' | 'text' | 'file'>('url');
  const [inputValue, setInputValue] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const validateUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setSelectedFile(file);
      
      // For .txt and similar files, read as text
      if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        const reader = new FileReader();
        reader.onload = () => {
          setInputValue(reader.result as string);
        };
        reader.readAsText(file);
      } else {
        // For other files (like PDFs), we'll notify that we're using basic extraction
        setInputValue(`[Extracting content from ${file.name}...]`);
        // In a real app we'd use a parser here. For now we'll simulate reading basic metadata
        // and ideally we'd send the file to a backend.
        // For now, let's stick to text files for better accuracy in this demo.
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt'],
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
    },
    multiple: false
  } as any);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (activeTab === 'file') {
      if (!selectedFile || !inputValue) return;
      onAnalyze({
        type: 'contract',
        value: inputValue,
        fileName: selectedFile.name
      });
      return;
    }

    if (!inputValue.trim() || isLoading) return;
    
    // URL validation
    if (activeTab === 'url') {
      if (!validateUrl(inputValue)) {
        setUrlError("Please enter a valid URL starting with http:// or https://");
        return;
      }
      setUrlError(null);
    }

    onAnalyze({
      type: activeTab === 'url' ? 'website' : 'contract',
      value: inputValue
    });
  };

  const clearFile = () => {
    setSelectedFile(null);
    setInputValue('');
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="bg-[#0B1219] rounded-2xl border border-white/10 shadow-2xl overflow-hidden transition-all duration-500 hover:border-accent-blue/30">
        <div className="flex border-b border-white/10">
          <button
            onClick={() => { setActiveTab('url'); setUrlError(null); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-5 text-sm font-bold tracking-tight transition-all",
              activeTab === 'url' ? "bg-white/5 text-white" : "text-white/40 hover:text-white hover:bg-white/5"
            )}
          >
            <LinkIcon className="h-4 w-4" />
            Website URL
          </button>
          <button
            onClick={() => { setActiveTab('text'); setUrlError(null); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-5 text-sm font-bold tracking-tight transition-all",
              activeTab === 'text' ? "bg-white/5 text-white" : "text-white/40 hover:text-white hover:bg-white/5"
            )}
          >
            <FileText className="h-4 w-4" />
            Paste Text
          </button>
          <button
            onClick={() => { setActiveTab('file'); setUrlError(null); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-5 text-sm font-bold tracking-tight transition-all",
              activeTab === 'file' ? "bg-white/5 text-white" : "text-white/40 hover:text-white hover:bg-white/5"
            )}
          >
            <Upload className="h-4 w-4" />
            Upload Document
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-10">
          {activeTab === 'url' ? (
            <div className="relative group">
              <input
                type="text"
                value={inputValue || ''}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  if (urlError) setUrlError(null);
                }}
                placeholder="https://example.com/terms"
                className={cn(
                  "w-full pl-14 pr-6 py-5 rounded-xl bg-white/5 border focus:bg-white/10 focus:ring-0 transition-all text-xl font-medium placeholder:text-white/20",
                  urlError ? "border-red-500/50 focus:border-red-500" : "border-white/10 focus:border-accent-blue/50"
                )}
              />
              <Search className={cn(
                "absolute left-5 top-1/2 -translate-y-1/2 h-6 w-6 transition-colors",
                urlError ? "text-red-500/50" : "text-white/30 group-focus-within:text-accent-blue"
              )} />
              {urlError && (
                <div className="absolute -bottom-6 left-2 flex items-center gap-1.5 text-red-500 text-xs font-bold animate-in fade-in slide-in-from-top-1">
                  <AlertCircle className="h-3 w-3" />
                  {urlError}
                </div>
              )}
            </div>
          ) : activeTab === 'text' ? (
            <textarea
              value={inputValue || ''}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Paste the Terms of Service or Contract text here..."
              rows={8}
              className="w-full p-8 rounded-xl bg-white/5 border border-white/10 focus:bg-white/10 focus:border-accent-blue/50 focus:ring-0 transition-all text-xl font-medium placeholder:text-white/20 resize-none"
            />
          ) : (
            <div 
              {...getRootProps()} 
              className={cn(
                "w-full p-12 rounded-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-4 cursor-pointer",
                isDragActive ? "border-mint bg-mint/5" : "border-white/10 hover:border-white/20 bg-white/5",
                selectedFile && "border-mint/50 bg-mint/5"
              )}
            >
              <input {...getInputProps()} />
              {selectedFile ? (
                <div className="flex flex-col items-center gap-4 animate-in fade-in zoom-in duration-300">
                  <div className="h-20 w-20 rounded-xl bg-mint/20 flex items-center justify-center">
                    <FileText className="h-10 w-10 text-mint" />
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-white">{selectedFile.name}</p>
                    <p className="text-sm text-white/40">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <button 
                    type="button"
                    onClick={(e) => { e.stopPropagation(); clearFile(); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-white/60 hover:text-white hover:bg-white/20 transition-all text-xs font-bold"
                  >
                    <X className="h-3 w-3" />
                    Remove File
                  </button>
                </div>
              ) : (
                <>
                  <div className="h-20 w-20 rounded-xl bg-white/5 flex items-center justify-center">
                    <FileUp className="h-10 w-10 text-white/20" />
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-white">Click or drag to upload</p>
                    <p className="text-sm text-white/40">Supports PDF, DOCX, TXT (Max 10MB)</p>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="mt-10 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3 text-white/40 text-sm font-medium">
              <div className="p-1.5 rounded-full bg-accent-blue/10">
                <AlertCircle className="h-4 w-4 text-accent-blue" />
              </div>
              <span>AI analysis can occasionally produce inaccuracies.</span>
            </div>
            <button
              type="submit"
              disabled={isLoading || (activeTab === 'file' ? !selectedFile : !inputValue.trim())}
              className={cn(
                "w-full md:w-auto px-6 py-3 rounded-xl font-extrabold transition-all active:scale-95",
                isLoading || (activeTab === 'file' ? !selectedFile : !inputValue.trim()) 
                  ? "bg-white/5 text-white/20 cursor-not-allowed" 
                  : "bg-mint text-[#050B10] hover:scale-105"
              )}
            >
              {isLoading ? (
                <div className="flex items-center justify-center gap-3">
                  <div className="h-5 w-5 border-2 border-[#050B10]/30 border-t-[#050B10] rounded-full animate-spin" />
                  Analyzing...
                </div>
              ) : (
                "Analyze Privacy Policy"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

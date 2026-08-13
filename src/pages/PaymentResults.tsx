import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

const BASE_URL = import.meta.env.VITE_API_URL || '';

export function PaystackCallback() {
  const [status, setStatus] = useState<'loading' | 'success' | 'failed'>('loading');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference');

    if (!reference) {
      setStatus('failed');
      setTimeout(() => { window.location.href = '/pricing?payment=failed'; }, 2000);
      return;
    }

    fetch(`${BASE_URL}/api/paystack/callback?reference=${reference}`)
      .then(res => {
        if (res.redirected) {
          window.location.href = res.url;
        } else if (res.ok) {
          setStatus('success');
          setTimeout(() => { window.location.href = '/dashboard?payment=success'; }, 2000);
        } else {
          setStatus('failed');
          setTimeout(() => { window.location.href = '/pricing?payment=failed'; }, 2000);
        }
      })
      .catch(() => {
        setStatus('failed');
        setTimeout(() => { window.location.href = '/pricing?payment=failed'; }, 2000);
      });
  }, []);

  return (
    <div className="min-h-screen bg-[#050B10] flex items-center justify-center">
      <div className="text-center space-y-4">
        {status === 'loading' && (
          <>
            <Loader2 className="h-12 w-12 text-mint animate-spin mx-auto" />
            <p className="text-white text-lg font-bold">Verifying your payment...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto" />
            <p className="text-white text-lg font-bold">Payment successful!</p>
            <p className="text-white/40 text-sm">Redirecting to your dashboard...</p>
          </>
        )}
        {status === 'failed' && (
          <>
            <XCircle className="h-12 w-12 text-red-400 mx-auto" />
            <p className="text-white text-lg font-bold">Payment verification failed</p>
            <p className="text-white/40 text-sm">Redirecting to pricing...</p>
          </>
        )}
      </div>
    </div>
  );
}

export function LemonSqueezySuccess() {
  useEffect(() => {
    const timer = setTimeout(() => {
      window.location.href = '/dashboard?payment=success';
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#050B10] flex items-center justify-center">
      <div className="text-center space-y-4">
        <CheckCircle2 className="h-12 w-12 text-mint mx-auto" />
        <p className="text-white text-lg font-bold">Payment successful!</p>
        <p className="text-white/40 text-sm">Setting up your account...</p>
      </div>
    </div>
  );
}

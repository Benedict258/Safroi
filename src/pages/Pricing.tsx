import React, { useState, useEffect } from 'react';
import { Check, Loader2, Zap, Shield, Globe, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import type { AuthUser } from '../services/auth';

const BASE_URL = import.meta.env.VITE_API_URL || '';

interface PricingProps {
  user: AuthUser | null;
  onLogin: () => void;
  onNavigate: (view: string) => void;
}

interface PlanFeature {
  text: string;
  included: boolean;
}

const plans = {
  free: {
    name: 'Free',
    price: '$0',
    period: '/forever',
    features: [
      { text: 'Limited scans per month', included: true },
      { text: 'URL input', included: true },
      { text: 'Basic risk cards', included: true },
      { text: 'Chrome Extension sync', included: false },
      { text: 'Translation', included: false },
      { text: 'Risk history & export', included: false },
    ] as PlanFeature[],
  },
  pro: {
    name: 'Pro',
    price: '$5',
    period: '/month',
    badge: 'Most Popular',
    features: [
      { text: 'Unlimited scans', included: true },
      { text: 'URL + paste + file input', included: true },
      { text: 'Chrome Extension sync', included: true },
      { text: '4-language translation', included: true },
      { text: 'Risk history & export', included: true },
      { text: 'Priority support', included: false },
    ] as PlanFeature[],
  },
  business: {
    name: 'Business',
    price: '$15',
    period: '/month',
    features: [
      { text: 'Everything in Pro', included: true },
      { text: '3 team seats', included: true },
      { text: 'Policy change alerts', included: true },
      { text: 'API access', included: true },
      { text: 'Priority support', included: true },
      { text: 'Custom integrations', included: true },
    ] as PlanFeature[],
  },
};

export function Pricing({ user, onLogin, onNavigate }: PricingProps) {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentFailed, setPaymentFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'failed') {
      setPaymentFailed(true);
      window.history.replaceState({}, document.title, '/pricing');
    }
  }, []);

  const isNigerian = () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return tz.includes('Africa/Lagos') || tz.includes('Africa/Abuja');
    } catch {
      return false;
    }
  };

  const handlePayment = async (plan: 'pro' | 'business', provider: 'paystack' | 'lemonsqueezy') => {
    if (!user) {
      onNavigate('home');
      return;
    }

    setLoadingPlan(`${plan}-${provider}`);
    setError(null);

    try {
      if (provider === 'paystack') {
        const res = await fetch(`${BASE_URL}/api/paystack/initialize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: user.email, userId: user.uid, plan }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Payment failed');
        window.location.href = data.authorizationUrl;
      } else {
        const res = await fetch(`${BASE_URL}/api/lemonsqueezy/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.uid, plan }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Payment failed');
        window.location.href = data.checkoutUrl;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed. Please try again.');
      setLoadingPlan(null);
    }
  };

  const renderCta = (planKey: string) => {
    const plan = plans[planKey as keyof typeof plans];
    if (planKey === 'free') {
      if (!user) {
        return (
          <button onClick={onLogin} className="w-full py-4 rounded-xl font-extrabold text-[#050B10] bg-white hover:bg-white/90 transition-all">
            Get Started
          </button>
        );
      }
      if (user.plan === 'pro' || user.plan === 'business') {
        return (
          <div className="w-full py-4 rounded-xl text-center text-sm font-bold text-white/40 border border-white/10">
            Current plan — downgrade not available
          </div>
        );
      }
      return (
        <button onClick={() => onNavigate('dashboard')} className="w-full py-4 rounded-xl font-extrabold text-[#050B10] bg-white hover:bg-white/90 transition-all">
          Go to Dashboard
        </button>
      );
    }

    if (!user) {
      return (
        <button onClick={onLogin} className="w-full py-4 rounded-xl font-extrabold text-[#050B10] bg-mint hover:bg-mint/90 transition-all">
          Get {plan.name}
        </button>
      );
    }

    const showBoth = isNigerian() || user.paymentProvider === 'paystack';

    if (showBoth) {
      return (
        <div className="space-y-2">
          <button
            onClick={() => handlePayment(planKey as 'pro' | 'business', 'paystack')}
            disabled={loadingPlan !== null}
            className="w-full py-3 rounded-xl font-extrabold text-[#050B10] bg-mint hover:bg-mint/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loadingPlan === `${planKey}-paystack` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Pay with Paystack
          </button>
          <button
            onClick={() => handlePayment(planKey as 'pro' | 'business', 'lemonsqueezy')}
            disabled={loadingPlan !== null}
            className="w-full py-3 rounded-xl font-extrabold text-white bg-white/10 border border-white/20 hover:bg-white/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loadingPlan === `${planKey}-lemonsqueezy` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Pay with Lemon Squeezy
          </button>
        </div>
      );
    }

    return (
      <button
        onClick={() => handlePayment(planKey as 'pro' | 'business', 'lemonsqueezy')}
        disabled={loadingPlan !== null}
        className="w-full py-4 rounded-xl font-extrabold text-[#050B10] bg-mint hover:bg-mint/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loadingPlan === `${planKey}-lemonsqueezy` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Get {plan.name}
      </button>
    );
  };

  return (
    <div className="space-y-12 animate-in fade-in duration-500">
      <div className="text-center space-y-4">
        <button onClick={() => onNavigate('home')} className="inline-flex items-center gap-2 text-sm font-bold text-white/40 hover:text-white transition-colors mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-4xl md:text-6xl font-black tracking-tight italic uppercase">
          Choose Your <span className="text-mint">Protection</span>
        </h1>
        <p className="text-xl text-white/40 max-w-2xl mx-auto">
          Start free, upgrade when you need more. Every plan includes AI-powered risk analysis.
        </p>
      </div>

      {error && (
        <div className="max-w-md mx-auto p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold text-center">
          {error}
        </div>
      )}

      {paymentFailed && (
        <div className="max-w-md mx-auto p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold text-center">
          Payment could not be completed. Please try again or contact support.
          <button onClick={() => setPaymentFailed(false)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 max-w-5xl mx-auto">
        {(Object.entries(plans) as [string, typeof plans.free][]).map(([key, plan]) => (
          <div
            key={key}
            className={cn(
              "relative p-8 rounded-2xl border flex flex-col",
              key === 'pro'
                ? "bg-[#0B1219] border-mint/50 shadow-[0_0_40px_rgba(34,228,162,0.1)]"
                : "bg-[#0B1219] border-white/10"
            )}
          >
            {plan.badge && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-mint text-[#050B10] text-[10px] font-black uppercase tracking-widest">
                {plan.badge}
              </div>
            )}

            <div className="mb-6">
              <h3 className="text-2xl font-black uppercase italic">{plan.name}</h3>
              <div className="flex items-baseline gap-1 mt-2">
                <span className="text-5xl font-black">{plan.price}</span>
                <span className="text-white/40 font-bold">{plan.period}</span>
              </div>
            </div>

            <ul className="space-y-3 mb-8 flex-1">
              {plan.features.map((f, i) => (
                <li key={i} className={cn("flex items-start gap-3 text-sm font-medium", f.included ? "text-white/80" : "text-white/30")}>
                  <Check className={cn("h-4 w-4 mt-0.5 shrink-0", f.included ? "text-mint" : "text-white/20")} />
                  {f.text}
                </li>
              ))}
            </ul>

            {renderCta(key)}
          </div>
        ))}
      </div>
    </div>
  );
}

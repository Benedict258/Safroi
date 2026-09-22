import React, { useState, useEffect } from 'react';
import { Check, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import type { AuthUser } from '../services/auth';

interface PricingProps {
  user: AuthUser | null;
  onLogin: () => void;
  onNavigate: (view: string) => void;
}

interface PlanFeature {
  text: string;
  included: boolean;
}

interface PlanItem {
  name: string;
  price: string;
  period: string;
  badge?: string;
  features: PlanFeature[];
}

const plans: Record<string, PlanItem> = {
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
      const locale = navigator.language || '';
      return tz.includes('Africa/Lagos') || tz.includes('Africa/Abuja') || tz.includes('Lagos') || locale.includes('NG') || locale.includes('ng');
    } catch {
      return false;
    }
  };

  const getPlanPrice = (planKey: string) => {
    const inNigeria = isNigerian();
    if (planKey === 'pro') {
      return inNigeria ? '₦2,500' : '$5';
    }
    if (planKey === 'business') {
      return inNigeria ? '₦5,000' : '$15';
    }
    return plans[planKey]?.price || '$0';
  };

  const renderCta = (planKey: string) => {
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

    // For paid plans (Pro & Business): Just one button just like Go to Dashboard that says Pay (not clickable yet)
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Payment coming soon"
        className="w-full py-4 rounded-xl font-extrabold text-[#050B10] bg-white opacity-90 cursor-not-allowed transition-all select-none"
      >
        Pay
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

      {paymentFailed && (
        <div className="max-w-md mx-auto p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold text-center">
          Payment could not be completed. Please try again or contact support.
          <button onClick={() => setPaymentFailed(false)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 max-w-5xl mx-auto">
        {Object.entries(plans).map(([key, plan]) => (
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
                <span className="text-5xl font-black">{getPlanPrice(key)}</span>
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

import { Router } from 'express';
import crypto from 'crypto';
import { User } from '../db/models';

const router = Router();

const CLIENT_URL = (process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/+$/, '');

// POST /api/paystack/initialize
router.post('/initialize', async (req, res) => {
  try {
    const { email, userId, plan } = req.body;

    if (!email || !userId || !plan) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    if (plan !== 'pro' && plan !== 'business') {
      return res.status(400).json({ error: 'invalid_plan' });
    }

    const planCode = plan === 'pro'
      ? process.env.PAYSTACK_PLAN_CODE_PRO
      : process.env.PAYSTACK_PLAN_CODE_BUSINESS;

    if (!planCode) {
      console.error('[Paystack] Plan code not configured for plan:', plan);
      return res.status(500).json({ error: 'paystack_not_configured' });
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        plan: planCode,
        callback_url: `${CLIENT_URL}/payment/paystack/callback`,
        metadata: { userId, plan },
      }),
    });

    const data = await response.json();

    if (!data.status) {
      console.error('[Paystack] Initialize failed:', data.message);
      return res.status(500).json({ error: 'paystack_init_failed' });
    }

    res.json({ authorizationUrl: data.data.authorization_url });
  } catch (err) {
    console.error('[Paystack] Initialize error:', err);
    res.status(500).json({ error: 'paystack_init_failed' });
  }
});

// GET /api/paystack/callback
router.get('/callback', async (req, res) => {
  try {
    const { reference } = req.query;

    if (!reference) {
      return res.redirect(`${CLIENT_URL}/pricing?payment=failed`);
    }

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });

    const data = await response.json();

    if (!data.status || data.data.status !== 'success') {
      console.error('[Paystack] Verification failed:', data.message);
      return res.redirect(`${CLIENT_URL}/pricing?payment=failed`);
    }

    const { userId, plan } = data.data.metadata;

    const user = await User.findById(userId);
    if (!user) {
      return res.redirect(`${CLIENT_URL}/pricing?payment=failed`);
    }

    await User.findByIdAndUpdate(userId, {
      plan,
      planActive: true,
      paymentProvider: 'paystack',
      paystackCustomerId: data.data.customer?.id?.toString() || null,
      paystackSubscriptionCode: data.data.subscription_code || null,
    });

    res.redirect(`${CLIENT_URL}/dashboard?payment=success`);
  } catch (err) {
    console.error('[Paystack] Callback error:', err);
    res.redirect(`${CLIENT_URL}/pricing?payment=failed`);
  }
});

// POST /api/paystack/webhook
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'missing_signature' });
    }

    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const computedHash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
      .update(rawBody)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(signature))) {
      return res.status(400).json({ error: 'invalid_signature' });
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    switch (event.type) {
      case 'charge.success': {
        const { userId, plan } = event.data.metadata || {};
        if (userId) {
          await User.findByIdAndUpdate(userId, {
            plan,
            planActive: true,
            paymentProvider: 'paystack',
            paystackCustomerId: event.data.customer?.id?.toString() || null,
            paystackSubscriptionCode: event.data.subscription_code || null,
          });
        }
        break;
      }
      case 'subscription.disable':
      case 'invoice.payment_failed': {
        const customerCode = event.data.customer?.customer_code;
        if (customerCode) {
          await User.findOneAndUpdate(
            { paystackCustomerId: customerCode },
            { planActive: false }
          );
        }
        break;
      }
      default:
        console.log('[Paystack] Unhandled event:', event.type);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Paystack] Webhook error:', err);
    res.status(200).json({ received: true });
  }
});

export default router;

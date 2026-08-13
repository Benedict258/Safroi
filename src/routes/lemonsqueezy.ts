import { Router } from 'express';
import crypto from 'crypto';
import { User } from '../db/models';

const router = Router();

const CLIENT_URL = (process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/+$/, '');

// POST /api/lemonsqueezy/checkout
router.post('/checkout', async (req, res) => {
  try {
    const { userId, plan } = req.body;

    if (!userId || !plan) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    if (plan !== 'pro' && plan !== 'business') {
      return res.status(400).json({ error: 'invalid_plan' });
    }

    const variantId = plan === 'pro'
      ? process.env.LEMONSQUEEZY_VARIANT_ID_PRO
      : process.env.LEMONSQUEEZY_VARIANT_ID_BUSINESS;

    if (!variantId || !process.env.LEMONSQUEEZY_API_KEY || !process.env.LEMONSQUEEZY_STORE_ID) {
      console.error('[LemonSqueezy] Not configured for plan:', plan);
      return res.status(500).json({ error: 'lemonsqueezy_not_configured' });
    }

    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_options: {
              success_url: `${CLIENT_URL}/payment/lemonsqueezy/success`,
            },
            checkout_data: {
              custom: { userId, plan },
            },
          },
          relationships: {
            store: {
              data: { type: 'stores', id: process.env.LEMONSQUEEZY_STORE_ID },
            },
            variant: {
              data: { type: 'variants', id: variantId },
            },
          },
        },
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.data?.attributes?.url) {
      console.error('[LemonSqueezy] Checkout failed:', JSON.stringify(data));
      return res.status(500).json({ error: 'lemonsqueezy_checkout_failed' });
    }

    res.json({ checkoutUrl: data.data.attributes.url });
  } catch (err) {
    console.error('[LemonSqueezy] Checkout error:', err);
    res.status(500).json({ error: 'lemonsqueezy_checkout_failed' });
  }
});

// POST /api/lemonsqueezy/webhook
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'missing_signature' });
    }

    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const computedHash = crypto
      .createHmac('sha256', process.env.LEMONSQUEEZY_WEBHOOK_SECRET || '')
      .update(rawBody)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(signature))) {
      return res.status(400).json({ error: 'invalid_signature' });
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventName = event.meta?.event_name;

    switch (eventName) {
      case 'order_created':
      case 'subscription_created': {
        const userId = event.meta?.custom_data?.userId;
        const plan = event.meta?.custom_data?.plan;
        if (userId) {
          const update: Record<string, any> = {
            plan,
            planActive: true,
            paymentProvider: 'lemonsqueezy',
          };
          if (event.data?.attributes?.customer_id) {
            update.lemonsqueezyCustomerId = event.data.attributes.customer_id.toString();
          }
          if (event.data?.id) {
            update.lemonsqueezySubscriptionId = event.data.id.toString();
          }
          await User.findByIdAndUpdate(userId, update);
        }
        break;
      }
      case 'subscription_updated': {
        const subscriptionId = event.data?.id?.toString();
        if (subscriptionId) {
          const isActive = event.data?.attributes?.status === 'active';
          await User.findOneAndUpdate(
            { lemonsqueezySubscriptionId: subscriptionId },
            { planActive: isActive }
          );
        }
        break;
      }
      case 'subscription_cancelled':
      case 'subscription_expired': {
        const subscriptionId = event.data?.id?.toString();
        if (subscriptionId) {
          await User.findOneAndUpdate(
            { lemonsqueezySubscriptionId: subscriptionId },
            { planActive: false }
          );
        }
        break;
      }
      default:
        console.log('[LemonSqueezy] Unhandled event:', eventName);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[LemonSqueezy] Webhook error:', err);
    res.status(200).json({ received: true });
  }
});

// GET /api/lemonsqueezy/success
router.get('/success', (_req, res) => {
  res.redirect(`${CLIENT_URL}/dashboard?payment=success`);
});

export default router;

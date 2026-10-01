import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Usage } from '../db/models';
import { isDbConnected } from '../db/index';
import { userStore } from '../services/userStore';
import { getJwtSecret } from './auth';

// Pricing page: Free = "limited scans per month", Pro/Business = unlimited.
// Anonymous visitors can still try the product, with a small per-IP daily allowance.
const FREE_SCANS_PER_MONTH = () => Number(process.env.FREE_SCANS_PER_MONTH || 10);
const ANON_SCANS_PER_DAY = () => Number(process.env.ANON_SCANS_PER_DAY || 3);

const memory = new Map<string, { count: number; expiresAt: number }>();

/** Atomically add `delta` to a counter and return the new count. */
async function bump(key: string, delta: number, expiresAt: Date): Promise<number> {
  if (isDbConnected()) {
    try {
      const doc = await (Usage as any).findOneAndUpdate(
        { _id: key },
        { $inc: { count: delta }, $setOnInsert: { expiresAt } },
        { upsert: true, new: true },
      ).lean();
      return Math.max(0, doc.count);
    } catch (err) {
      console.warn('[Usage] DB error, using memory:', err instanceof Error ? err.message : err);
    }
  }
  const now = Date.now();
  const cur = memory.get(key);
  const entry = !cur || cur.expiresAt <= now ? { count: 0, expiresAt: expiresAt.getTime() } : cur;
  entry.count = Math.max(0, entry.count + delta);
  memory.set(key, entry);
  return entry.count;
}

const endOfUtcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)); };
const endOfUtcMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); };

/** Identify the caller if a valid Bearer token is present; otherwise continue as anonymous. Never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(header.slice(7), getJwtSecret()) as any;
      const uid = decoded.uid || decoded.userId || decoded.sub;
      if (uid) (req as any).user = { uid };
    } catch { /* invalid or expired token: treat as anonymous */ }
  }
  next();
}

/** Reserve one scan for the caller; refunded if the request fails. Use after optionalAuth. */
export async function scanQuota(req: Request, res: Response, next: NextFunction) {
  try {
    const uid: string | undefined = (req as any).user?.uid;
    let key: string, limit: number, expiresAt: Date, message: string;

    if (uid) {
      const user = await userStore.findById(uid);
      const plan = user?.plan || 'free';
      const active = user?.planActive !== false;
      if (plan !== 'free' && active) return next(); // pro / business: unlimited
      limit = FREE_SCANS_PER_MONTH();
      expiresAt = endOfUtcMonth();
      key = `scan:${uid}:${expiresAt.toISOString().slice(0, 7)}`;
      message = `You have used all ${limit} free scans this month. Upgrade to Pro for unlimited scans.`;
    } else {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      limit = ANON_SCANS_PER_DAY();
      expiresAt = endOfUtcDay();
      key = `scan:ip:${ip}:${expiresAt.toISOString().slice(0, 10)}`;
      message = `Guest limit reached (${limit} scans per day). Sign up free for ${FREE_SCANS_PER_MONTH()} scans a month.`;
    }

    const used = await bump(key, 1, expiresAt);
    if (used > limit) {
      await bump(key, -1, expiresAt);
      return res.status(429).json({ error: message, code: 'scan_limit_reached', limit, upgradeUrl: '/pricing' });
    }
    res.setHeader('X-Scans-Remaining', String(Math.max(0, limit - used)));
    res.on('finish', () => { if (res.statusCode >= 400) bump(key, -1, expiresAt).catch(() => {}); });
    next();
  } catch (err) {
    console.error('[Usage] quota check failed, allowing request:', err);
    next();
  }
}

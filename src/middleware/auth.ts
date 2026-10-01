import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const DEFAULT_JWT_SECRET = 'safroi-dev-jwt-secret-key-change-in-prod';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production');
  return DEFAULT_JWT_SECRET;
}

/** Use after requireAuth: the :userId route param must match the authenticated user. */
export function requireSelf(req: Request, res: Response, next: NextFunction) {
  if (req.params.userId !== (req as any).user?.uid) return res.status(403).json({ error: 'Forbidden' });
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const secret = getJwtSecret();
    
    const decoded = jwt.verify(token, secret) as any;
    // Support both legacy uid and userId payloads
    const userId = decoded.uid || decoded.userId || decoded.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }
    (req as any).user = { uid: userId };
    
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

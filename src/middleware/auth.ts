import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const secret = process.env.JWT_SECRET || 'fallback-secret';
    
    const decoded = jwt.verify(token, secret) as any;
    (req as any).user = { uid: decoded.uid || decoded.sub };
    
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

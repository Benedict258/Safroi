import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
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

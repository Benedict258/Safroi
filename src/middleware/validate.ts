import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export const signupSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
  name: z.string().min(1, 'Name is required').max(100),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
  password: z.string().min(1, 'Password is required').max(128),
});

export const resetSchema = z.object({
  email: z.string().email('Invalid email address').max(255),
});

export const resetConfirmSchema = z.object({
  token: z.string().min(1, 'Token is required').max(512),
  newPassword: z.string().min(6, 'Password must be at least 6 characters').max(128),
});

export const analyzeSchema = z.object({
  type: z.enum(['website', 'contract']).optional(),
  value: z.string().min(1).max(50000),
  title: z.string().max(500).optional(),
  url: z.string().url().max(2048).optional(),
  favicon: z.string().max(2048).optional(),
});

export const translateSchema = z.object({
  text: z.string().min(1).max(50000),
  targetLanguage: z.string().min(1).max(50),
});

export const speakSchema = z.object({
  text: z.string().min(1).max(10000),
  language: z.string().min(1).max(50),
});

export const ocrSchema = z.object({
  image: z.string().min(10),
  useDirectImage: z.boolean().optional(),
});

export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.errors.map(e => e.message).join('; ');
      return res.status(400).json({ error: message });
    }
    req.body = result.data;
    next();
  };
}

import type { Request, Response, NextFunction } from 'express';

const PLAN_HIERARCHY: Record<string, number> = {
  free: 0,
  pro: 1,
  business: 2,
};

export function requirePlan(minimumPlan: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userPlan = user.plan || 'free';
    const planActive = user.planActive !== false;

    if (!planActive && userPlan !== 'free') {
      return res.status(403).json({
        error: 'upgrade_required',
        currentPlan: 'free',
        requiredPlan: minimumPlan,
        upgradeUrl: '/pricing',
      });
    }

    const userLevel = PLAN_HIERARCHY[userPlan] ?? 0;
    const requiredLevel = PLAN_HIERARCHY[minimumPlan] ?? 0;

    if (userLevel < requiredLevel) {
      return res.status(403).json({
        error: 'upgrade_required',
        currentPlan: userPlan,
        requiredPlan: minimumPlan,
        upgradeUrl: '/pricing',
      });
    }

    next();
  };
}

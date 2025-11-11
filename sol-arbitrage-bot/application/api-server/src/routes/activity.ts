/**
 * Activity Routes
 * 
 * Handles activity feed endpoints
 */

import { Router, Request, Response } from 'express';
import { ActivityService } from '../services/activityService';

const router = Router();
const activityService = new ActivityService();

/**
 * GET /api/activity
 * Get recent activity events
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const type = req.query.type as string | undefined;
    const level = req.query.level as string | undefined;
    const token = req.query.token as string | undefined;

    const filters = {
      type: type as any,
      level: level as any,
      token,
      limit
    };

    const events = await activityService.getActivity(filters);
    res.json({ events, count: events.length });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch activity',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;


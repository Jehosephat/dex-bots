/**
 * Trade Routes
 * 
 * Handles trade history and statistics endpoints
 */

import { Router, Request, Response } from 'express';
import { TradeService } from '../services/tradeService';

const router = Router();
const tradeService = new TradeService();

/**
 * GET /api/trades
 * List trades with pagination and filters
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const token = req.query.token as string | undefined;
    const direction = req.query.direction as 'forward' | 'reverse' | undefined;
    const success = req.query.success === 'true' ? true : req.query.success === 'false' ? false : undefined;
    const mode = req.query.mode as 'live' | 'dry_run' | undefined;

    const filters = { token, direction, success, mode };
    const result = await tradeService.getTrades(page, limit, filters);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch trades',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/trades/stats
 * Get trade statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await tradeService.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch trade statistics',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/trades/:id
 * Get trade by timestamp ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const trade = await tradeService.getTradeById(id);
    
    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    
    res.json(trade);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch trade',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;


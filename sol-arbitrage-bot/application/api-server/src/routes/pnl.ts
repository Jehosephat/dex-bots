/**
 * P&L Routes
 * 
 * API endpoints for profit and loss calculations
 */

import { Router, Request, Response } from 'express';
import { PnLService } from '../services/pnlService';

const router = Router();
const pnlService = new PnLService();

/**
 * GET /api/pnl/summary
 * Get P&L summary with optional filters
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, token, direction, mode } = req.query;
    
    const summary = await pnlService.calculatePnL({
      startDate: startDate as string,
      endDate: endDate as string,
      token: token as string,
      direction: direction as 'forward' | 'reverse',
      mode: mode as 'live' | 'dry_run'
    });
    
    res.json(summary);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to calculate P&L',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/pnl/by-token
 * Get P&L breakdown by token
 */
router.get('/by-token', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, mode } = req.query;
    
    const byToken = await pnlService.getPnLByToken({
      startDate: startDate as string,
      endDate: endDate as string,
      mode: mode as 'live' | 'dry_run'
    });
    
    res.json(byToken);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get P&L by token',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/pnl/breakdown
 * Get comprehensive P&L breakdown
 */
router.get('/breakdown', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, mode } = req.query;
    
    const breakdown = await pnlService.getPnLBreakdown({
      startDate: startDate as string,
      endDate: endDate as string,
      mode: mode as 'live' | 'dry_run'
    });
    
    res.json(breakdown);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get P&L breakdown',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/pnl/inventory
 * Get current inventory value
 */
router.get('/inventory', async (req: Request, res: Response) => {
  try {
    const inventory = await pnlService.getCurrentInventoryValue();
    
    if (!inventory) {
      return res.status(404).json({
        error: 'Inventory data not available'
      });
    }
    
    res.json(inventory);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get inventory',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/pnl/daily
 * Get daily P&L data for charting
 */
router.get('/daily', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, mode } = req.query;
    
    const dailyData = await pnlService.getDailyPnL({
      startDate: startDate as string,
      endDate: endDate as string,
      mode: mode as 'live' | 'dry_run'
    });
    
    res.json(dailyData);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get daily P&L data',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;


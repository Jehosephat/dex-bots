/**
 * Balance Routes
 * 
 * API endpoints for token balances
 */

import { Router, Request, Response } from 'express';
import { BalanceService } from '../services/balanceService';

const router = Router();
const balanceService = new BalanceService();

/**
 * POST /api/balances/refresh
 * Refresh balances by fetching from networks
 * Must come before /:chain route to avoid route conflicts
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const balances = await balanceService.refreshBalances();
    
    if (!balances) {
      return res.status(404).json({
        error: 'Balance data not available after refresh'
      });
    }
    
    res.json(balances);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to refresh balances',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/balances
 * Get all balances (GalaChain and Solana)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const balances = await balanceService.getAllBalances();
    
    if (!balances) {
      return res.status(404).json({
        error: 'Balance data not available'
      });
    }
    
    res.json(balances);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get balances',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/balances/:chain
 * Get balances for a specific chain (galaChain or solana)
 */
router.get('/:chain', async (req: Request, res: Response) => {
  try {
    const { chain } = req.params;
    
    if (chain !== 'galaChain' && chain !== 'solana') {
      return res.status(400).json({
        error: 'Invalid chain. Must be "galaChain" or "solana"'
      });
    }
    
    const balances = await balanceService.getChainBalances(chain);
    
    if (!balances) {
      return res.status(404).json({
        error: 'Balance data not available'
      });
    }
    
    res.json(balances);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get balances',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;


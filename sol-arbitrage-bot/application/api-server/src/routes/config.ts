/**
 * Configuration Routes
 * 
 * Handles reading and updating configuration files
 */

import { Router, Request, Response } from 'express';
import { ConfigService, TokenConfig, BridgingConfig, InventoryConfig, TradingConfig } from '../services/configService';

const router = Router();
const configService = new ConfigService();

/**
 * GET /api/config/tokens
 * List all tokens
 */
router.get('/tokens', async (req: Request, res: Response) => {
  try {
    const tokens = await configService.readTokens();
    res.json(tokens);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to read tokens',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/config/tokens/:symbol
 * Get token config by symbol
 */
router.get('/tokens/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const tokens = await configService.readTokens();
    const token = tokens.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
    
    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    res.json(token);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to read token',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/config/tokens
 * Add new token
 */
router.post('/tokens', async (req: Request, res: Response) => {
  try {
    const newToken: TokenConfig = req.body;
    const tokens = await configService.readTokens();
    
    // Check if token already exists
    const exists = tokens.some(t => t.symbol.toUpperCase() === newToken.symbol.toUpperCase());
    if (exists) {
      return res.status(400).json({ error: 'Token already exists' });
    }
    
    tokens.push(newToken);
    await configService.writeTokens(tokens);
    
    res.status(201).json(newToken);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to add token',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * PUT /api/config/tokens/:symbol
 * Update token
 */
router.put('/tokens/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const updates: Partial<TokenConfig> = req.body;
    const tokens = await configService.readTokens();
    
    const index = tokens.findIndex(t => t.symbol.toUpperCase() === symbol.toUpperCase());
    if (index === -1) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    // Update token
    tokens[index] = { ...tokens[index], ...updates };
    await configService.writeTokens(tokens);
    
    res.json(tokens[index]);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update token',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * DELETE /api/config/tokens/:symbol
 * Remove token
 */
router.delete('/tokens/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const tokens = await configService.readTokens();
    
    const filtered = tokens.filter(t => t.symbol.toUpperCase() !== symbol.toUpperCase());
    if (filtered.length === tokens.length) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    await configService.writeTokens(filtered);
    
    res.json({ message: 'Token deleted successfully' });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to delete token',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/config/bridging
 * Get bridging config
 */
router.get('/bridging', async (req: Request, res: Response) => {
  try {
    const config = await configService.getBridgingConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to read bridging config',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * PUT /api/config/bridging
 * Update bridging config
 */
router.put('/bridging', async (req: Request, res: Response) => {
  try {
    const updates: Partial<BridgingConfig> = req.body;
    await configService.updateBridgingConfig(updates);
    const updated = await configService.getBridgingConfig();
    res.json(updated);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update bridging config',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/config/inventory
 * Get inventory config
 */
router.get('/inventory', async (req: Request, res: Response) => {
  try {
    const config = await configService.getInventoryConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to read inventory config',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * PUT /api/config/inventory
 * Update inventory config
 */
router.put('/inventory', async (req: Request, res: Response) => {
  try {
    const updates: Partial<InventoryConfig> = req.body;
    await configService.updateInventoryConfig(updates);
    const updated = await configService.getInventoryConfig();
    res.json(updated);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update inventory config',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/config/trading
 * Get trading config
 */
router.get('/trading', async (req: Request, res: Response) => {
  try {
    const config = await configService.getTradingConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to read trading config',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * PUT /api/config/trading
 * Update trading config
 */
router.put('/trading', async (req: Request, res: Response) => {
  try {
    const updates: Partial<TradingConfig> = req.body;
    await configService.updateTradingConfig(updates);
    const updated = await configService.getTradingConfig();
    res.json(updated);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update trading config',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;


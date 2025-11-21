/**
 * Bot Control Routes
 * 
 * Handles bot status, start/stop, and mode switching
 */

import { Router, Request, Response } from 'express';
import { Server } from 'socket.io';
import { BotManager } from '../services/botManager';

const router = Router();

// Initialize bot manager (will be set with io in botRoutes)
let botManager: BotManager;

export default function botRoutes(io: Server): Router {
  // Initialize bot manager with Socket.io instance
  if (!botManager) {
    botManager = new BotManager(io);
  }
  /**
   * GET /api/bot/status
   * Get current bot status
   */
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const status = await botManager.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get bot status',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/bot/start
   * Start the bot
   */
  router.post('/start', async (req: Request, res: Response) => {
    try {
      const { mode } = req.body;
      const result = await botManager.start(mode || 'dry_run');
      
      // Emit WebSocket event
      io.emit('bot:status:update', result);
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to start bot',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/bot/stop
   * Stop the bot
   */
  router.post('/stop', async (req: Request, res: Response) => {
    try {
      const result = await botManager.stop();
      
      // Emit WebSocket event
      io.emit('bot:status:update', result);
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to stop bot',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/bot/pause
   * Pause the bot
   */
  router.post('/pause', async (req: Request, res: Response) => {
    try {
      const result = await botManager.pause();
      
      // Emit WebSocket event
      io.emit('bot:status:update', result);
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to pause bot',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/bot/resume
   * Resume the bot
   */
  router.post('/resume', async (req: Request, res: Response) => {
    try {
      const result = await botManager.resume();
      
      // Emit WebSocket event
      io.emit('bot:status:update', result);
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to resume bot',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * GET /api/bot/console
   * Get recent console logs
   */
  router.get('/console', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = botManager.getConsoleLogs(limit);
      res.json({ logs });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to get console logs',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * DELETE /api/bot/console
   * Clear console logs
   */
  router.delete('/console', async (req: Request, res: Response) => {
    try {
      botManager.clearConsoleLogs();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ 
        error: 'Failed to clear console logs',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return router;
}


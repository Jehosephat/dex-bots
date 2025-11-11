/**
 * API Server for Sol Arbitrage Bot Vue.js Interface
 * 
 * Provides REST API and WebSocket server for managing and monitoring the bot
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

// Import routes
import botRoutes from './routes/bot';
import configRoutes from './routes/config';
import tradeRoutes from './routes/trades';
import activityRoutes from './routes/activity';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.VUE_APP_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Routes
app.use('/api/bot', botRoutes(io));
app.use('/api/config', configRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/activity', activityRoutes);

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Export io for use in routes/services
export { io };

const PORT = process.env.API_PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready`);
});


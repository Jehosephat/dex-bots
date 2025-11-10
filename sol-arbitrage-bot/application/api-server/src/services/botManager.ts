/**
 * Bot Manager Service
 * 
 * Manages bot process lifecycle without modifying core bot code.
 * Uses process detection and state files to determine bot status.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';

interface BotStatus {
  status: 'running' | 'stopped' | 'paused' | 'error';
  mode?: 'live' | 'dry_run';
  pid?: number;
  uptime?: number;
  lastCycle?: string;
  error?: string;
}

export class BotManager {
  private botProcess: ChildProcess | null = null;
  private botPid: number | null = null;
  private startTime: Date | null = null;
  private stateFilePath: string;
  private botRoot: string;

  constructor() {
    // Path to bot root (two levels up from api-server/dist)
    // In development, __dirname points to src, in production to dist
    const currentDir = __dirname;
    if (currentDir.includes('dist')) {
      this.botRoot = path.resolve(currentDir, '../../..');
    } else {
      // Development mode
      this.botRoot = path.resolve(currentDir, '../../../..');
    }
    this.stateFilePath = path.join(this.botRoot, 'state.json');
  }

  /**
   * Get current bot status
   */
  async getStatus(): Promise<BotStatus> {
    try {
      // Check if process is running
      if (this.botProcess && !this.botProcess.killed) {
        const uptime = this.startTime 
          ? Math.floor((Date.now() - this.startTime.getTime()) / 1000)
          : 0;

        // Try to read state file for additional info
        let lastCycle: string | undefined;
        let mode: 'live' | 'dry_run' | undefined;
        try {
          if (existsSync(this.stateFilePath)) {
            const stateContent = await fs.readFile(this.stateFilePath, 'utf-8');
            const state = JSON.parse(stateContent);
            lastCycle = state.lastCycleTime;
            // Check if we can infer mode from state (if available)
            // For now, default to dry_run
            mode = 'dry_run';
          }
        } catch (e) {
          // Ignore state file read errors
        }

        return {
          status: 'running',
          mode: mode || 'dry_run',
          pid: this.botPid || undefined,
          uptime,
          lastCycle
        };
      }

      // Check if bot is running externally by reading state file
      try {
        if (existsSync(this.stateFilePath)) {
          const stateContent = await fs.readFile(this.stateFilePath, 'utf-8');
          const state = JSON.parse(stateContent);
          
          // Check if state indicates bot is running
          if (state.status === 'running' || state.lastHeartbeat) {
            const lastHeartbeat = state.lastHeartbeat;
            const now = Date.now();
            const heartbeatAge = now - lastHeartbeat;
            
            // Consider bot running if heartbeat is less than 2 minutes old
            if (heartbeatAge < 120000) {
              return {
                status: 'running',
                mode: 'dry_run', // TODO: Read from actual process/env
                lastCycle: state.lastCycleTime
              };
            }
          }
        }
      } catch (e) {
        // Ignore state file read errors
      }

      // Bot appears to be stopped
      return {
        status: 'stopped'
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Start the bot
   */
  async start(mode: 'live' | 'dry_run' = 'dry_run'): Promise<BotStatus> {
    try {
      // Check if already running
      const currentStatus = await this.getStatus();
      if (currentStatus.status === 'running') {
        return currentStatus;
      }

      // Path to bot entry point
      const botEntryPoint = path.join(this.botRoot, 'dist', 'index.js');

      // Check if bot is built
      if (!existsSync(botEntryPoint)) {
        throw new Error('Bot not built. Run "npm run build" first.');
      }

      // Start bot process
      const env = {
        ...process.env,
        MODE: mode
      };

      this.botProcess = spawn('node', [botEntryPoint], {
        cwd: this.botRoot,
        env,
        stdio: 'pipe'
      });

      this.botPid = this.botProcess.pid || null;
      this.startTime = new Date();

      // Handle process events
      this.botProcess.on('exit', (code) => {
        console.log(`Bot process exited with code ${code}`);
        this.botProcess = null;
        this.botPid = null;
        this.startTime = null;
      });

      this.botProcess.on('error', (error) => {
        console.error('Bot process error:', error);
        this.botProcess = null;
        this.botPid = null;
        this.startTime = null;
      });

      // Log output
      if (this.botProcess.stdout) {
        this.botProcess.stdout.on('data', (data) => {
          console.log(`[Bot] ${data.toString()}`);
        });
      }

      if (this.botProcess.stderr) {
        this.botProcess.stderr.on('data', (data) => {
          console.error(`[Bot Error] ${data.toString()}`);
        });
      }

      // Wait a moment to ensure process started
      await new Promise(resolve => setTimeout(resolve, 500));

      return await this.getStatus();
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<BotStatus> {
    try {
      if (this.botProcess && !this.botProcess.killed) {
        this.botProcess.kill('SIGTERM');
        
        // Wait for graceful shutdown
        await new Promise((resolve) => {
          if (this.botProcess) {
            this.botProcess.on('exit', resolve);
            setTimeout(resolve, 5000); // Force kill after 5s
          } else {
            resolve(undefined);
          }
        });

        // Force kill if still running
        if (this.botProcess && !this.botProcess.killed) {
          this.botProcess.kill('SIGKILL');
        }
      }

      this.botProcess = null;
      this.botPid = null;
      this.startTime = null;

      return {
        status: 'stopped'
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Pause the bot (not implemented yet - would require bot support)
   */
  async pause(): Promise<BotStatus> {
    // TODO: Implement pause functionality
    // This would require the bot to support pause signals
    return {
      status: 'paused',
      error: 'Pause functionality not yet implemented'
    };
  }

  /**
   * Resume the bot (not implemented yet - would require bot support)
   */
  async resume(): Promise<BotStatus> {
    // TODO: Implement resume functionality
    const currentStatus = await this.getStatus();
    if (currentStatus.status === 'paused') {
      // Resume logic here
    }
    return currentStatus;
  }
}


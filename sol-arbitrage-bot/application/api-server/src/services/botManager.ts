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
import { Server } from 'socket.io';

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
  private botMode: 'live' | 'dry_run' | null = null; // Track the mode the bot was started with
  private stateFilePath: string;
  private botRoot: string;
  private io: Server | null = null;
  private consoleLogs: Array<{ timestamp: number; type: 'stdout' | 'stderr'; message: string }> = [];
  private readonly MAX_LOGS = 1000; // Keep last 1000 log lines

  constructor(io?: Server) {
    this.io = io || null;
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
        try {
          if (existsSync(this.stateFilePath)) {
            const stateContent = await fs.readFile(this.stateFilePath, 'utf-8');
            const state = JSON.parse(stateContent);
            lastCycle = state.lastCycleTime;
          }
        } catch (e) {
          // Ignore state file read errors
        }

        return {
          status: 'running',
          mode: this.botMode || 'dry_run', // Use tracked mode
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
                mode: this.botMode || 'dry_run', // Use tracked mode if available
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

      // Path to bot entry point - use run-bot.ts (the actual entry point)
      const botEntryPointSrc = path.join(this.botRoot, 'src', 'run-bot.ts');
      const botEntryPointDist = path.join(this.botRoot, 'dist', 'run-bot.js');

      // Determine if we should use compiled version or source
      const useCompiled = existsSync(botEntryPointDist);
      const entryPoint = useCompiled ? botEntryPointDist : botEntryPointSrc;

      // Start bot process
      const env = {
        ...process.env,
        RUN_MODE: mode  // Bot expects RUN_MODE, not MODE
      };

      // Use node for compiled, tsx for source
      const command = useCompiled ? 'node' : 'npx';
      const args = useCompiled ? [entryPoint] : ['tsx', entryPoint];

      this.botProcess = spawn(command, args, {
        cwd: this.botRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'], // stdin: ignore, stdout: pipe, stderr: pipe
        shell: false
      });
      
      // Log process start
      console.log(`[BotManager] Starting bot process: ${command} ${args.join(' ')}`);
      console.log(`[BotManager] Mode: ${mode}, PID: ${this.botProcess.pid}`);

      this.botPid = this.botProcess.pid || null;
      this.startTime = new Date();
      this.botMode = mode; // Track the mode we started with

      // Handle process events
      this.botProcess.on('exit', (code) => {
        console.log(`Bot process exited with code ${code}`);
        this.botProcess = null;
        this.botPid = null;
        this.startTime = null;
        this.botMode = null; // Clear mode when process exits
      });

      this.botProcess.on('error', (error) => {
        console.error('Bot process error:', error);
        this.botProcess = null;
        this.botPid = null;
        this.startTime = null;
        this.botMode = null; // Clear mode on error
      });

      // Capture and emit console output
      if (this.botProcess.stdout) {
        this.botProcess.stdout.setEncoding('utf8');
        this.botProcess.stdout.on('data', (data) => {
          const message = data.toString();
          console.log(`[Bot stdout] ${message}`);
          // Split by newlines and add each line as a separate log entry
          const lines = message.split('\n').filter((line: string) => line.trim().length > 0);
          lines.forEach((line: string) => this.addLog('stdout', line));
        });
        
        this.botProcess.stdout.on('error', (error) => {
          console.error('[Bot stdout error]', error);
          this.addLog('stderr', `stdout error: ${error.message}`);
        });
      } else {
        console.warn('[BotManager] stdout is null');
      }

      if (this.botProcess.stderr) {
        this.botProcess.stderr.setEncoding('utf8');
        this.botProcess.stderr.on('data', (data) => {
          const message = data.toString();
          console.error(`[Bot stderr] ${message}`);
          // Split by newlines and add each line as a separate log entry
          const lines = message.split('\n').filter((line: string) => line.trim().length > 0);
          lines.forEach((line: string) => this.addLog('stderr', line));
        });
        
        this.botProcess.stderr.on('error', (error) => {
          console.error('[Bot stderr error]', error);
          this.addLog('stderr', `stderr error: ${error.message}`);
        });
      } else {
        console.warn('[BotManager] stderr is null');
      }
      
      // Add a startup message
      this.addLog('stdout', `Bot process started (PID: ${this.botPid}, Mode: ${mode})`);

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
      this.botMode = null; // Clear mode when stopped
      // Don't clear console logs - keep them for reference

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
   * Add a log entry and emit via WebSocket
   */
  private addLog(type: 'stdout' | 'stderr', message: string): void {
    if (!message || message.trim().length === 0) {
      return; // Skip empty messages
    }
    
    const logEntry = {
      timestamp: Date.now(),
      type,
      message: message.trim()
    };

    // Add to logs array
    this.consoleLogs.push(logEntry);

    // Keep only last MAX_LOGS entries
    if (this.consoleLogs.length > this.MAX_LOGS) {
      this.consoleLogs.shift();
    }

    // Emit via WebSocket if available
    if (this.io) {
      this.io.emit('bot:console:output', logEntry);
    } else {
      console.warn('[BotManager] Socket.io not available, cannot emit console output');
    }
  }

  /**
   * Get recent console logs
   */
  getConsoleLogs(limit: number = 100): Array<{ timestamp: number; type: 'stdout' | 'stderr'; message: string }> {
    return this.consoleLogs.slice(-limit);
  }

  /**
   * Clear console logs
   */
  clearConsoleLogs(): void {
    this.consoleLogs = [];
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


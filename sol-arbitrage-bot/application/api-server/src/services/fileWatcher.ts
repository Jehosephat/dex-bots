/**
 * File Watcher Service
 * 
 * Watches log files and bridge state for changes and emits WebSocket events
 */

import { watch, FSWatcher } from 'chokidar';
import { Server } from 'socket.io';
import path from 'path';
import { existsSync } from 'fs';

export class FileWatcherService {
  private io: Server;
  private watchers: Map<string, FSWatcher> = new Map();
  private botRoot: string;

  constructor(io: Server) {
    this.io = io;
    
    // Determine bot root directory
    const currentDir = __dirname;
    if (currentDir.includes('dist')) {
      this.botRoot = path.resolve(currentDir, '../../..');
    } else {
      this.botRoot = path.resolve(currentDir, '../../../..');
    }
  }

  /**
   * Start watching files for changes
   */
  startWatching(): void {
    // Watch trades.json
    const tradesPath = path.join(this.botRoot, 'logs', 'trades.json');
    if (existsSync(tradesPath)) {
      this.watchFile(tradesPath, 'trades');
    } else {
      // Watch the logs directory and wait for trades.json to be created
      const logsDir = path.join(this.botRoot, 'logs');
      if (existsSync(logsDir)) {
        this.watchFile(path.join(logsDir, 'trades.json'), 'trades');
      }
    }

    // Watch bridge-state.json
    const bridgeStatePath = path.join(this.botRoot, 'bridge-state.json');
    if (existsSync(bridgeStatePath)) {
      this.watchFile(bridgeStatePath, 'bridge');
    } else {
      // Watch for bridge-state.json to be created
      this.watchFile(bridgeStatePath, 'bridge');
    }

    console.log('📡 File watcher started');
  }

  /**
   * Watch a specific file for changes
   */
  private watchFile(filePath: string, type: 'trades' | 'bridge'): void {
    // Debounce timer
    let debounceTimer: NodeJS.Timeout | null = null;
    const DEBOUNCE_MS = 500; // Wait 500ms after last change before emitting

    const watcher = watch(filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      }
    });

    watcher.on('change', () => {
      // Debounce file change events
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        console.log(`📝 File changed: ${type} - ${filePath}`);
        
        // Emit activity update event
        this.io.emit('activity:update', {
          type,
          file: path.basename(filePath),
          timestamp: new Date().toISOString()
        });
      }, DEBOUNCE_MS);
    });

    watcher.on('error', (error) => {
      console.error(`❌ Error watching file ${filePath}:`, error);
    });

    this.watchers.set(filePath, watcher);
  }

  /**
   * Stop watching all files
   */
  stopWatching(): void {
    for (const [filePath, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
    console.log('📡 File watcher stopped');
  }
}


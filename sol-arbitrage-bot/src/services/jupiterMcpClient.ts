/**
 * Jupiter Swap MCP Client
 * 
 * Provides a client interface for communicating with the Solana Jupiter Swap MCP server.
 * The MCP server must be installed and built separately, then run as a child process.
 * 
 * See: https://github.com/techsavvy5416/solana-jupiter-swap-mcp
 */

import { join } from 'path';
import logger from '../utils/logger';

// MCP SDK types - optional dependency, may not be installed
type Client = any;
type StdioClientTransport = any;

export interface JupiterMcpSwapQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string; // in lamports/base units
  slippageBps?: number;
}

export interface JupiterMcpSwapQuoteResult {
  inAmount: string;
  outAmount: string;
  priceImpact?: number;
  route?: any;
}

export interface JupiterMcpSwapExecuteParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
}

export interface JupiterMcpSwapExecuteResult {
  signature?: string;
  error?: string;
}

export class JupiterMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private isConnected = false;
  private mcpServerPath: string;
  private ClientClass: any;
  private TransportClass: any;

  constructor(mcpServerPath?: string) {
    // Default to looking for the built MCP server in node_modules or a configured path
    this.mcpServerPath = mcpServerPath || 
      process.env.JUPITER_MCP_SERVER_PATH || 
      join(process.cwd(), 'node_modules', 'techsavvy5416-solana-jupiter-swap-mcp', 'build', 'index.js');
    
    // Try to load MCP SDK classes (optional dependency)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.ClientClass = require('@modelcontextprotocol/sdk/client/index.js').Client;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.TransportClass = require('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport;
    } catch (error) {
      // MCP SDK not installed - this is optional functionality
      logger.warn('⚠️ MCP SDK not installed - Jupiter MCP client will not be available');
      this.ClientClass = null;
      this.TransportClass = null;
    }
  }

  /**
   * Initialize and connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.client) {
      return;
    }

    try {
      // Check if server path exists
      const fs = await import('fs/promises');
      try {
        await fs.access(this.mcpServerPath);
      } catch {
        throw new Error(
          `MCP server not found at ${this.mcpServerPath}. ` +
          `Please install and build the MCP server or set JUPITER_MCP_SERVER_PATH.`
        );
      }

      // Create transport - spawn the MCP server as a child process
      if (!this.TransportClass) {
        throw new Error('MCP SDK not available. Install @modelcontextprotocol/sdk to use Jupiter MCP client.');
      }
      this.transport = new this.TransportClass({
        command: 'node',
        args: [this.mcpServerPath],
        env: {
          ...process.env,
          SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
          SOLANA_PRIVATE_KEY: process.env.SOLANA_PRIVATE_KEY || '',
        }
      });

      // Create client
      if (!this.ClientClass) {
        throw new Error('MCP SDK not available. Install @modelcontextprotocol/sdk to use Jupiter MCP client.');
      }
      this.client = new this.ClientClass({
        name: 'sol-arbitrage-bot',
        version: '1.0.0',
      }, {
        capabilities: {}
      });

      // Connect to the transport
      await this.client.connect(this.transport);
      this.isConnected = true;

      logger.info('✅ Connected to Jupiter Swap MCP server');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Failed to connect to Jupiter Swap MCP server', { 
        error: errorMessage,
        serverPath: this.mcpServerPath 
      });
      throw error;
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        logger.warn('Error closing MCP client', { error });
      }
      this.client = null;
      this.transport = null;
      this.isConnected = false;
    }
  }

  /**
   * Get a swap quote from Jupiter
   */
  async getSwapQuote(params: JupiterMcpSwapQuoteParams): Promise<JupiterMcpSwapQuoteResult | null> {
    if (!this.isConnected || !this.client) {
      throw new Error('MCP client not connected. Call connect() first.');
    }

    try {
      const result = await this.client.callTool({
        name: 'getSwapQuote',
        arguments: {
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount,
          slippageBps: params.slippageBps || 50,
        }
      });

      if (result.content && Array.isArray(result.content) && result.content.length > 0) {
        const content = result.content[0];
        if (content && typeof content === 'object' && 'type' in content && content.type === 'text' && 'text' in content) {
          const data = JSON.parse(content.text as string);
          return {
            inAmount: data.inAmount || data.inputAmount,
            outAmount: data.outAmount || data.outputAmount,
            priceImpact: data.priceImpact || data.priceImpactPct,
            route: data.route || data.routePlan,
          };
        }
      }

      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ MCP getSwapQuote failed', { params, error: errorMessage });
      throw error;
    }
  }

  /**
   * Execute a swap using Jupiter
   */
  async executeSwap(params: JupiterMcpSwapExecuteParams): Promise<JupiterMcpSwapExecuteResult> {
    if (!this.isConnected || !this.client) {
      throw new Error('MCP client not connected. Call connect() first.');
    }

    try {
      const result = await this.client.callTool({
        name: 'executeSwap',
        arguments: {
          inputMint: params.inputMint,
          outputMint: params.outputMint,
          amount: params.amount,
          slippageBps: params.slippageBps || 50,
        }
      });

      if (result.content && Array.isArray(result.content) && result.content.length > 0) {
        const content = result.content[0];
        if (content && typeof content === 'object' && 'type' in content && content.type === 'text' && 'text' in content) {
          const data = JSON.parse(content.text as string);
          if (data.signature || data.txSig) {
            return { signature: data.signature || data.txSig };
          } else if (data.error) {
            return { error: data.error };
          }
        }
      }

      return { error: 'No signature or error in MCP response' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ MCP executeSwap failed', { params, error: errorMessage });
      return { error: errorMessage };
    }
  }

  /**
   * Get SOL balance for an address
   */
  async getBalance(address: string): Promise<number | null> {
    if (!this.isConnected || !this.client) {
      throw new Error('MCP client not connected. Call connect() first.');
    }

    try {
      const result = await this.client.callTool({
        name: 'getBalance',
        arguments: { address }
      });

      if (result.content && Array.isArray(result.content) && result.content.length > 0) {
        const content = result.content[0];
        if (content && typeof content === 'object' && 'type' in content && content.type === 'text' && 'text' in content) {
          const data = JSON.parse(content.text as string);
          return data.balance || data.solBalance || null;
        }
      }

      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ MCP getBalance failed', { address, error: errorMessage });
      return null;
    }
  }

  /**
   * Get wallet address from private key
   */
  async getMyAddress(): Promise<string | null> {
    if (!this.isConnected || !this.client) {
      throw new Error('MCP client not connected. Call connect() first.');
    }

    try {
      const result = await this.client.callTool({
        name: 'getMyAddress',
        arguments: {}
      });

      if (result.content && Array.isArray(result.content) && result.content.length > 0) {
        const content = result.content[0];
        if (content && typeof content === 'object' && 'type' in content && content.type === 'text' && 'text' in content) {
          const data = JSON.parse(content.text as string);
          return data.address || data.publicKey || null;
        }
      }

      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ MCP getMyAddress failed', { error: errorMessage });
      return null;
    }
  }

  /**
   * Get SPL token balances for an address
   */
  async getSplTokenBalances(address: string): Promise<any[] | null> {
    if (!this.isConnected || !this.client) {
      throw new Error('MCP client not connected. Call connect() first.');
    }

    try {
      const result = await this.client.callTool({
        name: 'getSplTokenBalances',
        arguments: { address }
      });

      if (result.content && Array.isArray(result.content) && result.content.length > 0) {
        const content = result.content[0];
        if (content && typeof content === 'object' && 'type' in content && content.type === 'text' && 'text' in content) {
          const data = JSON.parse(content.text as string);
          return data.tokens || data.balances || [];
        }
      }

      return [];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ MCP getSplTokenBalances failed', { address, error: errorMessage });
      return null;
    }
  }
}


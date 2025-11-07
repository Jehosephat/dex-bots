import BigNumber from 'bignumber.js';
import { ConfigManager } from '../config/configManager';
import logger from '../utils/logger';
import { GalaConnectClient, BridgeTokenDescriptor } from './galaConnectClient';
import { resolveGalaEndpoints } from './galaEndpoints';
import { RequestTokenBridgeOutDto, TokenInstanceKey, TokenClassKey } from '@gala-chain/api';
import { instanceToPlain } from 'class-transformer';

export interface BridgeFeeEstimate {
  chain: 'Solana';
  feeToken: 'GALA';
  estimatedTotalFeeGala: BigNumber;
  details?: Record<string, unknown>;
}

export interface BridgeOutParams {
  symbol: string;
  amount: BigNumber; // human units
  destination: 'Solana';
  recipient: string; // destination wallet
  deadlineMs: number;
  fee: BridgeFeeEstimate;
}


export interface BridgeExecutionResult {
  success: boolean;
  bridgeRequestId?: string;
  transactionHash?: string;
  error?: string;
}

export class BridgeManager {
  private readonly configManager: ConfigManager;
  private client?: GalaConnectClient;
  private privateKey?: string; // GalaChain private key (hex string, no 0x prefix)

  constructor(configManager?: ConfigManager) {
    this.configManager = configManager ?? new ConfigManager();
  }

  async initialize(): Promise<void> {
    const networks = this.configManager.getNetworksConfig();
    logger.info('BridgeManager initialized', {
      galaRpc: networks.galaChain.rpcUrl,
      solRpc: networks.solana.rpcUrl,
    });

    const ep = resolveGalaEndpoints();
    const baseUrl = ep.connectBaseUrl;
    const galachainApi = ep.dexApiBaseUrl; // Use DEX API base URL
    const wallet = process.env.GALACHAIN_WALLET_ADDRESS || '';
    this.client = new GalaConnectClient(baseUrl, galachainApi, wallet);
    
    // Initialize signer from BRIDGE_PRIVATE_KEY (Ethereum-compatible private key)
    const bridgePriv = process.env.BRIDGE_PRIVATE_KEY;
    if (bridgePriv) {
      try {
        // Private key should be in hex format (64 chars, with or without 0x)
        const privKey = bridgePriv.trim().replace(/^0x/, '');
        if (privKey.length !== 64) {
          throw new Error('BRIDGE_PRIVATE_KEY must be 64-character hex string');
        }
        // Store as hex string (with 0x prefix) for use with DTO sign() method
        this.privateKey = `0x${privKey}`;
        logger.info('Bridge signer initialized');
      } catch (error) {
        logger.warn('Failed to initialize bridge signer', { error: error instanceof Error ? error.message : String(error) });
      }
    } else {
      logger.warn('BRIDGE_PRIVATE_KEY not set - bridge execution will not be available');
    }
    
    logger.info('GalaConnect client ready', { baseUrl, galachainApi, walletPresent: Boolean(wallet) });
  }

  async estimateFee(symbol: string, destination: 'Solana'): Promise<BridgeFeeEstimate> {
    if (!this.client) throw new Error('BridgeManager not initialized');
    const descriptor = await this.resolveBridgeTokenDescriptor(symbol);
    const fee = await this.client.fetchBridgeFee({ chainId: 'Solana', bridgeToken: descriptor });
    // OracleBridgeFeeAssertionDto properties are BigNumber instances
    const totalGala = fee.estimatedTotalTxFeeInGala instanceof BigNumber 
      ? fee.estimatedTotalTxFeeInGala 
      : new BigNumber(fee.estimatedTotalTxFeeInGala);
    return {
      chain: 'Solana',
      feeToken: 'GALA',
      estimatedTotalFeeGala: totalGala,
      details: {
        chainId: 'Solana',
        descriptor: `${descriptor.collection}|${descriptor.category}|${descriptor.type}|${descriptor.additionalKey}`,
        units: fee.estimatedTxFeeUnitsTotal?.toString() || '0',
        pricePerUnit: fee.estimatedPricePerTxFeeUnit?.toString() || '0',
        totalGala: fee.estimatedTotalTxFeeInGala?.toString() || '0',
        galaDecimals: fee.galaDecimals,
        timestamp: fee.timestamp,
        signingIdentity: fee.signingIdentity,
      },
    };
  }

  async buildBridgeOutParams(params: {
    symbol: string;
    amount: number | string | BigNumber;
    recipient?: string;
    destination: 'Solana';
  }): Promise<BridgeOutParams> {
    const { symbol, destination } = params;
    const amount = new BigNumber(params.amount);
    const networks = this.configManager.getNetworksConfig();
    const recipient = params.recipient ?? process.env.SOLANA_WALLET_ADDRESS ?? '';
    const fee = await this.estimateFee(symbol, destination);
    const deadlineMs = Date.now() + 60_000; // 60s window
    const result: BridgeOutParams = { symbol, amount, destination, recipient, deadlineMs, fee };
    logger.execution('Prepared bridge-out params', {
      symbol,
      amount: amount.toString(),
      destination,
      recipient,
      deadlineMs,
      feeGala: fee.estimatedTotalFeeGala.toString(),
      feeDetails: fee.details,
      galaRpc: networks.galaChain.rpcUrl,
    });
    return result;
  }

  /**
   * Execute a bridge from GalaChain to Solana using DEX API with @gala-chain/api DTOs
   */
  async executeBridgeOut(params: {
    symbol: string;
    amount: number | string | BigNumber;
    recipient?: string;
    destination: 'Solana';
  }): Promise<BridgeExecutionResult> {
    if (!this.client) throw new Error('BridgeManager not initialized');
    if (!this.privateKey) throw new Error('BRIDGE_PRIVATE_KEY not set - cannot sign bridge payload');

    const { symbol, destination } = params;
    const amount = new BigNumber(params.amount);
    const recipient = params.recipient ?? process.env.SOLANA_WALLET_ADDRESS ?? '';
    
    try {
      // 1. Resolve token descriptor
      const descriptor = await this.resolveBridgeTokenDescriptor(symbol);
      
      // 2. Fetch bridge fee (returns OracleBridgeFeeAssertionDto)
      logger.info('Fetching bridge fee', { symbol, amount: amount.toString() });
      const bridgeFee = await this.client.fetchBridgeFee({ chainId: 'Solana', bridgeToken: descriptor });
      
      const uniqueKey = `galaswap-operation-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      const tokenClass = new TokenClassKey();
      tokenClass.collection = descriptor.collection;
      tokenClass.category = descriptor.category;
      tokenClass.type = descriptor.type;
      tokenClass.additionalKey = descriptor.additionalKey;
      const tokenInstance = TokenInstanceKey.fungibleKey(tokenClass);
      
      const dto = new RequestTokenBridgeOutDto();
      dto.destinationChainId = 1002;
      dto.tokenInstance = tokenInstance;
      dto.quantity = amount;
      dto.recipient = recipient;
      dto.destinationChainTxFee = bridgeFee;
      dto.uniqueKey = uniqueKey;

      logger.debug('Signing bridge DTO', { symbol, uniqueKey });
      dto.sign(this.privateKey);
      
      const dtoPayload = instanceToPlain(dto, {
        enableImplicitConversion: true,
        exposeDefaultValues: true,
      }) as any;
      
      const fixBigNumberSerialization = (obj: any): any => {
        if (obj === null || obj === undefined) return obj;
        if (obj instanceof BigNumber) {
          return obj.toFixed().replace(/\.?0+$/, '');
        }
        if (typeof obj === 'string' && /^[\d.]+[eE][+-]?\d+$/.test(obj)) {
          const bn = new BigNumber(obj);
          return bn.toFixed().replace(/\.?0+$/, '');
        }
        if (Array.isArray(obj)) {
          return obj.map(fixBigNumberSerialization);
        }
        if (typeof obj === 'object' && obj.constructor === Object) {
          const result: any = {};
          for (const [key, value] of Object.entries(obj)) {
            result[key] = fixBigNumberSerialization(value);
          }
          return result;
        }
        return obj;
      };
      
      const fixedPayload = fixBigNumberSerialization(dtoPayload);
      
      logger.info('Submitting RequestTokenBridgeOut', { symbol, uniqueKey });
      const requestResponse = await this.client.requestBridgeOut(fixedPayload);
      
      let bridgeRequestId: string | undefined;
      if (typeof requestResponse === 'object' && requestResponse !== null) {
        const req = requestResponse as any;
        if (typeof req.Data === 'string') {
          bridgeRequestId = req.Data;
        } else if (req.data != null) {
          if (typeof req.data === 'string') {
            bridgeRequestId = req.data;
          } else if (typeof req.data === 'object') {
            const dataObj = req.data as { Data?: unknown };
            if (typeof dataObj.Data === 'string') {
              bridgeRequestId = dataObj.Data;
            }
          }
        }
      }
      
      if (!bridgeRequestId) {
        logger.error('Bridge request ID missing from response', { response: requestResponse });
        return {
          success: false,
          error: 'Bridge request ID missing from RequestTokenBridgeOut response',
        };
      }
      
      logger.info('RequestTokenBridgeOut accepted', { symbol, bridgeRequestId });
      
      logger.info('Submitting BridgeTokenOut', { symbol, bridgeRequestId });
      const bridgeResponse = await this.client.bridgeTokenOut({
        bridgeFromChannel: 'asset',
        bridgeRequestId,
      });
      
      // 9. Extract transaction hash
      const hash = (bridgeResponse as any)?.Hash || (bridgeResponse as any)?.hash;
      if (!hash) {
        logger.error('BridgeTokenOut response missing hash', { response: bridgeResponse });
        return {
          success: false,
          error: 'BridgeTokenOut response missing transaction hash',
        };
      }
      
      logger.info('BridgeTokenOut submitted', { symbol, hash });
      
      return {
        success: true,
        bridgeRequestId,
        transactionHash: hash,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Bridge execution failed', { symbol, error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  }


  /**
   * Poll bridge status until completion
   */
  async waitForBridgeCompletion(
    hash: string,
    timeoutMinutes: number = 30
  ): Promise<{ status: number; statusDescription: string } | null> {
    if (!this.client) throw new Error('BridgeManager not initialized');

    const start = Date.now();
    const timeoutMs = timeoutMinutes * 60 * 1000;
    let lastStatus: number | undefined;

    while (Date.now() - start < timeoutMs) {
      try {
        const statusResponse = await this.client.getBridgeStatus(hash);
        const status = (statusResponse as any)?.data?.status ?? (statusResponse as any)?.status;
        const desc = (statusResponse as any)?.data?.statusDescription ?? (statusResponse as any)?.statusDescription;

        if (status !== lastStatus) {
          logger.info('Bridge status update', { hash, status, description: desc });
          lastStatus = status;
        }

        if (status >= 5) {
          // Status 5 = completed, >5 = failed
          return { status, statusDescription: desc || 'Unknown' };
        }
      } catch (error: any) {
        // Handle 404 as "not yet available"
        if (error?.status === 404) {
          logger.debug('Bridge status not yet available (404), waiting...', { hash });
        } else {
          logger.warn('Error checking bridge status', { hash, error: error instanceof Error ? error.message : String(error) });
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 15_000)); // Poll every 15 seconds
    }

    logger.warn('Bridge status polling timed out', { hash, timeoutMinutes });
    return null;
  }

  private async resolveBridgeTokenDescriptor(symbol: string): Promise<BridgeTokenDescriptor> {
    // 1) Prefer local config tokens.json descriptor (e.g., GSOL|Unit|none|none)
    const tokenCfg = this.configManager.getTokenConfig(symbol);
    const mint = tokenCfg?.galaChainMint;
    if (mint) {
      const parts = mint.split('|');
      if (parts.length === 4) {
        const [collection, category, type, additionalKey] = parts;
        return { collection, category, type, additionalKey };
      }
    }

    // 2) Fall back to GalaConnect discovery
    if (!this.client) throw new Error('BridgeManager not initialized');
    const trySymbol = async (s: string) => {
      const tokens = await this.client!.getBridgeConfigurations(s);
      const match = tokens.find((t) => t.symbol.toUpperCase() === s.toUpperCase() && t.verified);
      return match;
    };
    let token = await trySymbol(symbol);
    if (!token && !symbol.toUpperCase().startsWith('G')) {
      token = await trySymbol(`G${symbol}`);
    }
    if (!token) throw new Error(`Unable to resolve bridge token for ${symbol}`);
    return {
      collection: token.collection,
      category: token.category,
      type: token.type,
      additionalKey: token.additionalKey,
    };
  }

  async getBridgeStatus(hash: string): Promise<unknown> {
    if (!this.client) throw new Error('BridgeManager not initialized');
    const status = await this.client.getBridgeStatus(hash);
    return status;
  }
}

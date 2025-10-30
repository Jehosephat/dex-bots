import BigNumber from 'bignumber.js';
import { ConfigManager } from '../config/configManager';
import logger from '../utils/logger';
import { GalaConnectClient, BridgeTokenDescriptor } from './galaConnectClient';

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

export class BridgeManager {
  private readonly configManager: ConfigManager;
  private client?: GalaConnectClient;

  constructor(configManager?: ConfigManager) {
    this.configManager = configManager ?? new ConfigManager();
  }

  async initialize(): Promise<void> {
    const networks = this.configManager.getNetworksConfig();
    logger.info('BridgeManager initialized', {
      galaRpc: networks.galaChain.rpcUrl,
      solRpc: networks.solana.rpcUrl,
    });

    const baseUrl = process.env.GALA_CONNECT_BASE_URL || 'https://connect.gala.com';
    const galachainApi = process.env.GALACHAIN_API_BASE_URL || 'https://gateway-mainnet.galachain.com/';
    const wallet = process.env.GALACHAIN_WALLET_ADDRESS || '';
    this.client = new GalaConnectClient(baseUrl, galachainApi, wallet);
    logger.info('GalaConnect client ready', { baseUrl, galachainApi, walletPresent: Boolean(wallet) });
  }

  async estimateFee(symbol: string, destination: 'Solana'): Promise<BridgeFeeEstimate> {
    if (!this.client) throw new Error('BridgeManager not initialized');
    const descriptor = await this.resolveBridgeTokenDescriptor(symbol);
    const fee = await this.client.fetchBridgeFee({ chainId: 'Solana', bridgeToken: descriptor });
    const totalGala = new BigNumber(fee.estimatedTotalTxFeeInGala);
    const galachainApi = process.env.GALACHAIN_API_BASE_URL || 'https://api.galachain.io';
    const feePath = process.env.GALA_FEE_PATH || '/v1/bridge/fee';
    const feeUrl = new URL(feePath, galachainApi).toString();
    return {
      chain: 'Solana',
      feeToken: 'GALA',
      estimatedTotalFeeGala: totalGala,
      details: {
        chainId: 'Solana',
        descriptor: `${descriptor.collection}|${descriptor.category}|${descriptor.type}|${descriptor.additionalKey}`,
        units: fee.estimatedTxFeeUnitsTotal,
        pricePerUnit: fee.estimatedPricePerTxFeeUnit,
        totalGala: fee.estimatedTotalTxFeeInGala,
        galaDecimals: fee.galaDecimals,
        timestamp: fee.timestamp,
        signingIdentity: fee.signingIdentity,
        feeUrl,
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



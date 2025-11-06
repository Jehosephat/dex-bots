import { resolveGalaEndpoints } from './galaEndpoints';

export interface BridgeTokenDescriptor {
  collection: string;
  category: string;
  type: string;
  additionalKey: string;
}

export interface BridgeConfigurationToken extends BridgeTokenDescriptor {
  symbol: string;
  decimals: number;
  verified?: boolean;
  channel?: string;
}

interface BridgeFeeResponse {
  bridgeToken: BridgeTokenDescriptor;
  bridgeTokenIsNonFungible: boolean;
  estimatedPricePerTxFeeUnit: string;
  estimatedTotalTxFeeInExternalToken: string;
  estimatedTotalTxFeeInGala: string;
  estimatedTxFeeUnitsTotal: string;
  galaDecimals: number;
  timestamp: number | string;
  signingIdentity: string;
  signature: string;
}

export class GalaConnectHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly responseBody: unknown,
    public readonly url?: string,
  ) {
    super(
      `GalaConnect ${path} failed with ${status}` +
        (url ? ` (url: ${url})` : '') +
        (responseBody ? `: ${JSON.stringify(responseBody)}` : ''),
    );
  }
}

export class GalaConnectClient {
  constructor(
    private readonly baseUrl: string,
    private readonly galachainBaseUrl: string,
    private readonly walletAddress: string,
  ) {}

  async getBridgeConfigurations(searchPrefix: string): Promise<BridgeConfigurationToken[]> {
    const ep = resolveGalaEndpoints();
    const url = new URL(ep.pathBridgeConfigs, this.baseUrl);
    url.searchParams.set('searchprefix', searchPrefix);
    const fullUrl = url.toString();
    const res = await this.request(fullUrl, { method: 'GET' });
    const text = await res.text();
    const parsed = this.tryParse(text);
    if (!res.ok) throw new GalaConnectHttpError(res.status, url.pathname, parsed ?? text, fullUrl);
    if (!parsed || typeof parsed !== 'object') throw new GalaConnectHttpError(500, url.pathname, text, fullUrl);
    const root = parsed as { data?: { tokens?: BridgeConfigurationToken[] } };
    const tokens = root.data?.tokens;
    if (!tokens) throw new GalaConnectHttpError(500, url.pathname, parsed, fullUrl);
    return tokens;
  }

  async fetchBridgeFee(payload: { chainId: string; bridgeToken: BridgeTokenDescriptor }): Promise<BridgeFeeResponse> {
    const ep = resolveGalaEndpoints();
    if (ep.urlBridgeFee) {
      const u = new URL(ep.urlBridgeFee);
      return this.postJson(u.pathname + u.search, payload, `${u.protocol}//${u.host}`);
    }
    return this.postJson(ep.pathBridgeFee, payload, ep.dexApiBaseUrl);
  }

  async getBridgeStatus(hash: string): Promise<unknown> {
    const ep = resolveGalaEndpoints();
    if (ep.urlBridgeStatus) {
      const u = new URL(ep.urlBridgeStatus);
      u.searchParams.set('hash', hash);
      const res = await this.request(u.toString(), { method: 'GET' });
      const text = await res.text();
      const parsed = this.tryParse(text);
      if (!res.ok) throw new GalaConnectHttpError(res.status, u.pathname + u.search, parsed ?? text, u.toString());
      return parsed as unknown;
    }
    const url = new URL(ep.pathBridgeStatus, ep.dexApiBaseUrl);
    url.searchParams.set('hash', hash);
    const fullUrl = url.toString();
    const res = await this.request(fullUrl, { method: 'GET' });
    const text = await res.text();
    const parsed = this.tryParse(text);
    if (!res.ok) throw new GalaConnectHttpError(res.status, url.pathname + url.search, parsed ?? text, fullUrl);
    return parsed as unknown;
  }

  async fetchBalances(): Promise<unknown> {
    const ep = resolveGalaEndpoints();
    const fullUrlOverride = ep.urlFetchBalances;
    const path = ep.pathFetchBalances;
    const baseForBalances = process.env.GC_BALANCES_BASE_URL || ep.dexBaseUrl;
    const body = { owner: this.walletAddress } as const;
    if (fullUrlOverride) {
      const url = new URL(fullUrlOverride);
      return this.postJson(url.pathname + url.search, body, `${url.protocol}//${url.host}`);
    }
    return this.postJson(path, body, baseForBalances);
  }

  async requestBridgeOut(payload: Record<string, unknown>): Promise<unknown> {
    const ep = resolveGalaEndpoints();
    // Use dexApiBaseUrl for bridge operations instead of connectBaseUrl
    return this.postJson(ep.pathRequestBridgeOut, payload, ep.dexApiBaseUrl);
  }

  async bridgeTokenOut(payload: Record<string, unknown>): Promise<unknown> {
    const ep = resolveGalaEndpoints();
    // Use dexApiBaseUrl for bridge operations instead of connectBaseUrl
    return this.postJson(ep.pathBridgeTokenOut, payload, ep.dexApiBaseUrl);
  }

  async registerBridgeTransaction(payload: Record<string, unknown>): Promise<unknown> {
    const ep = resolveGalaEndpoints();
    // Some deployments expose registration on connect base
    const path = '/v1/bridge/transaction';
    return this.postJson(path, payload, ep.connectBaseUrl);
  }

  private async postJson<T>(path: string, body: unknown, baseUrl = this.baseUrl): Promise<T> {
    const url = new URL(path, baseUrl);
    const fullUrl = url.toString();
    const res = await this.request(fullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
    });
    const text = await res.text();
    const parsed = text ? this.tryParse(text) : undefined;
    if (!res.ok) throw new GalaConnectHttpError(res.status, path, parsed ?? text, fullUrl);
    return (parsed as T)!;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
      'X-Wallet-Address': this.walletAddress,
    };
    return fetch(url, { ...init, headers });
  }

  private tryParse(text: string): unknown {
    try { return JSON.parse(text); } catch { return undefined; }
  }
  private async safeJson(res: Response): Promise<unknown> {
    try { return await res.json(); } catch { return undefined; }
  }
}



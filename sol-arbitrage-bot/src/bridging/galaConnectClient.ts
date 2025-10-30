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
    const url = new URL('/v1/connect/bridge-configurations', this.baseUrl);
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
    const path = process.env.GALA_FEE_PATH || '/v1/bridge/fee';
    return this.postJson(path, payload, this.galachainBaseUrl);
  }

  async getBridgeStatus(hash: string): Promise<unknown> {
    const path = process.env.GALA_STATUS_PATH || '/v1/bridge/status';
    const url = new URL(path, this.galachainBaseUrl);
    url.searchParams.set('hash', hash);
    const fullUrl = url.toString();
    const res = await this.request(fullUrl, { method: 'GET' });
    const text = await res.text();
    const parsed = this.tryParse(text);
    if (!res.ok) throw new GalaConnectHttpError(res.status, url.pathname + url.search, parsed ?? text, fullUrl);
    return parsed as unknown;
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



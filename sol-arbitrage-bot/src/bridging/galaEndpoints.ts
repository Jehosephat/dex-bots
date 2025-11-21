export interface GalaEndpointsConfig {
  connectBaseUrl: string;
  dexApiBaseUrl: string; // previously GC_API_BASE_URL
  dexBaseUrl: string; // gala swap/api host for balances and future swaps
  galaConnectBaseUrl: string; // GalaConnect API base URL
  // Paths (GalaConnect API)
  pathRequestBridgeToken: string;
  pathBridgeToken: string;
  pathBridgeConfigs: string;
  pathBridgeStatus: string; // GET ?hash=
  pathBridgeFee: string; // POST
  pathFetchBalances: string; // POST { owner }
  pathGetPublicKey: string; // POST GetPublicKey
  // Legacy paths (deprecated, kept for backward compatibility)
  pathRequestBridgeOut: string;
  pathBridgeTokenOut: string;
  // Absolute overrides (optional)
  urlFetchBalances?: string;
  urlBridgeStatus?: string;
  urlBridgeFee?: string;
}

export function resolveGalaEndpoints(): GalaEndpointsConfig {
  const connectBaseUrl = process.env.GC_CONNECT_BASE_URL || 'https://connect.gala.com';
  const dexApiBaseUrl = process.env.GC_DEX_API_BASE_URL || 'https://dex-api-platform-dex-prod-gala.gala.com';
  const dexBaseUrl = process.env.GC_DEX_BASE_URL || 'https://api-galaswap.gala.com';
  const galaConnectBaseUrl = process.env.GC_GALACONNECT_BASE_URL || 'https://api-galaswap.gala.com';

  // GalaConnect API paths
  const pathRequestBridgeToken = process.env.GC_PATH_REQUEST_BRIDGE_TOKEN || '/v1/RequestBridgeToken';
  const pathBridgeToken = process.env.GC_PATH_BRIDGE_TOKEN || '/v1/BridgeToken';
  const pathBridgeConfigs = process.env.GC_PATH_BRIDGE_CONFIGS || '/v1/connect/bridge-configurations';
  const pathBridgeStatus = process.env.GC_PATH_BRIDGE_STATUS || '/v1/bridge/status';
  const pathBridgeFee = process.env.GC_PATH_BRIDGE_FEE || '/v1/bridge/fee';
  const pathFetchBalances = process.env.GC_PATH_FETCH_BALANCES || '/galachain/api/asset/token-contract/FetchBalances';
  const pathGetPublicKey = process.env.GC_PATH_GET_PUBLIC_KEY || '/galachain/api/asset/public-key-contract/GetPublicKey';

  // Legacy paths (deprecated)
  const pathRequestBridgeOut = process.env.GC_PATH_REQUEST_BRIDGE_OUT || '/v1/RequestTokenBridgeOut';
  const pathBridgeTokenOut = process.env.GC_PATH_BRIDGE_TOKEN_OUT || '/v1/BridgeTokenOut';

  const urlFetchBalances = process.env.GC_URL_FETCH_BALANCES;
  const urlBridgeStatus = process.env.GC_URL_BRIDGE_STATUS;
  const urlBridgeFee = process.env.GC_URL_BRIDGE_FEE;

  return {
    connectBaseUrl,
    dexApiBaseUrl,
    dexBaseUrl,
    galaConnectBaseUrl,
    pathRequestBridgeToken,
    pathBridgeToken,
    pathBridgeConfigs,
    pathBridgeStatus,
    pathBridgeFee,
    pathFetchBalances,
    pathGetPublicKey,
    pathRequestBridgeOut,
    pathBridgeTokenOut,
    urlFetchBalances,
    urlBridgeStatus,
    urlBridgeFee,
  };
}



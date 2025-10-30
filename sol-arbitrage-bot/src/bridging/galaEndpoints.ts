export interface GalaEndpointsConfig {
  connectBaseUrl: string;
  dexApiBaseUrl: string; // previously GC_API_BASE_URL
  dexBaseUrl: string; // gala swap/api host for balances and future swaps
  // Paths
  pathRequestBridgeOut: string;
  pathBridgeTokenOut: string;
  pathBridgeConfigs: string;
  pathBridgeStatus: string; // GET ?hash=
  pathBridgeFee: string; // POST
  pathFetchBalances: string; // POST { owner }
  // Absolute overrides (optional)
  urlFetchBalances?: string;
  urlBridgeStatus?: string;
  urlBridgeFee?: string;
}

export function resolveGalaEndpoints(): GalaEndpointsConfig {
  const connectBaseUrl = process.env.GC_CONNECT_BASE_URL || 'https://connect.gala.com';
  const dexApiBaseUrl = process.env.GC_DEX_API_BASE_URL || 'https://dex-api-platform-dex-prod-gala.gala.com';
  const dexBaseUrl = process.env.GC_DEX_BASE_URL || 'https://api-galaswap.gala.com';

  const pathRequestBridgeOut = process.env.GC_PATH_REQUEST_BRIDGE_OUT || '/v1/RequestTokenBridgeOut';
  const pathBridgeTokenOut = process.env.GC_PATH_BRIDGE_TOKEN_OUT || '/v1/BridgeTokenOut';
  const pathBridgeConfigs = process.env.GC_PATH_BRIDGE_CONFIGS || '/v1/connect/bridge-configurations';
  const pathBridgeStatus = process.env.GC_PATH_BRIDGE_STATUS || '/v1/bridge/status';
  const pathBridgeFee = process.env.GC_PATH_BRIDGE_FEE || '/v1/bridge/fee';
  const pathFetchBalances = process.env.GC_PATH_FETCH_BALANCES || '/galachain/api/asset/token-contract/FetchBalances';

  const urlFetchBalances = process.env.GC_URL_FETCH_BALANCES;
  const urlBridgeStatus = process.env.GC_URL_BRIDGE_STATUS;
  const urlBridgeFee = process.env.GC_URL_BRIDGE_FEE;

  return {
    connectBaseUrl,
    dexApiBaseUrl,
    dexBaseUrl,
    pathRequestBridgeOut,
    pathBridgeTokenOut,
    pathBridgeConfigs,
    pathBridgeStatus,
    pathBridgeFee,
    pathFetchBalances,
    urlFetchBalances,
    urlBridgeStatus,
    urlBridgeFee,
  };
}



import axios from 'axios';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { keccak256 } = require('js-sha3');

const GRAPHQL_ENDPOINT = 'https://int-query-api-chain-platform-prod-chain-platform-eks.prod.galachain.com/graphql';

export async function getPoolData(token0Key: string, token1Key: string, fee: number) {
  // Get the specific pool using the targeted query
  const pool = await getSpecificPool(token0Key, token1Key, fee);
  
  if (!pool) {
    throw new Error(`Pool not found for tokens ${token0Key}/${token1Key} with fee ${fee}`);
  }

  const {poolAlias, poolHash} = getPoolAliasFromKeys(pool);
  const poolBalances = await getTokenBalance(poolAlias);
  const poolTicks = await getPoolTicks(poolHash);
  const token0Decimals = await getTokenDecimals(token0Key);
  const token1Decimals = await getTokenDecimals(token1Key);

  return {
    pool: pool,
    poolBalances: poolBalances,
    poolTicks: poolTicks,
    token0Decimals: token0Decimals,
    token1Decimals: token1Decimals
  };
}

function getPoolAliasFromKeys(poolData: any) {
  const token0 = poolData.token0; // 'GUSDC$Unit$none$none'
  const token1 = poolData.token1; // 'GWETH$Unit$none$none'
  const fee = poolData.fee; // '10000'

  // Create hash string (comma-separated)
  const hashingString = [token0, token1, fee].join(',');

  // Generate hash
  const poolHash = keccak256(hashingString);

  // Generate pool alias
  const poolAlias = `service|pool_${poolHash}`;
  return {poolAlias, poolHash};
}

// Get Specific Pool
const specificPoolQuery = `
query GetSpecificPool($token0Key: String!, $token1Key: String!, $fee: String!) {
  allChainObjects(
    condition: {
      key0: "GCDXCHLPL",
      key1: $token0Key,
      key2: $token1Key,
      key3: $fee
    }
  ) {
    edges {
      node {
        id
        key0
        key1
        key2
        key3
        value
      }
    }
  }
}`;

export async function getSpecificPool(token0Key: string, token1Key: string, fee: number) {
  const { data } = await axios.post(GRAPHQL_ENDPOINT, {
    query: specificPoolQuery,
    variables: {
      token0Key,
      token1Key,
      fee: fee.toString()
    }
  }, {
    headers: {
      'Content-Type': 'application/json'
    }
  });
  
  if (!data.data?.allChainObjects?.edges) {
    throw new Error('Invalid response format');
  }

  // Return the first (and should be only) pool that matches
  return JSON.parse(data.data.allChainObjects.edges[0].node.value) || null;
}

// Pool Balances
const balanceQuery = `
query GetTokenBalance($owner: String!) {
  allBalances(
    condition: {
      owner: $owner
    }
  ) {
    edges {
      node {
        quantity
        collection
        category
        additionalKey
        type
      }
    }
  }
}
`;

export async function getTokenBalance(owner: string) {
  const { data } = await axios.post(GRAPHQL_ENDPOINT, {
    query: balanceQuery,
    variables: { owner }
  });
  
  // Extract quantity from the response
  const edges = data.data.allBalances?.edges || [];
  if (edges.length > 0) {
    return edges;
  }
  return []; // Return 0 if no balance found
}

// Get All Pools
const poolTicksQuery = `
query GetPoolTicks($poolHash: String!) {
  allChainObjects(
    condition: {key0: "GCDXCHLTDA", key1: $poolHash}
  ) {
    edges {
      node {
        id
        key0
        key1
        key2
        value
      }
    }
  }
}`;

export async function getPoolTicks(poolHash: string) {
  const { data } = await axios.post(GRAPHQL_ENDPOINT, {
    query: poolTicksQuery,
    variables: { poolHash }
  }, {
    headers: {
      'Content-Type': 'application/json'
    }
  });
  
  if (!data.data?.allChainObjects?.edges) {
    throw new Error('Invalid response format');
  }

  return data.data.allChainObjects.edges;
}

const tokenDecimalsQuery = `
query GetTokenDecimals($collection: String!) {
  allChainObjects(
    condition: {key0: "GCTI", key1: $collection}
  ) {
    edges {
      node {
        id
        key0
        key1
        key2
        value
      }
    }
  }
}`;

export async function getTokenDecimals(tokenKey: string) {
  const collection = tokenKey.split('$')[0];
  const { data } = await axios.post(GRAPHQL_ENDPOINT, {
    query: tokenDecimalsQuery,
    variables: { collection }
  });
  if (!data.data?.allChainObjects?.edges) {
    throw new Error('Invalid response format');
  }

  return JSON.parse(data.data.allChainObjects.edges[0].node.value).decimals;
}



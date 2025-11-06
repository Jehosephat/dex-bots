import { Wallet, Signature } from 'ethers';

// Domain and types mirrored from bridge_round_trip for Gala bridge payload
export const GALA_BRIDGE_TYPED_DATA_DOMAIN = {
  name: 'GalaConnect',
  chainId: 1,
};

// Legacy typed data types (uses galaExchangeRate)
const LEGACY_TYPED_DATA_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  GalaTransaction: [
    { name: 'destinationChainId', type: 'uint256' },
    { name: 'destinationChainTxFee', type: 'destinationChainTxFee' },
    { name: 'quantity', type: 'string' },
    { name: 'recipient', type: 'string' },
    { name: 'tokenInstance', type: 'tokenInstance' },
    { name: 'uniqueKey', type: 'string' },
  ],
  destinationChainTxFee: [
    { name: 'bridgeToken', type: 'bridgeToken' },
    { name: 'bridgeTokenIsNonFungible', type: 'bool' },
    { name: 'estimatedPricePerTxFeeUnit', type: 'string' },
    { name: 'estimatedTotalTxFeeInExternalToken', type: 'string' },
    { name: 'estimatedTotalTxFeeInGala', type: 'string' },
    { name: 'estimatedTxFeeUnitsTotal', type: 'string' },
    { name: 'galaDecimals', type: 'uint256' },
    { name: 'galaExchangeRate', type: 'galaExchangeRate' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'signingIdentity', type: 'string' },
    { name: 'signature', type: 'string' },
  ],
  bridgeToken: [
    { name: 'collection', type: 'string' },
    { name: 'category', type: 'string' },
    { name: 'type', type: 'string' },
    { name: 'additionalKey', type: 'string' },
  ],
  galaExchangeRate: [
    { name: 'identity', type: 'string' },
    { name: 'oracle', type: 'string' },
    { name: 'source', type: 'string' },
    { name: 'sourceUrl', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'baseToken', type: 'baseToken' },
    { name: 'exchangeRate', type: 'string' },
    { name: 'externalQuoteToken', type: 'externalQuoteToken' },
  ],
  baseToken: [
    { name: 'collection', type: 'string' },
    { name: 'category', type: 'string' },
    { name: 'type', type: 'string' },
    { name: 'additionalKey', type: 'string' },
    { name: 'instance', type: 'string' },
  ],
  externalQuoteToken: [
    { name: 'name', type: 'string' },
    { name: 'symbol', type: 'string' },
  ],
  tokenInstance: [
    { name: 'collection', type: 'string' },
    { name: 'category', type: 'string' },
    { name: 'type', type: 'string' },
    { name: 'additionalKey', type: 'string' },
    { name: 'instance', type: 'string' },
  ],
};

// Cross rate typed data types (uses galaExchangeCrossRate)
const CROSS_RATE_TYPED_DATA_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  GalaTransaction: [
    { name: 'destinationChainId', type: 'uint256' },
    { name: 'destinationChainTxFee', type: 'destinationChainTxFee' },
    { name: 'quantity', type: 'string' },
    { name: 'recipient', type: 'string' },
    { name: 'tokenInstance', type: 'tokenInstance' },
    { name: 'uniqueKey', type: 'string' },
  ],
  destinationChainTxFee: [
    { name: 'bridgeToken', type: 'bridgeToken' },
    { name: 'bridgeTokenIsNonFungible', type: 'bool' },
    { name: 'estimatedPricePerTxFeeUnit', type: 'string' },
    { name: 'estimatedTotalTxFeeInExternalToken', type: 'string' },
    { name: 'estimatedTotalTxFeeInGala', type: 'string' },
    { name: 'estimatedTxFeeUnitsTotal', type: 'string' },
    { name: 'galaDecimals', type: 'uint256' },
    { name: 'galaExchangeCrossRate', type: 'galaExchangeCrossRate' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'signingIdentity', type: 'string' },
    { name: 'signature', type: 'string' },
  ],
  bridgeToken: [
    { name: 'collection', type: 'string' },
    { name: 'category', type: 'string' },
    { name: 'type', type: 'string' },
    { name: 'additionalKey', type: 'string' },
  ],
  galaExchangeCrossRate: [
    { name: 'baseTokenCrossRate', type: 'baseTokenCrossRate' },
    { name: 'crossRate', type: 'string' },
    { name: 'externalCrossRateToken', type: 'externalCrossRateToken' },
    { name: 'identity', type: 'string' },
    { name: 'oracle', type: 'string' },
    { name: 'quoteTokenCrossRate', type: 'quoteTokenCrossRate' },
    { name: 'source', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
  baseTokenCrossRate: [
    { name: 'identity', type: 'string' },
    { name: 'oracle', type: 'string' },
    { name: 'source', type: 'string' },
    { name: 'sourceUrl', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'exchangeRate', type: 'string' },
    { name: 'externalBaseToken', type: 'externalBaseToken' },
    { name: 'externalQuoteToken', type: 'externalQuoteToken' },
    { name: 'signature', type: 'string' },
  ],
  externalBaseToken: [
    { name: 'name', type: 'string' },
    { name: 'symbol', type: 'string' },
  ],
  externalQuoteToken: [
    { name: 'name', type: 'string' },
    { name: 'symbol', type: 'string' },
  ],
  externalCrossRateToken: [
    { name: 'name', type: 'string' },
    { name: 'symbol', type: 'string' },
  ],
  quoteTokenCrossRate: [
    { name: 'identity', type: 'string' },
    { name: 'oracle', type: 'string' },
    { name: 'source', type: 'string' },
    { name: 'sourceUrl', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'baseToken', type: 'baseToken' },
    { name: 'exchangeRate', type: 'string' },
    { name: 'externalQuoteToken', type: 'externalQuoteToken' },
    { name: 'signature', type: 'string' },
  ],
  baseToken: [
    { name: 'collection', type: 'string' },
    { name: 'category', type: 'string' },
    { name: 'type', type: 'string' },
    { name: 'additionalKey', type: 'string' },
    { name: 'instance', type: 'string' },
  ],
  tokenInstance: [
    { name: 'collection', type: 'string' },
    { name: 'category', type: 'string' },
    { name: 'type', type: 'string' },
    { name: 'additionalKey', type: 'string' },
    { name: 'instance', type: 'string' },
  ],
};

export function getGalaBridgeTypedDataTypes(hasCrossRate: boolean) {
  // Return one or the other, never both - ethers.js requires unambiguous types
  return hasCrossRate ? CROSS_RATE_TYPED_DATA_TYPES : LEGACY_TYPED_DATA_TYPES;
}

export async function signBridgePayload(
  wallet: Wallet,
  payload: Record<string, unknown>,
  hasCrossRate: boolean,
) {
  const types = getGalaBridgeTypedDataTypes(hasCrossRate);
  const signature = await wallet.signTypedData(GALA_BRIDGE_TYPED_DATA_DOMAIN as any, types as any, payload);
  const split = Signature.from(signature);
  return { signature, split };
}



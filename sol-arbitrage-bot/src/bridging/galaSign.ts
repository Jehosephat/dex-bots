import { Wallet, Signature } from 'ethers';

// Domain and types mirrored from bridge_round_trip for Gala bridge payload
export const GALA_BRIDGE_TYPED_DATA_DOMAIN = {
  name: 'GalaTransaction',
  version: '1',
};

export function getGalaBridgeTypedDataTypes(hasCrossRate: boolean) {
  const DestinationChainTxFee = hasCrossRate
    ? [
        { name: 'bridgeToken', type: 'BridgeTokenDescriptor' },
        { name: 'bridgeTokenIsNonFungible', type: 'bool' },
        { name: 'estimatedPricePerTxFeeUnit', type: 'string' },
        { name: 'estimatedTotalTxFeeInExternalToken', type: 'string' },
        { name: 'estimatedTotalTxFeeInGala', type: 'string' },
        { name: 'estimatedTxFeeUnitsTotal', type: 'string' },
        { name: 'galaDecimals', type: 'uint256' },
        { name: 'galaExchangeRate', type: 'GalaExchangeRate' },
        { name: 'timestamp', type: 'uint256' },
        { name: 'signingIdentity', type: 'string' },
        { name: 'signature', type: 'string' },
      ]
    : [
        { name: 'bridgeToken', type: 'BridgeTokenDescriptor' },
        { name: 'bridgeTokenIsNonFungible', type: 'bool' },
        { name: 'estimatedPricePerTxFeeUnit', type: 'string' },
        { name: 'estimatedTotalTxFeeInExternalToken', type: 'string' },
        { name: 'estimatedTotalTxFeeInGala', type: 'string' },
        { name: 'estimatedTxFeeUnitsTotal', type: 'string' },
        { name: 'galaDecimals', type: 'uint256' },
        { name: 'timestamp', type: 'uint256' },
        { name: 'signingIdentity', type: 'string' },
        { name: 'signature', type: 'string' },
      ];

  return {
    GalaTransaction: [
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'destinationChainTxFee', type: 'DestinationChainTxFee' },
      { name: 'quantity', type: 'string' },
      { name: 'recipient', type: 'string' },
      { name: 'tokenInstance', type: 'BridgeTokenInstance' },
      { name: 'uniqueKey', type: 'string' },
    ],
    DestinationChainTxFee,
    BridgeTokenDescriptor: [
      { name: 'collection', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'type', type: 'string' },
      { name: 'additionalKey', type: 'string' },
    ],
    BridgeTokenInstance: [
      { name: 'collection', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'type', type: 'string' },
      { name: 'additionalKey', type: 'string' },
      { name: 'instance', type: 'string' },
    ],
    GalaExchangeRate: [
      { name: 'identity', type: 'string' },
      { name: 'oracle', type: 'string' },
      { name: 'source', type: 'string' },
      { name: 'sourceUrl', type: 'string' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'baseToken', type: 'BridgeTokenInstance' },
      { name: 'exchangeRate', type: 'string' },
      { name: 'externalQuoteToken', type: 'ExternalTokenInfo' },
    ],
    ExternalTokenInfo: [
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
    ],
  } as const;
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



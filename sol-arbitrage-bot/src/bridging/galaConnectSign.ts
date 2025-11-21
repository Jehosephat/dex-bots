import stringify from 'json-stringify-deterministic';
import { ec as EC } from 'elliptic';
import { keccak256 } from 'js-sha3';
import BN from 'bn.js';

const ecSecp256k1 = new EC('secp256k1');

/**
 * Sign a GalaConnect API request using secp256k1 signature on keccak256 hash.
 * This matches the signing mechanism documented in the GalaConnect API.
 * 
 * @param obj - The request object to sign (will be modified to add signature and signerPublicKey)
 * @param privateKey - The private key in hex format (with or without 0x prefix)
 * @param publicKey - The public key in base64 format (will be added to the object)
 * @returns The object with signature and signerPublicKey added
 */
export function signGalaConnectRequest<T extends object>(
  obj: T,
  privateKey: string,
  publicKey: string
): T & { signature: string; signerPublicKey: string } {
  const toSign = { ...obj };

  // Remove signature if it exists (shouldn't, but just in case)
  if ('signature' in toSign) {
    delete (toSign as any).signature;
  }

  // Stringify deterministically (alphabetically ordered)
  const stringToSign = stringify(toSign);
  const stringToSignBuffer = Buffer.from(stringToSign);

  // Calculate keccak256 hash
  const keccak256Hash = Buffer.from(keccak256.digest(stringToSignBuffer));

  // Parse private key (remove 0x prefix if present)
  const privateKeyBuffer = Buffer.from(privateKey.replace(/^0x/, ''), 'hex');

  // Sign the hash
  const signature = ecSecp256k1.sign(keccak256Hash, privateKeyBuffer);

  // Normalize the signature if it's greater than half of order n
  if (signature.s.cmp(ecSecp256k1.curve.n.shrn(1)) > 0) {
    const curveN = ecSecp256k1.curve.n;
    const newS = new BN(curveN).sub(signature.s);
    const newRecoverParam = signature.recoveryParam != null ? 1 - signature.recoveryParam : null;
    signature.s = newS;
    signature.recoveryParam = newRecoverParam;
  }

  // Encode signature as base64 DER
  const signatureString = Buffer.from(signature.toDER()).toString('base64');

  return {
    ...toSign,
    signature: signatureString,
    signerPublicKey: publicKey,
  };
}


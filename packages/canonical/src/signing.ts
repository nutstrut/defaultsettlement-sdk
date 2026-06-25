/**
 * Ed25519 signing envelope for signed normative records.
 *
 * Signature input rule (the signature must NOT cover itself):
 *
 *     signed_core = record without its `signature` block
 *     signature   = Ed25519.sign( JCS(signed_core) )
 *
 * The `signature` block lives as a top-level field on the record and is
 * excluded from the canonical signing input. The canonical signing input is
 * deterministic (`sorted_keys_compact_v0` / JCS over the v0.1 value domain) and
 * documented so an independent verifier can reproduce it.
 *
 * Identity-to-signing-key binding: the envelope carries `key_id`, which MUST
 * equal the record's signer identity, and `public_key`, the signer's Ed25519
 * public key. Verification requires the caller to supply the trusted public key
 * bound to the expected identity. A record whose signature is valid but whose
 * `key_id` or presented public key does not match that identity-bound key FAILS
 * verification. This module does NOT resolve identities to keys — there is no
 * key registry or public key discovery here.
 */

import {
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto'
import { canonicalJson, sha256Hex } from './canonical.js'
import { CanonicalSignatureError } from './errors.js'

export const SIGNATURE_ALG = 'ed25519' as const

/** The signature envelope carried as a top-level `signature` field on a record. */
export interface SignatureBlock {
  alg: typeof SIGNATURE_ALG
  /** Signer identity; MUST equal the record's signer identity field. */
  key_id: string
  /** Signer Ed25519 public key, base64 of the SPKI DER encoding. */
  public_key: string
  /** Base64 Ed25519 signature over `JCS(signed_core)`. */
  signature: string
}

/** A signed record: its canonical core plus the excluded `signature` envelope. */
export type Signed<TCore extends object> = TCore & { signature: SignatureBlock }

/** Generate a fresh Ed25519 keypair (test / fixture / producer convenience). */
export function generateEd25519KeyPair(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync('ed25519')
}

/** Export an Ed25519 public key as base64 SPKI DER (the `public_key` field form). */
export function exportPublicKeyB64(publicKey: KeyObject): string {
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
}

/** Reconstruct an Ed25519 public KeyObject from its base64 SPKI DER form. */
export function importPublicKeyB64(b64: string): KeyObject {
  try {
    return createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' })
  } catch {
    throw new CanonicalSignatureError('signature.public_key is not a valid Ed25519 SPKI public key')
  }
}

/** Strip the `signature` block, returning the canonical signed core. */
export function signedCore<TCore extends object>(record: TCore & { signature?: unknown }): TCore {
  const { signature: _signature, ...core } = record as TCore & { signature?: unknown }
  return core as TCore
}

/** The exact bytes that are signed: `JCS(signed_core)` as a UTF-8 string. */
export function canonicalSigningInput<TCore extends object>(record: TCore & { signature?: unknown }): string {
  return canonicalJson(signedCore(record))
}

/**
 * Digest of the canonical signing input. Stable under any change to the
 * `signature` block alone (the block is excluded), and changes whenever any
 * signed-core field changes.
 */
export function signedPayloadDigest<TCore extends object>(record: TCore & { signature?: unknown }): string {
  return sha256Hex(canonicalSigningInput(record))
}

/**
 * Sign a canonical core, producing `core + { signature }`. `keyId` MUST be the
 * signer identity; callers should pass the record's own identity field so the
 * binding holds.
 */
export function signEnvelope<TCore extends object>(
  core: TCore,
  privateKey: KeyObject,
  keyId: string,
): Signed<TCore> {
  if ('signature' in core) {
    throw new CanonicalSignatureError('cannot sign a record that already carries a signature block')
  }
  const publicKey = createPublicKey(privateKey)
  const message = Buffer.from(canonicalJson(core), 'utf8')
  const signature = edSign(null, message, privateKey)
  return {
    ...core,
    signature: {
      alg: SIGNATURE_ALG,
      key_id: keyId,
      public_key: exportPublicKeyB64(publicKey),
      signature: signature.toString('base64'),
    },
  }
}

export interface VerifyEnvelopeOptions {
  /** Trusted Ed25519 public key bound to {@link expectedKeyId}, resolved out of band. */
  expectedPublicKey: KeyObject
  /** The identity the signature MUST be bound to (the record's signer identity). */
  expectedKeyId: string
}

/**
 * Verify a signed record's envelope and return its canonical core.
 *
 * Enforces identity-to-signing-key binding:
 *   1. `signature.key_id` MUST equal {@link VerifyEnvelopeOptions.expectedKeyId}.
 *   2. `signature.public_key` MUST equal the trusted {@link
 *      VerifyEnvelopeOptions.expectedPublicKey} bound to that identity.
 *   3. The Ed25519 signature MUST verify over `JCS(signed_core)` under that key.
 *
 * A valid signature with a mismatched identity or a non-identity-bound key
 * fails at step 1 or 2 before the cryptographic check even matters. The trusted
 * key is supplied by the caller; this function performs no key discovery.
 */
export function verifyEnvelope<TCore extends object>(
  record: TCore & { signature?: unknown },
  opts: VerifyEnvelopeOptions,
): TCore {
  const sig = (record as { signature?: unknown }).signature
  if (!sig || typeof sig !== 'object') {
    throw new CanonicalSignatureError('record has no signature block')
  }
  const block = sig as Partial<SignatureBlock>
  if (block.alg !== SIGNATURE_ALG) {
    throw new CanonicalSignatureError(`signature.alg must be ${SIGNATURE_ALG}`)
  }
  if (typeof block.key_id !== 'string' || typeof block.public_key !== 'string' || typeof block.signature !== 'string') {
    throw new CanonicalSignatureError('signature block is missing key_id, public_key, or signature')
  }
  // (1) signer identity binding.
  if (block.key_id !== opts.expectedKeyId) {
    throw new CanonicalSignatureError(
      `signature.key_id ${block.key_id} does not match the expected signer identity ${opts.expectedKeyId}`,
    )
  }
  // (2) the presented key must be the identity-bound trusted key.
  const expectedB64 = exportPublicKeyB64(opts.expectedPublicKey)
  if (block.public_key !== expectedB64) {
    throw new CanonicalSignatureError(
      'signing key does not match the trusted public key bound to the signer identity',
    )
  }
  // (3) cryptographic verification over the canonical signing input.
  const core = signedCore(record)
  const message = Buffer.from(canonicalJson(core), 'utf8')
  let ok = false
  try {
    ok = edVerify(null, message, opts.expectedPublicKey, Buffer.from(block.signature, 'base64'))
  } catch {
    ok = false
  }
  if (!ok) {
    throw new CanonicalSignatureError('Ed25519 signature verification failed')
  }
  return core
}

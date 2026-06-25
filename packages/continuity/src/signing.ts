/**
 * Ed25519 signing envelope for continuity-layer normative records.
 *
 * The signing envelope itself is now owned by the neutral
 * `@defaultsettlement/canonical` package so SAR-402, the continuity layer, and
 * future outside verifiers share one signed-record format. This module re-exports
 * those helpers (wrapping the throwing ones so failures surface as
 * {@link ContinuitySignatureError}, the continuity error contract) without
 * changing the signing/verification semantics:
 *
 *     signed_core = record without its `signature` block
 *     signature   = Ed25519.sign( JCS(signed_core) )
 *
 * The `signature` block lives as a top-level field and is excluded from the
 * canonical signing input. Verification enforces identity-to-signing-key
 * binding: `signature.key_id` MUST equal the expected signer identity, the
 * presented `public_key` MUST equal the caller-supplied trusted key for that
 * identity, and only then is the Ed25519 signature checked. The presented key is
 * never trusted by default. The canonical package performs no key discovery.
 */

import { type KeyObject } from 'node:crypto'
import {
  SIGNATURE_ALG,
  generateEd25519KeyPair,
  exportPublicKeyB64,
  importPublicKeyB64 as canonicalImportPublicKeyB64,
  signedCore,
  canonicalSigningInput,
  signedPayloadDigest,
  signEnvelope as canonicalSignEnvelope,
  verifyEnvelope as canonicalVerifyEnvelope,
  CanonicalSignatureError,
  type SignatureBlock,
  type Signed,
  type VerifyEnvelopeOptions,
} from '@defaultsettlement/canonical'
import { ContinuitySignatureError } from './errors.js'

// Pure helpers re-exported unchanged.
export { SIGNATURE_ALG, generateEd25519KeyPair, exportPublicKeyB64, signedCore, canonicalSigningInput, signedPayloadDigest }
export type { SignatureBlock, Signed, VerifyEnvelopeOptions }

function asContinuitySignatureError<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof CanonicalSignatureError) throw new ContinuitySignatureError(err.message)
    throw err
  }
}

/** Reconstruct an Ed25519 public KeyObject from its base64 SPKI DER form. */
export function importPublicKeyB64(b64: string): KeyObject {
  return asContinuitySignatureError(() => canonicalImportPublicKeyB64(b64))
}

/** Sign a canonical core, producing `core + { signature }`. */
export function signEnvelope<TCore extends object>(
  core: TCore,
  privateKey: KeyObject,
  keyId: string,
): Signed<TCore> {
  return asContinuitySignatureError(() => canonicalSignEnvelope(core, privateKey, keyId))
}

/** Verify a signed record's envelope and return its canonical core. */
export function verifyEnvelope<TCore extends object>(
  record: TCore & { signature?: unknown },
  opts: VerifyEnvelopeOptions,
): TCore {
  return asContinuitySignatureError(() => canonicalVerifyEnvelope<TCore>(record, opts))
}

/**
 * Ed25519 signing envelope for the key-bindings layer, plus the
 * publication-key fingerprint helper.
 *
 * The signing envelope is owned by the neutral `@defaultsettlement/canonical`
 * package, so an Agent Key Binding Assertion uses the SAME signed-record format
 * as continuity / outcome records — there is no second signing format:
 *
 *     signed_core = document without its `signature` block
 *     signature   = Ed25519.sign( JCS(signed_core) )
 *
 * This module re-exports those helpers (wrapping the throwing ones so failures
 * surface as {@link KeyBindingSignatureError}) and adds the publication-key
 * fingerprint helper that is specific to this package.
 */

import { createPublicKey, type KeyObject } from 'node:crypto'
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
  sha256Hex,
  CanonicalSignatureError,
  type SignatureBlock,
  type Signed,
  type VerifyEnvelopeOptions,
} from '@defaultsettlement/canonical'
import { KeyBindingSignatureError } from './errors.js'

// Pure helpers re-exported unchanged.
export { SIGNATURE_ALG, generateEd25519KeyPair, exportPublicKeyB64, signedCore, canonicalSigningInput, signedPayloadDigest }
export type { SignatureBlock, Signed, VerifyEnvelopeOptions }

function asKeyBindingSignatureError<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof CanonicalSignatureError) throw new KeyBindingSignatureError(err.message)
    throw err
  }
}

/** Reconstruct an Ed25519 public KeyObject from its base64 SPKI DER form. */
export function importPublicKeyB64(b64: string): KeyObject {
  return asKeyBindingSignatureError(() => canonicalImportPublicKeyB64(b64))
}

/** Sign a canonical core, producing `core + { signature }`. */
export function signEnvelope<TCore extends object>(
  core: TCore,
  privateKey: KeyObject,
  keyId: string,
): Signed<TCore> {
  return asKeyBindingSignatureError(() => canonicalSignEnvelope(core, privateKey, keyId))
}

/** Verify a signed record's envelope and return its canonical core. */
export function verifyEnvelope<TCore extends object>(
  record: TCore & { signature?: unknown },
  opts: VerifyEnvelopeOptions,
): TCore {
  return asKeyBindingSignatureError(() => canonicalVerifyEnvelope<TCore>(record, opts))
}

/**
 * Compute the publication-key fingerprint as `sha256:<64 lowercase hex>` over
 * the RAW SPKI DER public key bytes.
 *
 * Encoding rule (do not deviate): the hash is taken over the DER bytes
 * themselves, NOT over the base64 string and NOT over any other encoding.
 *   - `KeyObject`  -> export as SPKI DER bytes and hash those bytes.
 *   - `string`     -> interpreted as base64 SPKI DER; base64-decode to the raw
 *                     DER bytes, then hash those bytes.
 */
export function publicationKeyFingerprint(publicKey: KeyObject | string): string {
  let der: Buffer
  if (typeof publicKey === 'string') {
    der = Buffer.from(publicKey, 'base64')
  } else {
    der = publicKey.export({ type: 'spki', format: 'der' })
  }
  return sha256Hex(der)
}

/** Convenience: derive the Ed25519 public key from a private key. */
export function publicKeyFromPrivate(privateKey: KeyObject): KeyObject {
  return createPublicKey(privateKey)
}

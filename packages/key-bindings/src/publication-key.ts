/**
 * Default Settlement publication-key document
 * (schema_id: ds.defaultsettlement_publication_key.v0.1).
 *
 * This is a minimal anchor / reference document naming the Ed25519 public key
 * that signs Agent Key Binding Assertions. It is NOT signed in v0.1: it is an
 * anchor a verifier pins (or compares against the served well-known document),
 * not a normative signed record.
 *
 * It is NOT a certificate, NOT a certificate authority artifact, and carries no
 * revocation, rotation, or status semantics.
 */

import { KeyBindingRecordError } from './errors.js'
import { validatePublicationKeyFingerprint } from './canonical.js'
import { importPublicKeyB64, publicationKeyFingerprint } from './signing.js'

export const DEFAULTSETTLEMENT_PUBLICATION_KEY_SCHEMA_ID = 'ds.defaultsettlement_publication_key.v0.1' as const

/** The single Default Settlement publisher identity used across this package. */
export const PUBLISHER_ID = 'publisher:defaultsettlement' as const

/** Minimal publication-key anchor / reference document. Unsigned in v0.1. */
export interface DefaultSettlementPublicationKey {
  schema_id: typeof DEFAULTSETTLEMENT_PUBLICATION_KEY_SCHEMA_ID
  publisher_id: typeof PUBLISHER_ID
  key_alg: 'ed25519'
  /** Base64 SPKI DER of the publication Ed25519 public key. */
  public_key: string
  /** `sha256:<hex>` over the RAW SPKI DER bytes of {@link public_key}. */
  publication_key_fingerprint: string
}

/**
 * Validate a publication-key document. Checks the exact schema_id, publisher,
 * key algorithm, a parseable Ed25519 SPKI DER public key, a well-formed
 * fingerprint, AND that the fingerprint actually matches the public key.
 */
export function validatePublicationKeyDocument(doc: unknown): DefaultSettlementPublicationKey {
  if (doc == null || typeof doc !== 'object') {
    throw new KeyBindingRecordError('publication-key document must be an object')
  }
  const d = doc as Record<string, unknown>
  if (d.schema_id !== DEFAULTSETTLEMENT_PUBLICATION_KEY_SCHEMA_ID) {
    throw new KeyBindingRecordError(`schema_id must be exactly ${DEFAULTSETTLEMENT_PUBLICATION_KEY_SCHEMA_ID}`)
  }
  if (d.publisher_id !== PUBLISHER_ID) {
    throw new KeyBindingRecordError(`publisher_id must be exactly ${PUBLISHER_ID}`)
  }
  if (d.key_alg !== 'ed25519') {
    throw new KeyBindingRecordError("key_alg must be 'ed25519'")
  }
  if (typeof d.public_key !== 'string' || d.public_key.trim() === '') {
    throw new KeyBindingRecordError('public_key is required and must be a base64 SPKI DER string')
  }
  // Must be a parseable Ed25519 SPKI DER public key.
  let recomputed: string
  try {
    importPublicKeyB64(d.public_key)
    recomputed = publicationKeyFingerprint(d.public_key)
  } catch {
    throw new KeyBindingRecordError('public_key is not a valid Ed25519 SPKI DER public key')
  }
  validatePublicationKeyFingerprint(d.publication_key_fingerprint)
  if (d.publication_key_fingerprint !== recomputed) {
    throw new KeyBindingRecordError(
      'publication_key_fingerprint does not match the SHA-256 of the public key SPKI DER bytes',
    )
  }
  return {
    schema_id: DEFAULTSETTLEMENT_PUBLICATION_KEY_SCHEMA_ID,
    publisher_id: PUBLISHER_ID,
    key_alg: 'ed25519',
    public_key: d.public_key,
    publication_key_fingerprint: d.publication_key_fingerprint,
  }
}

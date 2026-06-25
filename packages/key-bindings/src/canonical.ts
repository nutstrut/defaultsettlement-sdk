/**
 * Canonicalization + identity validators for the key-bindings layer.
 *
 * Dependency direction: this package depends ONLY on
 * `@defaultsettlement/canonical`. It MUST NOT import from
 * `@defaultsettlement/sar-402` or `@defaultsettlement/continuity`. The shared
 * deterministic-serialization, digest, and `agent:` identity primitives live in
 * the neutral canonical package. This module re-exports those primitives and
 * wraps the validators so they throw {@link KeyBindingRecordError}, keeping the
 * key-bindings error contract.
 */

import {
  canonicalJson,
  sha256Hex,
  AGENT_ID_RE,
  SHA256_DIGEST_RE,
  validateAgentId as canonicalValidateAgentId,
  CanonicalValidationError,
} from '@defaultsettlement/canonical'
import { KeyBindingRecordError } from './errors.js'

// Compatibility re-exports.
export { canonicalJson, sha256Hex, AGENT_ID_RE, SHA256_DIGEST_RE }

/** A `sha256:<64 lowercase hex>` publication-key fingerprint pattern. */
export const PUBLICATION_KEY_FINGERPRINT_RE = SHA256_DIGEST_RE

/**
 * Validate a provisional `agent:` identity. Shared scheme with the canonical
 * package — see {@link AGENT_ID_RE}. Throws {@link KeyBindingRecordError} so the
 * key-bindings error contract is unchanged.
 */
export function validateAgentId(value: unknown, field = 'agent_id'): string {
  try {
    return canonicalValidateAgentId(value, field)
  } catch (err) {
    if (err instanceof CanonicalValidationError) throw new KeyBindingRecordError(err.message)
    throw err
  }
}

/** Validate a `sha256:<64 lowercase hex>` fingerprint string. Returns the value. */
export function validatePublicationKeyFingerprint(value: unknown, field = 'publication_key_fingerprint'): string {
  if (typeof value !== 'string' || !PUBLICATION_KEY_FINGERPRINT_RE.test(value)) {
    throw new KeyBindingRecordError(
      `${field} must be a sha256:<64 lowercase hex> fingerprint; got ${String(value)}`,
    )
  }
  return value
}

/**
 * Validate an ISO-ish timestamp string used for `published_at`. Intentionally
 * lightweight: a non-empty string that `Date.parse` accepts. Not overbuilt.
 */
export function validateTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || Number.isNaN(Date.parse(value))) {
    throw new KeyBindingRecordError(`${field} is required and must be an ISO-8601 / RFC 3339 timestamp; got ${String(value)}`)
  }
  return value
}

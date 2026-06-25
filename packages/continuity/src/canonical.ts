/**
 * Canonicalization + identity validators for the continuity layer.
 *
 * Cross-package boundary: `packages/continuity/` is a sibling / upper
 * composition layer to SAR-402, NOT a child of it. It MUST NOT import
 * SAR-owned implementation details from `packages/sar-402/`. The shared
 * deterministic-serialization, digest, and `agent:` identity / `action_ref`
 * primitives now live in the neutral `@defaultsettlement/canonical` package,
 * which both this layer and SAR-402 depend on. This module re-exports those
 * primitives (and wraps the validators so they keep throwing
 * {@link ContinuityRecordError}) plus the continuity-only timestamp validator.
 *
 * Canonicalization is the repo's `sorted_keys_compact_v0`: recursively
 * key-sorted JSON with compact separators. Over the v0.1 value domain (objects,
 * strings, integers in the IEEE-754 safe range, `null`; no fractional numbers)
 * it is byte-for-byte equivalent to RFC 8785 (JCS).
 */

import {
  canonicalJson,
  sha256Hex,
  AGENT_ID_RE,
  SHA256_DIGEST_RE,
  validateAgentId as canonicalValidateAgentId,
  validateActionRef as canonicalValidateActionRef,
  CanonicalValidationError,
} from '@defaultsettlement/canonical'
import { ContinuityRecordError } from './errors.js'

// Compatibility re-exports: continuity importers (and tests/examples) keep
// importing these names from this module unchanged.
export { canonicalJson, sha256Hex, AGENT_ID_RE, SHA256_DIGEST_RE }

/** A `sha256:<64 lowercase hex>` digest, used for `action_ref`. */
export const ACTION_REF_RE = SHA256_DIGEST_RE

/**
 * Validate a provisional `agent:` identity. Shared scheme with the canonical
 * package — see {@link AGENT_ID_RE}. Throws {@link ContinuityRecordError} so the
 * continuity error contract is unchanged.
 */
export function validateAgentId(agentId: string, field = 'identity'): void {
  try {
    canonicalValidateAgentId(agentId, field)
  } catch (err) {
    if (err instanceof CanonicalValidationError) throw new ContinuityRecordError(err.message)
    throw err
  }
}

/** Validate a `sha256:<64 lowercase hex>` `action_ref` digest. */
export function validateActionRef(actionRef: string, field = 'action_ref'): void {
  try {
    canonicalValidateActionRef(actionRef, field)
  } catch (err) {
    if (err instanceof CanonicalValidationError) throw new ContinuityRecordError(err.message)
    throw err
  }
}

/** Validate an RFC 3339 / ISO-8601 timestamp string used for audit fields. */
export function validateTimestamp(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '' || Number.isNaN(Date.parse(value))) {
    throw new ContinuityRecordError(`${field} is required and must be an RFC 3339 timestamp; got ${String(value)}`)
  }
}

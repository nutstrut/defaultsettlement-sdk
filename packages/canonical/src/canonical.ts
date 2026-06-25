/**
 * Deterministic serialization, digesting, identity/type validation, and
 * content/body digesting — the neutral core shared by the Default Settlement
 * packages.
 *
 * Canonicalization is the repo's `sorted_keys_compact_v0`: recursively
 * key-sorted JSON with compact separators, dropping `undefined`. Over the v0.1
 * value domain — objects, strings, `null`, and integers within the IEEE-754
 * safe range, with no fractional numbers — it is byte-for-byte equivalent to
 * RFC 8785 (JCS). Producers MUST keep values inside that domain (no floats, no
 * `undefined`, no functions) so the equivalence holds and output stays
 * deterministic. This module does NOT provide key discovery or a public key
 * registry.
 */

import { createHash } from 'node:crypto'
import { CanonicalValidationError } from './errors.js'

// ---------------------------------------------------------------------------
// Canonical JSON + SHA-256
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON: recursively sorted keys, compact separators, `undefined`
 * dropped (`sorted_keys_compact_v0`). Byte-equivalent to JCS/RFC 8785 over the
 * supported v0.1 value domain (objects, strings, `null`, safe-range integers;
 * no floats, no `undefined`, no functions).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = sortKeys(v)
    }
    return out
  }
  return value
}

/** sha256 over a UTF-8 string or bytes, returned as `sha256:<64 lowercase hex>`. */
export function sha256Hex(input: string | Uint8Array | Buffer): string {
  return 'sha256:' + createHash('sha256').update(input).digest('hex')
}

// ---------------------------------------------------------------------------
// Digest + identity + action-type validators
// ---------------------------------------------------------------------------

/** A `sha256:<64 lowercase hex>` digest. */
export const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/

/**
 * Provisional `agent:` identity rule. The namespaced `agent:` form
 * (e.g. `agent:example`, `agent:morpheus`, `agent:x402:eip155:8453:0xPayer`).
 * Freeform display names and other URI schemes (`morpheus`, `did:morpheus`,
 * `Agent Smith`, …) are rejected so an identity cannot become another soft
 * field inside a canonical digest or signed record.
 */
export const AGENT_ID_RE = /^agent:[a-z0-9]+(?::[A-Za-z0-9._-]+)*$/

/** `action_type` must be a stable namespaced string, e.g. `sar402.resource_delivery`. */
export const ACTION_TYPE_RE = /^[a-z0-9]+(?:\.[a-z0-9_]+)+$/

/** Validate a `sha256:<64 lowercase hex>` digest. Returns the value on success. */
export function validateSha256Digest(value: unknown, fieldName = 'digest'): string {
  if (typeof value !== 'string' || !SHA256_DIGEST_RE.test(value)) {
    throw new CanonicalValidationError(
      `${fieldName} must be a sha256:<64 lowercase hex> digest; got ${String(value)}`,
    )
  }
  return value
}

/** Validate an `action_ref` digest (a `sha256:<hex>` digest). Returns the value. */
export function validateActionRef(value: unknown, fieldName = 'action_ref'): string {
  return validateSha256Digest(value, fieldName)
}

/** Validate a provisional `agent_id`. See {@link AGENT_ID_RE}. Returns the value. */
export function validateAgentId(value: unknown, fieldName = 'agent_id'): string {
  if (typeof value !== 'string' || !AGENT_ID_RE.test(value)) {
    throw new CanonicalValidationError(
      `${fieldName} must use the agent: identity scheme (e.g. agent:example); got ${String(value)}`,
    )
  }
  return value
}

/** Validate `action_type` format (namespaced, e.g. sar402.resource_delivery). Returns the value. */
export function validateActionType(value: unknown, fieldName = 'action_type'): string {
  if (typeof value !== 'string' || !ACTION_TYPE_RE.test(value)) {
    throw new CanonicalValidationError(
      `${fieldName} must be a stable namespaced string (e.g. sar402.resource_delivery); got ${String(value)}`,
    )
  }
  return value
}

// ---------------------------------------------------------------------------
// content_type + body_digest
// ---------------------------------------------------------------------------

/** Raw body input for body_digest. `null`/`undefined`/empty all hash zero bytes. */
export type BodyInput = string | Uint8Array | null | undefined

/**
 * Canonicalize a content type by lowercasing and stripping parameters.
 * `application/json; charset=utf-8` -> `application/json`.
 */
export function canonicalizeContentType(contentType: string): string {
  if (typeof contentType !== 'string' || contentType.trim() === '') {
    throw new CanonicalValidationError('content_type is required')
  }
  return (contentType.split(';')[0] ?? '').trim().toLowerCase()
}

function toBytes(body?: BodyInput): Buffer {
  if (body == null) return Buffer.alloc(0)
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  return Buffer.from(body)
}

/**
 * Deterministic body digest, driven by the canonicalized content type.
 *
 * - Empty body -> SHA-256 of zero bytes (regardless of content type).
 * - canonical `application/json` -> parse JSON, JCS-canonicalize, SHA-256 the
 *   canonical bytes. Malformed JSON declared as JSON is invalid (throws).
 * - any other content type -> SHA-256 of the raw body bytes.
 */
export function computeBodyDigest(rawContentType: string, body?: BodyInput): string {
  const bytes = toBytes(body)
  if (bytes.length === 0) return sha256Hex(Buffer.alloc(0))
  const ct = canonicalizeContentType(rawContentType)
  if (ct === 'application/json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch {
      throw new CanonicalValidationError(
        'content_type is application/json but the body is not valid JSON; ' +
          'the request commitment is invalid',
      )
    }
    return sha256Hex(canonicalJson(parsed))
  }
  return sha256Hex(bytes)
}

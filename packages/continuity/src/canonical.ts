/**
 * Minimal, self-contained canonicalization + identity validators for the
 * continuity layer.
 *
 * Cross-package boundary: `packages/continuity/` is a sibling / upper
 * composition layer to SAR-402, NOT a child of it. It MUST NOT import
 * SAR-owned implementation details from `packages/sar-402/`. The
 * canonicalization helper and the `agent:` identity / `action_ref` validators
 * needed here are small and value-domain-identical to the ones SAR already
 * ships in `packages/sar-402/src/normalize.ts` and
 * `packages/sar-402/src/action-commitment.ts`. Rather than create a backwards
 * source dependency, this file duplicates the minimal logic.
 *
 * OPEN QUESTION (flagged for review): these helpers — canonical JSON, the
 * `sha256:` digest, the `agent:` identity regex, and the `action_ref` validator
 * — are now duplicated across SAR-402 and continuity. They should be extracted
 * into a neutral shared workspace package (e.g. `@defaultsettlement/canonical`)
 * that both packages depend on. That extraction is intentionally out of scope
 * for this focused diff (it would touch SAR-402 source). Until then, this file
 * is the single source of truth for the continuity layer.
 *
 * Canonicalization is the repo's `sorted_keys_compact_v0`: recursively
 * key-sorted JSON with compact separators. Over the v0.1 value domain (objects,
 * strings, integers in the IEEE-754 safe range, `null`; no fractional numbers)
 * it is byte-for-byte equivalent to RFC 8785 (JCS). The signed-record signing
 * input below is specified in terms of JCS so independent verifiers can
 * reproduce it; producers MUST keep record values inside that domain.
 */

import { createHash } from 'node:crypto'
import { ContinuityRecordError } from './errors.js'

/**
 * Provisional `agent:` identity rule. Identical scheme to Action Commitment's
 * `validateAgentId` (`packages/sar-402/src/action-commitment.ts`): the
 * namespaced `agent:` form (e.g. `agent:example`, `agent:morpheus`,
 * `agent:x402:eip155:8453:0xPayer`). Freeform display names and other URI
 * schemes (`morpheus`, `did:morpheus`, `Agent Smith`, …) are rejected so an
 * identity cannot become another soft field inside a signed record.
 */
export const AGENT_ID_RE = /^agent:[a-z0-9]+(?::[A-Za-z0-9._-]+)*$/

/** A `sha256:<64 lowercase hex>` digest, used for `action_ref`. */
export const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/
export const ACTION_REF_RE = SHA256_DIGEST_RE

/** Deterministic JSON: recursively sorted keys, compact separators (`sorted_keys_compact_v0`). */
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

/** sha256 over a UTF-8 string or Buffer, returned as `sha256:<hex>`. */
export function sha256Hex(data: string | Buffer): string {
  return 'sha256:' + createHash('sha256').update(data).digest('hex')
}

/**
 * Validate a provisional `agent:` identity. Shared scheme with Action
 * Commitment — see {@link AGENT_ID_RE}.
 */
export function validateAgentId(agentId: string, field = 'identity'): void {
  if (typeof agentId !== 'string' || !AGENT_ID_RE.test(agentId)) {
    throw new ContinuityRecordError(
      `${field} must use the agent: identity scheme (e.g. agent:example); got ${String(agentId)}`,
    )
  }
}

/** Validate a `sha256:<64 lowercase hex>` `action_ref` digest. */
export function validateActionRef(actionRef: string, field = 'action_ref'): void {
  if (typeof actionRef !== 'string' || !ACTION_REF_RE.test(actionRef)) {
    throw new ContinuityRecordError(`${field} must be a sha256:<64 lowercase hex> digest; got ${String(actionRef)}`)
  }
}

/** Validate an RFC 3339 / ISO-8601 timestamp string used for audit fields. */
export function validateTimestamp(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '' || Number.isNaN(Date.parse(value))) {
    throw new ContinuityRecordError(`${field} is required and must be an RFC 3339 timestamp; got ${String(value)}`)
  }
}

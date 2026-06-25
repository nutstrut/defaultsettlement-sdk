/**
 * Action Commitment — a first-class correlation primitive for Default
 * Settlement / SAR-402 composition.
 *
 * Action Commitment lets independent verifiers join, by the same stable
 * `action_ref`:
 *   - pre-execution continuity/evaluator records
 *   - outcome/execution receipts
 *   - SAR delivery/settlement receipts
 *   - chained verifier records
 *
 * Action Commitment closes the correlation gap, not the execution-faithfulness gap.
 * It proves records are joinable around the same
 * committed logical action. It does NOT prove the executor honestly performed
 * that action. Execution faithfulness still depends on signed records, complete
 * outcome emission, delivery evidence, and verifier checks.
 *
 * This module owns two frozen canonical objects:
 *   1. Action Request Commitment  (schema_id: ds.action_request.v0.1)
 *        request_digest = "sha256:" + SHA256(JCS(Action Request Commitment))
 *   2. Action Commitment          (schema_id: ds.action_commitment.v0.1)
 *        action_ref     = "sha256:" + SHA256(JCS(Action Commitment))
 *
 * Canonicalization: this module reuses the package's existing canonicalization
 * helper {@link canonicalJson} (the repo's `sorted_keys_compact_v0`). Over the
 * v0.1 value domain — objects, strings, `null`, and integers within the
 * IEEE-754 safe range, with no fractional numbers — that serialization is
 * byte-for-byte equivalent to RFC 8785 (JCS). The derivations above are
 * specified in terms of JCS so independent implementations can reproduce the
 * same digests; producers MUST keep request/commitment values inside that
 * domain (no floats) so the equivalence holds. We do not reimplement
 * canonicalization here.
 */

import {
  canonicalJson,
  sha256Hex,
  SHA256_DIGEST_RE,
  validateAgentId as canonicalValidateAgentId,
  validateActionType as canonicalValidateActionType,
  canonicalizeContentType as canonicalCanonicalizeContentType,
  computeBodyDigest as canonicalComputeBodyDigest,
  CanonicalValidationError,
} from '@defaultsettlement/canonical'
import { Sar402Error } from './errors.js'

// ---------------------------------------------------------------------------
// Schema ids (frozen for v0.1)
// ---------------------------------------------------------------------------

export const ACTION_REQUEST_SCHEMA_ID = 'ds.action_request.v0.1' as const
export const ACTION_COMMITMENT_SCHEMA_ID = 'ds.action_commitment.v0.1' as const
export const OPERATION_BINDING_SCHEMA_ID = 'ds.operation_binding.v0.1' as const

/** Default transport ports that MUST canonicalize to `null`. */
const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443 }

const METHOD_RE = /^[A-Z]+$/
// Digest / identity / action-type validation now lives in the neutral
// @defaultsettlement/canonical package; the `sha256:<hex>` shape is shared.
const REQUEST_DIGEST_RE = SHA256_DIGEST_RE
const ACTION_REF_RE = REQUEST_DIGEST_RE

/** Thrown when an Action Request Commitment / Action Commitment input is invalid. */
export class ActionCommitmentError extends Sar402Error {}

/**
 * Run a canonical helper, surfacing its {@link CanonicalValidationError} as an
 * {@link ActionCommitmentError} so this module's public error type (and the
 * downstream `catch`/`toThrow` contracts) stay unchanged after the extraction.
 */
function asActionCommitmentError<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof CanonicalValidationError) {
      throw new ActionCommitmentError(err.message)
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Already-normalized, inspectable target object. Never a raw live URL. */
export interface ActionRequestTarget {
  scheme: string
  host: string
  /** Always present. `null` for the default port; a positive integer otherwise. */
  port: number | null
  path: string
  query: Record<string, unknown>
}

/** Frozen Action Request Commitment (schema_id: ds.action_request.v0.1). */
export interface ActionRequestCommitment {
  schema_id: typeof ACTION_REQUEST_SCHEMA_ID
  method: string
  target: ActionRequestTarget
  content_type: string
  body_digest: string
}

/** Frozen Action Commitment (schema_id: ds.action_commitment.v0.1). */
export interface ActionCommitment {
  schema_id: typeof ACTION_COMMITMENT_SCHEMA_ID
  agent_id: string
  action_type: string
  request_digest: string
  idempotency_key: string
}

/** `_ext.operation_binding` envelope a SAR receipt uses to reference an action. */
export interface OperationBinding {
  schema_id: typeof OPERATION_BINDING_SCHEMA_ID
  action_ref: string
}

/** Raw body input for body_digest. `null`/`undefined`/empty all hash zero bytes. */
export type BodyInput = string | Uint8Array | null | undefined

/** Target input before canonicalization. `port` key MUST be present (use null). */
export interface TargetInput {
  scheme: string
  host: string
  port: number | null
  path: string
  query?: Record<string, unknown>
}

export interface ActionRequestInput {
  method: string
  target: TargetInput
  contentType: string
  body?: BodyInput
}

export interface ActionCommitmentInput {
  agentId: string
  actionType: string
  requestDigest: string
  idempotencyKey: string
}

// ---------------------------------------------------------------------------
// content_type + body_digest
// ---------------------------------------------------------------------------

/**
 * Canonicalize a content type by lowercasing and stripping parameters.
 * `application/json; charset=utf-8` -> `application/json`. Delegates to
 * `@defaultsettlement/canonical`; behavior and output are unchanged.
 */
export function canonicalizeContentType(contentType: string): string {
  return asActionCommitmentError(() => canonicalCanonicalizeContentType(contentType))
}

/**
 * Deterministic body digest, driven by the canonicalized content type.
 *
 * - Empty body -> SHA-256 of zero bytes.
 * - canonical `application/json` -> parse JSON, JCS-canonicalize, SHA-256 the
 *   canonical bytes. Malformed JSON declared as JSON is invalid (throws).
 * - any other content type -> SHA-256 of the raw body bytes.
 *
 * Delegates to `@defaultsettlement/canonical`; digest outputs are unchanged.
 */
export function computeBodyDigest(rawContentType: string, body?: BodyInput): string {
  return asActionCommitmentError(() => canonicalComputeBodyDigest(rawContentType, body))
}

// ---------------------------------------------------------------------------
// target canonicalization
// ---------------------------------------------------------------------------

/**
 * Canonicalize a producer-supplied target object. The producer commits an
 * already-normalized target — verifiers must never guess how to normalize a raw
 * URL, and the full live URL (which may carry volatile x402/resource material)
 * is never digested.
 *
 * Port rule: the `port` key MUST be present. Silent omission is rejected so one
 * producer cannot omit `port` while another sends `"port": null` and have both
 * treated as equivalent. The default port for the scheme (`443`/`80`) is
 * normalized to `null`; a non-default port must be a positive integer.
 */
export function canonicalizeTarget(input: TargetInput): ActionRequestTarget {
  if (input == null || typeof input !== 'object') {
    throw new ActionCommitmentError('target is required and must be an object')
  }
  const scheme = requireLowerString(input.scheme, 'target.scheme')
  const host = requireLowerString(input.host, 'target.host')

  if (!('port' in input)) {
    throw new ActionCommitmentError(
      'target.port must be present (use null for the default port); ' +
        'silent omission of port is rejected',
    )
  }
  const port = canonicalizePort(input.port, scheme)

  if (typeof input.path !== 'string' || input.path === '') {
    throw new ActionCommitmentError('target.path is required and must be a non-empty string')
  }

  const query = input.query ?? {}
  if (typeof query !== 'object' || Array.isArray(query)) {
    throw new ActionCommitmentError('target.query must be an object (not a raw query string)')
  }

  return { scheme, host, port, path: input.path, query }
}

function canonicalizePort(port: unknown, scheme: string): number | null {
  if (port === null) return null
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0) {
    throw new ActionCommitmentError('target.port must be null or a positive integer')
  }
  // A default port for the scheme normalizes to null so it can never drift
  // against a producer that committed null.
  if (DEFAULT_PORTS[scheme] === port) return null
  return port
}

function requireLowerString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ActionCommitmentError(`${field} is required`)
  }
  return value.toLowerCase()
}

// ---------------------------------------------------------------------------
// Action Request Commitment + request_digest
// ---------------------------------------------------------------------------

/** Build a canonical Action Request Commitment from request inputs. */
export function buildActionRequestCommitment(input: ActionRequestInput): ActionRequestCommitment {
  if (typeof input.method !== 'string' || input.method.trim() === '') {
    throw new ActionCommitmentError('method is required')
  }
  const method = input.method.toUpperCase()
  if (!METHOD_RE.test(method)) {
    throw new ActionCommitmentError(`method must be an uppercase token (e.g. GET, POST); got ${input.method}`)
  }
  return {
    schema_id: ACTION_REQUEST_SCHEMA_ID,
    method,
    target: canonicalizeTarget(input.target),
    content_type: canonicalizeContentType(input.contentType),
    body_digest: computeBodyDigest(input.contentType, input.body),
  }
}

/** request_digest = "sha256:" + SHA256(JCS(Action Request Commitment)). */
export function deriveRequestDigest(commitment: ActionRequestCommitment): string {
  assertActionRequestCommitment(commitment)
  return sha256Hex(canonicalJson(commitment))
}

function assertActionRequestCommitment(c: ActionRequestCommitment): void {
  if (c.schema_id !== ACTION_REQUEST_SCHEMA_ID) {
    throw new ActionCommitmentError(`schema_id must be exactly ${ACTION_REQUEST_SCHEMA_ID}`)
  }
  if (!METHOD_RE.test(c.method)) {
    throw new ActionCommitmentError('method must be an uppercase token')
  }
  // Re-run target/content_type canonicalization to reject non-canonical input.
  canonicalizeTarget(c.target)
  if (canonicalizeContentType(c.content_type) !== c.content_type) {
    throw new ActionCommitmentError('content_type is not canonical (lowercase, no parameters)')
  }
  if (typeof c.body_digest !== 'string' || !REQUEST_DIGEST_RE.test(c.body_digest)) {
    throw new ActionCommitmentError('body_digest must be a sha256:<hex> digest')
  }
}

// ---------------------------------------------------------------------------
// Action Commitment + action_ref
// ---------------------------------------------------------------------------

/**
 * Validate a provisional `agent_id`. See {@link AGENT_ID_RE}. The Action
 * Commitment itself may be unsigned in this implementation — trust comes from
 * the signed records that reference the same `action_ref`. This binds the
 * commitment to the agent identity those signed records assert.
 */
export function validateAgentId(agentId: string): void {
  asActionCommitmentError(() => canonicalValidateAgentId(agentId))
}

/** Validate `action_type` format (namespaced, e.g. sar402.resource_delivery). */
export function validateActionType(actionType: string): void {
  asActionCommitmentError(() => canonicalValidateActionType(actionType))
}

/**
 * Build a canonical Action Commitment.
 *
 * `idempotency_key` is caller-supplied and NOT derived from `request_digest`.
 * The same logical retry family reuses the same key (stable `action_ref`);
 * different intended operations with identical request content MUST use
 * different keys (distinct `action_ref`). `target_ref` is intentionally absent
 * from the canonical input — if a producer carries one for display/indexing it
 * must live outside this object and must not affect `action_ref`.
 */
export function buildActionCommitment(input: ActionCommitmentInput): ActionCommitment {
  validateAgentId(input.agentId)
  validateActionType(input.actionType)
  if (typeof input.requestDigest !== 'string' || !REQUEST_DIGEST_RE.test(input.requestDigest)) {
    throw new ActionCommitmentError('request_digest must be a sha256:<hex> digest')
  }
  if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim() === '') {
    throw new ActionCommitmentError('idempotency_key is required (caller-supplied, not derived)')
  }
  return {
    schema_id: ACTION_COMMITMENT_SCHEMA_ID,
    agent_id: input.agentId,
    action_type: input.actionType,
    request_digest: input.requestDigest,
    idempotency_key: input.idempotencyKey,
  }
}

/** action_ref = "sha256:" + SHA256(JCS(Action Commitment)). */
export function deriveActionRef(commitment: ActionCommitment): string {
  if (commitment.schema_id !== ACTION_COMMITMENT_SCHEMA_ID) {
    throw new ActionCommitmentError(`schema_id must be exactly ${ACTION_COMMITMENT_SCHEMA_ID}`)
  }
  validateAgentId(commitment.agent_id)
  validateActionType(commitment.action_type)
  if (!REQUEST_DIGEST_RE.test(commitment.request_digest)) {
    throw new ActionCommitmentError('request_digest must be a sha256:<hex> digest')
  }
  if (typeof commitment.idempotency_key !== 'string' || commitment.idempotency_key.trim() === '') {
    throw new ActionCommitmentError('idempotency_key is required')
  }
  return sha256Hex(canonicalJson(commitment))
}

// ---------------------------------------------------------------------------
// SAR operation binding
// ---------------------------------------------------------------------------

/** Build the `ds.operation_binding.v0.1` object for a given action_ref. */
export function buildOperationBinding(actionRef: string): OperationBinding {
  if (!ACTION_REF_RE.test(actionRef)) {
    throw new ActionCommitmentError('action_ref must be a sha256:<hex> digest')
  }
  return { schema_id: OPERATION_BINDING_SCHEMA_ID, action_ref: actionRef }
}

/**
 * Build the additive `_ext.operation_binding` envelope a SAR receipt carries to
 * reference an Action Commitment. This stays inside SAR's evidence role: it
 * joins the receipt to a committed action and asserts nothing about policy
 * authorization, payment finality, invoice correctness, or executor
 * faithfulness.
 */
export function operationBindingExt(actionRef: string): {
  _ext: { operation_binding: OperationBinding }
} {
  return { _ext: { operation_binding: buildOperationBinding(actionRef) } }
}

/**
 * Validate that a SAR receipt's `_ext.operation_binding.action_ref` exists and
 * equals the expected `action_ref` (typically derived from the linked Action
 * Commitment). Throws on a missing or mismatched binding. Returns the binding on
 * success. This is a correlation check only — it never makes SAR authoritative
 * for authorization, payment finality, invoice correctness, or execution.
 */
export function validateOperationBinding(
  sarReceipt: unknown,
  expectedActionRef: string,
): OperationBinding {
  const binding = (sarReceipt as { _ext?: { operation_binding?: unknown } })?._ext
    ?.operation_binding as OperationBinding | undefined
  if (!binding || typeof binding !== 'object') {
    throw new ActionCommitmentError('SAR receipt has no _ext.operation_binding')
  }
  if (binding.schema_id !== OPERATION_BINDING_SCHEMA_ID) {
    throw new ActionCommitmentError(
      `operation_binding.schema_id must be ${OPERATION_BINDING_SCHEMA_ID}`,
    )
  }
  if (typeof binding.action_ref !== 'string' || !ACTION_REF_RE.test(binding.action_ref)) {
    throw new ActionCommitmentError('operation_binding.action_ref must be a sha256:<hex> digest')
  }
  if (binding.action_ref !== expectedActionRef) {
    throw new ActionCommitmentError(
      `operation_binding.action_ref mismatch: receipt has ${binding.action_ref}, expected ${expectedActionRef}`,
    )
  }
  return binding
}

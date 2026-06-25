/**
 * Execution Outcome Receipt (schema_id: ds.execution_outcome.v0.1).
 *
 * Records what the mutation-capable executor DID after evaluation. It is a
 * SIGNED normative record: trust comes from the executor's Ed25519 signature,
 * and `executor_id` is bound to the signing key.
 *
 * Layer boundary:
 *   - Execution Outcome Receipt answers: what did the mutation-capable executor
 *     do?
 *
 * An Execution Outcome Receipt does NOT prove delivery.
 *
 * There is intentionally NO `NO_EMISSION` outcome state. A receipt cannot
 * self-attest its own absence. Absence of an Execution Outcome Receipt is a
 * verifier / audit finding, not an outcome state (see {@link
 * ../composition.ts} and the README absence-as-audit-gap rule).
 */

import { type KeyObject } from 'node:crypto'
import { validateActionRef, validateAgentId, validateTimestamp } from './canonical.js'
import { ContinuityRecordError } from './errors.js'
import {
  type Signed,
  type SignatureBlock,
  signEnvelope,
  verifyEnvelope,
} from './signing.js'

export const EXECUTION_OUTCOME_SCHEMA_ID = 'ds.execution_outcome.v0.1' as const

/**
 * Allowed `outcome_state` values.
 *
 *   PROCEEDED — executor performed the mutation/action.
 *   BLOCKED   — executor did not proceed; the action was blocked.
 *   FAILED    — executor attempted but the action failed.
 *
 * NO_EMISSION is deliberately absent: absence of a receipt is not an outcome.
 */
export const OUTCOME_STATES = ['PROCEEDED', 'BLOCKED', 'FAILED'] as const
export type OutcomeState = (typeof OUTCOME_STATES)[number]

/** Canonical unsigned core of an Execution Outcome Receipt. */
export interface ExecutionOutcomeCore {
  schema_id: typeof EXECUTION_OUTCOME_SCHEMA_ID
  action_ref: string
  executor_id: string
  outcome_state: OutcomeState
  /**
   * Optional, informational, and NON-load-bearing. Verifier logic MUST key off
   * `outcome_state`, never `reason`. A successful (`PROCEEDED`) receipt may omit
   * it; filler reasons are never required.
   */
  reason?: string
  /**
   * Required for audit / human inspection and signed as part of the record's
   * factual claim. NOT a join key: it must not affect `action_ref` and must not
   * be used to join retries.
   */
  recorded_at: string
}

/** A signed Execution Outcome Receipt: canonical core + signature envelope. */
export type ExecutionOutcomeReceipt = Signed<ExecutionOutcomeCore>

export interface ExecutionOutcomeInput {
  actionRef: string
  executorId: string
  outcomeState: OutcomeState
  reason?: string
  recordedAt: string
}

function validateReason(reason: unknown): void {
  if (reason === undefined) return
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new ContinuityRecordError('reason, when present, must be a non-empty string (it is optional and informational)')
  }
}

/** Build and validate a canonical Execution Outcome Receipt core (unsigned). */
export function buildExecutionOutcomeCore(input: ExecutionOutcomeInput): ExecutionOutcomeCore {
  validateActionRef(input.actionRef)
  validateAgentId(input.executorId, 'executor_id')
  if (!OUTCOME_STATES.includes(input.outcomeState)) {
    throw new ContinuityRecordError(
      `outcome_state must be one of ${OUTCOME_STATES.join(', ')}; got ${String(input.outcomeState)}` +
        ' (note: NO_EMISSION is not an outcome state — absence is a verifier finding)',
    )
  }
  validateReason(input.reason)
  validateTimestamp(input.recordedAt, 'recorded_at')
  const core: ExecutionOutcomeCore = {
    schema_id: EXECUTION_OUTCOME_SCHEMA_ID,
    action_ref: input.actionRef,
    executor_id: input.executorId,
    outcome_state: input.outcomeState,
    recorded_at: input.recordedAt,
  }
  // Only include `reason` when present, so the canonical core omits it cleanly.
  if (input.reason !== undefined) core.reason = input.reason
  return core
}

/** Validate an already-formed Execution Outcome Receipt core. */
export function validateExecutionOutcomeCore(core: ExecutionOutcomeCore): void {
  if (core == null || typeof core !== 'object') {
    throw new ContinuityRecordError('execution outcome core must be an object')
  }
  if (core.schema_id !== EXECUTION_OUTCOME_SCHEMA_ID) {
    throw new ContinuityRecordError(`schema_id must be exactly ${EXECUTION_OUTCOME_SCHEMA_ID}`)
  }
  validateActionRef(core.action_ref)
  validateAgentId(core.executor_id, 'executor_id')
  if (!OUTCOME_STATES.includes(core.outcome_state)) {
    throw new ContinuityRecordError(
      `outcome_state must be one of ${OUTCOME_STATES.join(', ')}; got ${String(core.outcome_state)}` +
        ' (note: NO_EMISSION is not an outcome state — absence is a verifier finding)',
    )
  }
  validateReason(core.reason)
  validateTimestamp(core.recorded_at, 'recorded_at')
}

/**
 * Sign an Execution Outcome Receipt with the executor's Ed25519 private key.
 * The `signature.key_id` is bound to `executor_id`.
 */
export function signExecutionOutcomeReceipt(
  input: ExecutionOutcomeInput | ExecutionOutcomeCore,
  executorPrivateKey: KeyObject,
): ExecutionOutcomeReceipt {
  const core =
    'schema_id' in input ? (validateExecutionOutcomeCore(input), input) : buildExecutionOutcomeCore(input)
  return signEnvelope(core, executorPrivateKey, core.executor_id)
}

/**
 * Verify a signed Execution Outcome Receipt. `expectedExecutorPublicKey` is the
 * trusted Ed25519 public key bound to the record's `executor_id`. Enforces core
 * validity and identity-to-signing-key binding.
 */
export function verifyExecutionOutcomeReceipt(
  record: ExecutionOutcomeReceipt | (ExecutionOutcomeCore & { signature?: SignatureBlock }),
  expectedExecutorPublicKey: KeyObject,
): ExecutionOutcomeCore {
  const core = verifyEnvelope<ExecutionOutcomeCore>(record, {
    expectedPublicKey: expectedExecutorPublicKey,
    expectedKeyId: (record as ExecutionOutcomeCore).executor_id,
  })
  validateExecutionOutcomeCore(core)
  return core
}

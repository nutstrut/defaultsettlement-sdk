/**
 * Composition validation: join signed continuity records, the execution
 * outcome, and SAR delivery/settlement evidence around the SAME `action_ref`.
 *
 * Doctrine: validation stays LAYERED. SAR does not validate continuity
 * semantics; continuity does not own SAR internals. This helper only checks
 * that supplied records reference the expected `action_ref`, and surfaces the
 * absence of an Execution Outcome Receipt as an explicit, inspectable audit-gap
 * finding — never as an outcome state.
 *
 *   Action Commitment closes the correlation gap, not the
 *   execution-faithfulness gap.
 *
 * Join key is `action_ref` ONLY. Timestamps (`evaluated_at`, `recorded_at`) are
 * never join keys and are not consulted here. `reason` is non-load-bearing and
 * is never consulted here.
 *
 * SAR boundary: the SAR receipt is read only through its additive, public
 * `_ext.operation_binding.action_ref` field. We do NOT import SAR-402 source
 * (that would be a backwards dependency); we read the documented envelope shape
 * from the supplied receipt object/fixture.
 */

import { validateActionRef, ACTION_REF_RE } from './canonical.js'
import { ContinuityCompositionError } from './errors.js'
import { type ContinuityEvaluationCore } from './continuity-evaluation.js'
import { type ExecutionOutcomeCore } from './execution-outcome.js'

const OPERATION_BINDING_SCHEMA_ID = 'ds.operation_binding.v0.1'

/** A record bearing an `action_ref` (a core or a signed receipt — only the join field is read). */
type ActionRefBearing = { action_ref?: unknown }

export interface CompositionInput {
  /** The `action_ref` all supplied records must join on (e.g. derived from the Action Commitment). */
  expectedActionRef: string
  /** Continuity Evaluation Receipt (core or signed). Optional. */
  evaluation?: ContinuityEvaluationCore | ActionRefBearing
  /** Execution Outcome Receipt (core or signed). Optional — absence is an audit gap, not an outcome. */
  outcome?: ExecutionOutcomeCore | ActionRefBearing
  /** SAR receipt carrying `_ext.operation_binding.action_ref`. Optional. */
  sarReceipt?: unknown
  /**
   * Whether the system has a separately verifiable complete-emission guarantee
   * (every executed action emits a signed Execution Outcome Receipt). Default
   * `false`. When `false`, a missing outcome receipt is an audit gap.
   */
  completeEmissionGuaranteed?: boolean
  /**
   * Whether the verifier is EXPLICITLY asking to interpret a missing outcome
   * receipt as blocked execution. Default `false`. This is only honored when
   * {@link completeEmissionGuaranteed} is also `true`. The assumption is never
   * applied silently.
   */
  interpretAbsenceAsBlocked?: boolean
}

export type CompositionFindingCode =
  | 'missing_execution_outcome_receipt'
  | 'absence_interpreted_as_blocked'

export interface CompositionFinding {
  code: CompositionFindingCode
  /** Audit/verifier finding severity. Absence is reported here, NEVER as an outcome state. */
  kind: 'audit_gap' | 'applied_assumption'
  message: string
}

export interface CompositionResult {
  /**
   * `ok: true` means all supplied records joined on the expected action_ref and
   * no unresolved audit gap remains. `ok: false` means validation found an
   * unresolved audit gap, such as a missing Execution Outcome Receipt without an
   * explicit complete-emission/absence-as-blocked assumption. (An action_ref
   * mismatch throws rather than returning `ok: false`.)
   */
  ok: boolean
  actionRef: string
  /** Which records were supplied and joined on the expected `action_ref`. */
  joined: { evaluation: boolean; outcome: boolean; sar: boolean }
  /** Verifier/audit findings (e.g. missing outcome → audit gap). Not record states. */
  findings: CompositionFinding[]
  /** Explicit, inspectable assumptions that were applied (e.g. absence→blocked). */
  appliedAssumptions: string[]
}

function readActionRef(record: ActionRefBearing | undefined): string | undefined {
  if (record == null || typeof record !== 'object') return undefined
  const ref = (record as ActionRefBearing).action_ref
  return typeof ref === 'string' ? ref : undefined
}

function readSarActionRef(sarReceipt: unknown): string {
  const binding = (sarReceipt as { _ext?: { operation_binding?: unknown } })?._ext?.operation_binding as
    | { schema_id?: unknown; action_ref?: unknown }
    | undefined
  if (!binding || typeof binding !== 'object') {
    throw new ContinuityCompositionError('SAR receipt has no _ext.operation_binding')
  }
  if (binding.schema_id !== OPERATION_BINDING_SCHEMA_ID) {
    throw new ContinuityCompositionError(
      `SAR _ext.operation_binding.schema_id must be ${OPERATION_BINDING_SCHEMA_ID}`,
    )
  }
  if (typeof binding.action_ref !== 'string' || !ACTION_REF_RE.test(binding.action_ref)) {
    throw new ContinuityCompositionError('SAR _ext.operation_binding.action_ref must be a sha256:<hex> digest')
  }
  return binding.action_ref
}

/**
 * Validate that all supplied records compose around `expectedActionRef`.
 *
 * Throws {@link ContinuityCompositionError} on any `action_ref` mismatch. A
 * missing Execution Outcome Receipt does NOT throw: it yields an audit-gap
 * finding (or, only when `completeEmissionGuaranteed && interpretAbsenceAsBlocked`,
 * an explicit applied-assumption that absence means blocked execution).
 */
export function validateActionRefComposition(input: CompositionInput): CompositionResult {
  validateActionRef(input.expectedActionRef, 'expectedActionRef')
  const expected = input.expectedActionRef
  const findings: CompositionFinding[] = []
  const appliedAssumptions: string[] = []

  // (1) Continuity Evaluation Receipt joins on the expected action_ref.
  const evaluationPresent = input.evaluation != null
  if (evaluationPresent) {
    const ref = readActionRef(input.evaluation)
    if (ref !== expected) {
      throw new ContinuityCompositionError(
        `continuity evaluation action_ref mismatch: ${String(ref)} !== expected ${expected}`,
      )
    }
  }

  // (2) Execution Outcome Receipt joins on the expected action_ref, when present.
  const outcomePresent = input.outcome != null
  if (outcomePresent) {
    const ref = readActionRef(input.outcome)
    if (ref !== expected) {
      throw new ContinuityCompositionError(
        `execution outcome action_ref mismatch: ${String(ref)} !== expected ${expected}`,
      )
    }
  }

  // (3) SAR receipt binding joins on the expected action_ref, when supplied.
  const sarPresent = input.sarReceipt != null
  if (sarPresent) {
    const ref = readSarActionRef(input.sarReceipt)
    if (ref !== expected) {
      throw new ContinuityCompositionError(
        `SAR _ext.operation_binding.action_ref mismatch: ${ref} !== expected ${expected}`,
      )
    }
  }

  // (6/7) Missing outcome → audit-gap finding (default), or explicit assumption.
  const completeEmissionGuaranteed = input.completeEmissionGuaranteed ?? false
  const interpretAbsenceAsBlocked = input.interpretAbsenceAsBlocked ?? false
  let unresolvedAuditGap = false
  if (!outcomePresent) {
    if (completeEmissionGuaranteed && interpretAbsenceAsBlocked) {
      appliedAssumptions.push(
        'complete-emission guarantee asserted AND absence-as-blocked explicitly requested: ' +
          'a missing Execution Outcome Receipt is interpreted as blocked execution',
      )
      findings.push({
        code: 'absence_interpreted_as_blocked',
        kind: 'applied_assumption',
        message:
          'No Execution Outcome Receipt was supplied. Under the explicit complete-emission ' +
          'assumption, absence is interpreted as blocked execution. This is an applied ' +
          'assumption, not an outcome receipt state, and not NO_EMISSION.',
      })
    } else {
      unresolvedAuditGap = true
      findings.push({
        code: 'missing_execution_outcome_receipt',
        kind: 'audit_gap',
        message:
          'No Execution Outcome Receipt was supplied. Absence of an Execution Outcome Receipt ' +
          'is a verifier finding (audit gap), not an outcome state. It proves blocked execution ' +
          'only under a separately verifiable complete-emission guarantee applied explicitly.',
      })
    }
  }

  return {
    ok: !unresolvedAuditGap,
    actionRef: expected,
    joined: { evaluation: evaluationPresent, outcome: outcomePresent, sar: sarPresent },
    findings,
    appliedAssumptions,
  }
}

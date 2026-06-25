/**
 * Continuity Evaluation Receipt (schema_id: ds.continuity_evaluation.v0.1).
 *
 * Records the evaluator / gate result for a committed logical action BEFORE
 * execution. It is a SIGNED normative record: trust comes from the evaluator's
 * Ed25519 signature, and `evaluator_id` is bound to the signing key.
 *
 * Layer boundary:
 *   - Action Commitment answers: what committed logical action is this about?
 *   - Continuity Evaluation Receipt answers: what did the evaluator/gate
 *     determine before execution?
 *
 * A Continuity Evaluation Receipt does NOT prove delivery.
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

export const CONTINUITY_EVALUATION_SCHEMA_ID = 'ds.continuity_evaluation.v0.1' as const

/**
 * Allowed `evaluation_state` values.
 *
 *   PASS              — evaluator completed and returned a permit/allow verdict.
 *   FAIL              — evaluator completed and returned a deny/block verdict.
 *   INDETERMINATE     — evaluator COMPLETED but could not reach a permit or deny
 *                       verdict. A positive artifact of uncertainty.
 *   EVALUATOR_TIMEOUT — evaluator did NOT complete and produced no verdict before
 *                       the timeout boundary (non-completion).
 *
 * INDETERMINATE and EVALUATOR_TIMEOUT are NOT synonyms: INDETERMINATE is a
 * completed evaluation with uncertainty; EVALUATOR_TIMEOUT is non-completion.
 */
export const EVALUATION_STATES = ['PASS', 'FAIL', 'INDETERMINATE', 'EVALUATOR_TIMEOUT'] as const
export type EvaluationState = (typeof EVALUATION_STATES)[number]

/** Canonical unsigned core of a Continuity Evaluation Receipt. */
export interface ContinuityEvaluationCore {
  schema_id: typeof CONTINUITY_EVALUATION_SCHEMA_ID
  action_ref: string
  evaluator_id: string
  evaluation_state: EvaluationState
  /**
   * Stable string reference to the policy applied — NOT a digest in v0.1, and
   * NOT a normative policy commitment. A future v0.2 MAY add `policy_digest`
   * once policy representation is normative. Do not introduce `policy_digest`
   * here.
   */
  policy_ref: string
  /**
   * Required for audit / human inspection and signed as part of the record's
   * factual claim. NOT a join key: it must not affect `action_ref` and must not
   * be used to join retries (retry-stable joining is via `action_ref`).
   */
  evaluated_at: string
}

/** A signed Continuity Evaluation Receipt: canonical core + signature envelope. */
export type ContinuityEvaluationReceipt = Signed<ContinuityEvaluationCore>

export interface ContinuityEvaluationInput {
  actionRef: string
  evaluatorId: string
  evaluationState: EvaluationState
  policyRef: string
  evaluatedAt: string
}

function validatePolicyRef(policyRef: unknown): void {
  if (typeof policyRef !== 'string' || policyRef.trim() === '') {
    throw new ContinuityRecordError('policy_ref is required and must be a non-empty stable string reference')
  }
}

/** Build and validate a canonical Continuity Evaluation Receipt core (unsigned). */
export function buildContinuityEvaluationCore(input: ContinuityEvaluationInput): ContinuityEvaluationCore {
  validateActionRef(input.actionRef)
  validateAgentId(input.evaluatorId, 'evaluator_id')
  if (!EVALUATION_STATES.includes(input.evaluationState)) {
    throw new ContinuityRecordError(
      `evaluation_state must be one of ${EVALUATION_STATES.join(', ')}; got ${String(input.evaluationState)}`,
    )
  }
  validatePolicyRef(input.policyRef)
  validateTimestamp(input.evaluatedAt, 'evaluated_at')
  return {
    schema_id: CONTINUITY_EVALUATION_SCHEMA_ID,
    action_ref: input.actionRef,
    evaluator_id: input.evaluatorId,
    evaluation_state: input.evaluationState,
    policy_ref: input.policyRef,
    evaluated_at: input.evaluatedAt,
  }
}

/** Validate an already-formed Continuity Evaluation Receipt core. */
export function validateContinuityEvaluationCore(core: ContinuityEvaluationCore): void {
  if (core == null || typeof core !== 'object') {
    throw new ContinuityRecordError('continuity evaluation core must be an object')
  }
  if (core.schema_id !== CONTINUITY_EVALUATION_SCHEMA_ID) {
    throw new ContinuityRecordError(`schema_id must be exactly ${CONTINUITY_EVALUATION_SCHEMA_ID}`)
  }
  validateActionRef(core.action_ref)
  validateAgentId(core.evaluator_id, 'evaluator_id')
  if (!EVALUATION_STATES.includes(core.evaluation_state)) {
    throw new ContinuityRecordError(
      `evaluation_state must be one of ${EVALUATION_STATES.join(', ')}; got ${String(core.evaluation_state)}`,
    )
  }
  validatePolicyRef(core.policy_ref)
  validateTimestamp(core.evaluated_at, 'evaluated_at')
}

/**
 * Sign a Continuity Evaluation Receipt with the evaluator's Ed25519 private
 * key. The `signature.key_id` is bound to `evaluator_id`, so verification will
 * require the trusted key for that identity.
 */
export function signContinuityEvaluationReceipt(
  input: ContinuityEvaluationInput | ContinuityEvaluationCore,
  evaluatorPrivateKey: KeyObject,
): ContinuityEvaluationReceipt {
  const core =
    'schema_id' in input ? (validateContinuityEvaluationCore(input), input) : buildContinuityEvaluationCore(input)
  return signEnvelope(core, evaluatorPrivateKey, core.evaluator_id)
}

/**
 * Verify a signed Continuity Evaluation Receipt. `expectedEvaluatorPublicKey`
 * is the trusted Ed25519 public key bound to the record's `evaluator_id`
 * (resolved out of band). Enforces both core validity and
 * identity-to-signing-key binding: a valid signature whose `evaluator_id` /
 * signing key does not match fails.
 */
export function verifyContinuityEvaluationReceipt(
  record: ContinuityEvaluationReceipt | (ContinuityEvaluationCore & { signature?: SignatureBlock }),
  expectedEvaluatorPublicKey: KeyObject,
): ContinuityEvaluationCore {
  const core = verifyEnvelope<ContinuityEvaluationCore>(record, {
    expectedPublicKey: expectedEvaluatorPublicKey,
    expectedKeyId: (record as ContinuityEvaluationCore).evaluator_id,
  })
  validateContinuityEvaluationCore(core)
  return core
}

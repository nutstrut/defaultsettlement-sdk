/**
 * @defaultsettlement/continuity
 *
 * The continuity composition layer for Default Settlement. It adds the two
 * SIGNED normative records that compose with the (unsigned) Action Commitment
 * correlation primitive around a shared `action_ref`:
 *
 *   1. Continuity Evaluation Receipt (ds.continuity_evaluation.v0.1)
 *        — what the evaluator/gate determined BEFORE execution.
 *   2. Execution Outcome Receipt     (ds.execution_outcome.v0.1)
 *        — what the mutation-capable executor DID.
 *
 * These let an independent verifier join pre-execution evaluation, execution
 * outcome, and SAR delivery/settlement evidence through the same `action_ref`.
 *
 * Doctrine:
 *   Action Commitment closes the correlation gap, not the
 *   execution-faithfulness gap.
 *   Absence of an Execution Outcome Receipt is a verifier finding, not an
 *   outcome state.
 *
 * Layer boundary: this package is a sibling / upper composition layer to
 * SAR-402. It does NOT own SAR semantics and does NOT import SAR-402 source.
 */

export { ContinuityError, ContinuityRecordError, ContinuitySignatureError, ContinuityCompositionError } from './errors.js'

export {
  AGENT_ID_RE,
  SHA256_DIGEST_RE,
  ACTION_REF_RE,
  canonicalJson,
  sha256Hex,
  validateAgentId,
  validateActionRef,
  validateTimestamp,
} from './canonical.js'

export {
  SIGNATURE_ALG,
  generateEd25519KeyPair,
  exportPublicKeyB64,
  importPublicKeyB64,
  signedCore,
  canonicalSigningInput,
  signedPayloadDigest,
  signEnvelope,
  verifyEnvelope,
} from './signing.js'
export type { SignatureBlock, Signed, VerifyEnvelopeOptions } from './signing.js'

export {
  CONTINUITY_EVALUATION_SCHEMA_ID,
  EVALUATION_STATES,
  buildContinuityEvaluationCore,
  validateContinuityEvaluationCore,
  signContinuityEvaluationReceipt,
  verifyContinuityEvaluationReceipt,
} from './continuity-evaluation.js'
export type {
  EvaluationState,
  ContinuityEvaluationCore,
  ContinuityEvaluationReceipt,
  ContinuityEvaluationInput,
} from './continuity-evaluation.js'

export {
  EXECUTION_OUTCOME_SCHEMA_ID,
  OUTCOME_STATES,
  buildExecutionOutcomeCore,
  validateExecutionOutcomeCore,
  signExecutionOutcomeReceipt,
  verifyExecutionOutcomeReceipt,
} from './execution-outcome.js'
export type {
  OutcomeState,
  ExecutionOutcomeCore,
  ExecutionOutcomeReceipt,
  ExecutionOutcomeInput,
} from './execution-outcome.js'

export { validateActionRefComposition } from './composition.js'
export type {
  CompositionInput,
  CompositionResult,
  CompositionFinding,
  CompositionFindingCode,
} from './composition.js'

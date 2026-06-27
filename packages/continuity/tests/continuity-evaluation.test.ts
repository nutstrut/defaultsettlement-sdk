import { describe, it, expect } from 'vitest'
import {
  CONTINUITY_EVALUATION_SCHEMA_ID,
  buildContinuityEvaluationCore,
  signContinuityEvaluationReceipt,
  verifyContinuityEvaluationReceipt,
  type ContinuityEvaluationInput,
  type EvaluationState,
} from '../src/index.js'
import { ContinuityRecordError, ContinuitySignatureError } from '../src/errors.js'
import { ACTION_REF, keypair } from './helpers.js'

function input(over: Partial<ContinuityEvaluationInput> = {}): ContinuityEvaluationInput {
  return {
    actionRef: ACTION_REF,
    evaluatorId: 'agent:example',
    evaluationState: 'INDETERMINATE',
    policyRef: 'policy:default-settlement/sar-402-delivery-v1',
    evaluatedAt: '2026-06-25T14:30:00Z',
    ...over,
  }
}

describe('Continuity Evaluation Receipt — core', () => {
  for (const state of ['PASS', 'FAIL', 'INDETERMINATE', 'EVALUATOR_TIMEOUT'] as EvaluationState[]) {
    it(`accepts valid ${state}`, () => {
      const core = buildContinuityEvaluationCore(input({ evaluationState: state }))
      expect(core.schema_id).toBe(CONTINUITY_EVALUATION_SCHEMA_ID)
      expect(core.evaluation_state).toBe(state)
    })
  }

  it('rejects an invalid evaluation_state', () => {
    expect(() => buildContinuityEvaluationCore(input({ evaluationState: 'MAYBE' as EvaluationState }))).toThrow(
      ContinuityRecordError,
    )
  })

  it('rejects an invalid action_ref', () => {
    expect(() => buildContinuityEvaluationCore(input({ actionRef: 'sha256:zzzz' }))).toThrow(ContinuityRecordError)
  })

  it('rejects an invalid evaluator_id (wrong scheme)', () => {
    expect(() => buildContinuityEvaluationCore(input({ evaluatorId: 'did:morpheus' }))).toThrow(ContinuityRecordError)
    expect(() => buildContinuityEvaluationCore(input({ evaluatorId: 'Agent Smith' }))).toThrow(ContinuityRecordError)
  })

  it('requires policy_ref', () => {
    expect(() => buildContinuityEvaluationCore(input({ policyRef: '' }))).toThrow(/policy_ref/)
  })

  it('requires evaluated_at', () => {
    expect(() => buildContinuityEvaluationCore(input({ evaluatedAt: '' }))).toThrow(/evaluated_at/)
    expect(() => buildContinuityEvaluationCore(input({ evaluatedAt: 'not-a-date' }))).toThrow(/evaluated_at/)
  })

  it('omits reason_code for clean PASS/FAIL cores (no noisy generic codes)', () => {
    const core = buildContinuityEvaluationCore(input({ evaluationState: 'PASS' }))
    expect('reason_code' in core).toBe(false)
  })

  it('includes reason_code when present (INDETERMINATE boundary case)', () => {
    const core = buildContinuityEvaluationCore(
      input({ evaluationState: 'INDETERMINATE', reasonCode: 'MISSING_ACCEPTANCE_SPEC' }),
    )
    expect(core.reason_code).toBe('MISSING_ACCEPTANCE_SPEC')
  })

  it('rejects an empty reason_code when the field is present', () => {
    expect(() => buildContinuityEvaluationCore(input({ reasonCode: '' }))).toThrow(/reason_code/)
  })
})

describe('Continuity Evaluation Receipt — signing', () => {
  it('signs and verifies', () => {
    const { publicKey, privateKey } = keypair()
    const receipt = signContinuityEvaluationReceipt(input(), privateKey)
    expect(receipt.signature.alg).toBe('ed25519')
    expect(receipt.signature.key_id).toBe('agent:example')
    const core = verifyContinuityEvaluationReceipt(receipt, publicKey)
    expect(core.evaluation_state).toBe('INDETERMINATE')
  })

  it('fails verification when the signed core is tampered', () => {
    const { publicKey, privateKey } = keypair()
    const receipt = signContinuityEvaluationReceipt(input({ evaluationState: 'PASS' }), privateKey)
    const tampered = { ...receipt, evaluation_state: 'FAIL' as EvaluationState }
    expect(() => verifyContinuityEvaluationReceipt(tampered, publicKey)).toThrow(ContinuitySignatureError)
  })

  it('fails verification when evaluator_id / signing key mismatch', () => {
    const evaluator = keypair()
    const attacker = keypair()
    // Signed by the attacker key, but verified against the legitimate evaluator key.
    const receipt = signContinuityEvaluationReceipt(input(), attacker.privateKey)
    expect(() => verifyContinuityEvaluationReceipt(receipt, evaluator.publicKey)).toThrow(ContinuitySignatureError)
  })

  it('signs reason_code inside the signed core (JCS signing input)', () => {
    const { publicKey, privateKey } = keypair()
    const receipt = signContinuityEvaluationReceipt(
      input({ evaluationState: 'INDETERMINATE', reasonCode: 'INVALID_ACCEPTANCE_SPEC' }),
      privateKey,
    )
    // Present in the signed record and verifies cleanly.
    expect(receipt.reason_code).toBe('INVALID_ACCEPTANCE_SPEC')
    const core = verifyContinuityEvaluationReceipt(receipt, publicKey)
    expect(core.reason_code).toBe('INVALID_ACCEPTANCE_SPEC')
    // Tampering with reason_code breaks verification -> it is in the signing input.
    const tampered = { ...receipt, reason_code: 'SOMETHING_ELSE' }
    expect(() => verifyContinuityEvaluationReceipt(tampered, publicKey)).toThrow(ContinuitySignatureError)
  })

  it('fails verification when key_id does not equal evaluator_id', () => {
    const { publicKey, privateKey } = keypair()
    const receipt = signContinuityEvaluationReceipt(input(), privateKey)
    receipt.signature.key_id = 'agent:someoneelse'
    expect(() => verifyContinuityEvaluationReceipt(receipt, publicKey)).toThrow(ContinuitySignatureError)
  })
})

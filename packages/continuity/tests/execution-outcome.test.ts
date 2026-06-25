import { describe, it, expect } from 'vitest'
import {
  EXECUTION_OUTCOME_SCHEMA_ID,
  buildExecutionOutcomeCore,
  signExecutionOutcomeReceipt,
  verifyExecutionOutcomeReceipt,
  type ExecutionOutcomeInput,
  type OutcomeState,
} from '../src/index.js'
import { ContinuityRecordError, ContinuitySignatureError } from '../src/errors.js'
import { ACTION_REF, keypair } from './helpers.js'

function input(over: Partial<ExecutionOutcomeInput> = {}): ExecutionOutcomeInput {
  return {
    actionRef: ACTION_REF,
    executorId: 'agent:example',
    outcomeState: 'BLOCKED',
    reason: 'policy_blocked',
    recordedAt: '2026-06-25T14:31:00Z',
    ...over,
  }
}

describe('Execution Outcome Receipt — core', () => {
  for (const state of ['PROCEEDED', 'BLOCKED', 'FAILED'] as OutcomeState[]) {
    it(`accepts valid ${state}`, () => {
      const core = buildExecutionOutcomeCore(input({ outcomeState: state, reason: undefined }))
      expect(core.schema_id).toBe(EXECUTION_OUTCOME_SCHEMA_ID)
      expect(core.outcome_state).toBe(state)
    })
  }

  it('rejects NO_EMISSION as an outcome_state', () => {
    expect(() => buildExecutionOutcomeCore(input({ outcomeState: 'NO_EMISSION' as OutcomeState }))).toThrow(
      ContinuityRecordError,
    )
  })

  it('rejects an invalid outcome_state', () => {
    expect(() => buildExecutionOutcomeCore(input({ outcomeState: 'DONE' as OutcomeState }))).toThrow(
      ContinuityRecordError,
    )
  })

  it('rejects an invalid action_ref', () => {
    expect(() => buildExecutionOutcomeCore(input({ actionRef: 'nope' }))).toThrow(ContinuityRecordError)
  })

  it('rejects an invalid executor_id', () => {
    expect(() => buildExecutionOutcomeCore(input({ executorId: 'morpheus' }))).toThrow(ContinuityRecordError)
  })

  it('reason is optional — PROCEEDED without reason is valid and omits the field', () => {
    const core = buildExecutionOutcomeCore(input({ outcomeState: 'PROCEEDED', reason: undefined }))
    expect(core.outcome_state).toBe('PROCEEDED')
    expect('reason' in core).toBe(false)
  })

  it('reason, if present, is informational and does not change validity by value', () => {
    const a = buildExecutionOutcomeCore(input({ outcomeState: 'FAILED', reason: 'executor_error' }))
    const b = buildExecutionOutcomeCore(input({ outcomeState: 'FAILED', reason: 'something_completely_different' }))
    // Both valid; reason is non-load-bearing (verifier keys off outcome_state).
    expect(a.outcome_state).toBe('FAILED')
    expect(b.outcome_state).toBe('FAILED')
  })

  it('requires recorded_at', () => {
    expect(() => buildExecutionOutcomeCore(input({ recordedAt: '' }))).toThrow(/recorded_at/)
  })
})

describe('Execution Outcome Receipt — signing', () => {
  it('signs and verifies', () => {
    const { publicKey, privateKey } = keypair()
    const receipt = signExecutionOutcomeReceipt(input(), privateKey)
    expect(receipt.signature.key_id).toBe('agent:example')
    const core = verifyExecutionOutcomeReceipt(receipt, publicKey)
    expect(core.outcome_state).toBe('BLOCKED')
  })

  it('fails verification when the signed core is tampered', () => {
    const { publicKey, privateKey } = keypair()
    const receipt = signExecutionOutcomeReceipt(input({ outcomeState: 'BLOCKED' }), privateKey)
    const tampered = { ...receipt, outcome_state: 'PROCEEDED' as OutcomeState }
    expect(() => verifyExecutionOutcomeReceipt(tampered, publicKey)).toThrow(ContinuitySignatureError)
  })

  it('fails verification when executor_id / signing key mismatch', () => {
    const executor = keypair()
    const attacker = keypair()
    const receipt = signExecutionOutcomeReceipt(input(), attacker.privateKey)
    expect(() => verifyExecutionOutcomeReceipt(receipt, executor.publicKey)).toThrow(ContinuitySignatureError)
  })
})

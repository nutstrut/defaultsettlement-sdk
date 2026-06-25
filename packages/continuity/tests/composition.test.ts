import { describe, it, expect } from 'vitest'
import {
  buildContinuityEvaluationCore,
  buildExecutionOutcomeCore,
  validateActionRefComposition,
} from '../src/index.js'
import { ContinuityCompositionError } from '../src/errors.js'
import { ACTION_REF, OTHER_ACTION_REF, sarReceipt } from './helpers.js'

function evaluation(actionRef = ACTION_REF) {
  return buildContinuityEvaluationCore({
    actionRef,
    evaluatorId: 'agent:example',
    evaluationState: 'PASS',
    policyRef: 'policy:default-settlement/sar-402-delivery-v1',
    evaluatedAt: '2026-06-25T14:30:00Z',
  })
}

function outcome(actionRef = ACTION_REF) {
  return buildExecutionOutcomeCore({
    actionRef,
    executorId: 'agent:example',
    outcomeState: 'PROCEEDED',
    recordedAt: '2026-06-25T14:31:00Z',
  })
}

describe('composition', () => {
  it('continuity + outcome + SAR all join on the same action_ref', () => {
    const result = validateActionRefComposition({
      expectedActionRef: ACTION_REF,
      evaluation: evaluation(),
      outcome: outcome(),
      sarReceipt: sarReceipt(ACTION_REF),
    })
    expect(result.ok).toBe(true)
    expect(result.joined).toEqual({ evaluation: true, outcome: true, sar: true })
    expect(result.findings).toHaveLength(0)
  })

  it('mismatched continuity action_ref fails', () => {
    expect(() =>
      validateActionRefComposition({ expectedActionRef: ACTION_REF, evaluation: evaluation(OTHER_ACTION_REF) }),
    ).toThrow(ContinuityCompositionError)
  })

  it('mismatched outcome action_ref fails', () => {
    expect(() =>
      validateActionRefComposition({ expectedActionRef: ACTION_REF, outcome: outcome(OTHER_ACTION_REF) }),
    ).toThrow(ContinuityCompositionError)
  })

  it('mismatched SAR binding action_ref fails', () => {
    expect(() =>
      validateActionRefComposition({ expectedActionRef: ACTION_REF, sarReceipt: sarReceipt(OTHER_ACTION_REF) }),
    ).toThrow(ContinuityCompositionError)
  })

  it('missing outcome produces an audit-gap finding and ok: false by default', () => {
    const result = validateActionRefComposition({ expectedActionRef: ACTION_REF, evaluation: evaluation() })
    expect(result.ok).toBe(false)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.code).toBe('missing_execution_outcome_receipt')
    expect(result.findings[0]?.kind).toBe('audit_gap')
  })

  it('missing outcome with completeEmissionGuaranteed: false produces an audit-gap finding and ok: false', () => {
    const result = validateActionRefComposition({
      expectedActionRef: ACTION_REF,
      evaluation: evaluation(),
      completeEmissionGuaranteed: false,
    })
    expect(result.ok).toBe(false)
    expect(result.findings[0]?.code).toBe('missing_execution_outcome_receipt')
    expect(result.appliedAssumptions).toHaveLength(0)
  })

  it('completeEmissionGuaranteed: true alone does NOT silently treat absence as blocked (ok: false)', () => {
    const result = validateActionRefComposition({
      expectedActionRef: ACTION_REF,
      evaluation: evaluation(),
      completeEmissionGuaranteed: true,
    })
    // Without the explicit interpret flag, absence is still an unresolved audit gap.
    expect(result.ok).toBe(false)
    expect(result.findings[0]?.code).toBe('missing_execution_outcome_receipt')
    expect(result.appliedAssumptions).toHaveLength(0)
  })

  it('missing outcome with both flags explicitly true is interpreted as blocked (ok: true)', () => {
    const result = validateActionRefComposition({
      expectedActionRef: ACTION_REF,
      evaluation: evaluation(),
      completeEmissionGuaranteed: true,
      interpretAbsenceAsBlocked: true,
    })
    expect(result.ok).toBe(true)
    expect(result.findings[0]?.code).toBe('absence_interpreted_as_blocked')
    expect(result.findings[0]?.kind).toBe('applied_assumption')
    expect(result.appliedAssumptions.length).toBeGreaterThan(0)
  })

  it('absence is never represented as NO_EMISSION', () => {
    const result = validateActionRefComposition({ expectedActionRef: ACTION_REF })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('NO_EMISSION')
    expect(result.findings.every((f) => f.code !== ('NO_EMISSION' as never))).toBe(true)
  })
})

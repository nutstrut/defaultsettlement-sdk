import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  importPublicKeyB64,
  verifyContinuityEvaluationReceipt,
  verifyExecutionOutcomeReceipt,
  validateActionRefComposition,
  type ContinuityEvaluationReceipt,
  type ExecutionOutcomeReceipt,
  type CompositionInput,
} from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, '..', 'examples', 'action-ref-composition')
const SAR_FIXTURES = join(here, '..', '..', 'sar-402', 'examples', 'action-commitment-composition')

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

const scenarioDirs = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

describe('action-ref-composition fixtures', () => {
  it('has the five expected scenarios', () => {
    expect(scenarioDirs).toEqual([
      '01-pass-proceeded-delivered',
      '02-fail-blocked',
      '03-indeterminate-blocked',
      '04-indeterminate-proceeded',
      '05-evaluator-timeout-audit-gap',
    ])
  })

  for (const dir of scenarioDirs) {
    describe(dir, () => {
      const evalReceipt = readJson<ContinuityEvaluationReceipt>(
        join(FIXTURES, dir, 'continuity-evaluation-receipt.json'),
      )

      it('continuity evaluation receipt verifies against its bound key', () => {
        const pub = importPublicKeyB64(evalReceipt.signature.public_key)
        expect(() => verifyContinuityEvaluationReceipt(evalReceipt, pub)).not.toThrow()
      })

      const outcomePath = join(FIXTURES, dir, 'execution-outcome-receipt.json')
      const hasOutcome = existsSync(outcomePath)

      if (hasOutcome) {
        it('execution outcome receipt verifies against its bound key', () => {
          const outcome = readJson<ExecutionOutcomeReceipt>(outcomePath)
          const pub = importPublicKeyB64(outcome.signature.public_key)
          expect(() => verifyExecutionOutcomeReceipt(outcome, pub)).not.toThrow()
        })
      } else {
        it('audit-gap scenario emits NO execution outcome receipt (absence is a finding, not a record)', () => {
          expect(hasOutcome).toBe(false)
          const comp = readJson<{ composition: { findings: { code: string }[] } }>(
            join(FIXTURES, dir, 'composition.json'),
          )
          expect(comp.composition.findings.some((f) => f.code === 'missing_execution_outcome_receipt')).toBe(true)
        })
      }

      it('records join the SAR Action Commitment fixture on the same action_ref', () => {
        const comp = readJson<{ _cross_reference: { action_ref_join_primitive: string }; action_ref: string }>(
          join(FIXTURES, dir, 'composition.json'),
        )
        const sarScenario = comp._cross_reference.action_ref_join_primitive.split('/').pop()!
        const sarJoin = readJson<{ action_ref: string }>(join(SAR_FIXTURES, sarScenario, 'join.json'))
        expect(comp.action_ref).toBe(sarJoin.action_ref)
        expect(evalReceipt.action_ref).toBe(sarJoin.action_ref)
      })

      it('composition re-validates with the same action_ref join', () => {
        const actionRef = evalReceipt.action_ref
        const input: CompositionInput = { expectedActionRef: actionRef, evaluation: evalReceipt }
        if (hasOutcome) input.outcome = readJson<ExecutionOutcomeReceipt>(outcomePath)
        const sarPath = join(FIXTURES, dir, 'composition.json')
        const cross = readJson<{ _cross_reference: { sar_delivery_receipt: string | null } }>(sarPath)
        if (cross._cross_reference.sar_delivery_receipt) {
          input.sarReceipt = readJson(join(here, '..', '..', '..', cross._cross_reference.sar_delivery_receipt))
        }
        const result = validateActionRefComposition(input)
        expect(result.actionRef).toBe(actionRef)
        // Scenarios with an outcome receipt resolve cleanly; the audit-gap
        // scenario (no outcome receipt, no explicit assumption) is ok: false.
        expect(result.ok).toBe(hasOutcome)
      })

      it('absence is never represented AS a NO_EMISSION outcome state or finding code', () => {
        // Prose may mention NO_EMISSION to explain why it is rejected; the
        // invariant is that it is never an actual outcome_state value or
        // finding code.
        const comp = readJson<{ composition: { findings: { code: string }[] } }>(
          join(FIXTURES, dir, 'composition.json'),
        )
        expect(comp.composition.findings.every((f) => f.code !== 'NO_EMISSION')).toBe(true)
        if (hasOutcome) {
          const outcome = readJson<{ outcome_state: string }>(outcomePath)
          expect(outcome.outcome_state).not.toBe('NO_EMISSION')
        }
      })
    })
  }
})

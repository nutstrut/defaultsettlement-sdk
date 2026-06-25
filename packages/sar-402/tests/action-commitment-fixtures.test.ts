import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deriveRequestDigest,
  deriveActionRef,
  validateOperationBinding,
  ActionCommitmentError,
  type ActionRequestCommitment,
  type ActionCommitment,
} from '../src/action-commitment.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesRoot = join(here, '..', 'examples', 'action-commitment-composition')

const readJson = (...p: string[]): any => JSON.parse(readFileSync(join(fixturesRoot, ...p), 'utf8'))

const scenarios = [
  '01-pass-delivered',
  '02-fail-blocked',
  '03a-indeterminate-blocked',
  '03b-indeterminate-absence',
  '04-indeterminate-proceeded',
  '05-evaluator-timeout',
]

describe('action-commitment composition fixtures', () => {
  for (const scenario of scenarios) {
    describe(scenario, () => {
      const request = readJson(scenario, 'action-request-commitment.json') as ActionRequestCommitment
      const commitment = readJson(scenario, 'action-commitment.json') as ActionCommitment
      const joinMeta = readJson(scenario, 'join.json') as { request_digest: string; action_ref: string }

      const requestDigest = deriveRequestDigest(request)
      const actionRef = deriveActionRef(commitment)

      it('re-derives the committed request_digest from the canonical request', () => {
        expect(requestDigest).toBe(joinMeta.request_digest)
        expect(commitment.request_digest).toBe(requestDigest)
      })

      it('re-derives the committed action_ref from the canonical commitment', () => {
        expect(actionRef).toBe(joinMeta.action_ref)
      })

      it('every downstream record in the folder is joined by the same action_ref', () => {
        for (const file of ['evaluator-record.json', 'outcome-receipt.json']) {
          const path = join(fixturesRoot, scenario, file)
          if (!existsSync(path)) continue
          const record = JSON.parse(readFileSync(path, 'utf8'))
          expect(record.action_ref).toBe(actionRef)
        }
      })

      it('SAR receipt (when present) carries a matching operation binding', () => {
        const path = join(fixturesRoot, scenario, 'sar-receipt.json')
        if (!existsSync(path)) return
        const sar = JSON.parse(readFileSync(path, 'utf8'))
        expect(() => validateOperationBinding(sar, actionRef)).not.toThrow()
        // A wrong expected action_ref must fail the correlation check.
        expect(() => validateOperationBinding(sar, 'sha256:' + '0'.repeat(64))).toThrow(
          ActionCommitmentError,
        )
      })
    })
  }

  it('distinct intended operations across scenarios have distinct action_refs', () => {
    const refs = scenarios.map((s) => deriveActionRef(readJson(s, 'action-commitment.json')))
    expect(new Set(refs).size).toBe(scenarios.length)
  })

  it('scenarios 02, 03a, 03b, 05 model blocked/absence: no SAR delivery receipt exists', () => {
    for (const scenario of ['02-fail-blocked', '03a-indeterminate-blocked', '03b-indeterminate-absence', '05-evaluator-timeout']) {
      expect(existsSync(join(fixturesRoot, scenario, 'sar-receipt.json'))).toBe(false)
    }
  })

  it('absence scenarios (03b, 05) have no outcome receipt — only an audit gap', () => {
    for (const scenario of ['03b-indeterminate-absence', '05-evaluator-timeout']) {
      expect(existsSync(join(fixturesRoot, scenario, 'outcome-receipt.json'))).toBe(false)
    }
  })
})

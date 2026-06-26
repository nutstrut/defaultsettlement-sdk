import { describe, it, expect } from 'vitest'
import {
  evaluateAcceptanceSpec,
  validateAcceptanceSpec,
  type AcceptanceSpec,
} from '../src/index.js'
import { ContinuityRecordError } from '../src/errors.js'
import { canonicalJson, sha256Hex } from '../src/canonical.js'

const SCHEMA_DIGEST = 'sha256:' + 'c'.repeat(64)

function spec(checks: AcceptanceSpec['checks']): AcceptanceSpec {
  return { spec_id: 'spec.test', evaluator_type: 'deterministic', checks }
}

describe('deterministic evaluator — aggregation', () => {
  it('PASS when all checks satisfied', () => {
    const out = evaluateAcceptanceSpec(
      spec([
        { kind: 'field_present', inputs: { output_path: '$.manifest' } },
        { kind: 'numeric_threshold', inputs: { output_path: '$.manifest.row_count' }, expected: { op: '>=', value: 1000 } },
        { kind: 'field_equals', inputs: { output_path: '$.status' }, expected: 'ok' },
      ]),
      { status: 'ok', manifest: { row_count: 1200 } },
    )
    expect(out.result).toBe('PASS')
    expect(out.checks.every((c) => c.status === 'satisfied')).toBe(true)
  })

  it('FAIL when a hard check is unsatisfied', () => {
    const out = evaluateAcceptanceSpec(
      spec([
        { kind: 'field_present', inputs: { output_path: '$.manifest' } },
        { kind: 'numeric_threshold', inputs: { output_path: '$.manifest.row_count' }, expected: { op: '>=', value: 1000 }, failure_behavior: 'FAIL' },
      ]),
      { manifest: { row_count: 740 } },
    )
    expect(out.result).toBe('FAIL')
    expect(out.checks[1]).toMatchObject({ status: 'unsatisfied', observed: 740 })
  })

  it('INDETERMINATE when a check is unevaluable and no hard FAIL dominates', () => {
    const out = evaluateAcceptanceSpec(
      spec([
        { kind: 'field_present', inputs: { output_path: '$.manifest' } },
        { kind: 'json_schema', inputs: { output_path: '$.manifest' }, external_refs: { schema_ref: SCHEMA_DIGEST } },
      ]),
      { manifest: { row_count: 1200 } },
    )
    expect(out.result).toBe('INDETERMINATE')
  })

  it('hard FAIL dominates INDETERMINATE', () => {
    const out = evaluateAcceptanceSpec(
      spec([
        { kind: 'json_schema', inputs: { output_path: '$.manifest' }, external_refs: { schema_ref: SCHEMA_DIGEST } },
        { kind: 'numeric_threshold', inputs: { output_path: '$.manifest.row_count' }, expected: { op: '>=', value: 1000 }, failure_behavior: 'FAIL' },
      ]),
      { manifest: { row_count: 740 } },
    )
    expect(out.result).toBe('FAIL')
  })
})

describe('deterministic evaluator — external refs', () => {
  it('rejects mutable references', () => {
    for (const ref of ['latest', 'https://example.com/schema.json', 'v1']) {
      expect(() =>
        validateAcceptanceSpec(spec([{ kind: 'json_schema', external_refs: { schema_ref: ref } }])),
      ).toThrow(ContinuityRecordError)
    }
  })

  it('accepts a content-addressed sha256 ref', () => {
    expect(() =>
      validateAcceptanceSpec(spec([{ kind: 'json_schema', external_refs: { schema_ref: SCHEMA_DIGEST } }])),
    ).not.toThrow()
  })
})

describe('deterministic evaluator — check kinds', () => {
  it('hash_equals works with sha256:<digest>', () => {
    const value = { a: 1, b: [2, 3] }
    const digest = sha256Hex(canonicalJson(value))
    const ok = evaluateAcceptanceSpec(
      spec([{ kind: 'hash_equals', inputs: { output_path: '$.payload' }, expected: digest }]),
      { payload: value },
    )
    expect(ok.result).toBe('PASS')

    const bad = evaluateAcceptanceSpec(
      spec([{ kind: 'hash_equals', inputs: { output_path: '$.payload' }, expected: 'sha256:' + 'd'.repeat(64) }]),
      { payload: value },
    )
    expect(bad.result).toBe('FAIL')
  })

  it('numeric_threshold supports >=, >, <=, <, ==', () => {
    const cases: Array<[string, number, number, boolean]> = [
      ['>=', 1000, 1000, true],
      ['>', 1000, 1000, false],
      ['<=', 740, 1000, true],
      ['<', 1000, 1000, false],
      ['==', 1200, 1200, true],
    ]
    for (const [op, value, threshold, expectPass] of cases) {
      const out = evaluateAcceptanceSpec(
        spec([{ kind: 'numeric_threshold', inputs: { output_path: '$.n' }, expected: { op, value: threshold } }]),
        { n: value },
      )
      expect(out.result, `${value} ${op} ${threshold}`).toBe(expectPass ? 'PASS' : 'FAIL')
    }
  })

  it('field_present and field_equals work on simple dot paths', () => {
    const present = evaluateAcceptanceSpec(
      spec([{ kind: 'field_present', inputs: { output_path: '$.headers.content_type' } }]),
      { headers: { content_type: 'application/json' } },
    )
    expect(present.result).toBe('PASS')

    const missing = evaluateAcceptanceSpec(
      spec([{ kind: 'field_present', inputs: { output_path: '$.headers.content_type' } }]),
      { headers: {} },
    )
    expect(missing.result).toBe('FAIL')

    const equals = evaluateAcceptanceSpec(
      spec([{ kind: 'field_equals', inputs: { output_path: '$.status' }, expected: 'delivered' }]),
      { status: 'delivered' },
    )
    expect(equals.result).toBe('PASS')
  })

  it('content_type_equals and http_status_equals compare literals', () => {
    const out = evaluateAcceptanceSpec(
      spec([
        { kind: 'content_type_equals', inputs: { output_path: '$.headers.content_type' }, expected: 'application/json' },
        { kind: 'http_status_equals', inputs: { output_path: '$.status_code' }, expected: 200 },
      ]),
      { headers: { content_type: 'application/json' }, status_code: 200 },
    )
    expect(out.result).toBe('PASS')
  })

  it('json_schema returns INDETERMINATE with reason "json_schema_not_implemented"', () => {
    const out = evaluateAcceptanceSpec(
      spec([{ kind: 'json_schema', inputs: { output_path: '$.manifest' }, external_refs: { schema_ref: SCHEMA_DIGEST } }]),
      { manifest: { row_count: 1200 } },
    )
    expect(out.result).toBe('INDETERMINATE')
    expect(out.checks[0]).toMatchObject({ status: 'unevaluable', reason: 'json_schema_not_implemented' })
  })
})

/**
 * Deterministic acceptance-spec evaluator (v0.1).
 *
 * This is NOT a new primitive, NOT an Action Commitment schema change, and NOT
 * a policy engine. It is the smallest pure helper that takes a committed
 * acceptance spec (the one that rides inside the Action Request body at
 * `ds_conditional_release.acceptance_spec`, covered by `body_digest`) plus a
 * submitted output, and produces an inspectable evaluation result.
 *
 * That result is what a {@link buildContinuityEvaluationCore Continuity
 * Evaluation Receipt} records against the shared `action_ref`. The evaluator
 * lives in this package because continuity records evaluator conclusions.
 *
 * Bounded claim (and nothing more):
 *
 *   A deterministic evaluator applied a declared acceptance spec to a
 *   referenced output and produced a recorded result.
 *
 * It does NOT prove objective correctness, payment/resource release, or that
 * any downstream system honored the release policy.
 *
 * See: reports/strategy/deterministic-conditional-release-profile-20260626.md
 * (Morpheus repo) §3–§4.
 */

import { canonicalJson, sha256Hex, SHA256_DIGEST_RE } from './canonical.js'
import { ContinuityRecordError } from './errors.js'

/** Aggregate evaluation result. Mirrors {@link EvaluationState}. */
export type EvaluationResult = 'PASS' | 'FAIL' | 'INDETERMINATE' | 'EVALUATOR_TIMEOUT'

/** Per-check outcome. */
export type CheckStatus = 'satisfied' | 'unsatisfied' | 'unevaluable'

/** What a non-satisfied check contributes to the aggregate. */
export type FailureBehavior = 'FAIL' | 'INDETERMINATE'

/** Supported deterministic check kinds for v0.1. */
export type CheckKind =
  | 'field_present'
  | 'field_equals'
  | 'numeric_threshold'
  | 'hash_equals'
  | 'content_type_equals'
  | 'http_status_equals'
  | 'json_schema'

/** Comparison operators for {@link numeric_threshold} checks. */
export type ThresholdOp = '>=' | '>' | '<=' | '<' | '=='

/** A single committed check. */
export interface AcceptanceCheck {
  kind: CheckKind
  inputs?: Record<string, unknown>
  expected?: unknown
  external_refs?: Record<string, string>
  failure_behavior?: FailureBehavior
}

/** The committed acceptance spec (lives inside the Action Request body). */
export interface AcceptanceSpec {
  spec_id?: string
  evaluator_type?: string
  checks: AcceptanceCheck[]
}

/** Inspectable per-check detail recorded alongside the aggregate. */
export interface CheckDetail {
  kind: CheckKind
  status: CheckStatus
  observed?: unknown
  expected?: unknown
  reason?: string
}

/** Structured evaluation result. */
export interface EvaluationOutcome {
  result: EvaluationResult
  checks: CheckDetail[]
}

const CHECK_KINDS: ReadonlySet<string> = new Set<CheckKind>([
  'field_present',
  'field_equals',
  'numeric_threshold',
  'hash_equals',
  'content_type_equals',
  'http_status_equals',
  'json_schema',
])

const THRESHOLD_OPS: ReadonlySet<string> = new Set<ThresholdOp>(['>=', '>', '<=', '<', '=='])

/**
 * Sentinel returned by dot-path traversal when a path does not resolve. Using a
 * unique symbol distinguishes "path absent" from "path present with value
 * undefined/null".
 */
const ABSENT = Symbol('absent')

/**
 * Minimal dot-path traversal. v0.1 deliberately implements only the small
 * subset of JSONPath we need — a leading `$` followed by dot-separated object
 * keys, e.g. `$.manifest.row_count`, `$.status`, `$.headers.content_type`.
 *
 * A full JSONPath library is a documented implementation gap, NOT a reason to
 * add a dependency for v0.1. Array indexing, wildcards, and filters are out of
 * scope.
 *
 * Returns {@link ABSENT} if any segment is missing or traversal hits a
 * non-object before consuming the whole path.
 */
function resolveDotPath(output: unknown, path: string): unknown {
  if (typeof path !== 'string' || path.length === 0) return ABSENT
  if (path === '$') return output
  if (!path.startsWith('$.')) return ABSENT
  const segments = path.slice(2).split('.')
  let current: unknown = output
  for (const seg of segments) {
    if (seg === '') return ABSENT
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return ABSENT
    if (!Object.prototype.hasOwnProperty.call(current, seg)) return ABSENT
    current = (current as Record<string, unknown>)[seg]
  }
  return current
}

/** Mutable references are forbidden: every external ref must be `sha256:<digest>`. */
function isContentAddressed(ref: unknown): ref is string {
  return typeof ref === 'string' && SHA256_DIGEST_RE.test(ref)
}

/** Deep structural equality over the v0.1 JSON value domain (via canonical JSON). */
function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

function unevaluable(kind: CheckKind, reason: string, expected?: unknown): CheckDetail {
  return { kind, status: 'unevaluable', reason, ...(expected !== undefined ? { expected } : {}) }
}

function evaluateCheck(check: AcceptanceCheck, output: unknown): CheckDetail {
  const { kind } = check
  const inputs = (check.inputs ?? {}) as Record<string, unknown>
  const outputPath = inputs.output_path

  switch (kind) {
    case 'field_present': {
      if (typeof outputPath !== 'string') return unevaluable(kind, 'inputs.output_path is required')
      const value = resolveDotPath(output, outputPath)
      if (value === ABSENT) {
        return { kind, status: 'unsatisfied', observed: null, reason: `output_path ${outputPath} not present` }
      }
      return { kind, status: 'satisfied', observed: value }
    }

    case 'field_equals': {
      if (typeof outputPath !== 'string') return unevaluable(kind, 'inputs.output_path is required')
      const value = resolveDotPath(output, outputPath)
      if (value === ABSENT) {
        return unevaluable(kind, `output_path ${outputPath} not present`, check.expected)
      }
      const ok = deepEqual(value, check.expected)
      return { kind, status: ok ? 'satisfied' : 'unsatisfied', observed: value, expected: check.expected }
    }

    case 'numeric_threshold': {
      if (typeof outputPath !== 'string') return unevaluable(kind, 'inputs.output_path is required')
      const expected = check.expected as { op?: unknown; value?: unknown } | undefined
      const op = expected?.op
      const threshold = expected?.value
      if (typeof op !== 'string' || !THRESHOLD_OPS.has(op) || typeof threshold !== 'number') {
        return unevaluable(kind, 'expected must be { op: ">="|">"|"<="|"<"|"==", value: <number> }', check.expected)
      }
      const value = resolveDotPath(output, outputPath)
      if (value === ABSENT) return unevaluable(kind, `output_path ${outputPath} not present`, check.expected)
      if (typeof value !== 'number') {
        return { kind, status: 'unsatisfied', observed: value, expected: check.expected, reason: 'observed value is not a number' }
      }
      let ok: boolean
      switch (op as ThresholdOp) {
        case '>=': ok = value >= threshold; break
        case '>': ok = value > threshold; break
        case '<=': ok = value <= threshold; break
        case '<': ok = value < threshold; break
        case '==': ok = value === threshold; break
      }
      return { kind, status: ok ? 'satisfied' : 'unsatisfied', observed: value, expected: check.expected }
    }

    case 'hash_equals': {
      // Hash the resolved value (or the whole output when no path is given).
      const target = outputPath === undefined ? output : resolveDotPath(output, outputPath as string)
      if (target === ABSENT) return unevaluable(kind, `output_path ${String(outputPath)} not present`, check.expected)
      const expected = check.expected
      if (!isContentAddressed(expected)) {
        return unevaluable(kind, 'expected must be a sha256:<digest> literal', expected)
      }
      const observed = sha256Hex(canonicalJson(target))
      return { kind, status: observed === expected ? 'satisfied' : 'unsatisfied', observed, expected }
    }

    case 'content_type_equals':
    case 'http_status_equals': {
      if (typeof outputPath !== 'string') return unevaluable(kind, 'inputs.output_path is required')
      const value = resolveDotPath(output, outputPath)
      if (value === ABSENT) return unevaluable(kind, `output_path ${outputPath} not present`, check.expected)
      const ok = deepEqual(value, check.expected)
      return { kind, status: ok ? 'satisfied' : 'unsatisfied', observed: value, expected: check.expected }
    }

    case 'json_schema': {
      // External-artifact check. The ref MUST be content-addressed even though
      // we cannot run validation yet — a mutable ref is rejected outright.
      const schemaRef = check.external_refs?.schema_ref
      if (!isContentAddressed(schemaRef)) {
        return unevaluable(kind, 'external_refs.schema_ref must be a sha256:<digest>', check.external_refs ?? null)
      }
      // No JSON Schema validator is in the dependency set for v0.1. Rather than
      // adding one without approval, json_schema is a documented implementation
      // gap and always routes to INDETERMINATE.
      return unevaluable(kind, 'json_schema_not_implemented', schemaRef)
    }

    default:
      return unevaluable(kind, `unsupported check kind: ${String(kind)}`)
  }
}

/**
 * Validate spec shape and the external-reference integrity boundary BEFORE
 * evaluation. Mutable external refs (`latest`, a URL, `v1`) are a hard spec
 * error: they would let the spec's meaning drift without invalidating
 * `body_digest`. Throws {@link ContinuityRecordError}.
 */
export function validateAcceptanceSpec(spec: AcceptanceSpec): void {
  if (spec === null || typeof spec !== 'object') throw new ContinuityRecordError('acceptance_spec must be an object')
  if (!Array.isArray(spec.checks)) throw new ContinuityRecordError('acceptance_spec.checks must be an array')
  if (spec.evaluator_type !== undefined && spec.evaluator_type !== 'deterministic') {
    throw new ContinuityRecordError(`evaluator_type must be "deterministic"; got ${String(spec.evaluator_type)}`)
  }
  spec.checks.forEach((check, i) => {
    if (check === null || typeof check !== 'object') throw new ContinuityRecordError(`checks[${i}] must be an object`)
    if (!CHECK_KINDS.has(check.kind)) throw new ContinuityRecordError(`checks[${i}].kind is unsupported: ${String(check.kind)}`)
    if (check.failure_behavior !== undefined && check.failure_behavior !== 'FAIL' && check.failure_behavior !== 'INDETERMINATE') {
      throw new ContinuityRecordError(`checks[${i}].failure_behavior must be "FAIL" or "INDETERMINATE"`)
    }
    const refs = check.external_refs ?? {}
    for (const [name, ref] of Object.entries(refs)) {
      if (!isContentAddressed(ref)) {
        throw new ContinuityRecordError(
          `checks[${i}].external_refs.${name} must be a content-addressed sha256:<digest>; mutable references are forbidden (got ${String(ref)})`,
        )
      }
    }
  })
}

/**
 * Apply a committed acceptance spec to a submitted output and produce an
 * inspectable result.
 *
 * Aggregation (profile §4):
 *   - PASS          — every check evaluated and satisfied.
 *   - FAIL          — at least one `failure_behavior: FAIL` check is unsatisfied.
 *   - INDETERMINATE — at least one check is unevaluable (or an unsatisfied
 *                     `failure_behavior: INDETERMINATE` check) and no hard FAIL
 *                     dominates.
 *   - EVALUATOR_TIMEOUT — not produced by this pure helper; timeout handling is
 *                     a documented future gap and is never silently coerced to
 *                     PASS or FAIL by callers.
 *
 * A hard FAIL dominates INDETERMINATE.
 *
 * @throws {ContinuityRecordError} if the spec shape or an external ref is invalid.
 */
export function evaluateAcceptanceSpec(spec: AcceptanceSpec, output: unknown): EvaluationOutcome {
  validateAcceptanceSpec(spec)

  const checks: CheckDetail[] = []
  let hardFail = false
  let indeterminate = false

  for (const check of spec.checks) {
    const detail = evaluateCheck(check, output)
    checks.push(detail)

    const behavior: FailureBehavior = check.failure_behavior ?? 'FAIL'
    if (detail.status === 'unsatisfied') {
      if (behavior === 'FAIL') hardFail = true
      else indeterminate = true
    } else if (detail.status === 'unevaluable') {
      // An unevaluable check cannot be a hard FAIL — it routes to INDETERMINATE
      // regardless of declared failure_behavior (we could not check it).
      indeterminate = true
    }
  }

  let result: EvaluationResult
  if (hardFail) result = 'FAIL'
  else if (indeterminate) result = 'INDETERMINATE'
  else result = 'PASS'

  return { result, checks }
}

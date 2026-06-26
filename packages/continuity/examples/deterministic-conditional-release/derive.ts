/**
 * Reproducible generator for the deterministic conditional-release example.
 *
 * Run (after `npm run build` at the repo root):
 *   npx tsx packages/continuity/examples/deterministic-conditional-release/derive.ts
 *
 * It writes the fixture set that demonstrates the deterministic
 * conditional-release profile (see Morpheus report
 * deterministic-conditional-release-profile-20260626.md):
 *
 *   request-body.json             the committed Action Request body carrying
 *                                 ds_conditional_release.acceptance_spec
 *   action-request-commitment.json  ds.action_request.v0.1 (with body_digest)
 *   action-commitment.json          ds.action_commitment.v0.1 (correlation)
 *   sample-output-pass.json         output that satisfies every check
 *   sample-output-fail.json         output that trips a hard FAIL check
 *   evaluation-pass.json            evaluator result for the PASS output
 *   evaluation-fail.json            evaluator result for the FAIL output
 *
 * Layer boundary: continuity is a sibling/upper layer to SAR-402 and MUST NOT
 * import SAR-402 source. The request_digest / action_ref derivations below are
 * reproduced inline from the neutral @defaultsettlement/canonical primitives
 * (the exact same JCS + sha256 recipe SAR-402 uses), not imported from
 * packages/sar-402.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  evaluateAcceptanceSpec,
  type AcceptanceSpec,
} from '@defaultsettlement/continuity'
import { canonicalJson, sha256Hex, computeBodyDigest } from '@defaultsettlement/canonical'

const here = dirname(fileURLToPath(import.meta.url))

function writeJson(name: string, value: unknown): void {
  mkdirSync(here, { recursive: true })
  writeFileSync(join(here, name), JSON.stringify(value, null, 2) + '\n')
}

// --- 1. Acceptance spec (self-contained checks only) -----------------------
// The demo uses only self-contained check kinds so PASS/FAIL are clean and
// fully reproducible from the committed body alone. `json_schema` is a
// documented v0.1 implementation gap (it routes to INDETERMINATE), so it is
// intentionally NOT part of this demo's authoritative gate. See README.
const acceptanceSpec: AcceptanceSpec = {
  spec_id: 'spec.dataset-x-delivery.2026-06-26',
  evaluator_type: 'deterministic',
  checks: [
    { kind: 'field_present', inputs: { output_path: '$.manifest' }, expected: null, external_refs: {}, failure_behavior: 'FAIL' },
    { kind: 'numeric_threshold', inputs: { output_path: '$.manifest.row_count' }, expected: { op: '>=', value: 1000 }, external_refs: {}, failure_behavior: 'FAIL' },
    { kind: 'content_type_equals', inputs: { output_path: '$.headers.content_type' }, expected: 'application/json', external_refs: {}, failure_behavior: 'FAIL' },
  ],
}

// --- 2. Committed Action Request body --------------------------------------
const requestBody = {
  method: 'POST',
  target: 'https://data.example/dataset-x/deliver',
  content_type: 'application/json',
  ds_conditional_release: {
    profile_schema_id: 'ds.conditional_release_profile.v0.1',
    intent:
      'Release access to dataset X only if the returned manifest is present, its row_count meets the committed threshold, and the content type is JSON.',
    acceptance_spec: acceptanceSpec,
    release_policy: {
      release_on: 'PASS',
      withhold_on: 'FAIL',
      manual_review_on: 'INDETERMINATE',
      timeout_behavior: 'manual_review',
    },
    evidence_expectations: {
      continuity_evaluation_receipt: 'required',
      sar_referencing_action_ref: 'required',
      execution_outcome_receipt: 'required',
    },
  },
}

// --- 3. body_digest -> request_digest -> action_ref ------------------------
const bodyDigest = computeBodyDigest('application/json', JSON.stringify(requestBody))

const actionRequestCommitment = {
  schema_id: 'ds.action_request.v0.1',
  method: 'POST',
  target: { scheme: 'https', host: 'data.example', port: null, path: '/dataset-x/deliver', query: {} },
  content_type: 'application/json',
  body_digest: bodyDigest,
}
const requestDigest = sha256Hex(canonicalJson(actionRequestCommitment))

const actionCommitment = {
  schema_id: 'ds.action_commitment.v0.1',
  agent_id: 'agent:example',
  action_type: 'ds.dataset_delivery',
  request_digest: requestDigest,
  idempotency_key: 'dataset-x-delivery-2026-06-26-001',
}
const actionRef = sha256Hex(canonicalJson(actionCommitment))

// --- 4. Sample outputs ------------------------------------------------------
const sampleOutputPass = {
  headers: { content_type: 'application/json' },
  status_code: 200,
  manifest: { dataset: 'dataset-x', row_count: 1200, generated_at: '2026-06-26T09:00:00Z' },
}
const sampleOutputFail = {
  headers: { content_type: 'application/json' },
  status_code: 200,
  manifest: { dataset: 'dataset-x', row_count: 740, generated_at: '2026-06-26T09:00:00Z' },
}

// --- 5. Evaluator results ---------------------------------------------------
const evalPass = evaluateAcceptanceSpec(acceptanceSpec, sampleOutputPass)
const evalFail = evaluateAcceptanceSpec(acceptanceSpec, sampleOutputFail)

function evaluationFile(outcome: ReturnType<typeof evaluateAcceptanceSpec>) {
  return {
    spec_id: acceptanceSpec.spec_id,
    action_ref: actionRef,
    evaluator_type: 'deterministic',
    result: outcome.result,
    checks: outcome.checks,
    // Mapping to declared release intent — NOT proof of actual release.
    declared_release_intent:
      outcome.result === 'PASS' ? 'should release' : outcome.result === 'FAIL' ? 'should withhold' : 'manual_review',
  }
}

// --- 6. Write fixtures ------------------------------------------------------
writeJson('request-body.json', requestBody)
writeJson('action-request-commitment.json', actionRequestCommitment)
writeJson('action-commitment.json', actionCommitment)
writeJson('sample-output-pass.json', sampleOutputPass)
writeJson('sample-output-fail.json', sampleOutputFail)
writeJson('evaluation-pass.json', evaluationFile(evalPass))
writeJson('evaluation-fail.json', evaluationFile(evalFail))

console.log('body_digest   :', bodyDigest)
console.log('request_digest:', requestDigest)
console.log('action_ref    :', actionRef)
console.log('PASS result   :', evalPass.result)
console.log('FAIL result   :', evalFail.result)

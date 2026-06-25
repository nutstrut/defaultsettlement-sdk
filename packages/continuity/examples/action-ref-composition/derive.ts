/**
 * Reproducible generator for the continuity composition fixtures.
 *
 * Run (after `npm run build` at the repo root):
 *   npx tsx packages/continuity/examples/action-ref-composition/derive.ts
 *
 * It writes one folder per scenario. Each folder carries the SIGNED normative
 * records this package defines:
 *   - continuity-evaluation-receipt.json (ds.continuity_evaluation.v0.1)
 *   - execution-outcome-receipt.json     (ds.execution_outcome.v0.1)  [when present]
 *   - composition.json                   (the verifier join result + findings)
 *
 * Action Commitment is the join primitive. These receipts join to the EXISTING
 * SAR-402 Action Commitment fixtures in
 *   packages/sar-402/examples/action-commitment-composition/<scenario>/
 * by reusing their derived `action_ref` (read from each scenario's join.json),
 * rather than duplicating the Action Commitment / SAR receipt files. The
 * matching SAR delivery receipt, when one exists for the scenario, lives in
 * that SAR fixture folder (cross-referenced, not copied).
 *
 * Determinism: signing keys are derived from fixed seeds so fixtures are
 * byte-stable across runs. Real evaluators/executors use their own managed
 * Ed25519 keys; these seeds are illustrative only.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import {
  signContinuityEvaluationReceipt,
  signExecutionOutcomeReceipt,
  validateActionRefComposition,
  exportPublicKeyB64,
  type EvaluationState,
  type OutcomeState,
  type CompositionInput,
} from '@defaultsettlement/continuity'

const here = dirname(fileURLToPath(import.meta.url))
const SAR_FIXTURES = join(here, '..', '..', '..', 'sar-402', 'examples', 'action-commitment-composition')

const EVALUATOR_ID = 'agent:example'
const EXECUTOR_ID = 'agent:example'
const POLICY_REF = 'policy:default-settlement/sar-402-delivery-v1'

/** Build a deterministic Ed25519 private key from a 32-byte seed (PKCS8 DER wrap). */
function ed25519FromSeed(seedHex: string): KeyObject {
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(seedHex, 'hex'),
  ])
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
}

const evaluatorKey = ed25519FromSeed('11'.repeat(32))
const executorKey = ed25519FromSeed('22'.repeat(32))
const evaluatorPublicB64 = exportPublicKeyB64(createPublicKey(evaluatorKey))
const executorPublicB64 = exportPublicKeyB64(createPublicKey(executorKey))

function writeJson(scenario: string, name: string, value: unknown): void {
  const dir = join(here, scenario)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n')
}

/** Read the derived action_ref for a SAR fixture scenario. */
function actionRefFor(sarScenario: string): string {
  const join_ = JSON.parse(readFileSync(join(SAR_FIXTURES, sarScenario, 'join.json'), 'utf8')) as {
    action_ref: string
  }
  return join_.action_ref
}

interface Scenario {
  dir: string
  sarScenario: string
  evaluationState: EvaluationState
  evaluatedAt: string
  /** undefined => no Execution Outcome Receipt is emitted (audit-gap scenario). */
  outcomeState?: OutcomeState
  outcomeReason?: string
  recordedAt?: string
  /** whether the matching SAR fixture has a delivery receipt to cross-reference. */
  sarDeliveryReceipt: boolean
  note: string
}

const scenarios: Scenario[] = [
  {
    dir: '01-pass-proceeded-delivered',
    sarScenario: '01-pass-delivered',
    evaluationState: 'PASS',
    evaluatedAt: '2026-06-25T14:30:00Z',
    outcomeState: 'PROCEEDED',
    recordedAt: '2026-06-25T14:31:00Z',
    sarDeliveryReceipt: true,
    note: 'Evaluator permitted; executor proceeded; SAR delivery receipt exists.',
  },
  {
    dir: '02-fail-blocked',
    sarScenario: '02-fail-blocked',
    evaluationState: 'FAIL',
    evaluatedAt: '2026-06-25T14:30:00Z',
    outcomeState: 'BLOCKED',
    outcomeReason: 'policy_blocked',
    recordedAt: '2026-06-25T14:31:00Z',
    sarDeliveryReceipt: false,
    note: 'Evaluator denied; executor blocked; no SAR delivery receipt (nothing delivered).',
  },
  {
    dir: '03-indeterminate-blocked',
    sarScenario: '03a-indeterminate-blocked',
    evaluationState: 'INDETERMINATE',
    evaluatedAt: '2026-06-25T14:30:00Z',
    outcomeState: 'BLOCKED',
    outcomeReason: 'policy_blocked',
    recordedAt: '2026-06-25T14:31:00Z',
    sarDeliveryReceipt: false,
    note: 'Evaluator uncertain (completed); policy blocked. Positive blocked outcome receipt.',
  },
  {
    dir: '04-indeterminate-proceeded',
    sarScenario: '04-indeterminate-proceeded',
    evaluationState: 'INDETERMINATE',
    evaluatedAt: '2026-06-25T14:30:00Z',
    outcomeState: 'PROCEEDED',
    recordedAt: '2026-06-25T14:31:00Z',
    sarDeliveryReceipt: true,
    note: 'Evaluator uncertain (completed); policy proceeded; SAR delivery receipt exists.',
  },
  {
    dir: '05-evaluator-timeout-audit-gap',
    sarScenario: '05-evaluator-timeout',
    evaluationState: 'EVALUATOR_TIMEOUT',
    evaluatedAt: '2026-06-25T14:30:00Z',
    // No outcome receipt, no SAR delivery receipt: this is an audit gap.
    sarDeliveryReceipt: false,
    note:
      'Evaluator did not complete (non-completion). No outcome or delivery evidence. ' +
      'Absence of an Execution Outcome Receipt is a verifier finding (audit gap), NOT an ' +
      'outcome state and NOT NO_EMISSION.',
  },
]

for (const s of scenarios) {
  const actionRef = actionRefFor(s.sarScenario)

  const evaluation = signContinuityEvaluationReceipt(
    {
      actionRef,
      evaluatorId: EVALUATOR_ID,
      evaluationState: s.evaluationState,
      policyRef: POLICY_REF,
      evaluatedAt: s.evaluatedAt,
    },
    evaluatorKey,
  )
  writeJson(s.dir, 'continuity-evaluation-receipt.json', evaluation)

  let outcome
  if (s.outcomeState) {
    outcome = signExecutionOutcomeReceipt(
      {
        actionRef,
        executorId: EXECUTOR_ID,
        outcomeState: s.outcomeState,
        ...(s.outcomeReason ? { reason: s.outcomeReason } : {}),
        recordedAt: s.recordedAt!,
      },
      executorKey,
    )
    writeJson(s.dir, 'execution-outcome-receipt.json', outcome)
  }

  // SAR delivery receipt (if any) lives in the SAR fixture folder. Cross-reference, do not copy.
  let sarReceipt: unknown
  if (s.sarDeliveryReceipt) {
    sarReceipt = JSON.parse(
      readFileSync(join(SAR_FIXTURES, s.sarScenario, 'sar-receipt.json'), 'utf8'),
    )
  }

  const compInput: CompositionInput = {
    expectedActionRef: actionRef,
    evaluation,
    ...(outcome ? { outcome } : {}),
    ...(sarReceipt ? { sarReceipt } : {}),
  }
  const composition = validateActionRefComposition(compInput)

  writeJson(s.dir, 'composition.json', {
    _note: s.note,
    _cross_reference: {
      action_ref_join_primitive:
        'Action Commitment — see packages/sar-402/examples/action-commitment-composition/' +
        s.sarScenario,
      sar_delivery_receipt: s.sarDeliveryReceipt
        ? 'packages/sar-402/examples/action-commitment-composition/' + s.sarScenario + '/sar-receipt.json'
        : null,
    },
    trusted_keys: {
      _note:
        'Identity-to-signing-key binding: a verifier must hold the trusted Ed25519 public key ' +
        'for each signer identity (resolved out of band) and verify each receipt against it. ' +
        'These seed-derived keys are illustrative only.',
      evaluator: { identity: EVALUATOR_ID, public_key_spki_der_b64: evaluatorPublicB64 },
      executor: { identity: EXECUTOR_ID, public_key_spki_der_b64: executorPublicB64 },
    },
    action_ref: actionRef,
    composition,
  })
}

// eslint-disable-next-line no-console
console.log('continuity action-ref-composition fixtures written.')

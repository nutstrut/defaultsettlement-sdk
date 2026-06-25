/**
 * Reproducible generator for the Action Commitment composition fixtures.
 *
 * Run (after `npm run build` at the repo root):
 *   npx tsx packages/sar-402/examples/action-commitment-composition/derive.ts
 *
 * It writes one folder per scenario, each containing the canonical Action
 * Request Commitment + Action Commitment plus the downstream records joined by
 * the SAME derived `action_ref`. The evaluator and outcome records are
 * NON-NORMATIVE illustrative scaffolding (see README) — they exist only to make
 * the `action_ref` join inspectable, not to define new protocol layers.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildActionRequestCommitment,
  deriveRequestDigest,
  buildActionCommitment,
  deriveActionRef,
  operationBindingExt,
  type ActionRequestInput,
} from '@defaultsettlement/sar-402'

const here = dirname(fileURLToPath(import.meta.url))

const AGENT_ID = 'agent:example'
const ACTION_TYPE = 'sar402.resource_delivery'
const BODY = '{"input":"https://example.com","format":"summary"}'

function writeJson(scenario: string, name: string, value: unknown): void {
  const dir = join(here, scenario)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n')
}

/** Build the canonical request + commitment for a scenario and write both. */
function commit(scenario: string, idempotencyKey: string): { actionRef: string } {
  const requestInput: ActionRequestInput = {
    method: 'POST',
    target: {
      scheme: 'https',
      host: 'api.example.com',
      port: null,
      path: '/demo/sar-402',
      query: {},
    },
    contentType: 'application/json',
    body: BODY,
  }
  const request = buildActionRequestCommitment(requestInput)
  const requestDigest = deriveRequestDigest(request)
  const commitment = buildActionCommitment({
    agentId: AGENT_ID,
    actionType: ACTION_TYPE,
    requestDigest,
    idempotencyKey,
  })
  const actionRef = deriveActionRef(commitment)

  writeJson(scenario, 'action-request-commitment.json', request)
  writeJson(scenario, 'action-commitment.json', commitment)
  writeJson(scenario, 'join.json', {
    _note:
      'Derived join metadata, NOT part of any canonical digest input. ' +
      'request_digest is derived from action-request-commitment.json; ' +
      'action_ref is derived from action-commitment.json. Every downstream ' +
      'record in this folder references this action_ref.',
    request_digest: requestDigest,
    action_ref: actionRef,
  })
  return { actionRef }
}

/** Non-normative illustrative evaluator (continuity) record. */
function evaluatorRecord(actionRef: string, evaluatorVerdict: string, note: string): unknown {
  return {
    _non_normative: true,
    _note:
      'Illustrative pre-execution evaluator record. NOT a normative Default ' +
      'Settlement continuity schema — present only to demonstrate action_ref ' +
      'composition. Must be individually signed to be trusted. ' +
      note,
    schema_id: 'illustrative.continuity_evaluator_record.nonnormative',
    action_ref: actionRef,
    evaluator_verdict: evaluatorVerdict,
    evaluated_at: '2026-06-25T12:00:00.000Z',
  }
}

/** Non-normative illustrative outcome/execution receipt. */
function outcomeReceipt(actionRef: string, execution: string, note: string): unknown {
  return {
    _non_normative: true,
    _note:
      'Illustrative outcome/execution receipt. NOT a normative Default ' +
      'Settlement outcome schema — present only to demonstrate action_ref ' +
      'composition. Must be individually signed; absence-as-proof requires ' +
      'complete outcome emission. ' +
      note,
    schema_id: 'illustrative.outcome_receipt.nonnormative',
    action_ref: actionRef,
    execution,
    recorded_at: '2026-06-25T12:00:01.000Z',
  }
}

/** A SAR-402-shaped delivery receipt carrying the additive operation binding. */
function sarReceipt(actionRef: string): unknown {
  return {
    schema_id: 'sar_402_settlement_v0.1',
    profile: 'sar-402',
    sar_type: 'Settlement Attestation Receipt',
    sar_verdict: 'PASS',
    verification_point: 'post_delivery',
    verification_mode: 'record',
    authority_binding: {
      verifier_has_execution_authority: false,
      verifier_controls_resource_release: false,
      resource_server_controls_delivery: true,
      acting_party: 'resource_server',
    },
    payment_state: 'verified',
    delivery_state: 'confirmed',
    settlement_state: 'delivered',
    delivery: {
      delivered_resource: 'https://api.example.com/demo/sar-402',
      evidence_type: 'http_response',
      status_code: 200,
      delivered_at: '2026-06-25T12:00:02.000Z',
    },
    notes:
      'Delivery/settlement evidence only. The _ext.operation_binding envelope ' +
      'is an additive, non-authoritative correlation link to an Action ' +
      'Commitment. SAR does not assert policy authorization, payment finality, ' +
      'invoice correctness, or executor faithfulness.',
    ...operationBindingExt(actionRef),
  }
}

// --- Scenario 01: PASS -> proceeds -> SAR delivery receipt ------------------
{
  const { actionRef } = commit('01-pass-delivered', 'idem_pass_001')
  writeJson('01-pass-delivered', 'evaluator-record.json', evaluatorRecord(actionRef, 'PASS', 'Evaluator permitted execution.'))
  writeJson('01-pass-delivered', 'outcome-receipt.json', outcomeReceipt(actionRef, 'executed', 'Execution proceeded.'))
  writeJson('01-pass-delivered', 'sar-receipt.json', sarReceipt(actionRef))
}

// --- Scenario 02: FAIL -> blocked -> affirmative blocked outcome, no SAR ----
{
  const { actionRef } = commit('02-fail-blocked', 'idem_fail_002')
  writeJson('02-fail-blocked', 'evaluator-record.json', evaluatorRecord(actionRef, 'FAIL', 'Evaluator denied execution.'))
  writeJson('02-fail-blocked', 'outcome-receipt.json', outcomeReceipt(actionRef, 'blocked', 'Execution was blocked; no delivery occurred.'))
  // No sar-receipt.json: nothing was delivered. The blocked outcome receipt is
  // the affirmative artifact joined by action_ref.
}

// --- Scenario 03a: INDETERMINATE -> policy blocks -> blocked outcome receipt -
{
  const { actionRef } = commit('03a-indeterminate-blocked', 'idem_indeterminate_blocked_003a')
  writeJson('03a-indeterminate-blocked', 'evaluator-record.json', evaluatorRecord(actionRef, 'INDETERMINATE', 'Evaluator uncertainty recorded.'))
  writeJson('03a-indeterminate-blocked', 'outcome-receipt.json', outcomeReceipt(actionRef, 'blocked', 'Policy chose to block under uncertainty. Affirmative blocked artifact.'))
}

// --- Scenario 03b: INDETERMINATE -> no downstream -> audit gap --------------
{
  const { actionRef } = commit('03b-indeterminate-absence', 'idem_indeterminate_absence_003b')
  writeJson('03b-indeterminate-absence', 'evaluator-record.json', evaluatorRecord(actionRef, 'INDETERMINATE', 'Evaluator uncertainty recorded; NO downstream outcome or delivery record exists.'))
  // No outcome-receipt.json and no sar-receipt.json. Absence only proves
  // blocked execution under a completeness assumption (see README). Otherwise
  // this is an audit gap, not proof of non-execution.
}

// --- Scenario 04: INDETERMINATE -> policy proceeds -> outcome + SAR ---------
{
  const { actionRef } = commit('04-indeterminate-proceeded', 'idem_indeterminate_proceed_004')
  writeJson('04-indeterminate-proceeded', 'evaluator-record.json', evaluatorRecord(actionRef, 'INDETERMINATE', 'Evaluator uncertainty recorded.'))
  writeJson('04-indeterminate-proceeded', 'outcome-receipt.json', outcomeReceipt(actionRef, 'executed', 'Policy chose to proceed despite uncertainty.'))
  writeJson('04-indeterminate-proceeded', 'sar-receipt.json', sarReceipt(actionRef))
}

// --- Scenario 05: EVALUATOR_TIMEOUT / audit gap -> missing downstream -------
{
  const { actionRef } = commit('05-evaluator-timeout', 'idem_evaluator_timeout_005')
  writeJson('05-evaluator-timeout', 'evaluator-record.json', evaluatorRecord(actionRef, 'EVALUATOR_TIMEOUT', 'Evaluator did not return in time; downstream evidence is missing.'))
  // No outcome-receipt.json and no sar-receipt.json. This is a missing-
  // downstream-evidence / audit-gap case: the verifier cannot conclude whether
  // execution proceeded, blocked, or failed.
}

// eslint-disable-next-line no-console
console.log('action-commitment-composition fixtures written.')

import { describe, it, expect } from 'vitest'
import {
  buildSar402Payload,
  evaluateContinuity,
  deriveVerdict,
  computeIntegrity,
  canonicalJson,
} from '../src/normalize.js'
import type { DeliveryMetadata } from '../src/types.js'
import { samplePaymentContext } from './helpers.js'

const goodDelivery: DeliveryMetadata = {
  deliveredResource: 'https://api.example.com/v1/forecast?region=eu-west',
  evidenceType: 'http_response',
  statusCode: 200,
  deliveredAt: new Date().toISOString(),
  failed: false,
}

describe('normalize: x402 evidence -> continuity', () => {
  it('all five predicates PASS for drift-free, delivered evidence', () => {
    const c = evaluateContinuity(samplePaymentContext(), goodDelivery)
    expect(c).toEqual({
      object_continuity: 'PASS',
      constraint_continuity: 'PASS',
      temporal_continuity: 'PASS',
      authority_continuity: 'PASS',
      executor_continuity: 'PASS',
    })
    expect(deriveVerdict(c)).toBe('PASS')
  })

  it('constraint drift (recipient mismatch) yields FAIL verdict', () => {
    const ctx = samplePaymentContext({ settledRecipient: '0xSomeoneElse' })
    const c = evaluateContinuity(ctx, goodDelivery)
    expect(c.constraint_continuity).toBe('FAIL')
    expect(deriveVerdict(c)).toBe('FAIL')
  })

  it('delivered resource mismatch fails object + executor continuity', () => {
    const c = evaluateContinuity(samplePaymentContext(), {
      ...goodDelivery,
      deliveredResource: 'https://api.example.com/v1/OTHER',
    })
    expect(c.object_continuity).toBe('FAIL')
    expect(c.executor_continuity).toBe('FAIL')
  })

  it('unknown authorized payers => INDETERMINATE (never guessed)', () => {
    const ctx = samplePaymentContext({ authorizedPayers: undefined })
    const c = evaluateContinuity(ctx, goodDelivery)
    expect(c.authority_continuity).toBe('INDETERMINATE')
    expect(deriveVerdict(c)).toBe('INDETERMINATE')
  })
})

describe('normalize: build SAR-402 payload', () => {
  it('produces a schema-shaped post_delivery receipt', () => {
    const payload = buildSar402Payload(samplePaymentContext(), goodDelivery, { mode: 'record' })
    expect(payload.schema_id).toBe('sar_402_settlement_v0.1')
    expect(payload.profile).toBe('sar-402')
    expect(payload.sar_type).toBe('Settlement Attestation Receipt')
    expect(payload.verification_point).toBe('post_delivery')
    expect(payload.verification_mode).toBe('record')
    expect(payload.payment_state).toBe('verified')
    expect(payload.delivery_state).toBe('confirmed')
    expect(payload.settlement_state).toBe('delivered')
    expect(payload.payment.amount_paid).toEqual(payload.payment.price)
    expect(payload.identity.derived_identity.derived_agent_id).toBe(
      'agent:x402:eip155:8453:0xPayer',
    )
  })

  it('integrity digest is a stable sha256 over the canonical receipt', () => {
    const payload = buildSar402Payload(samplePaymentContext(), goodDelivery, {
      mode: 'record',
      issuedAt: '2026-06-19T00:00:00.000Z',
    })
    const { integrity, ...rest } = payload
    expect(integrity.digest_alg).toBe('sha256')
    expect(integrity.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(computeIntegrity(rest).digest).toBe(integrity.digest)
  })

  it('failed delivery maps to delivery_state=failed / settlement_state=not_delivered', () => {
    const payload = buildSar402Payload(
      samplePaymentContext(),
      { ...goodDelivery, statusCode: 502, failed: true },
      { mode: 'record' },
    )
    expect(payload.delivery_state).toBe('failed')
    expect(payload.settlement_state).toBe('not_delivered')
  })

  it('canonicalJson sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: 2 } })).toBe('{"a":{"c":2},"b":1}')
  })
})

describe('normalize: authority binding doctrine', () => {
  it('every receipt asserts the verifier holds no execution authority', () => {
    const payload = buildSar402Payload(samplePaymentContext(), goodDelivery, { mode: 'record' })
    expect(payload.authority_binding).toEqual({
      verifier_has_execution_authority: false,
      verifier_controls_resource_release: false,
      resource_server_controls_delivery: true,
      acting_party: 'resource_server',
    })
  })
})

/**
 * Normalize x402 payment evidence into a SAR-402 attestation payload.
 *
 * This is the network-free core. It does not call DefaultVerifier, verify
 * payment, or touch a chain — it shapes evidence the resource server already
 * has into the committed sar-402-settlement-v0.1 receipt shape, evaluates the
 * five Continuity predicates, derives a verdict, and stamps an integrity
 * digest.
 *
 * Ported (faithfully, in spirit) from the committed Python SAR-402 predicates
 * and builder:
 *   morpheus/sar402/predicates.py
 *   morpheus/sar402/builder.py
 */

import { createHash } from 'node:crypto'
// Canonical JSON + sha256 now live in the neutral @defaultsettlement/canonical
// package. They are re-exported below as compatibility exports so existing
// importers of `canonicalJson` / `sha256Hex` from this module keep working.
import { canonicalJson, sha256Hex } from '@defaultsettlement/canonical'
import {
  Amount,
  AuthorityBinding,
  Continuity,
  DEFAULT_AUTHORITY_BINDING,
  DeliveryMetadata,
  Sar402Mode,
  Sar402Payload,
  Verdict,
  X402PaymentContext,
} from './types.js'

const PASS: Verdict = 'PASS'
const FAIL: Verdict = 'FAIL'
const INDETERMINATE: Verdict = 'INDETERMINATE'

export const SCHEMA_ID = 'sar_402_settlement_v0.1' as const
export const PROFILE = 'sar-402' as const
export const SAR_TYPE = 'Settlement Attestation Receipt' as const
export const CANONICALIZATION = 'sorted_keys_compact_v0'

const DEFAULT_ISSUER = {
  verifier: 'DefaultVerifier',
  verifier_version: '0.1.0',
}

// ---------------------------------------------------------------------------
// Canonicalization / integrity
// ---------------------------------------------------------------------------

/**
 * Compatibility re-exports. `canonicalJson` / `sha256Hex` are now owned by
 * `@defaultsettlement/canonical`; this module re-exports them unchanged so the
 * SAR-402 public API (and digest outputs) stay byte-identical.
 */
export { canonicalJson, sha256Hex }

/** sha256 over the canonical receipt (excluding the integrity block). */
export function computeIntegrity(receiptWithoutIntegrity: object): Sar402Payload['integrity'] {
  const digest = createHash('sha256').update(canonicalJson(receiptWithoutIntegrity)).digest('hex')
  return {
    digest_alg: 'sha256',
    canonicalization: CANONICALIZATION,
    digest: `sha256:${digest}`,
  }
}

// ---------------------------------------------------------------------------
// Continuity predicates (the canonical five)
// ---------------------------------------------------------------------------

function effectiveAmountPaid(ctx: X402PaymentContext): Amount {
  return ctx.amountPaid ?? ctx.price
}

function objectContinuity(ctx: X402PaymentContext, delivery?: DeliveryMetadata): Verdict {
  if (!ctx.resource) return INDETERMINATE
  if (!delivery) return PASS
  const delivered = delivery.deliveredResource
  if (!delivered) return INDETERMINATE
  return delivered === (ctx.deliveredResource ?? ctx.resource) ? PASS : FAIL
}

function constraintContinuity(ctx: X402PaymentContext): Verdict {
  if (!ctx.quoteId || !ctx.price) return INDETERMINATE
  const paid = effectiveAmountPaid(ctx)
  const checks = [
    ctx.price.amount === paid.amount,
    ctx.price.decimals === paid.decimals,
    ctx.asset === paid.asset,
    ctx.asset === (ctx.settledAsset ?? ctx.asset),
    ctx.chain === (ctx.settledChain ?? ctx.chain),
    ctx.recipient === (ctx.settledRecipient ?? ctx.recipient),
  ]
  return checks.every(Boolean) ? PASS : FAIL
}

function parseTs(value?: string): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

function temporalContinuity(ctx: X402PaymentContext, delivery?: DeliveryMetadata): Verdict {
  const windowEnd = parseTs(ctx.quoteExpiresAt)
  if (windowEnd === null) return INDETERMINATE
  const windowStart = parseTs(ctx.quotedAt)
  const observed: number[] = []
  for (const ts of [ctx.paidAt, delivery?.deliveredAt]) {
    const parsed = parseTs(ts)
    if (parsed !== null) observed.push(parsed)
  }
  if (observed.length === 0) return INDETERMINATE
  for (const moment of observed) {
    if (moment > windowEnd) return FAIL
    if (windowStart !== null && moment < windowStart) return FAIL
  }
  return PASS
}

function authorityContinuity(ctx: X402PaymentContext): Verdict {
  if (!ctx.authorizedPayers) return INDETERMINATE
  if (!ctx.payer) return INDETERMINATE
  const allowed = new Set(ctx.authorizedPayers.map((a) => a.toLowerCase()))
  const candidates = new Set([ctx.payer.toLowerCase()])
  if (ctx.agent) candidates.add(ctx.agent.toLowerCase())
  if (ctx.wallet) candidates.add(ctx.wallet.toLowerCase())
  for (const c of candidates) if (allowed.has(c)) return PASS
  return FAIL
}

function executorContinuity(ctx: X402PaymentContext, delivery?: DeliveryMetadata): Verdict {
  if (!delivery) return INDETERMINATE
  if (delivery.failed) return FAIL
  const delivered = delivery.deliveredResource
  if (!delivered) return INDETERMINATE
  return delivered === (ctx.deliveredResource ?? ctx.resource) ? PASS : FAIL
}

export function evaluateContinuity(
  ctx: X402PaymentContext,
  delivery?: DeliveryMetadata,
): Continuity {
  return {
    object_continuity: objectContinuity(ctx, delivery),
    constraint_continuity: constraintContinuity(ctx),
    temporal_continuity: temporalContinuity(ctx, delivery),
    authority_continuity: authorityContinuity(ctx),
    executor_continuity: executorContinuity(ctx, delivery),
  }
}

/**
 * Aggregate the five predicates into a single verdict at a post_delivery seam.
 * Any FAIL => FAIL; any remaining INDETERMINATE => INDETERMINATE; else PASS.
 * (Post-delivery has no pre-delivery exemption — executor is knowable here.)
 */
export function deriveVerdict(c: Continuity): Verdict {
  const values = Object.values(c)
  if (values.some((v) => v === FAIL)) return FAIL
  if (values.some((v) => v === INDETERMINATE)) return INDETERMINATE
  return PASS
}

// ---------------------------------------------------------------------------
// Payload assembly
// ---------------------------------------------------------------------------

function deriveAgentId(chain: string, payer: string): string {
  return `agent:x402:${chain}:${payer}`
}

export interface BuildPayloadOptions {
  mode: Sar402Mode
  acting_party?: string
  environment?: Sar402Payload['issuer']['environment']
  /** Optional request-side digest (never the raw request body). */
  requestDigest?: string
  notes?: string
  issuedAt?: string
}

/**
 * Build a post-delivery SAR-402 receipt payload from x402 context + delivery
 * metadata. Always stamps the full authority binding with
 * verifier_has_execution_authority=false.
 */
export function buildSar402Payload(
  ctx: X402PaymentContext,
  delivery: DeliveryMetadata,
  opts: BuildPayloadOptions,
): Sar402Payload {
  const continuity = evaluateContinuity(ctx, delivery)
  const verdict = deriveVerdict(continuity)

  let deliveryState: Sar402Payload['delivery_state']
  let settlementState: Sar402Payload['settlement_state']
  if (delivery.failed || continuity.executor_continuity === FAIL) {
    deliveryState = 'failed'
    settlementState = 'not_delivered'
  } else if (continuity.executor_continuity === PASS) {
    deliveryState = 'confirmed'
    settlementState = 'delivered'
  } else {
    deliveryState = 'indeterminate'
    settlementState = 'indeterminate'
  }

  const authority_binding: AuthorityBinding = {
    ...DEFAULT_AUTHORITY_BINDING,
    acting_party: opts.acting_party ?? 'resource_server',
  }

  const issuedAt = opts.issuedAt ?? new Date().toISOString()
  const verifiedAt = ctx.verifiedAt ?? issuedAt

  const payment: Sar402Payload['payment'] = {
    resource: ctx.resource,
    quote_id: ctx.quoteId,
    price: ctx.price,
    amount_paid: effectiveAmountPaid(ctx),
    asset: ctx.asset,
    chain: ctx.chain,
    recipient: ctx.recipient,
    payer: ctx.payer,
    payment_ref: ctx.paymentRef,
  }
  if (ctx.facilitator) payment.facilitator = ctx.facilitator

  const receiptWithoutIntegrity: Omit<Sar402Payload, 'integrity'> = {
    schema_id: SCHEMA_ID,
    profile: PROFILE,
    sar_type: SAR_TYPE,
    sar_verdict: verdict,
    verification_point: 'post_delivery',
    verification_mode: opts.mode,
    authority_binding,
    payment_state: 'verified',
    delivery_state: deliveryState,
    settlement_state: settlementState,
    continuity,
    payment,
    delivery: {
      delivered_resource: delivery.deliveredResource,
      evidence_type: delivery.evidenceType,
      ...(delivery.evidenceDigest ? { evidence_digest: delivery.evidenceDigest } : {}),
      status_code: delivery.statusCode,
      delivered_at: delivery.deliveredAt,
    },
    identity: {
      payer: ctx.payer,
      ...(ctx.agent ? { agent: ctx.agent } : {}),
      ...(ctx.wallet ? { wallet: ctx.wallet } : {}),
      derived_identity: {
        registration_mode: 'derived_from_settlement',
        derived_agent_id: deriveAgentId(ctx.chain, ctx.payer),
        identity_status: 'derived',
      },
    },
    timestamps: {
      quoted_at: ctx.quotedAt ?? verifiedAt,
      ...(ctx.paidAt ? { paid_at: ctx.paidAt } : {}),
      verified_at: verifiedAt,
      delivered_at: delivery.deliveredAt,
      issued_at: issuedAt,
      ...(ctx.quoteExpiresAt ? { quote_expires_at: ctx.quoteExpiresAt } : {}),
    },
    issuer: {
      ...DEFAULT_ISSUER,
      ...(opts.environment ? { environment: opts.environment } : {}),
    },
    ...(opts.requestDigest ? { request_digest: opts.requestDigest } : {}),
    ...(opts.notes ? { notes: opts.notes } : {}),
  }

  const integrity = computeIntegrity(receiptWithoutIntegrity)
  return { ...receiptWithoutIntegrity, integrity }
}

/**
 * Public types for @defaultsettlement/sar-402.
 *
 * SAR-402 == Settlement Attestation Receipt (the x402 profile of the SAR
 * primitive). These types describe (a) the x402 payment context a resource
 * server hands to the middleware, (b) the normalized SAR-402 attestation
 * payload that is POSTed to DefaultVerifier, and (c) the receipt metadata
 * handed back.
 *
 * Doctrine kept visible in the type system: the verifier never holds execution
 * authority. See {@link AuthorityBinding} and {@link DEFAULT_AUTHORITY_BINDING}.
 */

/** Phase 1 supported modes. `gate` is intentionally NOT supported here. */
export type Sar402Mode = 'observe' | 'record'

/** Verdict vocabulary — the only one. Never forked per chain. */
export type Verdict = 'PASS' | 'FAIL' | 'INDETERMINATE'

/** An on-chain amount as an integer string + explicit decimals (no float drift). */
export interface Amount {
  /** Integer amount as a decimal string, e.g. "10000". */
  amount: string
  /** Asset symbol, e.g. "USDC". */
  asset: string
  /** Token decimals, e.g. 6. */
  decimals: number
}

/**
 * The x402 payment context a resource server hands to the middleware after it
 * has verified payment through its own facilitator. The SDK does not verify
 * payment itself — it records what the resource server reports.
 *
 * Quote-side fields describe what the 402 challenge authorized. The optional
 * `settled*` overrides describe the actuals; when omitted they are treated as
 * equal to the quote side (no drift).
 */
export interface X402PaymentContext {
  /** Resource/action paid for. Anchors object_continuity. */
  resource: string
  /** 402 quote/challenge id. */
  quoteId: string
  /** Quoted price. */
  price: Amount
  /** Amount actually paid. Defaults to `price` when omitted. */
  amountPaid?: Amount
  /** Quoted asset symbol, e.g. "USDC". */
  asset: string
  /** CAIP-2 chain id, e.g. "eip155:8453". Chain-agnostic. Not Base-only. */
  chain: string
  /** Recipient (pay-to) address. */
  recipient: string
  /** Paying wallet/account address. */
  payer: string
  /** Settlement/transaction reference (tx hash, settlement id). */
  paymentRef: string

  /** x402 facilitator identity, if any. */
  facilitator?: string
  /** Delegated agent identifier, if distinct from the wallet. */
  agent?: string
  /** Wallet, if distinct from `payer`. */
  wallet?: string
  /** Wallets/agents authorized for this settlement. Omit => authority_continuity INDETERMINATE. */
  authorizedPayers?: string[]

  /** Settlement-actual overrides (default to the quote side when omitted). */
  settledAsset?: string
  settledChain?: string
  settledRecipient?: string

  /** ISO-8601 timestamps. */
  quotedAt?: string
  paidAt?: string
  verifiedAt?: string
  quoteExpiresAt?: string

  /**
   * What was actually delivered, if different from `resource`. Defaults to
   * `resource`. Used to detect object/executor continuity drift.
   */
  deliveredResource?: string
}

/** Safe delivery metadata captured after the handler responds. */
export interface DeliveryMetadata {
  /** What was delivered (defaults to the paid resource). */
  deliveredResource: string
  /** e.g. "http_response". */
  evidenceType: string
  /** Digest of the response body — present only when `includeResponseBodyHash`. */
  evidenceDigest?: string
  /** HTTP status code of the paid response. */
  statusCode: number
  /** ISO-8601 time the response finished. */
  deliveredAt: string
  /** True when the resource server's delivery failed (>=400 / aborted). */
  failed: boolean
}

/**
 * Authority binding embedded in every receipt. The first field MUST always be
 * false. The verifier records evidence; it never gains execution authority,
 * controls resource release, or takes over delivery.
 */
export interface AuthorityBinding {
  verifier_has_execution_authority: false
  verifier_controls_resource_release: false
  resource_server_controls_delivery: true
  /** Non-gate: the party that actually controlled the action. */
  acting_party: string
}

/** The five canonical Continuity predicates. Never add, never fork per chain. */
export interface Continuity {
  object_continuity: Verdict
  constraint_continuity: Verdict
  temporal_continuity: Verdict
  authority_continuity: Verdict
  executor_continuity: Verdict
}

/**
 * The SAR-402 attestation payload POSTed to DefaultVerifier. Shaped to align
 * with the committed sar-402-settlement-v0.1 schema. Privacy default: carries
 * hashes + metadata, never raw request/response bodies.
 */
export interface Sar402Payload {
  schema_id: 'sar_402_settlement_v0.1'
  profile: 'sar-402'
  sar_type: 'Settlement Attestation Receipt'
  sar_verdict: Verdict
  verification_point: 'post_delivery'
  verification_mode: Sar402Mode
  authority_binding: AuthorityBinding
  payment_state: 'verified' | 'unverified' | 'failed' | 'indeterminate'
  delivery_state: 'confirmed' | 'claimed' | 'failed' | 'not_applicable' | 'indeterminate'
  settlement_state: 'delivered' | 'not_delivered' | 'pending' | 'unverified' | 'indeterminate'
  continuity: Continuity
  payment: {
    resource: string
    quote_id: string
    price: Amount
    amount_paid: Amount
    asset: string
    chain: string
    recipient: string
    payer: string
    payment_ref: string
    facilitator?: string
  }
  delivery: {
    delivered_resource: string
    evidence_type: string
    evidence_digest?: string
    status_code: number
    delivered_at: string
  }
  identity: {
    payer: string
    agent?: string
    wallet?: string
    derived_identity: {
      registration_mode: 'derived_from_settlement'
      derived_agent_id: string
      identity_status: 'derived'
    }
  }
  timestamps: {
    quoted_at: string
    paid_at?: string
    verified_at: string
    delivered_at?: string
    issued_at: string
    quote_expires_at?: string
  }
  issuer: {
    verifier: string
    verifier_version: string
    environment?: 'production' | 'staging' | 'test' | 'local'
  }
  integrity: {
    digest_alg: 'sha256'
    canonicalization: string
    digest: string
  }
  /** Optional request-side hash (never the raw request body). */
  request_digest?: string
  notes?: string
}

/** Receipt metadata returned by DefaultVerifier (and surfaced via headers). */
export interface SarReceiptResult {
  /** True if DefaultVerifier accepted the receipt within the timeout. */
  ok: boolean
  mode: Sar402Mode
  /** Receipt id assigned by DefaultVerifier, if any. */
  receiptId?: string
  /** Public Explorer URL for the receipt, if any. */
  explorerUrl?: string
  /** The payload that was submitted. */
  payload: Sar402Payload
  /** Raw DefaultVerifier response body, if it returned one. */
  response?: unknown
  /** Populated when `ok` is false (fail-open path). */
  error?: Error
}

/** Context passed to the `onError` callback on the fail-open path. */
export interface SarContext {
  mode: Sar402Mode
  /** The x402 context the resource server provided, if available. */
  paymentContext?: X402PaymentContext
  /** Delivery metadata captured after the handler responded, if available. */
  delivery?: DeliveryMetadata
  /** The normalized payload, if it was built before the failure. */
  payload?: Sar402Payload
  /** Where in the pipeline the failure occurred. */
  stage: 'extract' | 'normalize' | 'submit'
}

/**
 * Resolves the x402 payment context for a request. Returning `undefined` means
 * "no paid action here" and the middleware emits nothing (fail-open).
 */
export type Sar402ContextExtractor = (
  req: unknown,
  res: unknown,
) => X402PaymentContext | undefined | Promise<X402PaymentContext | undefined>

/** Configuration for the SAR-402 middleware. */
export interface Sar402Config {
  /** DefaultVerifier base URL. Default: https://defaultverifier.com */
  endpoint?: string
  /**
   * Path appended to `endpoint` for receipt ingest. Default: `/v1/sar-402/receipts`.
   * That route now exists in attest-service and matches this default. Override
   * this (and/or `endpoint`) to target a self-hosted, test, or future endpoint
   * variant. The middleware fails open if the endpoint is unreachable or errors.
   */
  receiptPath?: string
  /** observe | record. Default: observe. `gate` is rejected. */
  mode?: Sar402Mode
  /** Optional API key sent as `Authorization: Bearer <apiKey>`. */
  apiKey?: string
  /** Hash the response body into delivery evidence. Default: false (privacy). */
  includeResponseBodyHash?: boolean
  /** Hash request method+path+selected headers into request_digest. Default: false. */
  includeRequestHash?: boolean
  /** Per-receipt HTTP timeout in ms. Default: 4000. */
  timeoutMs?: number
  /** Reported issuer environment. Default: production. */
  environment?: 'production' | 'staging' | 'test' | 'local'
  /**
   * How to read the x402 payment context from the request. Default reads
   * `res.locals.sar402` (set via {@link attachSettlementContext}).
   */
  extractContext?: Sar402ContextExtractor
  /** Called after a receipt attempt succeeds. */
  onReceipt?: (receipt: SarReceiptResult) => void | Promise<void>
  /** Called on the fail-open path when a receipt could not be emitted. */
  onError?: (error: Error, context: SarContext) => void | Promise<void>
  /**
   * Injectable fetch implementation (for tests). Defaults to global `fetch`.
   * @internal
   */
  fetchImpl?: typeof fetch
}

/** Authority binding constant. verifier_has_execution_authority is always false. */
export const DEFAULT_AUTHORITY_BINDING: Omit<AuthorityBinding, 'acting_party'> = {
  verifier_has_execution_authority: false,
  verifier_controls_resource_release: false,
  resource_server_controls_delivery: true,
}

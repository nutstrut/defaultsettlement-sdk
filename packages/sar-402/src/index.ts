/**
 * @defaultsettlement/sar-402
 *
 * Express middleware that emits SAR-402 (Settlement Attestation Receipt) records
 * for paid x402 endpoints. x402 proves the payment flow; SAR-402 records what
 * happened around the paid action and leaves verifiable evidence.
 *
 * Doctrine: the verifier records evidence. It does not execute your API,
 * authorize delivery, custody funds, or control resource release. Fail-open is
 * a hard constraint — DefaultVerifier availability can never block your paid
 * response.
 */

export {
  sar402,
  attachSettlementContext,
  RECEIPT_ID_HEADER,
  EXPLORER_URL_HEADER,
  MODE_HEADER,
} from './middleware.js'

export {
  buildSar402Payload,
  evaluateContinuity,
  deriveVerdict,
  computeIntegrity,
  canonicalJson,
  sha256Hex,
  SCHEMA_ID,
  PROFILE,
  SAR_TYPE,
  CANONICALIZATION,
} from './normalize.js'
export type { BuildPayloadOptions } from './normalize.js'

export {
  DefaultVerifierClient,
  DEFAULT_ENDPOINT,
  DEFAULT_RECEIPT_PATH,
  PROPOSED_RECEIPT_PATH,
  DEFAULT_TIMEOUT_MS,
} from './client.js'
export type { ClientOptions } from './client.js'

export {
  Sar402Error,
  Sar402ConfigError,
  GateModeUnsupportedError,
  AuthorityBoundaryError,
  DefaultVerifierError,
} from './errors.js'

export { DEFAULT_AUTHORITY_BINDING } from './types.js'
export type {
  Sar402Mode,
  Sar402Config,
  Sar402ContextExtractor,
  X402PaymentContext,
  DeliveryMetadata,
  AuthorityBinding,
  Continuity,
  Verdict,
  Amount,
  Sar402Payload,
  SarReceiptResult,
  SarContext,
} from './types.js'

/** Error types for @defaultsettlement/sar-402. */

/** Base class for all SDK errors. */
export class Sar402Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** Thrown at construction time for invalid configuration. */
export class Sar402ConfigError extends Sar402Error {}

/**
 * Thrown when `gate` mode is requested. Gate mode lets a verifier verdict block
 * release — it is deliberately out of scope for Phase 1 of this SDK, because
 * this middleware must never sit on the resource server's delivery path with
 * authority to withhold. Use `observe` or `record`.
 */
export class GateModeUnsupportedError extends Sar402ConfigError {
  constructor() {
    super(
      "gate mode is not supported by @defaultsettlement/sar-402 (Phase 1). " +
        "The verifier never holds execution authority or controls resource release. " +
        "Use mode 'observe' or 'record'.",
    )
  }
}

/**
 * Thrown when evidence would assert that the verifier holds execution
 * authority. The authority boundary is non-negotiable.
 */
export class AuthorityBoundaryError extends Sar402Error {}

/**
 * Wraps a DefaultVerifier transport/HTTP failure. On the fail-open path this is
 * caught internally and surfaced through `onError`; it never propagates into
 * the resource server's response path.
 */
export class DefaultVerifierError extends Sar402Error {
  readonly status?: number
  readonly cause?: unknown
  constructor(message: string, opts: { status?: number; cause?: unknown } = {}) {
    super(message)
    this.status = opts.status
    this.cause = opts.cause
  }
}

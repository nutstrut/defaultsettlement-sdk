/** Error types for @defaultsettlement/canonical. */

/** Base class for all canonical-package errors. */
export class CanonicalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/**
 * Thrown when a value fails a canonical validator (digest format, identity
 * scheme, action-type, content-type, or body-digest input).
 */
export class CanonicalValidationError extends CanonicalError {}

/** Thrown when signing or signature verification fails. */
export class CanonicalSignatureError extends CanonicalError {}

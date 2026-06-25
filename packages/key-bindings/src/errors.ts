/** Error types for @defaultsettlement/key-bindings. */

/** Base class for all key-bindings errors. */
export class KeyBindingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/**
 * Thrown when a publication-key document or an Agent Key Binding Assertion
 * (or one of its bindings) fails validation.
 */
export class KeyBindingRecordError extends KeyBindingError {}

/** Thrown when signing or signature verification of an assertion fails. */
export class KeyBindingSignatureError extends KeyBindingError {}

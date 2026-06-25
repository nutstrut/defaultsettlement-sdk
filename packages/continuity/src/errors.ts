/** Error types for @defaultsettlement/continuity. */

/** Base class for all continuity-layer errors. */
export class ContinuityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** Thrown when a Continuity Evaluation / Execution Outcome record is invalid. */
export class ContinuityRecordError extends ContinuityError {}

/** Thrown when signing or signature verification fails. */
export class ContinuitySignatureError extends ContinuityError {}

/** Thrown when records do not compose around the same `action_ref`. */
export class ContinuityCompositionError extends ContinuityError {}

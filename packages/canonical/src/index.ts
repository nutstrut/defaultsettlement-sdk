/**
 * @defaultsettlement/canonical
 *
 * Neutral shared primitives for Default Settlement packages. It standardizes
 * deterministic serialization, digest validation, identity validation,
 * content/body digesting, and signed-record envelope helpers.
 *
 * It does NOT provide a key registry or public key discovery. Verification
 * requires the caller to supply the trusted public key bound to the expected
 * signer identity, resolved out of band.
 *
 * Dependency direction: this package depends on nothing in the monorepo.
 * `@defaultsettlement/sar-402` and `@defaultsettlement/continuity` depend on it,
 * never the reverse.
 */

export { CanonicalError, CanonicalValidationError, CanonicalSignatureError } from './errors.js'

export {
  canonicalJson,
  sha256Hex,
  SHA256_DIGEST_RE,
  AGENT_ID_RE,
  ACTION_TYPE_RE,
  validateSha256Digest,
  validateActionRef,
  validateAgentId,
  validateActionType,
  canonicalizeContentType,
  computeBodyDigest,
} from './canonical.js'
export type { BodyInput } from './canonical.js'

export {
  SIGNATURE_ALG,
  generateEd25519KeyPair,
  exportPublicKeyB64,
  importPublicKeyB64,
  signedCore,
  canonicalSigningInput,
  signedPayloadDigest,
  signEnvelope,
  verifyEnvelope,
} from './signing.js'
export type { SignatureBlock, Signed, VerifyEnvelopeOptions } from './signing.js'

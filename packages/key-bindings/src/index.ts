/**
 * @defaultsettlement/key-bindings
 *
 * Define, sign, verify, and resolve Default Settlement Agent Key Binding
 * Assertions.
 *
 * A Default Settlement Agent Key Binding Assertion is an OPTIONAL published
 * trust source. It lets a verifier resolve an agent identity to a trusted
 * Ed25519 public key without private coordination, IF the verifier chooses to
 * trust Default Settlement's published bindings. It is NOT a decentralized
 * registry, certificate authority, revocation system, or transparency log.
 *
 * The assertion answers only: "is this presented public key the trusted key for
 * this signer identity?" It does not prove an agent acted correctly, that a
 * receipt is true, or that Default Settlement is the only valid source of trust
 * bindings.
 *
 * Dependency direction: this package depends ONLY on
 * `@defaultsettlement/canonical`. It MUST NOT import `@defaultsettlement/sar-402`
 * or `@defaultsettlement/continuity`.
 */

export { KeyBindingError, KeyBindingRecordError, KeyBindingSignatureError } from './errors.js'

export {
  canonicalJson,
  sha256Hex,
  AGENT_ID_RE,
  SHA256_DIGEST_RE,
  PUBLICATION_KEY_FINGERPRINT_RE,
  validateAgentId,
  validatePublicationKeyFingerprint,
  validateTimestamp,
} from './canonical.js'

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
  publicationKeyFingerprint,
  publicKeyFromPrivate,
} from './signing.js'
export type { SignatureBlock, Signed, VerifyEnvelopeOptions } from './signing.js'

export {
  DEFAULTSETTLEMENT_PUBLICATION_KEY_SCHEMA_ID,
  PUBLISHER_ID,
  validatePublicationKeyDocument,
} from './publication-key.js'
export type { DefaultSettlementPublicationKey } from './publication-key.js'

export {
  AGENT_KEY_BINDING_ASSERTION_SCHEMA_ID,
  validateAgentKeyBindingAssertionCore,
  validateAgentKeyBindingAssertion,
  signAgentKeyBindingAssertion,
  verifyAgentKeyBindingAssertion,
} from './assertion.js'
export type {
  AgentKeyBinding,
  AgentKeyBindingAssertionCore,
  AgentKeyBindingAssertion,
} from './assertion.js'

export {
  resolveTrustedKeyForSignedRecord,
  checkBindingAssertionVersion,
} from './resolver.js'
export type { ResolveTrustedKeyResult, BindingAssertionVersionResult } from './resolver.js'

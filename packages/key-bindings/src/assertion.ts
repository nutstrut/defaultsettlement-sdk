/**
 * Agent Key Binding Assertion
 * (schema_id: ds.agent_key_binding_assertion.v0.1).
 *
 * A signed document by which Default Settlement asserts, as of an integer
 * version N, that a set of agent identities are bound to specific Ed25519
 * public keys:
 *
 *   "As of version N, Default Settlement asserts that agent_id X is bound to
 *    Ed25519 public key Y."
 *
 * It is an OPTIONAL published trust source. A verifier MAY use it to resolve a
 * signer identity to a trusted key, or MAY supply its own trusted bindings. It
 * is NOT a decentralized registry, certificate authority, revocation system, or
 * transparency log.
 *
 * v0.1 deliberately has NO `status` field on bindings: a `status` would imply
 * revocation semantics, and v0.1 does not define or enforce revocation.
 */

import { type KeyObject } from 'node:crypto'
import { KeyBindingRecordError } from './errors.js'
import { validateAgentId, validatePublicationKeyFingerprint, validateTimestamp } from './canonical.js'
import { PUBLISHER_ID } from './publication-key.js'
import {
  type Signed,
  type SignatureBlock,
  signEnvelope,
  verifyEnvelope,
  importPublicKeyB64,
  publicKeyFromPrivate,
  publicationKeyFingerprint,
} from './signing.js'

export const AGENT_KEY_BINDING_ASSERTION_SCHEMA_ID = 'ds.agent_key_binding_assertion.v0.1' as const

/** One agent identity bound to one Ed25519 public key. No `status` in v0.1. */
export interface AgentKeyBinding {
  agent_id: string
  key_alg: 'ed25519'
  /** Base64 SPKI DER of the bound Ed25519 public key. */
  public_key: string
}

/** Canonical unsigned core of an Agent Key Binding Assertion. */
export interface AgentKeyBindingAssertionCore {
  schema_id: typeof AGENT_KEY_BINDING_ASSERTION_SCHEMA_ID
  version: number
  published_at: string
  publisher: {
    id: typeof PUBLISHER_ID
    publication_key_fingerprint: string
  }
  bindings: AgentKeyBinding[]
}

/** A signed Agent Key Binding Assertion: canonical core + signature envelope. */
export type AgentKeyBindingAssertion = Signed<AgentKeyBindingAssertionCore>

function validateVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new KeyBindingRecordError(`version must be a positive safe integer; got ${String(value)}`)
  }
  return value
}

/** Validate a single binding. Rejects unknown `key_alg`, malformed keys, and any `status` field. */
function validateBinding(binding: unknown, index: number): AgentKeyBinding {
  const where = `bindings[${index}]`
  if (binding == null || typeof binding !== 'object') {
    throw new KeyBindingRecordError(`${where} must be an object`)
  }
  const b = binding as Record<string, unknown>
  if ('status' in b) {
    throw new KeyBindingRecordError(
      `${where} must not carry a status field; v0.1 does not define or enforce revocation semantics`,
    )
  }
  validateAgentId(b.agent_id, `${where}.agent_id`)
  if (b.key_alg !== 'ed25519') {
    throw new KeyBindingRecordError(`${where}.key_alg must be 'ed25519'`)
  }
  if (typeof b.public_key !== 'string' || b.public_key.trim() === '') {
    throw new KeyBindingRecordError(`${where}.public_key is required and must be a base64 SPKI DER string`)
  }
  try {
    importPublicKeyB64(b.public_key)
  } catch {
    throw new KeyBindingRecordError(`${where}.public_key is not a valid Ed25519 SPKI DER public key`)
  }
  return { agent_id: b.agent_id as string, key_alg: 'ed25519', public_key: b.public_key }
}

/** Validate the unsigned core of an Agent Key Binding Assertion. */
export function validateAgentKeyBindingAssertionCore(core: unknown): AgentKeyBindingAssertionCore {
  if (core == null || typeof core !== 'object') {
    throw new KeyBindingRecordError('assertion core must be an object')
  }
  const c = core as Record<string, unknown>
  if (c.schema_id !== AGENT_KEY_BINDING_ASSERTION_SCHEMA_ID) {
    throw new KeyBindingRecordError(`schema_id must be exactly ${AGENT_KEY_BINDING_ASSERTION_SCHEMA_ID}`)
  }
  validateVersion(c.version)
  validateTimestamp(c.published_at, 'published_at')

  if (c.publisher == null || typeof c.publisher !== 'object') {
    throw new KeyBindingRecordError('publisher is required and must be an object')
  }
  const pub = c.publisher as Record<string, unknown>
  if (pub.id !== PUBLISHER_ID) {
    throw new KeyBindingRecordError(`publisher.id must be exactly ${PUBLISHER_ID}`)
  }
  validatePublicationKeyFingerprint(pub.publication_key_fingerprint, 'publisher.publication_key_fingerprint')

  if (!Array.isArray(c.bindings)) {
    throw new KeyBindingRecordError('bindings is required and must be an array')
  }
  const bindings = c.bindings.map((b, i) => validateBinding(b, i))

  // No duplicate agent_id values.
  const seenIds = new Set<string>()
  for (const b of bindings) {
    if (seenIds.has(b.agent_id)) {
      throw new KeyBindingRecordError(`duplicate agent_id in bindings: ${b.agent_id}`)
    }
    seenIds.add(b.agent_id)
  }
  // No duplicate public keys.
  const seenKeys = new Set<string>()
  for (const b of bindings) {
    if (seenKeys.has(b.public_key)) {
      throw new KeyBindingRecordError('duplicate public_key in bindings')
    }
    seenKeys.add(b.public_key)
  }

  return {
    schema_id: AGENT_KEY_BINDING_ASSERTION_SCHEMA_ID,
    version: c.version as number,
    published_at: c.published_at as string,
    publisher: {
      id: PUBLISHER_ID,
      publication_key_fingerprint: pub.publication_key_fingerprint as string,
    },
    bindings,
  }
}

/** Validate a signed Agent Key Binding Assertion (shape + signature block presence). */
export function validateAgentKeyBindingAssertion(assertion: unknown): AgentKeyBindingAssertion {
  if (assertion == null || typeof assertion !== 'object') {
    throw new KeyBindingRecordError('assertion must be an object')
  }
  const sig = (assertion as { signature?: unknown }).signature
  if (sig == null || typeof sig !== 'object') {
    throw new KeyBindingRecordError('signed assertion is missing its signature block')
  }
  const core = validateAgentKeyBindingAssertionCore(assertion)
  return { ...core, signature: sig as SignatureBlock }
}

/**
 * Sign an Agent Key Binding Assertion with Default Settlement's publication
 * private key.
 *
 * - default `keyId` is `publisher:defaultsettlement`;
 * - derives the signer public key from the private key;
 * - computes the publication-key fingerprint of that public key;
 * - confirms `core.publisher.publication_key_fingerprint` matches it (the body
 *   must commit to the key that signs the document);
 * - signs with the canonical envelope and returns the signed assertion.
 */
export function signAgentKeyBindingAssertion(
  core: AgentKeyBindingAssertionCore,
  privateKey: KeyObject,
  keyId: typeof PUBLISHER_ID = PUBLISHER_ID,
): AgentKeyBindingAssertion {
  const validated = validateAgentKeyBindingAssertionCore(core)
  const publicKey = publicKeyFromPrivate(privateKey)
  const fingerprint = publicationKeyFingerprint(publicKey)
  if (validated.publisher.publication_key_fingerprint !== fingerprint) {
    throw new KeyBindingRecordError(
      'publisher.publication_key_fingerprint does not match the fingerprint of the signing publication key',
    )
  }
  return signEnvelope(validated, privateKey, keyId)
}

/**
 * Verify a signed Agent Key Binding Assertion against a supplied trusted
 * publication key.
 *
 * - validates the assertion shape;
 * - checks the body `publication_key_fingerprint` matches the supplied key;
 * - verifies the envelope binding `key_id` to `publisher:defaultsettlement`
 *   and the presented key to the supplied publication key;
 * - returns the validated core on success.
 */
export function verifyAgentKeyBindingAssertion(
  assertion: AgentKeyBindingAssertion,
  publicationKey: KeyObject,
): AgentKeyBindingAssertionCore {
  const validated = validateAgentKeyBindingAssertion(assertion)
  const fingerprint = publicationKeyFingerprint(publicationKey)
  if (validated.publisher.publication_key_fingerprint !== fingerprint) {
    throw new KeyBindingRecordError(
      'publisher.publication_key_fingerprint does not match the supplied trusted publication key',
    )
  }
  const core = verifyEnvelope<AgentKeyBindingAssertionCore>(validated, {
    expectedPublicKey: publicationKey,
    expectedKeyId: PUBLISHER_ID,
  })
  return validateAgentKeyBindingAssertionCore(core)
}

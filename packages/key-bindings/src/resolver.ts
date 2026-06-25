/**
 * Resolver: connect an Agent Key Binding Assertion to existing signed-record
 * verification.
 *
 * A signed record already carries `signature.key_id`, `signature.public_key`,
 * and `signature.signature`. The binding assertion answers a DIFFERENT
 * question: is the presented public key the trusted key for this signer
 * identity?
 *
 * This resolver performs ONLY binding resolution. It does NOT verify the
 * record's Ed25519 signature — that stays composable. On a `verified` result,
 * pass the returned `public_key` to canonical `verifyEnvelope` to check the
 * signature itself.
 *
 * Outcome distinction (do not collapse these):
 *   - `unresolved_trust_binding` — no trusted binding exists for this signer
 *      identity. The verifier simply cannot resolve a trusted key.
 *   - `key_binding_mismatch` — a trusted binding EXISTS, but the record
 *      presented a different key. This is security-relevant and must NOT be
 *      softened into "unresolved".
 */

import { type KeyObject } from 'node:crypto'
import { type AgentKeyBindingAssertionCore } from './assertion.js'
import { importPublicKeyB64 } from './signing.js'

/** Result of resolving a signed record's presented key against a binding assertion. */
export type ResolveTrustedKeyResult =
  | {
      ok: true
      status: 'verified'
      signer_id: string
      public_key: KeyObject
      public_key_b64: string
      binding_version: number
    }
  | {
      ok: false
      status: 'unresolved_trust_binding'
      signer_id: string | null
      reason: string
    }
  | {
      ok: false
      status: 'key_binding_mismatch'
      signer_id: string
      record_public_key_b64: string
      bound_public_key_b64: string
      binding_version: number
      reason: string
    }
  | {
      ok: false
      status: 'malformed_signature_block'
      signer_id: string | null
      reason: string
    }

interface SignatureLike {
  key_id?: unknown
  public_key?: unknown
}

/**
 * Resolve the trusted key for a signed record's asserted signer identity.
 *
 *   1. Extract `signature.key_id` and `signature.public_key`.
 *   2. Find a binding whose `agent_id === signature.key_id`.
 *   3. No binding              -> `unresolved_trust_binding`.
 *   4. Binding, key differs    -> `key_binding_mismatch`.
 *   5. Binding, key matches     -> `verified` (with the imported public key).
 *
 * A malformed / missing signature block returns `malformed_signature_block`.
 */
export function resolveTrustedKeyForSignedRecord(
  signedRecord: { signature?: unknown },
  assertionCore: AgentKeyBindingAssertionCore,
): ResolveTrustedKeyResult {
  const sig = signedRecord?.signature
  if (sig == null || typeof sig !== 'object') {
    return {
      ok: false,
      status: 'malformed_signature_block',
      signer_id: null,
      reason: 'signed record has no signature block',
    }
  }
  const block = sig as SignatureLike
  if (typeof block.key_id !== 'string' || block.key_id.trim() === '') {
    return {
      ok: false,
      status: 'malformed_signature_block',
      signer_id: null,
      reason: 'signature.key_id is missing or not a string',
    }
  }
  const signerId = block.key_id
  if (typeof block.public_key !== 'string' || block.public_key.trim() === '') {
    return {
      ok: false,
      status: 'malformed_signature_block',
      signer_id: signerId,
      reason: 'signature.public_key is missing or not a string',
    }
  }
  const recordPublicKeyB64 = block.public_key

  const binding = assertionCore.bindings.find((b) => b.agent_id === signerId)
  if (!binding) {
    return {
      ok: false,
      status: 'unresolved_trust_binding',
      signer_id: signerId,
      reason: `no trusted binding exists for signer identity ${signerId}`,
    }
  }
  if (binding.public_key !== recordPublicKeyB64) {
    return {
      ok: false,
      status: 'key_binding_mismatch',
      signer_id: signerId,
      record_public_key_b64: recordPublicKeyB64,
      bound_public_key_b64: binding.public_key,
      binding_version: assertionCore.version,
      reason: `a trusted binding exists for ${signerId} but the record presented a different key`,
    }
  }
  return {
    ok: true,
    status: 'verified',
    signer_id: signerId,
    public_key: importPublicKeyB64(binding.public_key),
    public_key_b64: binding.public_key,
    binding_version: assertionCore.version,
  }
}

/** Result of the verifier-side monotonicity check. */
export type BindingAssertionVersionResult =
  | { ok: true }
  | {
      ok: false
      status: 'binding_document_downgrade'
      fetched_version: number
      previously_accepted_version: number
      reason: string
    }

/**
 * Local, verifier-side downgrade protection. If a verifier has previously
 * accepted version N from a binding source, it MAY reject a later-fetched
 * document from that source whose version is < N as a downgrade.
 *
 * This is NOT an append-only proof and provides NO transparency-log guarantees.
 * It is purely local state held by one verifier.
 */
export function checkBindingAssertionVersion(
  fetchedVersion: number,
  previouslyAcceptedVersion?: number,
): BindingAssertionVersionResult {
  if (previouslyAcceptedVersion === undefined) {
    return { ok: true }
  }
  if (fetchedVersion < previouslyAcceptedVersion) {
    return {
      ok: false,
      status: 'binding_document_downgrade',
      fetched_version: fetchedVersion,
      previously_accepted_version: previouslyAcceptedVersion,
      reason: `fetched binding version ${fetchedVersion} is lower than previously accepted ${previouslyAcceptedVersion}`,
    }
  }
  return { ok: true }
}

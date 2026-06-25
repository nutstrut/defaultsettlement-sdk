import { describe, it, expect } from 'vitest'
import {
  resolveTrustedKeyForSignedRecord,
  signAgentKeyBindingAssertion,
  verifyAgentKeyBindingAssertion,
  signEnvelope,
  verifyEnvelope,
  exportPublicKeyB64,
} from '../src/index.js'
import { publicationKeypair, morpheusKeypair, buildCore, ed25519FromSeed } from './helpers.js'
import { createPublicKey } from 'node:crypto'

/** A continuity-style signed record signed by agent:morpheus. */
function continuityStyleRecord(signerId: string, privateKey: import('node:crypto').KeyObject) {
  const core = {
    schema_id: 'ds.continuity_evaluation.v0.1',
    action_ref: 'sha256:' + 'a'.repeat(64),
    evaluator_id: signerId,
    evaluation_state: 'PASS',
    policy_ref: 'policy:demo',
    evaluated_at: '2026-06-25T14:30:00Z',
  }
  return signEnvelope(core, privateKey, signerId)
}

describe('resolver', () => {
  const pub = publicationKeypair()
  const morpheus = morpheusKeypair()
  const assertionCore = buildCore(pub.publicKey, morpheus.publicKey)

  it('a matching signed record key resolves as verified', () => {
    const record = continuityStyleRecord('agent:morpheus', morpheus.privateKey)
    const result = resolveTrustedKeyForSignedRecord(record, assertionCore)
    expect(result.ok).toBe(true)
    expect(result.status).toBe('verified')
    if (result.status === 'verified') {
      expect(result.signer_id).toBe('agent:morpheus')
      expect(result.public_key_b64).toBe(exportPublicKeyB64(morpheus.publicKey))
      expect(result.binding_version).toBe(1)
    }
  })

  it('no binding for the signer returns unresolved_trust_binding', () => {
    const stranger = ed25519FromSeed('d4'.repeat(32))
    const record = continuityStyleRecord('agent:trinity', stranger)
    const result = resolveTrustedKeyForSignedRecord(record, assertionCore)
    expect(result).toMatchObject({ ok: false, status: 'unresolved_trust_binding', signer_id: 'agent:trinity' })
  })

  it('a binding that exists but a different presented key returns key_binding_mismatch', () => {
    const impostor = ed25519FromSeed('e5'.repeat(32))
    // Signs as agent:morpheus, but with a DIFFERENT key than the bound one.
    const record = continuityStyleRecord('agent:morpheus', impostor)
    const result = resolveTrustedKeyForSignedRecord(record, assertionCore)
    expect(result.ok).toBe(false)
    expect(result.status).toBe('key_binding_mismatch')
    if (result.status === 'key_binding_mismatch') {
      expect(result.record_public_key_b64).toBe(exportPublicKeyB64(createPublicKey(impostor)))
      expect(result.bound_public_key_b64).toBe(exportPublicKeyB64(morpheus.publicKey))
      expect(result.binding_version).toBe(1)
    }
  })

  it('a malformed / missing signature block returns malformed_signature_block', () => {
    expect(resolveTrustedKeyForSignedRecord({}, assertionCore)).toMatchObject({
      ok: false,
      status: 'malformed_signature_block',
    })
    expect(resolveTrustedKeyForSignedRecord({ signature: { key_id: 'agent:morpheus' } }, assertionCore)).toMatchObject({
      ok: false,
      status: 'malformed_signature_block',
    })
  })

  it('the resolved key can be passed into canonical verifyEnvelope to verify the record', () => {
    const record = continuityStyleRecord('agent:morpheus', morpheus.privateKey)
    const result = resolveTrustedKeyForSignedRecord(record, assertionCore)
    if (!result.ok || result.status !== 'verified') throw new Error('expected verified')
    const core = verifyEnvelope(record, {
      expectedPublicKey: result.public_key,
      expectedKeyId: result.signer_id,
    })
    expect((core as { evaluator_id: string }).evaluator_id).toBe('agent:morpheus')
  })

  it('end-to-end: verify assertion, resolve, then verify the record', () => {
    const signedAssertion = signAgentKeyBindingAssertion(assertionCore, pub.privateKey)
    const verifiedCore = verifyAgentKeyBindingAssertion(signedAssertion, pub.publicKey)
    const record = continuityStyleRecord('agent:morpheus', morpheus.privateKey)
    const result = resolveTrustedKeyForSignedRecord(record, verifiedCore)
    if (!result.ok || result.status !== 'verified') throw new Error('expected verified')
    expect(() =>
      verifyEnvelope(record, { expectedPublicKey: result.public_key, expectedKeyId: result.signer_id }),
    ).not.toThrow()
  })
})

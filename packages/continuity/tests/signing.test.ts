import { describe, it, expect } from 'vitest'
import {
  signEnvelope,
  verifyEnvelope,
  signedCore,
  canonicalSigningInput,
  signedPayloadDigest,
} from '../src/index.js'
import { ContinuitySignatureError } from '../src/errors.js'
import { keypair } from './helpers.js'

interface DemoCore {
  schema_id: 'demo.v0.1'
  subject_id: string
  value: string
}

const core: DemoCore = { schema_id: 'demo.v0.1', subject_id: 'agent:example', value: 'hello' }

describe('signing envelope', () => {
  it('the signature is not included in the signed bytes', () => {
    const { privateKey } = keypair()
    const signed = signEnvelope(core, privateKey, core.subject_id)
    const input = canonicalSigningInput(signed)
    expect(input).not.toContain('signature')
    expect(input).toBe(JSON.stringify({ schema_id: 'demo.v0.1', subject_id: 'agent:example', value: 'hello' }))
  })

  it('signedCore excludes the signature block from the canonical signing input', () => {
    const { privateKey } = keypair()
    const signed = signEnvelope(core, privateKey, core.subject_id)
    expect('signature' in signedCore(signed)).toBe(false)
  })

  it('a generated signed record verifies', () => {
    const { publicKey, privateKey } = keypair()
    const signed = signEnvelope(core, privateKey, core.subject_id)
    expect(() => verifyEnvelope<DemoCore>(signed, { expectedPublicKey: publicKey, expectedKeyId: core.subject_id })).not.toThrow()
  })

  it('modifying the signature block alone does not change the canonical signed payload digest', () => {
    const { privateKey } = keypair()
    const signed = signEnvelope(core, privateKey, core.subject_id)
    const before = signedPayloadDigest(signed)
    const mutated = { ...signed, signature: { ...signed.signature, signature: 'AAAA' } }
    const after = signedPayloadDigest(mutated)
    expect(after).toBe(before)
  })

  it('modifying the signed payload invalidates verification', () => {
    const { publicKey, privateKey } = keypair()
    const signed = signEnvelope(core, privateKey, core.subject_id)
    const mutated = { ...signed, value: 'tampered' }
    expect(() => verifyEnvelope<DemoCore>(mutated, { expectedPublicKey: publicKey, expectedKeyId: core.subject_id })).toThrow(
      ContinuitySignatureError,
    )
  })

  it('a valid signature with a mismatched identity fails verification', () => {
    const legit = keypair()
    const attacker = keypair()
    // Validly signed by attacker, but the trusted key for this identity is legit's.
    const signed = signEnvelope(core, attacker.privateKey, core.subject_id)
    expect(() =>
      verifyEnvelope<DemoCore>(signed, { expectedPublicKey: legit.publicKey, expectedKeyId: core.subject_id }),
    ).toThrow(ContinuitySignatureError)
  })

  it('a mismatched key_id fails verification', () => {
    const { publicKey, privateKey } = keypair()
    const signed = signEnvelope(core, privateKey, 'agent:wrong')
    expect(() =>
      verifyEnvelope<DemoCore>(signed, { expectedPublicKey: publicKey, expectedKeyId: core.subject_id }),
    ).toThrow(ContinuitySignatureError)
  })
})

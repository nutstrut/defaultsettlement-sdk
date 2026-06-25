import { describe, it, expect } from 'vitest'
import {
  generateEd25519KeyPair,
  signEnvelope,
  verifyEnvelope,
  signedCore,
  canonicalSigningInput,
  signedPayloadDigest,
  CanonicalSignatureError,
} from '../src/index.js'

interface DemoCore {
  schema_id: 'demo.v0.1'
  subject_id: string
  value: string
}

const core: DemoCore = { schema_id: 'demo.v0.1', subject_id: 'agent:example', value: 'hello' }

describe('signing envelope', () => {
  it('signedCore excludes the signature block', () => {
    const { privateKey } = generateEd25519KeyPair()
    const signed = signEnvelope(core, privateKey, core.subject_id)
    expect('signature' in signedCore(signed)).toBe(false)
  })

  it('the signature is not part of the canonical signing input', () => {
    const { privateKey } = generateEd25519KeyPair()
    const signed = signEnvelope(core, privateKey, core.subject_id)
    const input = canonicalSigningInput(signed)
    expect(input).not.toContain('signature')
    expect(input).toBe(JSON.stringify({ schema_id: 'demo.v0.1', subject_id: 'agent:example', value: 'hello' }))
  })

  it('signedPayloadDigest is unchanged by a signature-block mutation', () => {
    const { privateKey } = generateEd25519KeyPair()
    const signed = signEnvelope(core, privateKey, core.subject_id)
    const before = signedPayloadDigest(signed)
    const mutated = { ...signed, signature: { ...signed.signature, signature: 'AAAA' } }
    expect(signedPayloadDigest(mutated)).toBe(before)
  })

  it('sign/verify succeeds with the trusted key', () => {
    const { publicKey, privateKey } = generateEd25519KeyPair()
    const signed = signEnvelope(core, privateKey, core.subject_id)
    expect(() =>
      verifyEnvelope<DemoCore>(signed, { expectedPublicKey: publicKey, expectedKeyId: core.subject_id }),
    ).not.toThrow()
  })

  it('a mismatched key_id fails before the trust check', () => {
    const { publicKey, privateKey } = generateEd25519KeyPair()
    const signed = signEnvelope(core, privateKey, 'agent:wrong')
    expect(() =>
      verifyEnvelope<DemoCore>(signed, { expectedPublicKey: publicKey, expectedKeyId: core.subject_id }),
    ).toThrow(CanonicalSignatureError)
  })

  it('a presented public key that is not the trusted key fails (no trust by default)', () => {
    const legit = generateEd25519KeyPair()
    const attacker = generateEd25519KeyPair()
    const signed = signEnvelope(core, attacker.privateKey, core.subject_id)
    expect(() =>
      verifyEnvelope<DemoCore>(signed, { expectedPublicKey: legit.publicKey, expectedKeyId: core.subject_id }),
    ).toThrow(CanonicalSignatureError)
  })

  it('a tampered payload fails verification', () => {
    const { publicKey, privateKey } = generateEd25519KeyPair()
    const signed = signEnvelope(core, privateKey, core.subject_id)
    const mutated = { ...signed, value: 'tampered' }
    expect(() =>
      verifyEnvelope<DemoCore>(mutated, { expectedPublicKey: publicKey, expectedKeyId: core.subject_id }),
    ).toThrow(CanonicalSignatureError)
  })
})

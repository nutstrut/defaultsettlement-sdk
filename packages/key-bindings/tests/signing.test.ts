import { describe, it, expect } from 'vitest'
import {
  signAgentKeyBindingAssertion,
  verifyAgentKeyBindingAssertion,
  canonicalSigningInput,
  KeyBindingRecordError,
  KeyBindingSignatureError,
} from '../src/index.js'
import { publicationKeypair, morpheusKeypair, buildCore } from './helpers.js'

describe('signing / verification', () => {
  it('signing an assertion succeeds', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    const core = buildCore(pub.publicKey, morpheus.publicKey)
    const signed = signAgentKeyBindingAssertion(core, pub.privateKey)
    expect(signed.signature.alg).toBe('ed25519')
    expect(signed.signature.key_id).toBe('publisher:defaultsettlement')
  })

  it('verification succeeds with the trusted publication key', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    const signed = signAgentKeyBindingAssertion(buildCore(pub.publicKey, morpheus.publicKey), pub.privateKey)
    const core = verifyAgentKeyBindingAssertion(signed, pub.publicKey)
    expect(core.bindings[0]?.agent_id).toBe('agent:morpheus')
  })

  it('verification fails if the body fingerprint does not match the trusted publication key', () => {
    const pub = publicationKeypair()
    const other = morpheusKeypair() // a different key entirely
    const morpheus = morpheusKeypair()
    const signed = signAgentKeyBindingAssertion(buildCore(pub.publicKey, morpheus.publicKey), pub.privateKey)
    expect(() => verifyAgentKeyBindingAssertion(signed, other.publicKey)).toThrow(KeyBindingRecordError)
  })

  it('verification fails if the signature key_id is not publisher:defaultsettlement', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    const signed = signAgentKeyBindingAssertion(buildCore(pub.publicKey, morpheus.publicKey), pub.privateKey)
    const tampered = { ...signed, signature: { ...signed.signature, key_id: 'publisher:impostor' } }
    expect(() => verifyAgentKeyBindingAssertion(tampered, pub.publicKey)).toThrow(KeyBindingSignatureError)
  })

  it('verification fails if the document is tampered after signing', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    const signed = signAgentKeyBindingAssertion(buildCore(pub.publicKey, morpheus.publicKey), pub.privateKey)
    const tampered = { ...signed, version: 999 }
    expect(() => verifyAgentKeyBindingAssertion(tampered, pub.publicKey)).toThrow(KeyBindingSignatureError)
  })

  it('the signature block is excluded from the signed bytes (canonical envelope behavior)', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    const signed = signAgentKeyBindingAssertion(buildCore(pub.publicKey, morpheus.publicKey), pub.privateKey)
    const input = canonicalSigningInput(signed)
    expect(input).not.toContain(signed.signature.signature)
    expect(input).not.toContain('"signature"')
  })

  it('signing fails if the body fingerprint does not commit to the signing key', () => {
    const pub = publicationKeypair()
    const other = morpheusKeypair()
    const morpheus = morpheusKeypair()
    // Core claims the wrong publication key fingerprint.
    const core = buildCore(other.publicKey, morpheus.publicKey)
    expect(() => signAgentKeyBindingAssertion(core, pub.privateKey)).toThrow(KeyBindingRecordError)
  })
})

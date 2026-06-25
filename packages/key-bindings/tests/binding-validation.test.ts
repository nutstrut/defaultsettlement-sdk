import { describe, it, expect } from 'vitest'
import {
  validateAgentKeyBindingAssertionCore,
  validateAgentKeyBindingAssertion,
  exportPublicKeyB64,
  KeyBindingRecordError,
} from '../src/index.js'
import { publicationKeypair, morpheusKeypair, buildCore, ed25519FromSeed } from './helpers.js'
import { createPublicKey } from 'node:crypto'

describe('binding validation', () => {
  it('a valid binding passes', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    expect(() => validateAgentKeyBindingAssertionCore(buildCore(pub.publicKey, morpheus.publicKey))).not.toThrow()
  })

  it('invalid agent_id rejects', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    const core = buildCore(pub.publicKey, morpheus.publicKey)
    core.bindings[0]!.agent_id = 'Morpheus' // not the agent: scheme
    expect(() => validateAgentKeyBindingAssertionCore(core)).toThrow(KeyBindingRecordError)
  })

  it('unsupported key_alg rejects', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    const core = buildCore(pub.publicKey, morpheus.publicKey)
    ;(core.bindings[0] as Record<string, unknown>).key_alg = 'rsa'
    expect(() => validateAgentKeyBindingAssertionCore(core)).toThrow(KeyBindingRecordError)
  })

  it('a status field on a binding rejects (no revocation semantics in v0.1)', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    const core = buildCore(pub.publicKey, morpheus.publicKey)
    ;(core.bindings[0] as Record<string, unknown>).status = 'active'
    expect(() => validateAgentKeyBindingAssertionCore(core)).toThrow(/status/)
  })

  it('duplicate agent_id rejects', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    const other = createPublicKey(ed25519FromSeed('c3'.repeat(32)))
    const core = buildCore(pub.publicKey, morpheus.publicKey)
    core.bindings.push({ agent_id: 'agent:morpheus', key_alg: 'ed25519', public_key: exportPublicKeyB64(other) })
    expect(() => validateAgentKeyBindingAssertionCore(core)).toThrow(/duplicate agent_id/)
  })

  it('duplicate public_key rejects', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    const core = buildCore(pub.publicKey, morpheus.publicKey)
    core.bindings.push({ agent_id: 'agent:trinity', key_alg: 'ed25519', public_key: exportPublicKeyB64(morpheus.publicKey) })
    expect(() => validateAgentKeyBindingAssertionCore(core)).toThrow(/duplicate public_key/)
  })

  it('malformed public key rejects', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    const core = buildCore(pub.publicKey, morpheus.publicKey)
    core.bindings[0]!.public_key = 'not-a-key'
    expect(() => validateAgentKeyBindingAssertionCore(core)).toThrow(KeyBindingRecordError)
  })

  it('non-positive version rejects', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    const core = buildCore(pub.publicKey, morpheus.publicKey, { version: 0 })
    expect(() => validateAgentKeyBindingAssertionCore(core)).toThrow(KeyBindingRecordError)
  })

  it('signed-assertion validation requires a signature block', () => {
    const pub = publicationKeypair()
    const morpheus = morpheusKeypair()
    const core = buildCore(pub.publicKey, morpheus.publicKey)
    expect(() => validateAgentKeyBindingAssertion(core)).toThrow(/signature block/)
  })
})

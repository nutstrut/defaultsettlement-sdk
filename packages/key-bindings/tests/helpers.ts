import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import {
  exportPublicKeyB64,
  publicationKeyFingerprint,
  type AgentKeyBindingAssertionCore,
} from '../src/index.js'

/** Build a deterministic Ed25519 private key from a 32-byte seed (PKCS8 DER wrap). */
export function ed25519FromSeed(seedHex: string): KeyObject {
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(seedHex, 'hex'),
  ])
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
}

/** The publication keypair used across tests. */
export function publicationKeypair() {
  const privateKey = ed25519FromSeed('a1'.repeat(32))
  const publicKey = createPublicKey(privateKey)
  return { privateKey, publicKey }
}

/** A sample agent (agent:morpheus) keypair. */
export function morpheusKeypair() {
  const privateKey = ed25519FromSeed('b2'.repeat(32))
  const publicKey = createPublicKey(privateKey)
  return { privateKey, publicKey }
}

/** Build a single-binding assertion core bound to the supplied publication key. */
export function buildCore(
  publicationKey: KeyObject,
  bindingPublicKey: KeyObject,
  overrides: Partial<AgentKeyBindingAssertionCore> = {},
): AgentKeyBindingAssertionCore {
  return {
    schema_id: 'ds.agent_key_binding_assertion.v0.1',
    version: 1,
    published_at: '2026-06-25T00:00:00Z',
    publisher: {
      id: 'publisher:defaultsettlement',
      publication_key_fingerprint: publicationKeyFingerprint(publicationKey),
    },
    bindings: [
      {
        agent_id: 'agent:morpheus',
        key_alg: 'ed25519',
        public_key: exportPublicKeyB64(bindingPublicKey),
      },
    ],
    ...overrides,
  }
}

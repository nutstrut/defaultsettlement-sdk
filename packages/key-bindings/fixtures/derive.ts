/**
 * Reproducible generator for the key-bindings fixtures.
 *
 * Run (after `npm run build` at the repo root):
 *   npx tsx packages/key-bindings/fixtures/derive.ts
 *
 * It writes two PUBLIC anchor/reference artifacts:
 *   - defaultsettlement-publication-key.json     (ds.defaultsettlement_publication_key.v0.1)
 *   - defaultsettlement-agent-key-bindings.json  (signed ds.agent_key_binding_assertion.v0.1)
 *
 * Determinism: the publication and agent keys are derived from FIXED seeds so
 * the fixtures are byte-stable across runs. These seeds are illustrative test
 * material only — they are NOT deployable production keys, and no private key
 * material is ever written to the fixture JSON.
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import {
  signAgentKeyBindingAssertion,
  validatePublicationKeyDocument,
  verifyAgentKeyBindingAssertion,
  exportPublicKeyB64,
  publicationKeyFingerprint,
  type AgentKeyBindingAssertionCore,
  type DefaultSettlementPublicationKey,
} from '@defaultsettlement/key-bindings'

const here = dirname(fileURLToPath(import.meta.url))

/** Build a deterministic Ed25519 private key from a 32-byte seed (PKCS8 DER wrap). */
function ed25519FromSeed(seedHex: string): KeyObject {
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(seedHex, 'hex'),
  ])
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
}

function writeJson(name: string, value: unknown): void {
  writeFileSync(join(here, name), JSON.stringify(value, null, 2) + '\n')
}

// Publication key: the key Default Settlement uses to SIGN binding assertions.
const publicationPrivate = ed25519FromSeed('a1'.repeat(32))
const publicationPublic = createPublicKey(publicationPrivate)
const publicationPublicB64 = exportPublicKeyB64(publicationPublic)
const publicationFingerprint = publicationKeyFingerprint(publicationPublic)

// A deterministic sample agent keypair (agent:morpheus). Only the PUBLIC key is
// published in the binding; the private seed stays here, illustrative only.
const morpheusPrivate = ed25519FromSeed('b2'.repeat(32))
const morpheusPublicB64 = exportPublicKeyB64(createPublicKey(morpheusPrivate))

// 1. Publication-key anchor document (unsigned in v0.1).
const publicationKeyDoc: DefaultSettlementPublicationKey = {
  schema_id: 'ds.defaultsettlement_publication_key.v0.1',
  publisher_id: 'publisher:defaultsettlement',
  key_alg: 'ed25519',
  public_key: publicationPublicB64,
  publication_key_fingerprint: publicationFingerprint,
}
validatePublicationKeyDocument(publicationKeyDoc)
writeJson('defaultsettlement-publication-key.json', publicationKeyDoc)

// 2. Signed Agent Key Binding Assertion.
const assertionCore: AgentKeyBindingAssertionCore = {
  schema_id: 'ds.agent_key_binding_assertion.v0.1',
  version: 1,
  published_at: '2026-06-25T00:00:00Z',
  publisher: {
    id: 'publisher:defaultsettlement',
    publication_key_fingerprint: publicationFingerprint,
  },
  bindings: [
    {
      agent_id: 'agent:morpheus',
      key_alg: 'ed25519',
      public_key: morpheusPublicB64,
    },
  ],
}
const assertion = signAgentKeyBindingAssertion(assertionCore, publicationPrivate)
// Self-check: the signed fixture must verify against the published key.
verifyAgentKeyBindingAssertion(assertion, publicationPublic)
writeJson('defaultsettlement-agent-key-bindings.json', assertion)

// eslint-disable-next-line no-console
console.log('key-bindings fixtures written.')

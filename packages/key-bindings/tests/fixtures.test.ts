import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validatePublicationKeyDocument,
  verifyAgentKeyBindingAssertion,
  importPublicKeyB64,
  resolveTrustedKeyForSignedRecord,
  type AgentKeyBindingAssertion,
  type DefaultSettlementPublicationKey,
} from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, '..', 'fixtures')

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
}

describe('committed fixtures', () => {
  const pubRaw = readJson('defaultsettlement-publication-key.json') as DefaultSettlementPublicationKey
  const assertionRaw = readJson('defaultsettlement-agent-key-bindings.json') as AgentKeyBindingAssertion

  it('the publication-key document validates', () => {
    expect(() => validatePublicationKeyDocument(pubRaw)).not.toThrow()
  })

  it('the signed assertion verifies against the published publication key', () => {
    const publicationKey = importPublicKeyB64(pubRaw.public_key)
    const core = verifyAgentKeyBindingAssertion(assertionRaw, publicationKey)
    expect(core.bindings.some((b) => b.agent_id === 'agent:morpheus')).toBe(true)
  })

  it('a morpheus-signed record resolves against the fixture binding', () => {
    const morpheusKey = assertionRaw.bindings.find((b) => b.agent_id === 'agent:morpheus')!.public_key
    const record = { signature: { alg: 'ed25519', key_id: 'agent:morpheus', public_key: morpheusKey, signature: 'x' } }
    const result = resolveTrustedKeyForSignedRecord(record, assertionRaw)
    expect(result).toMatchObject({ ok: true, status: 'verified', signer_id: 'agent:morpheus' })
  })

  it('no private key material is present in either fixture', () => {
    for (const name of ['defaultsettlement-publication-key.json', 'defaultsettlement-agent-key-bindings.json']) {
      const raw = readFileSync(join(FIXTURES, name), 'utf8')
      expect(raw).not.toContain('PRIVATE')
      expect(raw).not.toMatch(/private_key/i)
    }
  })
})

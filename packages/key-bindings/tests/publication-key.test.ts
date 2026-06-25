import { describe, it, expect } from 'vitest'
import {
  validatePublicationKeyDocument,
  publicationKeyFingerprint,
  exportPublicKeyB64,
  KeyBindingRecordError,
  type DefaultSettlementPublicationKey,
} from '../src/index.js'
import { publicationKeypair } from './helpers.js'

function validDoc(): DefaultSettlementPublicationKey {
  const { publicKey } = publicationKeypair()
  return {
    schema_id: 'ds.defaultsettlement_publication_key.v0.1',
    publisher_id: 'publisher:defaultsettlement',
    key_alg: 'ed25519',
    public_key: exportPublicKeyB64(publicKey),
    publication_key_fingerprint: publicationKeyFingerprint(publicKey),
  }
}

describe('publication-key document', () => {
  it('a valid publication-key document passes', () => {
    expect(() => validatePublicationKeyDocument(validDoc())).not.toThrow()
  })

  it('fingerprint must match the public key', () => {
    const doc = validDoc()
    doc.publication_key_fingerprint = 'sha256:' + '0'.repeat(64)
    expect(() => validatePublicationKeyDocument(doc)).toThrow(KeyBindingRecordError)
  })

  it('wrong schema_id rejects', () => {
    const doc = { ...validDoc(), schema_id: 'ds.something_else.v0.1' }
    expect(() => validatePublicationKeyDocument(doc)).toThrow(KeyBindingRecordError)
  })

  it('wrong publisher_id rejects', () => {
    const doc = { ...validDoc(), publisher_id: 'publisher:someone-else' }
    expect(() => validatePublicationKeyDocument(doc)).toThrow(KeyBindingRecordError)
  })

  it('malformed public key rejects', () => {
    const doc = { ...validDoc(), public_key: 'not-a-valid-key' }
    expect(() => validatePublicationKeyDocument(doc)).toThrow(KeyBindingRecordError)
  })

  it('fingerprint is computed over raw DER bytes, not the base64 string', () => {
    const { publicKey } = publicationKeypair()
    const b64 = exportPublicKeyB64(publicKey)
    const fromString = publicationKeyFingerprint(b64)
    const fromKeyObject = publicationKeyFingerprint(publicKey)
    expect(fromString).toBe(fromKeyObject)
  })
})

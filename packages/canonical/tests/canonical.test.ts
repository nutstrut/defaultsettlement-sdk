import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  canonicalJson,
  sha256Hex,
  SHA256_DIGEST_RE,
  validateSha256Digest,
  validateActionRef,
  validateAgentId,
  validateActionType,
  canonicalizeContentType,
  computeBodyDigest,
  CanonicalValidationError,
} from '../src/index.js'

const sha256OfZeroBytes = 'sha256:' + createHash('sha256').update(Buffer.alloc(0)).digest('hex')

describe('canonicalJson', () => {
  it('sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: 2 } })).toBe('{"a":{"c":2},"b":1}')
  })

  it('emits compact separators (no spaces)', () => {
    expect(canonicalJson({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}')
  })

  it('is stable across key ordering', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }))
  })
})

describe('sha256Hex', () => {
  it('returns sha256:<64 lowercase hex>', () => {
    const d = sha256Hex('hello')
    expect(d).toMatch(SHA256_DIGEST_RE)
    expect(d).toBe('sha256:' + createHash('sha256').update('hello').digest('hex'))
  })

  it('hashes bytes and strings identically for equal content', () => {
    expect(sha256Hex(Buffer.from('x', 'utf8'))).toBe(sha256Hex('x'))
  })
})

describe('digest validation', () => {
  const good = sha256Hex('x')
  it('accepts a well-formed digest', () => {
    expect(validateSha256Digest(good)).toBe(good)
    expect(validateActionRef(good)).toBe(good)
  })
  it('rejects malformed digests', () => {
    for (const bad of ['sha256:XYZ', 'sha1:' + 'a'.repeat(40), good.toUpperCase(), 42, null]) {
      expect(() => validateSha256Digest(bad)).toThrow(CanonicalValidationError)
    }
  })
})

describe('agent_id validation', () => {
  it('accepts the agent: identity scheme', () => {
    for (const ok of ['agent:example', 'agent:morpheus', 'agent:x402:eip155:8453:0xPayer']) {
      expect(validateAgentId(ok)).toBe(ok)
    }
  })
  it('rejects freeform names and other schemes', () => {
    for (const bad of ['morpheus', 'did:morpheus', 'Agent Smith', '', 42]) {
      expect(() => validateAgentId(bad)).toThrow(CanonicalValidationError)
    }
  })
})

describe('action_type validation', () => {
  it('accepts a namespaced action type', () => {
    expect(validateActionType('sar402.resource_delivery')).toBe('sar402.resource_delivery')
  })
  it('rejects un-namespaced strings', () => {
    for (const bad of ['resource_delivery', 'SAR402.x', '', 42]) {
      expect(() => validateActionType(bad)).toThrow(CanonicalValidationError)
    }
  })
})

describe('content type canonicalization', () => {
  it('lowercases and strips parameters', () => {
    expect(canonicalizeContentType('Application/JSON; charset=UTF-8')).toBe('application/json')
  })
  it('rejects an empty content type', () => {
    expect(() => canonicalizeContentType('')).toThrow(CanonicalValidationError)
  })
})

describe('body digest', () => {
  it('empty body hashes zero bytes regardless of content type', () => {
    expect(computeBodyDigest('application/json', '')).toBe(sha256OfZeroBytes)
    expect(computeBodyDigest('text/plain', undefined)).toBe(sha256OfZeroBytes)
    expect(computeBodyDigest('application/octet-stream', new Uint8Array())).toBe(sha256OfZeroBytes)
  })

  it('application/json is key-order stable (JCS canonicalized)', () => {
    expect(computeBodyDigest('application/json', '{"b":1,"a":2}')).toBe(
      computeBodyDigest('application/json', '{"a":2,"b":1}'),
    )
  })

  it('charset parameter does not change the json digest', () => {
    expect(computeBodyDigest('application/json; charset=utf-8', '{"a":1}')).toBe(
      computeBodyDigest('application/json', '{"a":1}'),
    )
  })

  it('malformed non-empty JSON declared as JSON is rejected', () => {
    expect(() => computeBodyDigest('application/json', '{not json')).toThrow(CanonicalValidationError)
  })

  it('non-JSON content hashes the raw bytes', () => {
    const body = 'plain text body'
    expect(computeBodyDigest('text/plain', body)).toBe(sha256Hex(Buffer.from(body, 'utf8')))
  })
})

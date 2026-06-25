import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  ActionCommitmentError,
  buildActionCommitment,
  buildActionRequestCommitment,
  canonicalizeContentType,
  canonicalizeTarget,
  computeBodyDigest,
  deriveActionRef,
  deriveRequestDigest,
  operationBindingExt,
  validateAgentId,
  validateActionType,
  validateOperationBinding,
  type ActionRequestInput,
} from '../src/action-commitment.js'

const sha256OfZeroBytes =
  'sha256:' + createHash('sha256').update(Buffer.alloc(0)).digest('hex')

function baseRequest(over: Partial<ActionRequestInput> = {}): ActionRequestInput {
  return {
    method: 'POST',
    target: {
      scheme: 'https',
      host: 'api.example.com',
      port: null,
      path: '/demo/sar-402',
      query: {},
    },
    contentType: 'application/json',
    body: '{"region":"eu-west","n":2}',
    ...over,
  }
}

// ---------------------------------------------------------------------------
// 1. JSON body digest
// ---------------------------------------------------------------------------

describe('body digest', () => {
  it('application/json canonicalizes (JCS) before hashing — key order is irrelevant', () => {
    const a = computeBodyDigest('application/json', '{"b":1,"a":2}')
    const b = computeBodyDigest('application/json', '{"a":2,"b":1}')
    expect(a).toBe(b)
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('application/json; charset=utf-8 canonicalizes to application/json (same digest)', () => {
    const plain = computeBodyDigest('application/json', '{"a":1}')
    const withParams = computeBodyDigest('application/json; charset=utf-8', '{"a":1}')
    expect(withParams).toBe(plain)
  })

  it('malformed JSON declared as JSON is invalid', () => {
    expect(() => computeBodyDigest('application/json', '{not json')).toThrow(ActionCommitmentError)
  })

  it('non-JSON content hashes raw bytes', () => {
    const body = 'plain text body'
    const expected = 'sha256:' + createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex')
    expect(computeBodyDigest('text/plain', body)).toBe(expected)
    // The same bytes mislabeled as JSON would be rejected, proving the content
    // type drives the digest rule, not the bytes.
    expect(() => computeBodyDigest('application/json', body)).toThrow(ActionCommitmentError)
  })

  it('empty body hashes zero bytes', () => {
    expect(computeBodyDigest('application/json', '')).toBe(sha256OfZeroBytes)
    expect(computeBodyDigest('text/plain', undefined)).toBe(sha256OfZeroBytes)
    expect(computeBodyDigest('application/octet-stream', new Uint8Array())).toBe(sha256OfZeroBytes)
  })
})

describe('content_type canonicalization', () => {
  it('lowercases and strips parameters', () => {
    expect(canonicalizeContentType('Application/JSON; charset=UTF-8')).toBe('application/json')
  })
  it('rejects empty content type', () => {
    expect(() => canonicalizeContentType('')).toThrow(ActionCommitmentError)
  })
})

// ---------------------------------------------------------------------------
// 2. Target canonicalization
// ---------------------------------------------------------------------------

describe('target canonicalization', () => {
  it('lowercases host and scheme', () => {
    const t = canonicalizeTarget({
      scheme: 'HTTPS',
      host: 'API.Example.COM',
      port: null,
      path: '/demo/sar-402',
    })
    expect(t.scheme).toBe('https')
    expect(t.host).toBe('api.example.com')
  })

  it('default port is always present as null', () => {
    const t = canonicalizeTarget({ scheme: 'https', host: 'h', port: null, path: '/p' })
    expect('port' in t).toBe(true)
    expect(t.port).toBeNull()
  })

  it('non-default port is included as an integer', () => {
    const t = canonicalizeTarget({ scheme: 'https', host: 'h', port: 8443, path: '/p' })
    expect(t.port).toBe(8443)
  })

  it('query object is stable under key ordering', () => {
    const a = canonicalizeTarget({ scheme: 'https', host: 'h', port: null, path: '/p', query: { b: '2', a: '1' } })
    const b = canonicalizeTarget({ scheme: 'https', host: 'h', port: null, path: '/p', query: { a: '1', b: '2' } })
    expect(deriveRequestDigestForTarget(a)).toBe(deriveRequestDigestForTarget(b))
  })

  it('excluded volatile query fields never appear in the canonical target', () => {
    // The producer commits only semantic params. Volatile params (payment token,
    // nonce, trace id, session) must already be excluded before committing.
    const t = canonicalizeTarget({
      scheme: 'https',
      host: 'api.example.com',
      port: null,
      path: '/demo/sar-402',
      query: { region: 'eu-west' },
    })
    expect(Object.keys(t.query)).toEqual(['region'])
    for (const volatile of ['payment', 'sig', 'nonce', 'expiry', 'trace_id', 'session_id']) {
      expect(t.query).not.toHaveProperty(volatile)
    }
  })
})

describe('port omission drift (guardrail)', () => {
  it('omitted port is rejected (silent omission cannot pass)', () => {
    // @ts-expect-error intentionally omitting the required port key
    expect(() => canonicalizeTarget({ scheme: 'https', host: 'h', path: '/p' })).toThrow(
      ActionCommitmentError,
    )
  })

  it('https default port 443 normalizes to null (equals an explicit null producer)', () => {
    const explicit443 = canonicalizeTarget({ scheme: 'https', host: 'h', port: 443, path: '/p' })
    const explicitNull = canonicalizeTarget({ scheme: 'https', host: 'h', port: null, path: '/p' })
    expect(explicit443.port).toBeNull()
    expect(deriveRequestDigestForTarget(explicit443)).toBe(deriveRequestDigestForTarget(explicitNull))
  })

  it('http default port 80 normalizes to null', () => {
    const t = canonicalizeTarget({ scheme: 'http', host: 'h', port: 80, path: '/p' })
    expect(t.port).toBeNull()
  })

  it('two producers that disagree on port representation cannot collide unless normalized equal', () => {
    // 443 (https) -> null and an explicit null are the same canonical input.
    // 8443 is a real non-default port and must stay distinct.
    const nonDefault = canonicalizeTarget({ scheme: 'https', host: 'h', port: 8443, path: '/p' })
    const defaulted = canonicalizeTarget({ scheme: 'https', host: 'h', port: null, path: '/p' })
    expect(deriveRequestDigestForTarget(nonDefault)).not.toBe(deriveRequestDigestForTarget(defaulted))
  })
})

function deriveRequestDigestForTarget(target: ReturnType<typeof canonicalizeTarget>): string {
  return deriveRequestDigest(
    buildActionRequestCommitment({ method: 'GET', target, contentType: 'application/json', body: '' }),
  )
}

// ---------------------------------------------------------------------------
// 3. Request digest
// ---------------------------------------------------------------------------

describe('request_digest', () => {
  it('same logical Action Request Commitment produces same request_digest', () => {
    const a = deriveRequestDigest(buildActionRequestCommitment(baseRequest()))
    const b = deriveRequestDigest(buildActionRequestCommitment(baseRequest()))
    expect(a).toBe(b)
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('changed body changes body_digest and request_digest', () => {
    const original = buildActionRequestCommitment(baseRequest())
    const changed = buildActionRequestCommitment(baseRequest({ body: '{"region":"us-east","n":2}' }))
    expect(changed.body_digest).not.toBe(original.body_digest)
    expect(deriveRequestDigest(changed)).not.toBe(deriveRequestDigest(original))
  })
})

// ---------------------------------------------------------------------------
// 4. Action ref + identity/type validation
// ---------------------------------------------------------------------------

const requestDigest = deriveRequestDigest(buildActionRequestCommitment(baseRequest()))

function baseCommitment(over: Partial<Parameters<typeof buildActionCommitment>[0]> = {}) {
  return buildActionCommitment({
    agentId: 'agent:example',
    actionType: 'sar402.resource_delivery',
    requestDigest,
    idempotencyKey: 'idem_alpha',
    ...over,
  })
}

describe('action_ref', () => {
  it('same inputs produce same action_ref', () => {
    expect(deriveActionRef(baseCommitment())).toBe(deriveActionRef(baseCommitment()))
  })

  it('different idempotency_key produces a different action_ref (same request)', () => {
    expect(deriveActionRef(baseCommitment({ idempotencyKey: 'idem_beta' }))).not.toBe(
      deriveActionRef(baseCommitment()),
    )
  })

  it('changed request_digest produces a different action_ref', () => {
    const otherDigest = deriveRequestDigest(
      buildActionRequestCommitment(baseRequest({ body: '{"region":"us-east"}' })),
    )
    expect(deriveActionRef(baseCommitment({ requestDigest: otherDigest }))).not.toBe(
      deriveActionRef(baseCommitment()),
    )
  })

  it('display metadata such as target_ref outside the canonical input does not affect action_ref', () => {
    const ref = deriveActionRef(baseCommitment())
    // Carrying target_ref as sidecar display/index metadata must not change the
    // canonical Action Commitment digest input.
    const withSidecar = { ...baseCommitment(), target_ref: 'idx://api.example.com/demo/sar-402' }
    const { target_ref, ...canonical } = withSidecar
    void target_ref
    expect(deriveActionRef(canonical as ReturnType<typeof baseCommitment>)).toBe(ref)
  })
})

describe('agent_id / action_type validation', () => {
  it('accepts the agent: identity scheme', () => {
    expect(() => validateAgentId('agent:example')).not.toThrow()
    expect(() => validateAgentId('agent:x402:eip155:8453:0xPayer')).not.toThrow()
  })

  it('rejects freeform names and other schemes', () => {
    for (const bad of ['morpheus', 'did:morpheus', 'Agent Smith', '']) {
      expect(() => validateAgentId(bad)).toThrow(ActionCommitmentError)
    }
  })

  it('action_type must be namespaced', () => {
    expect(() => validateActionType('sar402.resource_delivery')).not.toThrow()
    expect(() => validateActionType('resource_delivery')).toThrow(ActionCommitmentError)
  })
})

// ---------------------------------------------------------------------------
// 5. SAR operation binding
// ---------------------------------------------------------------------------

describe('SAR operation binding', () => {
  const actionRef = deriveActionRef(baseCommitment())

  it('validates when _ext.operation_binding.action_ref equals the derived action_ref', () => {
    const receipt = { schema_id: 'sar_402_settlement_v0.1', ...operationBindingExt(actionRef) }
    expect(() => validateOperationBinding(receipt, actionRef)).not.toThrow()
  })

  it('fails on a mismatched action_ref', () => {
    const receipt = operationBindingExt(deriveActionRef(baseCommitment({ idempotencyKey: 'idem_other' })))
    expect(() => validateOperationBinding(receipt, actionRef)).toThrow(ActionCommitmentError)
  })

  it('fails when the binding is missing', () => {
    expect(() => validateOperationBinding({ schema_id: 'sar_402_settlement_v0.1' }, actionRef)).toThrow(
      ActionCommitmentError,
    )
  })
})

// ---------------------------------------------------------------------------
// 6. Retry stability
// ---------------------------------------------------------------------------

describe('retry stability', () => {
  it('same retry family (same idempotency_key) keeps the same action_ref', () => {
    const attempt1 = deriveActionRef(baseCommitment({ idempotencyKey: 'idem_retry_family_1' }))
    const attempt2 = deriveActionRef(baseCommitment({ idempotencyKey: 'idem_retry_family_1' }))
    expect(attempt1).toBe(attempt2)
  })

  it('same body but a different intended operation (different key) produces a different action_ref', () => {
    const opA = deriveActionRef(baseCommitment({ idempotencyKey: 'idem_op_A' }))
    const opB = deriveActionRef(baseCommitment({ idempotencyKey: 'idem_op_B' }))
    expect(opA).not.toBe(opB)
  })
})

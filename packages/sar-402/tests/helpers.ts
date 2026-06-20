import { EventEmitter } from 'node:events'
import type { X402PaymentContext } from '../src/types.js'

/** Minimal Express-like response mock backed by an EventEmitter. */
export class MockResponse extends EventEmitter {
  statusCode = 200
  locals: Record<string, unknown> = {}
  headers: Record<string, string> = {}
  headersSent = false
  bodyChunks: Buffer[] = []
  finished = false

  setHeader(key: string, value: unknown): this {
    if (this.headersSent) throw new Error(`headers already sent; cannot set ${key}`)
    this.headers[key.toLowerCase()] = String(value)
    return this
  }

  getHeader(key: string): string | undefined {
    return this.headers[key.toLowerCase()]
  }

  status(code: number): this {
    this.statusCode = code
    return this
  }

  write(chunk: unknown, ...rest: unknown[]): boolean {
    if (chunk) this.bodyChunks.push(toBuf(chunk))
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined
    if (cb) cb()
    return true
  }

  end(chunk?: unknown, ...rest: unknown[]): this {
    if (chunk && typeof chunk !== 'function') this.bodyChunks.push(toBuf(chunk))
    this.headersSent = true
    this.finished = true
    const cb = [chunk, ...rest].find((a) => typeof a === 'function') as (() => void) | undefined
    if (cb) cb()
    this.emit('finish')
    return this
  }

  json(obj: unknown): this {
    return this.end(Buffer.from(JSON.stringify(obj)))
  }

  get body(): string {
    return Buffer.concat(this.bodyChunks).toString('utf8')
  }
}

export function mockRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    method: 'POST',
    url: '/pay/url-summary',
    originalUrl: '/pay/url-summary',
    headers: { 'content-type': 'application/json' },
    body: {},
    ...overrides,
  }
}

function toBuf(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8')
  if (chunk instanceof Uint8Array) return Buffer.from(chunk)
  return Buffer.from(String(chunk))
}

/** A valid, drift-free x402 payment context (all five predicates can PASS). */
export function samplePaymentContext(over: Partial<X402PaymentContext> = {}): X402PaymentContext {
  const now = Date.now()
  return {
    resource: 'https://api.example.com/v1/forecast?region=eu-west',
    quoteId: 'q_8f3a91c2',
    price: { amount: '10000', asset: 'USDC', decimals: 6 },
    asset: 'USDC',
    chain: 'eip155:8453',
    recipient: '0xRecipient',
    payer: '0xPayer',
    paymentRef: '0xtxref',
    facilitator: 'x402-facilitator.example',
    authorizedPayers: ['0xPayer'],
    quotedAt: new Date(now - 2000).toISOString(),
    paidAt: new Date(now).toISOString(),
    verifiedAt: new Date(now).toISOString(),
    quoteExpiresAt: new Date(now + 600000).toISOString(),
    ...over,
  }
}

/** A fetch stub that records calls and returns a canned receipt response. */
export function okFetch(receipt: Record<string, unknown> = { receipt_id: 'sar_rcpt_123' }) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(receipt), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { impl, calls }
}

/** A fetch stub that always rejects (DefaultVerifier unreachable). */
export function unreachableFetch() {
  const calls: string[] = []
  const impl = (async (url: string | URL | Request) => {
    calls.push(String(url))
    throw new Error('ECONNREFUSED')
  }) as unknown as typeof fetch
  return { impl, calls }
}

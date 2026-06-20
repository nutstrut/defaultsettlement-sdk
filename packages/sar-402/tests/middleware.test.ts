import { describe, it, expect, vi } from 'vitest'
import {
  sar402,
  attachSettlementContext,
  RECEIPT_ID_HEADER,
  EXPLORER_URL_HEADER,
  MODE_HEADER,
} from '../src/index.js'
import type { Request, Response } from 'express'
import type { Sar402Config, SarReceiptResult } from '../src/index.js'
import {
  MockResponse,
  mockRequest,
  samplePaymentContext,
  okFetch,
  unreachableFetch,
} from './helpers.js'

/** Drive the middleware with a handler and resolve once the response finishes. */
function drive(
  config: Sar402Config,
  handler: (req: Request, res: Response) => void,
  reqOverrides: Record<string, unknown> = {},
): Promise<{ req: Request; res: MockResponse }> {
  const mw = sar402(config)
  const req = mockRequest(reqOverrides) as unknown as Request
  const res = new MockResponse()
  return new Promise((resolve) => {
    res.on('finish', () => resolve({ req, res }))
    mw(req, res as unknown as Response, () => handler(req, res as unknown as Response))
  })
}

describe('record mode', () => {
  it('attaches receipt headers on success', async () => {
    const { impl, calls } = okFetch({ receipt_id: 'sar_rcpt_abc', explorer_url: 'https://dv/explorer/x' })
    const { res } = await drive({ mode: 'record', fetchImpl: impl }, (_req, r) => {
      attachSettlementContext(r, samplePaymentContext())
      r.status(200).json({ ok: true })
    })

    expect(calls).toHaveLength(1)
    expect(res.getHeader(MODE_HEADER)).toBe('record')
    expect(res.getHeader(RECEIPT_ID_HEADER)).toBe('sar_rcpt_abc')
    expect(res.getHeader(EXPLORER_URL_HEADER)).toBe('https://dv/explorer/x')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
  })

  it('fails open when DefaultVerifier is unreachable (response still proceeds)', async () => {
    const { impl, calls } = unreachableFetch()
    const onError = vi.fn()
    const { res } = await drive(
      { mode: 'record', fetchImpl: impl, onError, timeoutMs: 200 },
      (_req, r) => {
        attachSettlementContext(r, samplePaymentContext())
        r.status(200).json({ delivered: true })
      },
    )

    expect(calls.length).toBe(1)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ delivered: true })
    expect(res.getHeader(RECEIPT_ID_HEADER)).toBeUndefined()
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][1].stage).toBe('submit')
  })

  it('does not store raw response bodies by default (privacy)', async () => {
    const { impl, calls } = okFetch()
    await drive({ mode: 'record', fetchImpl: impl }, (_req, r) => {
      attachSettlementContext(r, samplePaymentContext())
      r.status(200).json({ secret: 'super-sensitive-response-body' })
    })
    const sent = JSON.parse(String(calls[0].init.body))
    expect(sent.delivery.evidence_digest).toBeUndefined()
    expect(JSON.stringify(sent)).not.toContain('super-sensitive-response-body')
  })

  it('includes only a digest (never the raw body) when includeResponseBodyHash=true', async () => {
    const { impl, calls } = okFetch()
    await drive(
      { mode: 'record', fetchImpl: impl, includeResponseBodyHash: true },
      (_req, r) => {
        attachSettlementContext(r, samplePaymentContext())
        r.status(200).json({ secret: 'super-sensitive-response-body' })
      },
    )
    const sent = JSON.parse(String(calls[0].init.body))
    expect(sent.delivery.evidence_digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(JSON.stringify(sent)).not.toContain('super-sensitive-response-body')
  })

  it('uses the configured endpoint (default receipt path)', async () => {
    const { impl, calls } = okFetch()
    await drive(
      { mode: 'record', fetchImpl: impl, endpoint: 'https://verifier.internal' },
      (_req, r) => {
        attachSettlementContext(r, samplePaymentContext())
        r.status(200).json({ ok: true })
      },
    )
    // The default receipt path (/v1/sar-402/receipts) is appended verbatim.
    expect(calls[0].url).toBe('https://verifier.internal/v1/sar-402/receipts')
  })

  it('honors a custom receiptPath (point at a receiver you control)', async () => {
    const { impl, calls } = okFetch()
    await drive(
      {
        mode: 'record',
        fetchImpl: impl,
        endpoint: 'https://my-receiver.example',
        receiptPath: '/ingest/sar',
      },
      (_req, r) => {
        attachSettlementContext(r, samplePaymentContext())
        r.status(200).json({ ok: true })
      },
    )
    expect(calls[0].url).toBe('https://my-receiver.example/ingest/sar')
  })

  it('emits nothing when no payment context is attached', async () => {
    const { impl, calls } = okFetch()
    const { res } = await drive({ mode: 'record', fetchImpl: impl }, (_req, r) => {
      r.status(200).json({ free: true })
    })
    expect(calls).toHaveLength(0)
    expect(JSON.parse(res.body)).toEqual({ free: true })
  })
})

describe('observe mode', () => {
  it('fires the receipt without blocking and fails open', async () => {
    const { impl, calls } = unreachableFetch()
    let resolveSettled: () => void
    const settled = new Promise<void>((r) => (resolveSettled = r))

    const onError = vi.fn(() => resolveSettled())
    await drive({ mode: 'observe', fetchImpl: impl, onError }, (_req, r) => {
      attachSettlementContext(r, samplePaymentContext())
      r.status(200).json({ ok: true })
    })

    await settled
    expect(calls.length).toBe(1)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('calls onReceipt and submits with verification_mode=observe', async () => {
    const { impl, calls } = okFetch({ receipt_id: 'sar_obs_1' })
    let resolveDone: (r: SarReceiptResult) => void
    const done = new Promise<SarReceiptResult>((r) => (resolveDone = r))

    await drive({ mode: 'observe', fetchImpl: impl, onReceipt: (r) => resolveDone(r) }, (_req, r) => {
      attachSettlementContext(r, samplePaymentContext())
      r.status(200).json({ ok: true })
    })

    const receipt = await done
    expect(receipt.receiptId).toBe('sar_obs_1')
    expect(receipt.mode).toBe('observe')
    const sent = JSON.parse(String(calls[0].init.body))
    expect(sent.verification_mode).toBe('observe')
  })
})

describe('request hashing', () => {
  it('adds a request_digest (not the raw request) only when enabled', async () => {
    const { impl, calls } = okFetch()
    await drive(
      { mode: 'record', fetchImpl: impl, includeRequestHash: true },
      (_req, r) => {
        attachSettlementContext(r, samplePaymentContext())
        r.status(200).json({ ok: true })
      },
      { body: { url: 'https://target.example/secret-path' } },
    )
    const sent = JSON.parse(String(calls[0].init.body))
    expect(sent.request_digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(JSON.stringify(sent)).not.toContain('secret-path')
  })
})

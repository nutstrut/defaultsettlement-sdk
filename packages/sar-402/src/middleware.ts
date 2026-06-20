/**
 * Express-compatible SAR-402 middleware.
 *
 * Behavior, by mode:
 *
 *   observe  Fire-and-forget. The response streams through untouched; after it
 *            finishes, a receipt is attempted in the background. Never blocks,
 *            never delays, never attaches headers. Ideal for integration/testing.
 *
 *   record   Records after delivery. The response body is buffered so a delivery
 *            digest can be computed and so receipt headers can be attached, then
 *            the (bounded) receipt attempt runs and the buffered response is
 *            flushed. The wait is capped at `timeoutMs`; on timeout/error the
 *            response is sent anyway, without receipt headers.
 *
 * HARD FAIL-OPEN CONSTRAINT (Phase 1): if DefaultVerifier is unreachable, times
 * out, or errors, the paid response still proceeds. The failure is logged, the
 * `onError` callback fires, and receipt headers are simply omitted. DefaultVerifier
 * availability can never break the resource server's paid API path.
 *
 * `gate` mode is not implemented and is rejected at construction time — this
 * middleware never holds authority to withhold delivery.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { createHash } from 'node:crypto'

import { DefaultVerifierClient } from './client.js'
import { GateModeUnsupportedError, Sar402ConfigError } from './errors.js'
import { buildSar402Payload } from './normalize.js'
import {
  DeliveryMetadata,
  Sar402Config,
  Sar402Mode,
  SarContext,
  SarReceiptResult,
  X402PaymentContext,
} from './types.js'

export const RECEIPT_ID_HEADER = 'X-DefaultSettlement-Receipt-ID'
export const EXPLORER_URL_HEADER = 'X-DefaultSettlement-Explorer-URL'
export const MODE_HEADER = 'X-DefaultSettlement-Mode'

const CONTEXT_LOCALS_KEY = 'sar402'

/**
 * Attach the x402 payment context to a response so the middleware can pick it
 * up after the handler runs. Call this from inside your paid handler once you
 * have verified payment.
 */
export function attachSettlementContext(res: Response, ctx: X402PaymentContext): void {
  ;(res.locals as Record<string, unknown>)[CONTEXT_LOCALS_KEY] = ctx
}

function defaultExtractContext(req: unknown, res: unknown): X402PaymentContext | undefined {
  const locals = (res as Response | undefined)?.locals as Record<string, unknown> | undefined
  const fromLocals = locals?.[CONTEXT_LOCALS_KEY]
  if (fromLocals) return fromLocals as X402PaymentContext
  const fromReq = (req as Record<string, unknown> | undefined)?.[CONTEXT_LOCALS_KEY]
  return fromReq as X402PaymentContext | undefined
}

function validateMode(mode: string | undefined): Sar402Mode {
  if (mode === undefined || mode === 'observe' || mode === 'record') {
    return mode ?? 'observe'
  }
  if (mode === 'gate') throw new GateModeUnsupportedError()
  throw new Sar402ConfigError(`unknown SAR-402 mode ${JSON.stringify(mode)}; use 'observe' or 'record'`)
}

interface ResolvedConfig {
  mode: Sar402Mode
  includeResponseBodyHash: boolean
  includeRequestHash: boolean
  environment?: Sar402Config['environment']
  extractContext: NonNullable<Sar402Config['extractContext']>
  onReceipt?: Sar402Config['onReceipt']
  onError?: Sar402Config['onError']
  client: DefaultVerifierClient
}

function reportError(cfg: ResolvedConfig, err: Error, ctx: SarContext): void {
  // Fail-open: never throw out of the middleware. Log + surface via callback.
  try {
    // eslint-disable-next-line no-console
    console.warn(`[sar-402] receipt not emitted (${ctx.stage}): ${err.message}`)
  } catch {
    /* ignore logging failures */
  }
  if (cfg.onError) {
    Promise.resolve()
      .then(() => cfg.onError!(err, ctx))
      .catch(() => {
        /* a failing onError must not break delivery either */
      })
  }
}

function notifyReceipt(cfg: ResolvedConfig, receipt: SarReceiptResult): void {
  if (!cfg.onReceipt) return
  Promise.resolve()
    .then(() => cfg.onReceipt!(receipt))
    .catch(() => {
      /* onReceipt failures are non-fatal */
    })
}

function buildRequestDigest(req: Request): string {
  const material = JSON.stringify({
    method: req.method,
    path: (req as unknown as { originalUrl?: string }).originalUrl ?? req.url,
    contentType: req.headers['content-type'] ?? null,
    contentLength: req.headers['content-length'] ?? null,
  })
  return 'sha256:' + createHash('sha256').update(material).digest('hex')
}

/**
 * Create the SAR-402 Express middleware.
 *
 * @throws {GateModeUnsupportedError} if `mode: 'gate'` is supplied.
 */
export function sar402(config: Sar402Config = {}): RequestHandler {
  const mode = validateMode(config.mode)

  const cfg: ResolvedConfig = {
    mode,
    includeResponseBodyHash: config.includeResponseBodyHash ?? false,
    includeRequestHash: config.includeRequestHash ?? false,
    environment: config.environment,
    extractContext: config.extractContext ?? defaultExtractContext,
    onReceipt: config.onReceipt,
    onError: config.onError,
    client: new DefaultVerifierClient({
      endpoint: config.endpoint,
      receiptPath: config.receiptPath,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      fetchImpl: config.fetchImpl,
    }),
  }

  return function sar402Middleware(req: Request, res: Response, next: NextFunction): void {
    if (cfg.mode === 'record') {
      installRecordMode(cfg, req, res)
    } else {
      installObserveMode(cfg, req, res)
    }
    next()
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function resolveContext(
  cfg: ResolvedConfig,
  req: Request,
  res: Response,
): Promise<X402PaymentContext | undefined> {
  try {
    return await cfg.extractContext(req, res)
  } catch (err) {
    reportError(cfg, err as Error, { mode: cfg.mode, stage: 'extract' })
    return undefined
  }
}

function makeDelivery(
  cfg: ResolvedConfig,
  ctx: X402PaymentContext,
  statusCode: number,
  bodyDigest: string | undefined,
): DeliveryMetadata {
  return {
    deliveredResource: ctx.deliveredResource ?? ctx.resource,
    evidenceType: 'http_response',
    ...(cfg.includeResponseBodyHash && bodyDigest ? { evidenceDigest: bodyDigest } : {}),
    statusCode,
    deliveredAt: new Date().toISOString(),
    failed: statusCode >= 400,
  }
}

async function emitReceipt(
  cfg: ResolvedConfig,
  req: Request,
  ctx: X402PaymentContext,
  delivery: DeliveryMetadata,
): Promise<SarReceiptResult | undefined> {
  let payload
  try {
    payload = buildSar402Payload(ctx, delivery, {
      mode: cfg.mode,
      environment: cfg.environment,
      requestDigest: cfg.includeRequestHash ? buildRequestDigest(req) : undefined,
    })
  } catch (err) {
    reportError(cfg, err as Error, {
      mode: cfg.mode,
      paymentContext: ctx,
      delivery,
      stage: 'normalize',
    })
    return undefined
  }

  try {
    const receipt = await cfg.client.submit(payload, cfg.mode)
    notifyReceipt(cfg, receipt)
    return receipt
  } catch (err) {
    reportError(cfg, err as Error, {
      mode: cfg.mode,
      paymentContext: ctx,
      delivery,
      payload,
      stage: 'submit',
    })
    return undefined
  }
}

// ---------------------------------------------------------------------------
// observe mode — fire-and-forget, never blocks, never delays
// ---------------------------------------------------------------------------

function installObserveMode(cfg: ResolvedConfig, req: Request, res: Response): void {
  let hash: ReturnType<typeof createHash> | undefined
  if (cfg.includeResponseBodyHash) {
    hash = createHash('sha256')
    tapBody(res, (chunk) => hash!.update(chunk))
  }

  res.on('finish', () => {
    void (async () => {
      const ctx = await resolveContext(cfg, req, res)
      if (!ctx) return // no paid action here
      const bodyDigest = hash ? 'sha256:' + hash.digest('hex') : undefined
      const delivery = makeDelivery(cfg, ctx, res.statusCode, bodyDigest)
      await emitReceipt(cfg, req, ctx, delivery)
    })()
  })
}

/** Tap response chunks without altering the stream (for hashing). */
function tapBody(res: Response, onChunk: (chunk: Buffer) => void): void {
  const origWrite = res.write.bind(res) as Response['write']
  const origEnd = res.end.bind(res) as Response['end']

  res.write = function patchedWrite(this: Response, chunk: unknown, ...rest: unknown[]): boolean {
    if (chunk) onChunk(toBuffer(chunk, rest[0]))
    return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest)
  } as Response['write']

  res.end = function patchedEnd(this: Response, chunk?: unknown, ...rest: unknown[]): Response {
    if (chunk && typeof chunk !== 'function') onChunk(toBuffer(chunk, rest[0]))
    return (origEnd as (...a: unknown[]) => Response)(chunk, ...rest)
  } as Response['end']
}

function toBuffer(chunk: unknown, encoding?: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, (typeof encoding === 'string' ? encoding : 'utf8') as BufferEncoding)
  }
  if (chunk instanceof Uint8Array) return Buffer.from(chunk)
  return Buffer.from(String(chunk))
}

// ---------------------------------------------------------------------------
// record mode — buffer, attempt receipt (bounded), attach headers, flush
// ---------------------------------------------------------------------------

function installRecordMode(cfg: ResolvedConfig, req: Request, res: Response): void {
  const chunks: Buffer[] = []
  const origWrite = res.write.bind(res) as Response['write']
  const origEnd = res.end.bind(res) as Response['end']
  let finalized = false

  res.write = function bufferedWrite(this: Response, chunk: unknown, ...rest: unknown[]): boolean {
    if (chunk) chunks.push(toBuffer(chunk, rest[0]))
    const cb = rest.find((a) => typeof a === 'function') as ((e?: Error | null) => void) | undefined
    if (cb) cb()
    return true
  } as Response['write']

  res.end = function bufferedEnd(this: Response, chunk?: unknown, ...rest: unknown[]): Response {
    if (chunk && typeof chunk !== 'function') chunks.push(toBuffer(chunk, rest[0]))
    const endCb = [chunk, ...rest].find((a) => typeof a === 'function') as
      | (() => void)
      | undefined

    if (finalized) return res
    finalized = true

    void finalize(cfg, req, res, chunks, origWrite, origEnd, endCb)
    return res
  } as Response['end']
}

async function finalize(
  cfg: ResolvedConfig,
  req: Request,
  res: Response,
  chunks: Buffer[],
  origWrite: Response['write'],
  origEnd: Response['end'],
  endCb: (() => void) | undefined,
): Promise<void> {
  let flushed = false
  const flush = () => {
    if (flushed) return
    flushed = true
    res.write = origWrite
    res.end = origEnd
    const body = Buffer.concat(chunks)
    if (body.length > 0) origWrite(body)
    ;(origEnd as (cb?: () => void) => Response)(endCb)
  }

  try {
    const ctx = await resolveContext(cfg, req, res)
    if (!ctx) {
      return
    }

    const bodyDigest = cfg.includeResponseBodyHash
      ? 'sha256:' + createHash('sha256').update(Buffer.concat(chunks)).digest('hex')
      : undefined
    const delivery = makeDelivery(cfg, ctx, res.statusCode, bodyDigest)

    if (!res.headersSent) res.setHeader(MODE_HEADER, cfg.mode)

    const receipt = await emitReceipt(cfg, req, ctx, delivery)
    if (receipt?.ok && !res.headersSent) {
      if (receipt.receiptId) res.setHeader(RECEIPT_ID_HEADER, receipt.receiptId)
      if (receipt.explorerUrl) res.setHeader(EXPLORER_URL_HEADER, receipt.explorerUrl)
    }
  } catch (err) {
    // Truly last-resort guard: nothing here may stop delivery.
    reportError(cfg, err as Error, { mode: cfg.mode, stage: 'submit' })
  } finally {
    flush()
  }
}

/**
 * Direct-to-DefaultVerifier client.
 *
 * The client is deliberately thin: POST the normalized payload, bound the call
 * with a timeout, and parse receipt metadata defensively. Any
 * transport/HTTP/timeout failure raises {@link DefaultVerifierError}; the
 * middleware catches it and fails open so the resource server's response is
 * never blocked.
 *
 * BACKEND STATUS: `POST /v1/sar-402/receipts` now exists in attest-service
 * (commit 8e9f8f3) and matches this SDK's default `receiptPath`. It records
 * normalized SAR-402 evidence and returns receipt metadata (`receipt_id`,
 * `explorer_url`, and lookup fields). The SDK still **fails open** if that
 * endpoint is unreachable, slow, or errors: the middleware catches the
 * {@link DefaultVerifierError}, logs, fires `onError`, omits receipt headers,
 * and delivery is never blocked. `receiptPath` remains configurable for
 * self-hosted, test, or future endpoint variants.
 * See {@link DEFAULT_RECEIPT_PATH}.
 */

import { DefaultVerifierError } from './errors.js'
import { Sar402Payload, SarReceiptResult, Sar402Mode } from './types.js'

export const DEFAULT_ENDPOINT = 'https://defaultverifier.com'
/**
 * Default ingest path for resource-server-emitted SAR-402 receipts.
 *
 * `POST /v1/sar-402/receipts` now exists in attest-service (commit 8e9f8f3) and
 * matches this default, so integrations that keep the default issue live
 * receipts with no code change. Override via `receiptPath` to target a
 * self-hosted, test, or future endpoint variant.
 */
export const DEFAULT_RECEIPT_PATH = '/v1/sar-402/receipts'
/**
 * @deprecated Use {@link DEFAULT_RECEIPT_PATH}. Retained as an alias for
 * backward compatibility; the route is no longer merely "proposed" — it exists.
 */
export const PROPOSED_RECEIPT_PATH = DEFAULT_RECEIPT_PATH
export const DEFAULT_TIMEOUT_MS = 4000

export interface ClientOptions {
  endpoint?: string
  /** Path appended to `endpoint`. Defaults to {@link DEFAULT_RECEIPT_PATH}. */
  receiptPath?: string
  apiKey?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}

/** Read the first present value among candidate keys (defensive parsing). */
function firstPresent(obj: unknown, keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const record = obj as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

export class DefaultVerifierClient {
  private readonly endpoint: string
  private readonly receiptPath: string
  private readonly apiKey?: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(opts: ClientOptions = {}) {
    this.endpoint = (opts.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, '')
    this.receiptPath = opts.receiptPath ?? DEFAULT_RECEIPT_PATH
    this.apiKey = opts.apiKey
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const impl = opts.fetchImpl ?? globalThis.fetch
    if (typeof impl !== 'function') {
      throw new DefaultVerifierError(
        'no fetch implementation available; pass config.fetchImpl or run on Node >=18',
      )
    }
    this.fetchImpl = impl
  }

  /** The configured DefaultVerifier base URL (for diagnostics/tests). */
  get baseUrl(): string {
    return this.endpoint
  }

  /**
   * Submit a SAR-402 payload. Resolves to receipt metadata on success; rejects
   * with {@link DefaultVerifierError} on any timeout/transport/HTTP error.
   */
  async submit(payload: Sar402Payload, mode: Sar402Mode): Promise<SarReceiptResult> {
    const url = joinUrl(this.endpoint, this.receiptPath)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      throw new DefaultVerifierError(
        aborted
          ? `DefaultVerifier request timed out after ${this.timeoutMs}ms`
          : `DefaultVerifier request failed: ${(err as Error).message}`,
        { cause: err },
      )
    } finally {
      clearTimeout(timer)
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }

    if (!response.ok) {
      throw new DefaultVerifierError(
        `DefaultVerifier returned ${response.status}`,
        { status: response.status, cause: body },
      )
    }

    const receiptId = firstPresent(body, [
      'receipt_id',
      'receiptId',
      'sar_receipt_id',
      'id',
    ])
    const explorerUrl =
      firstPresent(body, ['explorer_url', 'explorerUrl', 'explorer']) ??
      (receiptId ? joinUrl(this.endpoint, `/explorer/sar/${encodeURIComponent(receiptId)}`) : undefined)

    return {
      ok: true,
      mode,
      receiptId,
      explorerUrl,
      payload,
      response: body,
    }
  }
}

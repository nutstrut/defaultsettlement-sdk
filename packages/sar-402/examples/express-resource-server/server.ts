/**
 * Runnable SAR-402 integration demo for an x402 resource server.
 *
 * What this proves to a developer evaluating the SDK:
 *
 *   - You keep serving your own response. The handler below builds and returns
 *     the paid result exactly as it would without the SDK.
 *   - A SAR-402 receipt is emitted as a *byproduct*. The only SDK-specific lines
 *     in your handler are one `attachSettlementContext(res, ctx)` call and the
 *     `sar402(...)` middleware you mount once.
 *   - Fail-open is a hard constraint. Point DEFAULTVERIFIER_URL at a dead address
 *     and the paid response still ships — just without receipt headers, plus a
 *     console warning and an `onError` callback firing.
 *
 * Doctrine (kept explicit, Phase 1):
 *   - The resource server controls delivery.
 *   - The SDK records evidence.
 *   - DefaultVerifier does NOT authorize delivery.
 *   - DefaultVerifier does NOT control resource release.
 *   - DefaultVerifier does NOT custody or move funds.
 *   - There is no `gate` mode.
 *
 * The x402 settlement here is SIMULATED locally. This demo never touches real
 * x402, CDP, Coinbase, a wallet, funding, or mainnet — it fabricates a realistic
 * payment object so the SAR-402 continuity checks evaluate to PASS.
 *
 * Run (from the repo root, after `npm install && npm run build`):
 *   npx tsx packages/sar-402/examples/express-resource-server/server.ts
 *
 * `tsx` (a devDependency) runs the .ts file directly on Node 18+.
 */

import { randomBytes, randomUUID } from 'node:crypto'

import express from 'express'
import {
  sar402,
  attachSettlementContext,
  RECEIPT_ID_HEADER,
  EXPLORER_URL_HEADER,
  MODE_HEADER,
  type X402PaymentContext,
  type SarReceiptResult,
  type SarContext,
} from '@defaultsettlement/sar-402'

const PORT = Number(process.env.PORT ?? 3000)

// Default: the live DefaultVerifier. To exercise fail-open, set this to an
// unreachable address, e.g. DEFAULTVERIFIER_URL=http://127.0.0.1:9
const DEFAULTVERIFIER_URL = process.env.DEFAULTVERIFIER_URL ?? 'https://defaultverifier.com'

const app = express()
app.use(express.json())

// ---------------------------------------------------------------------------
// Mount SAR-402 once, in `record` mode.
//
// `record` buffers the response just long enough to (a) compute a digest of the
// delivered body and (b) attach receipt headers, then flushes. The wait is
// bounded by `timeoutMs`; on timeout/error the response is sent anyway, without
// receipt headers. This is the fail-open guarantee in action.
// ---------------------------------------------------------------------------
app.use(
  sar402({
    endpoint: DEFAULTVERIFIER_URL,
    mode: 'record',
    includeResponseBodyHash: true, // digest only — the raw body is never sent
    apiKey: process.env.DEFAULTSETTLEMENT_API_KEY, // optional
    timeoutMs: Number(process.env.SAR402_TIMEOUT_MS ?? 4000),
    environment: (process.env.SAR402_ENVIRONMENT as 'production' | 'local' | undefined) ?? 'production',
    onReceipt: (r: SarReceiptResult) => {
      if (r.ok && r.receiptId) {
        console.log(`[sar-402] receipt recorded: ${r.receiptId}`)
        if (r.explorerUrl) console.log(`[sar-402] explorer: ${r.explorerUrl}`)
      }
    },
    onError: (err: Error, ctx: SarContext) => {
      // Fail-open proof: this fires when DefaultVerifier is unreachable. The
      // paid response has already been (or is about to be) delivered regardless.
      console.warn(
        `[sar-402] FAIL-OPEN at stage="${ctx.stage}": ${err.message} — ` +
          `paid response still delivered, receipt headers omitted.`,
      )
    },
  }),
)

// ---------------------------------------------------------------------------
// One simulated paid/protected resource: POST /pay/url-summary
// ---------------------------------------------------------------------------
app.post('/pay/url-summary', async (req, res) => {
  const targetUrl = String(req.body?.url ?? 'https://example.com')

  // --- YOUR EXISTING x402 PAYMENT VERIFICATION ---------------------------
  // In a real server you verify payment through your own facilitator. Here it
  // is simulated locally. The SDK does NOT verify payment, move funds, or
  // gate delivery — it only records what you report below.
  const payment = simulateX402Settlement(targetUrl)

  // The one new line inside your handler: tell the middleware what the payment
  // authorized. This must run AFTER verification and BEFORE you return.
  const ctx: X402PaymentContext = {
    resource: payment.resource,
    quoteId: payment.quoteId,
    price: payment.price,
    asset: payment.asset,
    chain: payment.chain,
    recipient: payment.recipient,
    payer: payment.payer,
    paymentRef: payment.paymentRef,
    facilitator: payment.facilitator,
    authorizedPayers: payment.authorizedPayers,
    quotedAt: payment.quotedAt,
    paidAt: payment.paidAt,
    verifiedAt: payment.verifiedAt,
    quoteExpiresAt: payment.quoteExpiresAt,
  }
  attachSettlementContext(res, ctx)
  // -----------------------------------------------------------------------

  // Deliver the paid result exactly as you would today.
  const summary = `Summary of ${targetUrl}: lorem ipsum (simulated paid output).`
  res.status(200).json({
    url: targetUrl,
    summary,
    paymentRef: payment.paymentRef,
  })
})

// Tiny help endpoint so `GET /` is not a 404.
app.get('/', (_req, res) => {
  res.type('text/plain').send(
    [
      'SAR-402 express-resource-server demo',
      `DefaultVerifier endpoint: ${DEFAULTVERIFIER_URL}`,
      '',
      'Try:',
      `  curl -i -X POST http://localhost:${PORT}/pay/url-summary \\`,
      `    -H 'content-type: application/json' -d '{"url":"https://example.com"}'`,
      '',
      'Receipt headers appear on success:',
      `  ${RECEIPT_ID_HEADER}, ${EXPLORER_URL_HEADER}, ${MODE_HEADER}`,
    ].join('\n'),
  )
})

app.listen(PORT, () => {
  console.log(`[demo] resource server listening on http://localhost:${PORT}`)
  console.log(`[demo] SAR-402 mode=record, DefaultVerifier=${DEFAULTVERIFIER_URL}`)
  if (DEFAULTVERIFIER_URL.includes('127.0.0.1:9')) {
    console.log('[demo] fail-open mode: DefaultVerifier is intentionally unreachable.')
  }
})

// ---------------------------------------------------------------------------
// Simulated x402 settlement — stands in for YOUR facilitator. Not part of the
// SDK. Produces a realistic, internally consistent payment so the SAR-402
// continuity predicates evaluate to PASS.
// ---------------------------------------------------------------------------
interface SimulatedSettlement {
  resource: string
  quoteId: string
  price: { amount: string; asset: string; decimals: number }
  asset: string
  chain: string
  recipient: string
  payer: string
  paymentRef: string
  facilitator: string
  authorizedPayers: string[]
  quotedAt: string
  paidAt: string
  verifiedAt: string
  quoteExpiresAt: string
}

function simulateX402Settlement(resource: string): SimulatedSettlement {
  const now = Date.now()
  const payer = '0x' + randomBytes(20).toString('hex')
  const recipient = '0x' + randomBytes(20).toString('hex')
  const txHash = '0x' + randomBytes(32).toString('hex')

  return {
    resource,
    quoteId: `q_${randomUUID()}`,
    price: { amount: '10000', asset: 'USDC', decimals: 6 }, // 0.01 USDC
    asset: 'USDC',
    chain: 'eip155:8453', // Base mainnet, CAIP-2 (chain-agnostic, not Base-only)
    recipient,
    payer,
    paymentRef: txHash,
    facilitator: 'x402-facilitator.example',
    authorizedPayers: [payer], // matches payer => authority_continuity PASS
    quotedAt: new Date(now - 3000).toISOString(),
    paidAt: new Date(now - 1500).toISOString(),
    verifiedAt: new Date(now - 500).toISOString(),
    quoteExpiresAt: new Date(now + 10 * 60_000).toISOString(),
  }
}

/**
 * Example: add SAR-402 receipts to an existing paid x402 endpoint.
 *
 * The scenario mirrors the reference `/pay/url-summary` demo: a paid action that
 * summarizes a URL. The x402 payment is verified by YOUR facilitator (not shown
 * — that is your existing code). All this SDK adds is:
 *
 *   1. `sar402(...)` middleware, and
 *   2. one `attachSettlementContext(res, ctx)` call inside the paid handler.
 *
 * Run (after `npm run build` at the package root):
 *   node --loader ts-node/esm examples/express-url-summary.ts
 * or compile with the rest of the package. This file is included in the
 * typecheck via tsconfig.examples.json so `npm test` proves it compiles.
 */

import express from 'express'
import {
  sar402,
  attachSettlementContext,
  type X402PaymentContext,
  type SarReceiptResult,
} from '@defaultsettlement/sar-402'

const app = express()
app.use(express.json())

// Add SAR-402 to the paid routes. `record` buffers the response so it can attach
// receipt headers; `observe` is fire-and-forget. Either way, if DefaultVerifier
// is down, your response still ships — fail-open is guaranteed.
// NOTE (Phase 1): attest-service does not yet expose a SAR-402 receipt-ingest
// route, so against the default endpoint the receipt call fails open (delivery is
// unaffected). Point `endpoint`/`receiptPath` at a receiver you control to see the
// full flow, or read the receipt from the `onReceipt` callback below.
app.use(
  sar402({
    endpoint: process.env.DEFAULTVERIFIER_URL ?? 'https://defaultverifier.com',
    receiptPath: process.env.SAR402_RECEIPT_PATH, // undefined => proposed default
    mode: 'record',
    apiKey: process.env.DEFAULTSETTLEMENT_API_KEY,
    includeResponseBodyHash: true, // digest only — the raw body is never sent
    timeoutMs: 4000,
    onReceipt: (r: SarReceiptResult) => {
      if (r.receiptId) console.log(`[sar-402] receipt ${r.receiptId} -> ${r.explorerUrl}`)
    },
    onError: (err) => {
      console.warn(`[sar-402] failed open: ${err.message}`)
    },
  }),
)

app.post('/pay/url-summary', async (req, res) => {
  const targetUrl = String(req.body?.url ?? '')

  // --- YOUR EXISTING x402 PAYMENT VERIFICATION HAPPENS HERE ---------------
  // You verify payment through your own facilitator and authorize the action.
  // The SDK does NOT verify payment, move funds, or gate delivery.
  const verifiedPayment = await verifyX402PaymentSomehow(targetUrl)
  // -----------------------------------------------------------------------

  // Tell the middleware what the payment authorized. This is the only new line
  // inside your handler.
  const ctx: X402PaymentContext = {
    resource: targetUrl,
    quoteId: verifiedPayment.quoteId,
    price: { amount: '10000', asset: 'USDC', decimals: 6 },
    asset: 'USDC',
    chain: 'eip155:8453', // Base mainnet, CAIP-2
    recipient: verifiedPayment.payTo,
    payer: verifiedPayment.payer,
    paymentRef: verifiedPayment.txHash,
    facilitator: verifiedPayment.facilitator,
    quotedAt: verifiedPayment.quotedAt,
    paidAt: verifiedPayment.paidAt,
    verifiedAt: new Date().toISOString(),
    quoteExpiresAt: verifiedPayment.quoteExpiresAt,
  }
  attachSettlementContext(res, ctx)

  // Deliver the paid result exactly as you do today.
  const summary = await summarize(targetUrl)
  res.status(200).json({ url: targetUrl, summary })
})

app.listen(3000, () => console.log('listening on :3000'))

// --- stand-ins for your real code (not part of the SDK) --------------------
interface VerifiedPayment {
  quoteId: string
  payTo: string
  payer: string
  txHash: string
  facilitator: string
  quotedAt: string
  paidAt: string
  quoteExpiresAt: string
}

async function verifyX402PaymentSomehow(_url: string): Promise<VerifiedPayment> {
  const now = new Date()
  return {
    quoteId: 'q_example',
    payTo: '0xRecipient',
    payer: '0xPayer',
    txHash: '0xdeadbeef',
    facilitator: 'x402-facilitator.example',
    quotedAt: new Date(now.getTime() - 2000).toISOString(),
    paidAt: now.toISOString(),
    quoteExpiresAt: new Date(now.getTime() + 600000).toISOString(),
  }
}

async function summarize(url: string): Promise<string> {
  return `Summary of ${url}`
}

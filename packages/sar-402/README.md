# @defaultsettlement/sar-402

Express middleware that emits **Settlement Attestation Receipts (SAR-402)** for
paid [x402](https://x402.org) endpoints — in a few lines, fail-open, and without
handing Default Settlement any control over your API.

> **60-second pitch.** You already have an x402 paid endpoint. You add this
> middleware. Now every paid action can emit a **Settlement Attestation Receipt**
> with a live Explorer link — without giving Default Settlement control over your
> API, funds, authorization, or delivery logic.

## What SAR-402 is

**SAR-402 = Settlement Attestation Receipt** — the x402 profile of the SAR
primitive. It records what happened *around* a paid action and leaves verifiable
evidence:

- **x402 proves the payment flow** — the buyer paid, your facilitator verified it.
- **SAR-402 records what happened around the paid action** — what was quoted,
  what was paid, what was delivered, whether they matched (the five Continuity
  predicates), who could act on the result, and an integrity digest over it all.

The receipt is content-addressed and carries an authority binding that states,
in the evidence itself, that the verifier holds no execution authority.

### Doctrine (why this is safe to add)

```
Capability ≠ Authority
Authority  ≠ Execution
Execution  ≠ Verification
Verification must leave evidence.
Verified restraint is the product.
```

DefaultVerifier **records evidence**. It does **not** execute your API, authorize
delivery, custody funds, or control resource release. Every receipt carries:

```json
{
  "verifier_has_execution_authority": false,
  "verifier_controls_resource_release": false,
  "resource_server_controls_delivery": true
}
```

## Install

```bash
npm install @defaultsettlement/sar-402
```

Node ≥ 18 (uses the built-in `fetch`/`AbortController`). `express` is an optional
peer dependency.

## Minimal Express integration

```ts
import express from 'express'
import { sar402, attachSettlementContext } from '@defaultsettlement/sar-402'

const app = express()
app.use(express.json())

// 1. Add the middleware.
app.use(sar402({ mode: 'record' }))

app.post('/pay/url-summary', async (req, res) => {
  // ... your existing x402 payment verification happens here ...

  // 2. Tell the middleware what the payment authorized (one line).
  attachSettlementContext(res, {
    resource: req.body.url,
    quoteId: payment.quoteId,
    price: { amount: '10000', asset: 'USDC', decimals: 6 },
    asset: 'USDC',
    chain: 'eip155:8453',          // CAIP-2, chain-agnostic (not Base-only)
    recipient: payment.payTo,
    payer: payment.payer,
    paymentRef: payment.txHash,
  })

  // 3. Deliver exactly as you do today.
  res.json({ summary: await summarize(req.body.url) })
})
```

That's it. The middleware reads the context after your handler responds,
normalizes it into a SAR-402 receipt, POSTs it to DefaultVerifier, and (in
`record` mode) attaches receipt headers. A full runnable version is in
[`examples/express-url-summary.ts`](examples/express-url-summary.ts).

## `observe` vs `record`

| | `observe` | `record` |
| --- | --- | --- |
| When it runs | After the response finishes | After delivery, before final flush |
| Blocks the response? | Never — fire-and-forget | Only a bounded wait (≤ `timeoutMs`), then proceeds regardless |
| Receipt headers? | No (response already sent) | Yes, when the receipt succeeds in time |
| Delivery digest? | Optional (`includeResponseBodyHash`) | Optional (`includeResponseBodyHash`) |
| Best for | Integration & testing | Production, when you want the live Explorer link in headers |

`record` buffers the response body so it can (a) compute a delivery digest and
(b) attach receipt headers, then flushes. The added latency is capped at
`timeoutMs`; if DefaultVerifier is slow or down, the response ships anyway.

## Backend status — the default ingest endpoint exists

The receipt-ingest endpoint is **live**. `POST /v1/sar-402/receipts` now exists in
attest-service (commit `8e9f8f3`) and **matches the SDK default `receiptPath`**:

- `POST /v1/sar-402/receipts` records normalized SAR-402 evidence and returns
  receipt metadata — `receipt_id`, `explorer_url`, and receipt-lookup fields.
- The default `endpoint` (`https://defaultverifier.com`) + default `receiptPath`
  (`/v1/sar-402/receipts`) therefore issues live receipts with no code change.
- The SDK still **fails open** if that endpoint is unreachable, slow, or returns an
  error: the receipt call is logged, `onError` fires, no receipt headers are
  attached, and your paid delivery is unaffected.
- `receiptPath` remains **configurable** for self-hosted, test, or future endpoint
  variants — point `endpoint`/`receiptPath` at a receiver you control, or capture
  the payload via the local `onReceipt` callback.

Explorer status: the backend returns `receipt_id` and `explorer_url`, and backend
receipt-lookup / recent-receipt compatibility is implemented. Full public Explorer
**frontend** rendering should still be visually verified before claiming the
Explorer UI is fully complete.

The normalization, authority binding, fail-open, and header logic are complete and
tested.

## Fail-open behavior (hard guarantee)

If DefaultVerifier is unreachable, times out, or returns an error, the middleware
**fails open**:

- the paid API response **proceeds** unchanged,
- the failure is logged and the `onError(error, context)` callback fires,
- receipt headers are omitted.

DefaultVerifier availability **can never block your paid API path.** This is a
Phase-1 constraint, not a configurable default — there is no setting that makes a
verifier outage break delivery.

## Response headers (record mode, on success)

| Header | Meaning |
| --- | --- |
| `X-DefaultSettlement-Receipt-ID` | The receipt id assigned by DefaultVerifier |
| `X-DefaultSettlement-Explorer-URL` | Public Explorer URL for the receipt |
| `X-DefaultSettlement-Mode` | `record` |

If the receipt could not be emitted in time, only `X-DefaultSettlement-Mode` may
be present and the response is otherwise unchanged.

## Privacy & security defaults

- **No raw bodies.** Request and response bodies are never sent. The receipt
  carries metadata and, *only when you opt in*, content **hashes**:
  - `includeResponseBodyHash` (default **false**) → `delivery.evidence_digest`
  - `includeRequestHash` (default **false**) → `request_digest` over
    method/path/content-type/length (not the body)
- **API key** (if set) is sent as `Authorization: Bearer …` over HTTPS and never
  logged.
- **Authority binding** is stamped into every receipt; the verifier can never be
  named as the acting/release party.

## Configuration

```ts
sar402({
  endpoint?: string,                 // default https://defaultverifier.com
  receiptPath?: string,              // default /v1/sar-402/receipts (live; override for self-hosted/test variants)
  mode?: 'observe' | 'record',       // default 'observe'   ('gate' is rejected)
  apiKey?: string,
  includeResponseBodyHash?: boolean, // default false
  includeRequestHash?: boolean,      // default false
  timeoutMs?: number,                // default 4000
  environment?: 'production' | 'staging' | 'test' | 'local',
  extractContext?: (req, res) => X402PaymentContext | undefined,
  onReceipt?: (receipt) => void,
  onError?: (error, context) => void,
})
```

## Current limitations

- **`gate` mode is not implemented** and is rejected at construction time. This
  middleware never holds authority to withhold delivery. (Gate mode — where a
  verdict can block release under a *non-verifier* gate controller — is defined
  in the SAR-402 profile but is out of scope for this SDK.)
- **Explorer frontend not yet fully verified.** The backend ingest endpoint
  exists and returns `receipt_id`/`explorer_url` with lookup compatibility — see
  [Backend status](#backend-status--the-default-ingest-endpoint-exists). Full
  public Explorer **frontend** rendering should still be visually verified before
  it is claimed complete. The SDK remains fail-open if the endpoint is
  unreachable; `receiptPath` stays configurable for self-hosted/test variants.
- **Direct-to-DefaultVerifier only.** Phase 1 posts directly (no local agent).
  Local, self-hosted, and air-gapped agents are planned, not present.
- **No offline verification.** This SDK does not verify receipts offline; it
  emits them and records DefaultVerifier's response.
- **It does not verify x402 payment.** You verify payment with your own
  facilitator and pass the result in. The SDK records; it does not settle, move
  funds, or gate.
- **Single-flush responses.** `record` mode buffers the response; extremely large
  streaming responses are better served by `observe`.

## What this is *not*

- Not a fraud-prevention system. A receipt attests what was reported around a
  paid action; it does not guarantee the payment was legitimate.
- Not a guaranteed-delivery mechanism. The receipt records delivery evidence; it
  does not ensure or re-drive delivery.
- Not a custody, authorization, or release-control layer. The resource server
  controls delivery, end to end.

## License

[Apache-2.0](../../LICENSE).

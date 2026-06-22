# SAR-402 × Express resource server — runnable demo

This is a developer onboarding proof, not a microsite. It answers one question:

> Can I drop `@defaultsettlement/sar-402` into my Express x402 resource server,
> keep serving my own response, and get a SAR-402 receipt as a byproduct —
> without DefaultVerifier ever blocking my paid response?

Yes. This demo shows it end to end.

## What it shows

- A minimal Express server with one simulated paid endpoint: `POST /pay/url-summary`.
- The x402 settlement is **simulated locally** — no real x402, CDP, Coinbase,
  wallet, funding, or mainnet.
- The handler calls `attachSettlementContext(res, ctx)` after the (simulated)
  payment verification and before returning its response.
- `sar402({ mode: 'record', includeResponseBodyHash: true })` records a receipt
  to DefaultVerifier as a byproduct and attaches receipt headers on success.
- **Fail-open**: point DefaultVerifier at a dead address and the paid response
  still returns — no receipt headers, plus a console warning and `onError`.

## Doctrine (Phase 1)

- The **resource server controls delivery**.
- The **SDK records evidence**.
- DefaultVerifier does **not** authorize delivery.
- DefaultVerifier does **not** control resource release.
- DefaultVerifier does **not** custody or move funds.
- There is **no `gate` mode**.

Only the resource server decides what to return and when. The receipt is
recorded after delivery; it never sits in the critical path.

---

## 1. Install & build (from the repo root)

```bash
cd ~/defaultsettlement-sdk
npm install
npm run build
```

`npm install` links `@defaultsettlement/sar-402` into the workspace and installs
`express`; `npm run build` compiles the SDK to `dist/`, which this demo imports.

> The demo runs on **Node 18+**. `npm install` brings in `tsx`, which runs the
> `.ts` file directly — no global install or build step for the example needed.

## 2. Start the demo server (normal mode)

```bash
npx tsx packages/sar-402/examples/express-resource-server/server.ts
```

You should see:

```
[demo] resource server listening on http://localhost:3000
[demo] SAR-402 mode=record, DefaultVerifier=https://defaultverifier.com
```

## 3. Call the paid endpoint with curl

In another terminal:

```bash
curl -i -X POST http://localhost:3000/pay/url-summary \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
```

## 4. Inspect the receipt headers

On success the response carries:

```
X-DefaultSettlement-Mode: record
X-DefaultSettlement-Receipt-ID: <id assigned by DefaultVerifier>
X-DefaultSettlement-Explorer-URL: https://sarexplorer.com/?receipt_id=<id>
```

and the JSON body is your own paid result:

```json
{ "url": "https://example.com", "summary": "Summary of https://example.com: ...", "paymentRef": "0x..." }
```

The server console also logs the receipt id and explorer URL via the `onReceipt`
callback.

> If DefaultVerifier is reachable but does not (yet) return a receipt within the
> timeout, the body still returns; the receipt headers are simply omitted. That
> is fail-open, not an error in the demo.

## 5. Open the Explorer URL

Copy the `X-DefaultSettlement-Explorer-URL` value into a browser to view the
recorded receipt:

```bash
curl -is -X POST http://localhost:3000/pay/url-summary \
  -H 'content-type: application/json' -d '{"url":"https://example.com"}' \
  | grep -i 'X-DefaultSettlement-Explorer-URL'
```

## 6. Run fail-open mode

Stop the server, then start it pointed at an unreachable address:

```bash
DEFAULTVERIFIER_URL=http://127.0.0.1:9 \
  npx tsx packages/sar-402/examples/express-resource-server/server.ts
```

(Or, from inside this example dir, `npm run start:fail-open`.)

Call the same endpoint:

```bash
curl -i -X POST http://localhost:3000/pay/url-summary \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
```

## 7. Confirm the resource response still returns

In fail-open mode:

- The HTTP response is still **`200 OK`** with your full JSON body.
- There are **no** receipt id or Explorer URL headers
  (`X-DefaultSettlement-Receipt-ID`, `X-DefaultSettlement-Explorer-URL`).
  `X-DefaultSettlement-Mode: record` may still be present, because the SDK sets
  the mode header before attempting the receipt.
- The server console prints a fail-open warning, e.g.:

  ```
  [sar-402] FAIL-OPEN at stage="submit": DefaultVerifier request failed: ... —
  paid response still delivered, receipt headers omitted.
  ```

DefaultVerifier being down changed nothing about what your customer received.

---

## The whole integration, in two places

```ts
// 1) Mount once.
app.use(sar402({ mode: 'record', includeResponseBodyHash: true }))

// 2) Inside your paid handler, after you verify payment, before you respond:
attachSettlementContext(res, ctx) // ctx = your x402 settlement details
```

The raw request and response bodies are **never** sent to DefaultVerifier —
`includeResponseBodyHash: true` sends only a SHA-256 digest of the delivered body.

See [`server.ts`](server.ts) for the full, commented source and the simulated
x402 settlement object.

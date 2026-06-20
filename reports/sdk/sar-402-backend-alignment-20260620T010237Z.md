# SAR-402 SDK ↔ Backend Alignment

**Date:** 2026-06-20
**Scope:** Documentation/comment alignment after the backend receipt-ingest
endpoint went live. This is an addendum to the original design and implementation
reports; those historical reports are left unedited as a point-in-time record.

## Backend endpoint now exists

- **attest-service commit:** `8e9f8f3` — *feat: add SAR-402 receipt ingestion endpoint*
- **Backend endpoint path:** `POST /v1/sar-402/receipts`
- **SDK default path (`DEFAULT_RECEIPT_PATH`):** `/v1/sar-402/receipts`
- **Match:** ✅ The backend endpoint path matches the SDK default `receiptPath`,
  so integrations that keep the defaults issue live receipts with no code change.

The endpoint records normalized SAR-402 evidence and returns receipt metadata:
`receipt_id`, `explorer_url`, and receipt-lookup fields.

## Did code behavior change?

No runtime behavior changed. Specifically preserved:

- **Fail-open semantics** — unchanged. If the endpoint is unreachable, slow, or
  errors, the middleware logs, fires `onError`, omits receipt headers, and
  delivery proceeds.
- **`receiptPath` configurability** — unchanged; still overridable for
  self-hosted, test, or future endpoint variants.
- **No gate mode** — `gate` remains rejected at construction time. observe +
  record only.
- **Authority boundaries** — unchanged. Default Settlement does not execute the
  paid action and does not control resource release; the resource server controls
  delivery.

The only symbol-level change is additive: a new exported `DEFAULT_RECEIPT_PATH`
constant, with the prior `PROPOSED_RECEIPT_PATH` retained as a `@deprecated`
alias (`PROPOSED_RECEIPT_PATH = DEFAULT_RECEIPT_PATH`) so existing consumers do
not break.

## What documentation changed

- `README.md` (root) — package row now states the ingest endpoint is live and
  matches the SDK default; notes fail-open and no-gate.
- `packages/sar-402/README.md` — replaced the "backend does not yet exist /
  proposed / fails open today" section with the live-endpoint truth; added the
  Explorer frontend caveat; updated the config comment and limitations section.
- `packages/sar-402/src/client.ts` — module doc, `DEFAULT_RECEIPT_PATH` doc, and
  `receiptPath` option doc no longer call the route "proposed"/"not yet exposed".
- `packages/sar-402/src/types.ts` — `receiptPath` config doc updated.
- `packages/sar-402/src/index.ts` — exports `DEFAULT_RECEIPT_PATH` alongside the
  deprecated alias.
- `packages/sar-402/examples/express-url-summary.ts` — comments updated.
- `packages/sar-402/tests/middleware.test.ts` — "proposed/pending" comments updated.

## Remaining caveats before public npm release

- **Explorer frontend not yet visually verified.** The backend returns
  `explorer_url` and backend lookup / recent-receipt compatibility is implemented,
  but full public Explorer **frontend** rendering should be visually confirmed
  before claiming the Explorer UI is complete. Docs deliberately avoid claiming
  "Explorer fully renders everything."
- **Direct-to-DefaultVerifier only** (no local/self-hosted agent yet).
- **No offline receipt verification.**
- The deprecated `PROPOSED_RECEIPT_PATH` alias should be removed in a future major.

## Tests run

- `npm run typecheck`
- `npm run build`
- `npm test`

(Results recorded in the session that produced this report.)

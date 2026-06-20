# SAR-402 TypeScript SDK — Design (Phase 1)

- **Package:** `@defaultsettlement/sar-402`
- **Location:** `packages/sar-402/`
- **Date:** 2026-06-20
- **Status:** Phase 1 — direct-to-DefaultVerifier, Express middleware, not published to npm.

## 1. Objective

Build the smallest credible SDK that lets an existing x402 resource server emit a
**Settlement Attestation Receipt (SAR-402)** after a paid action — with a live
Explorer link — **without** giving Default Settlement control over the API,
funds, authorization, or delivery logic.

Success test (resource-server developer, < 60s): *“I already have an x402 paid
endpoint. I add this middleware. Now every paid action can emit a Settlement
Attestation Receipt with a live Explorer link, without giving Default Settlement
control over my API, funds, or delivery logic.”*

## 2. Doctrine the design encodes

```
Capability ≠ Authority
Authority  ≠ Execution
Execution  ≠ Verification
Verification must leave evidence.
Verified restraint is the product.
```

- DefaultVerifier **records evidence**. It does not execute, authorize delivery,
  custody funds, or control resource release.
- Every receipt carries an `authority_binding` with
  `verifier_has_execution_authority: false`,
  `verifier_controls_resource_release: false`,
  `resource_server_controls_delivery: true`.
- `gate` mode (verdict can block release) is **out of scope** and rejected at
  construction time — the middleware never holds authority to withhold delivery.

## 3. Reference alignment

The TypeScript implementation is a faithful port (in spirit) of the committed
Python SAR-402 layer; it does not fork the vocabulary or schema.

| Concern | Reference | TS equivalent |
| --- | --- | --- |
| Receipt schema | `knowledge-assets/.../sar-402-settlement-v0.1.schema.json` | `Sar402Payload` shape in `src/types.ts` |
| Continuity predicates | `morpheus/sar402/predicates.py` | `evaluateContinuity` in `src/normalize.ts` |
| Verdict derivation | `predicates.derive_verdict` | `deriveVerdict` (post_delivery seam) |
| Receipt assembly + integrity | `morpheus/sar402/builder.py` | `buildSar402Payload`, `computeIntegrity` |
| x402 evidence normalization | `morpheus/sar402_agent/normalizer.py` | `X402PaymentContext` → payload |
| Live x402 boundary | `attest-service/x402_live.py` | Out of scope: payment is verified by the operator, not the SDK |
| Delivery digest pattern | `attest-service/pay_url_summary.py` | `sha256` over response body, opt-in |

The SDK deliberately **does not verify payment** (that is the operator's
facilitator flow, mirrored by `x402_live.py`); it records what the operator
reports. The honesty rule from `x402_live.py` ("never stamp `verified` from
unverified payment") is preserved by making the operator the source of the
verified payment context.

## 4. Module map

| File | Responsibility |
| --- | --- |
| `src/types.ts` | Public types + `DEFAULT_AUTHORITY_BINDING` constant |
| `src/errors.ts` | `Sar402ConfigError`, `GateModeUnsupportedError`, `AuthorityBoundaryError`, `DefaultVerifierError` |
| `src/normalize.ts` | Network-free core: continuity predicates, verdict, canonical JSON, integrity digest, `buildSar402Payload` |
| `src/client.ts` | `DefaultVerifierClient` — POST to DefaultVerifier, timeout via `AbortController`, defensive receipt parsing |
| `src/middleware.ts` | Express middleware (`sar402`), `attachSettlementContext`, response capture, header attachment, fail-open orchestration |
| `src/index.ts` | Public surface |
| `examples/express-url-summary.ts` | Minimal integration mirroring `/pay/url-summary` |
| `tests/` | Unit tests (mocked HTTP) + guarded integration test |

## 5. Data flow

```
paid handler ──attachSettlementContext(res, ctx)──► res.locals.sar402
        │
        ▼ res.end()
middleware captures delivery metadata (status, optional body hash)
        │
        ▼
normalize.buildSar402Payload(ctx, delivery)  ── evaluate 5 predicates, derive verdict,
        │                                         stamp authority binding + integrity digest
        ▼
client.submit(payload)  ──POST {endpoint}{receiptPath} (bounded by timeoutMs)
        │                     default receiptPath /v1/sar-402/receipts is PROPOSED,
        │                     not yet exposed by attest-service — see §11
        │
        ├─ success → SarReceiptResult{ receiptId, explorerUrl }
        │             record mode: attach X-DefaultSettlement-* headers
        │             onReceipt(receipt)
        └─ failure → FAIL OPEN: response proceeds, onError(err, ctx), no receipt headers
```

## 6. Modes

| | `observe` (default) | `record` |
| --- | --- | --- |
| Timing | After `finish`, fire-and-forget | After delivery, before final flush |
| Blocking | Never | Bounded wait ≤ `timeoutMs`, then proceeds regardless |
| Headers | None (already sent) | `X-DefaultSettlement-Receipt-ID/Explorer-URL/Mode` on success |
| Body buffering | No (optional incremental hash) | Yes (needed for digest + headers) |
| `gate` | **Rejected at construction** (`GateModeUnsupportedError`) | — |

**Design tension resolved:** "record after delivery" vs. "attach receipt
headers" is irreconcilable if headers are already flushed. Resolution: `record`
buffers the response, runs a **timeout-bounded** receipt attempt, attaches
headers if it returns in time, then flushes. The added latency is capped and the
response **always** ships — so this is still fail-open (a verifier outage costs at
most `timeoutMs`, never the response).

## 7. Fail-open (hard constraint)

Implemented as structure, not configuration:

- Every verifier interaction is wrapped; `DefaultVerifierError` never escapes the
  middleware.
- `record` mode `finalize()` flushes the buffered response in a `finally` block,
  so no code path — including a throw inside the SDK — can leave the response
  unsent.
- There is no setting that makes a verifier outage block delivery.

## 8. Privacy & security defaults

- Raw request/response bodies are **never** transmitted.
- `includeResponseBodyHash` (default false) → `delivery.evidence_digest` (sha256).
- `includeRequestHash` (default false) → `request_digest` over
  method/path/content-type/length (never the body).
- `apiKey` → `Authorization: Bearer …` over HTTPS, never logged.

## 9. Integrity

`sha256` over canonical (recursively sorted-key, compact, `undefined`-dropped)
JSON of the receipt excluding the `integrity` block. Labeled
`sorted_keys_compact_v0` — honest about not being RFC 8785 JCS, matching the
Python builder's stance.

## 10. Out of scope (Phase 1)

- `gate` mode; local/self-hosted/air-gapped agent; offline receipt verification;
  payment verification/settlement; npm publication.

## 11. Backend reconciliation (added post-implementation)

A direct inspection of attest-service routes (not assumption) found **no live
endpoint that ingests a resource-server-built `sar_402_settlement_v0.1`
receipt**:

| Route | Why it is not the ingest target |
| --- | --- |
| `/v1/sar-402/receipts` | Does not exist. |
| `POST /v1/attest` | Different contract: requires `continuity_input` + `sar_input`, forwarded to internal services (`127.0.0.1:3001/settlement-witness`, `:3002/continuity/evaluate`). Does not accept a pre-built receipt. |
| `POST /pay/url-summary` | All-in-one paid action that generates its own receipt; not a generic ingest endpoint. |
| `GET /v1/attest/receipt/{id}` | Read-only lookup. |

**Decision (Option B): configurable-only, no claim the default works.** The client
keeps `https://defaultverifier.com` as the base and `/v1/sar-402/receipts` as a
**proposed** default path (`PROPOSED_RECEIPT_PATH`), now overridable via
`receiptPath`. No code asserts the default route succeeds; against it the call
fails open by design. attest-service was **not** modified (out of scope for this
SDK repo). Live issuance is pending a backend ingest endpoint.

# SAR-402 TypeScript SDK — Implementation Report (Phase 1)

- **Package:** `@defaultsettlement/sar-402` v0.1.0 (`private: true`, not published)
- **Location:** `packages/sar-402/`
- **Date:** 2026-06-20
- **Toolchain:** Node ≥ 18 (built on Node 24), TypeScript 5.4, Vitest 1.6, ESM (`NodeNext`).

## 1. What was built

A Node/TypeScript server-side middleware package that lets an x402 resource
server emit SAR-402 Settlement Attestation Receipts after a paid action, posting
directly to a configurable DefaultVerifier endpoint, with a hard fail-open
guarantee. (Backend caveat: no live ingest route exists yet — see §8a.)

### Files

```
package.json  README.md  .gitignore  LICENSE (Apache-2.0)  tsconfig.base.json   # root
packages/sar-402/
  package.json  tsconfig.json  tsconfig.examples.json  vitest.config.ts  README.md
  src/index.ts  src/types.ts  src/errors.ts  src/normalize.ts  src/client.ts  src/middleware.ts
  examples/express-url-summary.ts
  tests/helpers.ts  normalize.test.ts  middleware.test.ts  gate.test.ts  example.test.ts  integration.test.ts
reports/sdk/sar-402-typescript-design-<ts>.md
reports/sdk/sar-402-typescript-implementation-report-<ts>.md
```

## 2. Phase-1 behavior — implementation status

| # | Requirement | Status | Where |
| --- | --- | --- | --- |
| 1 | Express-compatible middleware | ✅ | `src/middleware.ts` `sar402()` |
| 2 | Accept x402 payment context from the server | ✅ | `attachSettlementContext` / `extractContext` |
| 3 | Normalize x402 evidence → SAR-402 payload | ✅ | `src/normalize.ts` `buildSar402Payload` |
| 4 | Capture safe delivery metadata after handler responds | ✅ | response capture in `middleware.ts` |
| 5 | Prefer hashes/metadata, not raw bodies | ✅ | opt-in `includeResponseBodyHash` / `includeRequestHash` |
| 6 | POST normalized evidence to DefaultVerifier directly | ✅ | `src/client.ts` `DefaultVerifierClient.submit` |
| 7 | Return receipt metadata via headers | ✅ | `X-DefaultSettlement-Receipt-ID/Explorer-URL/Mode` |
| 8 | Support `observe` and `record` | ✅ | `installObserveMode` / `installRecordMode` |
| 9 | Do not implement `gate`; reject clearly | ✅ | `GateModeUnsupportedError` at construction |
| 10 | Do not publish to npm | ✅ | `private: true`, no publish config |

## 3. Fail-open verification

The hard constraint is enforced structurally:

- `DefaultVerifierError` (timeout via `AbortController`, transport, or non-2xx)
  is caught inside `emitReceipt`; it never propagates to the response path.
- `record` mode `finalize()` flushes the buffered response in a `finally`,
  guarded by a `flushed` flag, so even an unexpected throw cannot strand the
  response.
- `onError(error, context)` fires on every fail-open path with a `stage` of
  `extract` | `normalize` | `submit`.

Covered by tests: `record mode > fails open when DefaultVerifier is unreachable`
and `observe mode > fires the receipt without blocking and fails open` — both
assert the response body/status are delivered intact while the verifier call
rejected.

## 4. Authority boundary

`DEFAULT_AUTHORITY_BINDING` is stamped into every payload:

```json
{
  "verifier_has_execution_authority": false,
  "verifier_controls_resource_release": false,
  "resource_server_controls_delivery": true,
  "acting_party": "resource_server"
}
```

The `verifier_has_execution_authority` field is typed as the literal `false`, so
it cannot be set true through the public API. Tested in
`normalize.test.ts > authority binding doctrine`.

## 5. Continuity & verdict

Faithful port of `morpheus/sar402/predicates.py`: the five predicates
(object/constraint/temporal/authority/executor), INDETERMINATE on insufficient
evidence (never guessed), and post-delivery verdict aggregation
(any FAIL → FAIL; any INDETERMINATE → INDETERMINATE; else PASS). Integrity digest
is sha256 over canonical sorted-key compact JSON (`sorted_keys_compact_v0`).

## 6. Tests

Command: `npm test` (from `packages/sar-402/`). HTTP is mocked via an injected
`fetchImpl`; no live DefaultVerifier is contacted.

```
 ✓ tests/gate.test.ts        (3 tests)
 ✓ tests/normalize.test.ts   (9 tests)
 ✓ tests/middleware.test.ts  (9 tests)
 ✓ tests/example.test.ts     (1 test)   # runs tsc on the example
 ↓ tests/integration.test.ts (1 skipped)
 Test Files  4 passed | 1 skipped
      Tests  22 passed | 1 skipped
```

Required coverage mapping:

| Required test | Implemented |
| --- | --- |
| 1. Normalizing x402 evidence | `normalize.test.ts` continuity suite |
| 2. Building SAR-402 payload | `normalize.test.ts` build suite |
| 3. record mode fails open if unreachable | `middleware.test.ts` |
| 4. observe mode fails open | `middleware.test.ts` |
| 5. headers attach on success | `middleware.test.ts` |
| 6. sensitive bodies not stored by default | `middleware.test.ts` (privacy) |
| 7. authority binding present & correct | `normalize.test.ts` |
| 8. gate mode rejected | `gate.test.ts` |
| 9. configured endpoint used | `middleware.test.ts` |
| 10. example compiles | `example.test.ts` (tsc `--noEmit`) |

Integration test (`integration.test.ts`) is opt-in: it self-skips unless
`SAR402_INTEGRATION=1` is set, so the default suite never depends on a live
service. Run with `npm run test:integration` plus `SAR402_ENDPOINT` /
`SAR402_API_KEY`.

## 7. Build / typecheck

- `npm run build` → `tsc -p tsconfig.json` emits `dist/` (ESM + `.d.ts`). Clean.
- `npm run typecheck` → `tsc --noEmit`. Clean.
- Example typechecks against the public surface via `tsconfig.examples.json`
  (package name mapped to `./src/index.ts`).

## 8. Notable decisions

- **record-mode buffering.** To attach receipt headers *and* compute a delivery
  digest, `record` buffers the response and runs a timeout-bounded receipt
  attempt before flushing. Latency is capped at `timeoutMs`; the response always
  ships. `observe` stays pure fire-and-forget for zero added latency.
- **SDK does not verify payment.** Mirrors the honesty rule in
  `attest-service/x402_live.py`: the operator's facilitator verifies payment and
  passes the verified context in. The SDK records; it never settles or gates.
- **Defensive receipt parsing.** `DefaultVerifierClient` reads `receipt_id` /
  `explorer_url` across several key spellings and falls back to a constructed
  `/explorer/sar/<id>` URL, matching the tolerant style of `defaultsettle-cli`.
- **Type-only Express dependency.** `express` is an optional peer; the middleware
  imports Express types with `import type` (erased at runtime), so the package
  has no hard runtime dependency.

## 8a. Backend endpoint reconciliation (required note)

**Phase 1 SDK middleware is structurally complete, but live receipt issuance
requires an attestation endpoint to be exposed by attest-service — one does not
currently exist.**

A direct route inspection of attest-service (`grep` of `@app`/`@router`
decorators, not assumption) confirmed there is no route that ingests a
resource-server-built `sar_402_settlement_v0.1` receipt:

- `/v1/sar-402/receipts` — **does not exist**.
- `POST /v1/attest` — different contract (`continuity_input` + `sar_input`
  forwarded to internal `settlement-witness` / `continuity/evaluate` services);
  not a drop-in receipt-ingest target.
- `POST /pay/url-summary` — all-in-one paid action that builds its own receipt;
  not a generic ingest endpoint.
- `GET /v1/attest/receipt/{receipt_id}` — read-only lookup.

**Action taken (Option B):** the client no longer claims a working default live
route. The default base stays `https://defaultverifier.com`; the receipt path is
exported as `PROPOSED_RECEIPT_PATH` (`/v1/sar-402/receipts`) and is now
overridable via the new `receiptPath` option (`ClientOptions` / `Sar402Config`).
Against the proposed default the receipt call **fails open** by design (logged,
`onError` fires, no headers) and delivery is unaffected. When attest-service
exposes an ingest endpoint, integrations that kept the defaults begin issuing
live receipts with no code change.

**attest-service was not added to or modified by this SDK repo** (out of scope per
instruction). Reconciling the backend (exposing an ingest route) is a separate,
backend-side task.

## 9. Known limitations (Phase 1)

- **No live ingest endpoint yet** (see §8a) — default route is proposed/pending;
  receipts fail open against it until attest-service exposes one.
- `gate` mode unimplemented (rejected); direct-to-DefaultVerifier only (no local
  agent); no offline verification; no payment verification/settlement; single
  buffered flush in `record` (use `observe` for large streaming responses); not
  published to npm.

## 10. Claims explicitly NOT made

- Not fraud prevention. Not guaranteed delivery. Not offline verification. Not a
  custody/authorization/release-control layer. Documented as such in the README.

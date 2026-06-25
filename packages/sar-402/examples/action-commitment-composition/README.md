# Action Commitment composition (SAR-402)

This directory demonstrates the first **Action Commitment** primitive for Default
Settlement / SAR-402 composition. Action Commitment is a separate primitive from
SAR. It lets independent verifiers **join**, by the same stable `action_ref`:

- pre-execution continuity / evaluator records
- outcome / execution receipts
- SAR delivery / settlement receipts
- chained verifier records

> **Action Commitment closes the correlation gap, not the execution-faithfulness gap.**

Meaning:

- Action Commitment **proves records are joinable** around the same committed
  logical action.
- It does **not** prove the executor honestly performed that action.
- Execution faithfulness still depends on signed records, complete outcome
  emission, delivery evidence, and verifier checks.

SAR remains **delivery / settlement evidence**. It is not authoritative for policy
evaluation, authorization, payment finality, invoice correctness, or execution.
SAR references an Action Commitment only through the additive
`_ext.operation_binding.action_ref` field.

---

## Action Request Commitment

Canonical object (frozen, `schema_id: ds.action_request.v0.1`):

```json
{
  "schema_id": "ds.action_request.v0.1",
  "method": "POST",
  "target": {
    "scheme": "https",
    "host": "api.example.com",
    "port": null,
    "path": "/demo/sar-402",
    "query": {}
  },
  "content_type": "application/json",
  "body_digest": "sha256:..."
}
```

Derivation:

```text
request_digest = "sha256:" + SHA256(JCS(Action Request Commitment))
```

Rules:

- **`schema_id`** — required; exactly `ds.action_request.v0.1` for this version.
- **`method`** — required, uppercase (`GET`, `POST`, `PUT`, `DELETE`, …). Never
  inferred from the body.
- **`target`** — required object that **replaces a raw `target_uri`**. The producer
  commits an *already-normalized, inspectable* target. The full live URL is never
  digested, because x402 / resource URLs may carry volatile material, and verifiers
  must not guess how to normalize a raw URL.
  - `scheme` — lowercase, required.
  - `host` — lowercase, required.
  - `port` — **key always present.** Default port is always `null` (not omitted,
    not `443` / `80`). A non-default port is an integer. Silent omission of `port`
    is rejected so two producers cannot disagree on representation and still digest
    to the same bytes. `https:443` / `http:80` normalize to `null`.
  - `path` — required, the stable logical resource path; no volatile
    session/payment/nonce material unless that is intentionally part of the logical
    resource identity.
  - `query` — required object (default `{}`), **not** a raw query string. Include
    only semantic parameters that affect the logical requested resource. Exclude
    payment tokens, signatures, expiry params, nonces, auth params, cache busters,
    trace ids, session ids, and facilitator/proxy/transport-only parameters.
- **`content_type`** — required; canonicalized by lowercasing and stripping
  parameters. `application/json; charset=utf-8` → `application/json`.
- **`body_digest`** — required; deterministic from the canonicalized content type:
  - canonical `application/json` → parse the body as JSON, JCS-canonicalize, then
    SHA-256 the canonical bytes. Malformed JSON declared as JSON makes the
    commitment invalid.
  - any other content type → SHA-256 of the raw body bytes.
  - empty body → SHA-256 of zero bytes.

There is **no `request_params`** field in v0.1. Authorization headers, cookies,
timestamps, trace ids, nonces, user-agent, forwarded/proxy headers, signature
headers, outcome fields, evaluator state, delivery result, payment finality, and
invoice semantics are all excluded.

## Action Commitment

Canonical object (frozen, `schema_id: ds.action_commitment.v0.1`):

```json
{
  "schema_id": "ds.action_commitment.v0.1",
  "agent_id": "agent:example",
  "action_type": "sar402.resource_delivery",
  "request_digest": "sha256:...",
  "idempotency_key": "idem_..."
}
```

Derivation:

```text
action_ref = "sha256:" + SHA256(JCS(Action Commitment))
```

Rules:

- **`schema_id`** — required; exactly `ds.action_commitment.v0.1`.
- **`agent_id`** — required. Binds the commitment to the agent identity asserted in
  the signed records that reference it. **The Action Commitment itself may be
  unsigned** in this implementation; trust comes from the *signed records* that
  reference the same `action_ref`. `agent_id` must use the same identity scheme as
  those signed records — for current Default Settlement records that is the
  `agent:` namespaced form (e.g. `agent:example`). Freeform display names and other
  URI schemes (`morpheus`, `did:morpheus`, …) are rejected so `agent_id` cannot
  become another soft field inside the canonical digest. **This validation rule is
  provisional** for this package; if a shared agent-id validator is introduced it
  should defer to it.
- **`action_type`** — required, a stable namespaced string (format enforced, not a
  global semantic registry), e.g. `sar402.resource_delivery`.
- **`request_digest`** — required; produced by the Action Request Commitment
  derivation above.
- **`idempotency_key`** — required, **caller-supplied and not derived from
  `request_digest`**. See retry semantics below.

`target_ref` is intentionally **not** part of the canonical Action Commitment
input. If a producer carries a `target_ref` for display/indexing, it must live
outside this object and must not affect `action_ref`.

## SAR `_ext.operation_binding.action_ref`

A SAR receipt references an Action Commitment through an additive envelope:

```json
{
  "_ext": {
    "operation_binding": {
      "schema_id": "ds.operation_binding.v0.1",
      "action_ref": "sha256:..."
    }
  }
}
```

`ds.operation_binding.v0.1` is a **new extension schema introduced by this diff**;
the repo previously defined only `_ext.invoice` (see
[`../vic-sar-composition`](../vic-sar-composition)). Like `_ext.invoice`, it is
**additive** — a SAR verifier that does not understand it ignores `_ext` and still
validates the receipt as a normal delivery attestation. It changes no canonical
`sar_402_settlement_v0.1` field.

Validation (`validateOperationBinding`) checks that
`_ext.operation_binding.action_ref` exists and equals the `action_ref` derived from
the linked Action Commitment. It is a **correlation check only** — it never makes
SAR claim policy authorization, payment finality, invoice correctness, or executor
faithfulness.

## Retry semantics

`idempotency_key` is what separates *the same logical operation, retried* from *two
different operations that happen to have identical request content*.

- The **same logical retry family reuses the same `idempotency_key`** → the same
  `action_ref`. Retries of one intended operation stay joinable.
- **Different intended operations with identical request content must use different
  `idempotency_key` values** → different `action_ref`. Identical bytes do not
  collapse two distinct intents into one committed action.

Because `idempotency_key` is part of the canonical Action Commitment input,
changing it changes `action_ref`; changing the `request_digest` (e.g. a changed
body) also changes `action_ref`.

## INDETERMINATE / evaluator-timeout semantics

`INDETERMINATE` is a verdict an evaluator can record. It is:

- **not permit**, and
- **not deny**.

It is a **positive artifact** that evaluator uncertainty was recorded. What
actually happened — proceeded, blocked, failed, or produced an audit gap — is
determined by the **downstream record joined by `action_ref`**, not by the
`INDETERMINATE` verdict itself.

An evaluator timeout (or any missing downstream evidence) is an **audit gap**: the
verifier cannot conclude whether execution proceeded. Absence of a downstream record
proves *blocked execution* only under the completeness assumption below; otherwise
absence means the verifier has an audit gap, not proof of non-execution.

---

## Scenarios

Each folder contains the canonical `action-request-commitment.json` and
`action-commitment.json`, a derived `join.json` (showing `request_digest` and
`action_ref` — **not** a canonical digest input), and the downstream records joined
by that `action_ref`. Re-derive and verify them with the package helpers; the test
[`tests/action-commitment-fixtures.test.ts`](../../tests/action-commitment-fixtures.test.ts)
does exactly this.

| # | Folder | Evaluator | Execution | SAR delivery receipt |
|---|--------|-----------|-----------|----------------------|
| 1 | `01-pass-delivered` | `PASS` | proceeded | ✅ present |
| 2 | `02-fail-blocked` | `FAIL` | blocked | ❌ none; affirmative blocked outcome receipt |
| 3a | `03a-indeterminate-blocked` | `INDETERMINATE` | policy blocks | ❌ none; affirmative blocked outcome receipt |
| 3b | `03b-indeterminate-absence` | `INDETERMINATE` | unknown | ❌ none; **no outcome receipt** → audit gap |
| 4 | `04-indeterminate-proceeded` | `INDETERMINATE` | policy proceeds | ✅ present + outcome receipt |
| 5 | `05-evaluator-timeout` | `EVALUATOR_TIMEOUT` | unknown | ❌ none; **no downstream evidence** → audit gap |

Scenarios **3a** and **3b** are deliberately split:

- **3a — blocked with an affirmative artifact.** This is the *preferred* blocked
  case: a positive blocked outcome receipt joined by `action_ref` records that the
  policy chose to block under uncertainty.
- **3b — absence under the completeness assumption.** There is no downstream
  outcome or delivery record at all. Absence proves blocked execution **only if** the
  system guarantees complete outcome receipt emission. Otherwise absence is an audit
  gap, not proof of non-execution.

> The evaluator and outcome records in these folders are **non-normative
> illustrative scaffolding** (each is marked `"_non_normative": true`). The repo
> does not currently define normative continuity/evaluator or outcome/execution
> receipt schemas, and this task does **not** introduce any. They exist here only to
> demonstrate `action_ref` composition. See open questions.

Regenerate the fixtures (after `npm run build` at the repo root):

```bash
npx tsx packages/sar-402/examples/action-commitment-composition/derive.ts
```

## Documented assumptions

1. **Records must be individually signed to be trusted.** The Action Commitment
   itself may be unsigned; trust comes from the signed records that reference the
   same `action_ref`.
2. **Outcome receipt emission must be complete for absence-as-proof to mean blocked
   execution.** Without that guarantee, a missing downstream record is an audit gap,
   not proof of non-execution.
3. **Action Commitment closes the correlation gap, not the execution-faithfulness gap.**
   It proves joinability, not honest execution.
4. **SAR remains delivery/settlement evidence** and does not subsume the continuity,
   execution, payment, or invoice layers.

## Open questions

- There are **no normative continuity/evaluator or outcome/execution receipt
  schemas** in the repo today. The evaluator and outcome records here are
  non-normative scaffolding. Defining those primitives is out of scope for this
  diff and should be tracked separately.
- The `agent_id` validation rule is **provisional** for this package. If a shared
  Default Settlement agent-id validator is introduced, this rule should defer to it.

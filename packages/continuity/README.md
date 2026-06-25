# @defaultsettlement/continuity

The **continuity composition layer** for Default Settlement. It adds the two
**signed normative records** that compose with the (unsigned) Action Commitment
correlation primitive around a shared `action_ref`:

1. **Continuity Evaluation Receipt** — `ds.continuity_evaluation.v0.1`
2. **Execution Outcome Receipt** — `ds.execution_outcome.v0.1`

Together with Action Commitment and SAR-402 delivery evidence, these let an
independent verifier **join** — through the same `action_ref` —

- pre-execution evaluation,
- execution outcome, and
- SAR delivery / settlement evidence.

> **Action Commitment closes the correlation gap, not the execution-faithfulness gap.**

> **Absence of an Execution Outcome Receipt is a verifier finding, not an outcome state.**

---

## Why this package exists separately from SAR-402

Continuity/evaluation and execution outcome are **not SAR-owned layers**. SAR-402
records delivery/settlement evidence; it does not own policy evaluation or
execution. Putting these schemas inside `packages/sar-402/` would make SAR
authoritative for layers it must not own. So they live in a sibling package.

Layer boundaries:

```text
Action Commitment answers:           What committed logical action are the records about?
Continuity Evaluation Receipt answers: What did the evaluator/gate determine before execution?
Execution Outcome Receipt answers:     What did the mutation-capable executor do?
SAR Receipt answers:                   What delivery/settlement evidence was produced?
Verifier answers:                      Do the signed records compose around the same action_ref?
```

Doctrine, stated explicitly:

- A **Continuity Evaluation Receipt does not prove delivery.**
- An **Execution Outcome Receipt does not prove delivery.**
- **SAR does not prove policy authorization.**
- **SAR does not prove executor faithfulness.**
- **Missing outcome evidence is a verifier/audit finding, not an outcome receipt state.**

---

## Relationship to Action Commitment

Action Commitment (in `packages/sar-402/src/action-commitment.ts`, schema
`ds.action_commitment.v0.1`) is a **first-class, intentionally unsigned
correlation primitive**. It derives a stable `action_ref`:

```text
action_ref = "sha256:" + SHA256(JCS(Action Commitment))
```

Action Commitment is the **join primitive**. The records in this package are the
**signed records** that reference that join key. Action Commitment proves records
are *joinable* around the same committed logical action; it does **not** prove the
executor honestly performed that action. Execution faithfulness depends on these
signed records plus complete outcome emission, delivery evidence, and verifier
checks.

> Action Commitment may eventually deserve a neutral shared package. It is **not**
> moved in this layer's diff — moving it would reopen the prior commit and create
> churn.

## Relationship to SAR `_ext.operation_binding.action_ref`

A SAR-402 receipt references an Action Commitment only through the additive,
non-authoritative `_ext.operation_binding.action_ref` field. Composition
validation reads that field to confirm the SAR receipt joins on the same
`action_ref`. It never makes SAR authoritative for authorization, payment
finality, invoice correctness, or executor faithfulness.

---

## Continuity Evaluation Receipt

Records the evaluator/gate result for a committed logical action **before**
execution.

Canonical unsigned core:

```json
{
  "schema_id": "ds.continuity_evaluation.v0.1",
  "action_ref": "sha256:...",
  "evaluator_id": "agent:example",
  "evaluation_state": "INDETERMINATE",
  "policy_ref": "policy:default-settlement/sar-402-delivery-v1",
  "evaluated_at": "2026-06-25T14:30:00Z"
}
```

Rules:

- `schema_id` must be exactly `ds.continuity_evaluation.v0.1`.
- `action_ref` must be a valid `sha256:<64 lowercase hex>` digest.
- `evaluator_id` must use the same `agent:` identity scheme as Action Commitment.
- `evaluation_state` must be one of the four allowed values (below).
- `policy_ref` is a stable string reference, not a digest in v0.1.
- `evaluated_at` is required for audit/human inspection, and is signed as part of
  the record's factual claim. It is **not** a join key and must not affect
  `action_ref`.

### `evaluation_state` values

| State               | Meaning                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `PASS`              | Evaluator completed and returned a permit/allow verdict.                                  |
| `FAIL`              | Evaluator completed and returned a deny/block verdict.                                     |
| `INDETERMINATE`     | Evaluator **completed** but could not reach a permit or deny verdict. A positive artifact of uncertainty. |
| `EVALUATOR_TIMEOUT` | Evaluator did **not complete** and produced no verdict before the timeout boundary.        |

#### `INDETERMINATE` vs `EVALUATOR_TIMEOUT`

These are **not synonyms**.

- `INDETERMINATE` = a **completed** evaluation that reached uncertainty. It is a
  positive artifact: the evaluator ran and recorded that it could not decide.
- `EVALUATOR_TIMEOUT` = **non-completion**. The evaluator did not finish and
  produced no verdict.

---

## Execution Outcome Receipt

Records what the mutation-capable executor **did** after evaluation.

Canonical unsigned core:

```json
{
  "schema_id": "ds.execution_outcome.v0.1",
  "action_ref": "sha256:...",
  "executor_id": "agent:example",
  "outcome_state": "BLOCKED",
  "reason": "policy_blocked",
  "recorded_at": "2026-06-25T14:31:00Z"
}
```

Rules:

- `schema_id` must be exactly `ds.execution_outcome.v0.1`.
- `action_ref` must be a valid `sha256:<64 lowercase hex>` digest.
- `executor_id` must use the same `agent:` identity scheme as Action Commitment.
- `outcome_state` must be one of `PROCEEDED`, `BLOCKED`, `FAILED`.
- `reason` is **optional**, informational, and **non-load-bearing**. Verifier
  logic must key off `outcome_state`, never `reason`. A `PROCEEDED` receipt may
  omit `reason`; filler reasons are never required.
- `recorded_at` is required for audit/human inspection and is signed as part of
  the record's factual claim. It is **not** a join key and must not affect
  `action_ref`.

Examples: `BLOCKED` may include `reason: "policy_blocked"`; `FAILED` may include
`reason: "executor_error"`; `PROCEEDED` may omit `reason`.

### Why `NO_EMISSION` is not an outcome state

There is intentionally **no** `NO_EMISSION`. A receipt cannot self-attest its own
absence. Absence of an Execution Outcome Receipt is a verifier/audit finding, not
an outcome state.

### Absence-as-audit-gap rule

```text
Absence of an Execution Outcome Receipt is not itself an outcome state.
```

```text
Absence proves blocked execution only when the system has a separately
verifiable complete-emission guarantee. Otherwise, absence is an audit gap.
```

This is the **executor-continuity doctrine**.

### Complete-emission assumption

Composition validation takes an explicit parameter:

```ts
completeEmissionGuaranteed: boolean // default: false
```

- When `completeEmissionGuaranteed === false` (the default), a missing Execution
  Outcome Receipt produces an **audit-gap finding**.
- When `completeEmissionGuaranteed === true`, a missing Execution Outcome Receipt
  **may** be interpreted as blocked execution **only if** the validator is
  explicitly asked to apply that assumption, via a second explicit flag
  (`interpretAbsenceAsBlocked: true`).

The assumption is **explicit and inspectable** (surfaced in
`result.appliedAssumptions`). The validator never silently treats absence as
blocked.

---

## Composition validation

`validateActionRefComposition(input)`:

1. The Continuity Evaluation Receipt references the expected `action_ref`.
2. The Execution Outcome Receipt references the expected `action_ref`, when present.
3. The SAR receipt's `_ext.operation_binding.action_ref` references the expected
   `action_ref`, when a SAR receipt is supplied.
4. All supplied records join on the same `action_ref`.
5. A mismatch **fails** validation (throws `ContinuityCompositionError`).
6. A missing outcome receipt produces an **audit-gap finding** unless
   `completeEmissionGuaranteed: true` **and** `interpretAbsenceAsBlocked: true`
   are explicitly supplied.
7. Absence is never represented as `NO_EMISSION`.

The join key is **`action_ref` only**. Timestamps are never used to join (see
below), and `reason` is never consulted (it is non-load-bearing). Signature
verification is a separate step (`verifyContinuityEvaluationReceipt` /
`verifyExecutionOutcomeReceipt`); composition checks the join, not the crypto.

---

## Signing requirements

These records are **signed normative records** (unlike Action Commitment, which
is intentionally unsigned and derives trust from the signed records that
reference it).

- A Continuity Evaluation Receipt **must** be signed by the **evaluator's**
  Ed25519 key.
- An Execution Outcome Receipt **must** be signed by the **executor's** Ed25519
  key.
- `evaluator_id` / `executor_id` must correspond to the signing key identity.
- The same provisional `agent:` identity scheme and validator behavior as Action
  Commitment is used (`agent:example`, `agent:morpheus`,
  `agent:x402:eip155:8453:0xPayer`; freeform names like `morpheus`,
  `did:morpheus`, `Agent Smith` are rejected).

### Signature input rule

The signature must **not** cover itself:

```text
signed_core = record without its `signature` block
signature   = Ed25519.sign( JCS(signed_core) )
```

The `signature` block lives as a top-level field on the record and is **excluded**
from the canonical signing input. The canonical signing input is deterministic
(`sorted_keys_compact_v0`, equivalent to RFC 8785 / JCS over the v0.1 value
domain) and is reproducible by any independent verifier
(`canonicalSigningInput(record)` exposes the exact bytes).

The signature envelope:

```json
{
  "alg": "ed25519",
  "key_id": "agent:example",
  "public_key": "<base64 SPKI DER of the signer's Ed25519 public key>",
  "signature": "<base64 Ed25519 signature over JCS(signed_core)>"
}
```

### Identity-to-signing-key binding

Identity-to-signing-key binding is **required**. The key used to verify a record
must correspond to the record's signer identity.

`verifyEnvelope` (and the per-record `verify*Receipt` helpers) enforce:

1. `signature.key_id` **must** equal the expected signer identity (the record's
   `evaluator_id` / `executor_id`).
2. `signature.public_key` **must** equal the trusted Ed25519 public key bound to
   that identity (resolved out of band by the verifier).
3. The Ed25519 signature **must** verify over `JCS(signed_core)` under that key.

A record with a valid signature but a **mismatched** `evaluator_id` / signing key
or `executor_id` / signing key **fails verification**. `evaluator_id` /
`executor_id` are never self-asserted unsigned claims.

> This SDK has no key registry; the trusted `(identity → public key)` mapping is
> supplied by the verifier. The package guarantees a record cannot claim a signer
> identity different from the key it presents, and cannot be accepted under a key
> the verifier did not bind to that identity.

---

## Timestamp non-join rule

Timestamps are included for auditability but are **not** join-critical.

- `evaluated_at` and `recorded_at` are required fields in the signed records.
- They are signed as part of the record's factual claim.
- They are **not** part of Action Commitment, and do **not** affect
  `request_digest` or `action_ref`.
- They must **not** be used to join retries. Retry-stable joining happens through
  `action_ref`, not timestamps.

---

## `policy_ref` (v0.1 limitation) and future `policy_digest`

```text
policy_ref is a stable reference, not a normative policy commitment. A future
v0.2 may add policy_digest once policy representation is normative.
```

`policy_ref` is a stable string reference in v0.1 (e.g.
`policy:default-settlement/sar-402-delivery-v1`). This diff does **not** add a
policy schema or a policy digest. `policy_digest` may be introduced in v0.2 once
policy representation is normative.

---

## Cross-package dependency boundary

`packages/continuity/` source **must not** import SAR-owned implementation
details from `packages/sar-402/`. Continuity is a sibling / upper composition
layer, not a child of SAR. There is no circular dependency, and SAR source does
not own or validate continuity semantics.

The shared canonicalization helper (`sorted_keys_compact_v0`), the `sha256:`
digest, the `agent:` identity validator, the `action_ref` validator, and the
Ed25519 signed-record envelope now live in the neutral
[`@defaultsettlement/canonical`](../canonical/README.md) package, which both
this layer and SAR-402 depend on. `src/canonical.ts` and `src/signing.ts`
re-export those primitives (wrapping the validators so failures still surface as
`ContinuityRecordError` / `ContinuitySignatureError`) instead of duplicating the
logic. The dependency direction is `continuity -> canonical`; there is no import
back into SAR-402.

---

## Fixtures

`examples/action-ref-composition/` contains five signed scenarios. They join to
the existing SAR-402 Action Commitment fixtures
(`packages/sar-402/examples/action-commitment-composition/`) by **reusing their
derived `action_ref`** — Action Commitment is the join primitive; these receipts
are the signed records. Regenerate deterministically with:

```bash
npm run build
npx tsx packages/continuity/examples/action-ref-composition/derive.ts
```

| Scenario                          | evaluation_state    | outcome_state | SAR delivery receipt |
| --------------------------------- | ------------------- | ------------- | -------------------- |
| `01-pass-proceeded-delivered`     | `PASS`              | `PROCEEDED`   | yes (cross-ref)      |
| `02-fail-blocked`                 | `FAIL`              | `BLOCKED`     | no                   |
| `03-indeterminate-blocked`        | `INDETERMINATE`     | `BLOCKED`     | no                   |
| `04-indeterminate-proceeded`      | `INDETERMINATE`     | `PROCEEDED`   | yes (cross-ref)      |
| `05-evaluator-timeout-audit-gap`  | `EVALUATOR_TIMEOUT` | *(none)*      | no — **audit gap**   |

Scenario 05 emits **no** Execution Outcome Receipt: the missing outcome is a
verifier finding (`missing_execution_outcome_receipt`, `kind: audit_gap`) recorded
in `composition.json`, **not** an outcome receipt and **not** `NO_EMISSION`.

---

## Open question (flagged for review)

The canonical-JSON helper, `sha256:` digest, `agent:` identity validator,
`action_ref` validator, and the Ed25519 signed-record envelope have been
extracted into the neutral [`@defaultsettlement/canonical`](../canonical/README.md)
package that both SAR-402 and continuity now depend on, resolving the earlier
duplication. SAR-402's `integrity` block remains a plain content digest (not a
signature); the signed-record envelope this layer uses is the canonical package's
shared envelope.

The **remaining** open question is public key discovery. The canonical package
standardizes identity-to-signing-key binding but, by design, **does not provide a
key registry or public key discovery** — a verifier must still resolve each
signer identity to its trusted Ed25519 public key out of band. Building that
registry / discovery layer is the next step and is intentionally out of scope
here.

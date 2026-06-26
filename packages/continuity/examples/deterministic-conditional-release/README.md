# Deterministic conditional-release example

This fixture set demonstrates the **deterministic conditional-release profile**:
a declared acceptance spec is committed inside the Action Request body, a
deterministic evaluator applies that exact committed spec to a submitted output,
and the result (`PASS` / `FAIL` / `INDETERMINATE` / `EVALUATOR_TIMEOUT`) is what a
Continuity Evaluation Receipt records against the shared `action_ref`.

It is **not** a new primitive and **not** an Action Commitment schema change. The
profile rides inside the already-committed request body and is therefore bound to
the action through the existing chain:

```
body_digest → request_digest → action_ref
```

Reference design: `reports/strategy/deterministic-conditional-release-profile-20260626.md`
(Morpheus repo).

## Files

| File | What it is |
|---|---|
| `request-body.json` | The committed Action Request body. Carries `ds_conditional_release` with the `acceptance_spec`, `release_policy`, and `evidence_expectations`. |
| `action-request-commitment.json` | `ds.action_request.v0.1` — commits `body_digest` over the request body. |
| `action-commitment.json` | `ds.action_commitment.v0.1` — the correlation primitive; `action_ref` derives from it. |
| `sample-output-pass.json` | A submitted output that satisfies every check. |
| `sample-output-fail.json` | A submitted output whose `row_count` (740) trips the `numeric_threshold >= 1000` hard-FAIL check. |
| `evaluation-pass.json` | Evaluator result for the PASS output, with per-check detail. |
| `evaluation-fail.json` | Evaluator result for the FAIL output, with per-check detail. |
| `derive.ts` | Reproducible generator for all of the above. |

Regenerate (after `npm run build` at the repo root):

```
npx tsx packages/continuity/examples/deterministic-conditional-release/derive.ts
```

## Acceptance spec in this example

The demo uses **only self-contained check kinds** (`field_present`,
`numeric_threshold`, `content_type_equals`) so that PASS and FAIL are clean and
fully reproducible from the committed body alone.

`json_schema` is a **documented v0.1 implementation gap**: there is no approved
JSON Schema validator in the dependency set, so the evaluator returns
`INDETERMINATE` with reason `json_schema_not_implemented` for that kind. It is
therefore intentionally left out of this demo's authoritative gate so the PASS
path stays clean. Adding a validator is a deliberate, separately-approved step —
not something this example does.

## Boundaries (read this)

- **`release_policy` is declared intent, not proof of actual downstream release.**
  It records the mapping the requester *wants* a downstream system to apply to the
  recorded evaluation result (PASS → release, FAIL → withhold, INDETERMINATE →
  manual review). It is not an actuator and proves nothing about what any system
  actually did. The `declared_release_intent` field in the evaluation fixtures is
  exactly this declared mapping, not a record of action.

- **Actual release/withhold would require a separate Execution Outcome Receipt for
  the release event if we want to prove that loop.** That is the same primitives
  composed once more — a second action ("the release system performed release R
  against `action_ref` A") with its own Execution Outcome Receipt — not a new
  schema. It is out of scope for v0.1.

The single bounded claim this example supports is:

> A deterministic evaluator applied a declared acceptance spec to a referenced
> output and produced a recorded result.

It does **not** claim objective correctness, payment/resource-release finality, or
that any downstream system honored the release policy.

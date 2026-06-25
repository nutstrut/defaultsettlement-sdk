# @defaultsettlement/canonical

Neutral shared primitives for Default Settlement. It is the single source of
truth for the deterministic serialization, digesting, identity validation, and
signed-record envelope logic that `@defaultsettlement/sar-402` and
`@defaultsettlement/continuity` both depend on. It exists so core verification
logic is no longer duplicated across those packages.

> **This package does not provide key discovery or a public key registry.**

The canonical package standardizes deterministic serialization, digest
validation, identity validation, content/body digesting, and signed-record
envelope helpers. It does not provide a key registry or public key discovery.

## What it provides

- **Deterministic canonicalization** — `canonicalJson(value)` implements the
  repo's `sorted_keys_compact_v0`: recursively key-sorted JSON, compact
  separators, `undefined` dropped. Over the v0.1 value domain (objects, strings,
  `null`, and integers within the IEEE-754 safe range — no fractional numbers,
  no `undefined`, no functions) it is byte-for-byte equivalent to JCS / RFC 8785.
  Producers MUST keep values inside that domain so the equivalence holds and
  output stays deterministic.
- **Digest format** — `sha256Hex(input)` returns `sha256:<64 lowercase hex>`.
  `SHA256_DIGEST_RE`, `validateSha256Digest`, and `validateActionRef` validate
  that shape.
- **Identity validation** — `validateAgentId` / `AGENT_ID_RE` accept the
  namespaced `agent:` scheme (`agent:example`, `agent:x402:eip155:8453:0xPayer`)
  and reject freeform names and other URI schemes (`morpheus`, `did:morpheus`,
  `Agent Smith`). `validateActionType` / `ACTION_TYPE_RE` require a stable
  namespaced action type (e.g. `sar402.resource_delivery`).
- **Content / body digest behavior** — `canonicalizeContentType` lowercases and
  strips parameters (`application/json; charset=utf-8` → `application/json`).
  `computeBodyDigest(rawContentType, body)`:
  - empty body hashes zero bytes regardless of content type;
  - canonical `application/json` parses the JSON and hashes its canonical form
    (key-order independent); malformed JSON declared as JSON is invalid;
  - any other content type hashes the raw bytes.
- **Signed record envelope** — `signEnvelope` / `verifyEnvelope` plus
  `signedCore`, `canonicalSigningInput`, `signedPayloadDigest`,
  `generateEd25519KeyPair`, `exportPublicKeyB64`, `importPublicKeyB64`. The
  `signature` block is a top-level field excluded from the signed bytes; the
  signed bytes are `canonicalJson(record_without_signature_block)`.

## Identity-to-key binding

`verifyEnvelope` enforces, in order:

1. `signature.key_id` MUST equal the caller's expected signer identity.
2. `signature.public_key` MUST equal the trusted public key the caller supplies
   for that identity. The presented public key is never trusted by default.
3. The Ed25519 signature MUST verify over `canonicalJson(signed_core)`.

A valid signature with a mismatched identity, or signed by a key that is not the
identity-bound trusted key, fails at step 1 or 2 before the cryptographic check
matters.

## What it does not provide

This is infrastructure / prerequisite work. It standardizes the primitives that
outside verification will be built on; it does **not** solve key discovery.

> **This package does not provide key discovery or a public key registry.**

The caller must resolve an identity to its trusted Ed25519 public key out of
band and pass it to `verifyEnvelope`. Binding a `key_id` to a public key, and
discovering or registering public keys, is future work and intentionally out of
scope here.

## Dependency direction

```
sar-402    -> canonical
continuity -> canonical
```

`canonical` depends on nothing in the monorepo. It must never import from
`sar-402` or `continuity`.

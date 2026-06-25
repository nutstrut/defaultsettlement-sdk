# @defaultsettlement/key-bindings

Define, sign, verify, and resolve Default Settlement **Agent Key Binding Assertions**.

A Default Settlement Agent Key Binding Assertion is an optional published trust source. It allows a verifier to resolve an agent identity to a trusted Ed25519 public key without private coordination, if the verifier chooses to trust Default Settlement’s published bindings. It is not a decentralized registry, certificate authority, revocation system, or transparency log.

## What it is

An Agent Key Binding Assertion is a signed document that says, as of an integer version N:

> As of version N, Default Settlement asserts that `agent_id` X is bound to Ed25519 public key Y.

A verifier MAY use that assertion to resolve a signer identity to a trusted key, or MAY supply its own trusted bindings instead.

The binding assertion verifies who Default Settlement says a key belongs to. It does not prove the agent acted correctly, that a receipt is true, or that Default Settlement is the only valid source of trust bindings.

## What it is not

It is **not** a decentralized registry, identity registry, certificate authority, trust root, revocation system, or transparency log, and it makes no "trustless" claim. Using it means choosing to trust Default Settlement’s published bindings:

> An independent verifier can verify signed continuity and outcome records using a public Default Settlement-published key-binding source, without private key exchange or out-of-band coordination. This is not the same as verifying without trusting anyone.

## Why the record’s signature already carries a public key

Default Settlement signed records (continuity / outcome receipts) carry a `signature` block with `key_id`, `public_key`, and `signature`. The signature already proves that *whoever held some private key* signed the record, and `public_key` is the key they presented.

What the signature alone does **not** establish is whether that presented key is the *trusted* key for the asserted signer identity. The Agent Key Binding Assertion answers exactly that one question:

> Is this presented public key the trusted key for this signer identity?

That is why resolution is a separate, composable step from signature verification.

## Trust model and dual-anchor limitation

The Default Settlement publication-key fingerprint is anchored in two places:

1. this SDK repo fixture / reference (`fixtures/defaultsettlement-publication-key.json`);
2. the served well-known document (see below).

Both are controlled by Default Settlement, so the security property is bounded:

> Dual anchoring lets a verifier detect inconsistency between the public SDK repo and the served well-known document. It does not protect against a compromised Default Settlement publisher. A verifier that requires that guarantee must pin the publication key fingerprint out of band.

## v0.1 scope: no revocation, rotation, or status

v0.1 deliberately has **no** `status` field on bindings. A `status` (e.g. `"active"` / `"revoked"`) would imply revocation semantics, and v0.1 does not define or enforce revocation, rotation lifecycle, transparency logs, append-only Merkle logs, external witnesses, or third-party countersignatures.

## Optional verifier-side downgrade protection

`checkBindingAssertionVersion(fetchedVersion, previouslyAcceptedVersion?)` lets a verifier reject a later-fetched document whose version is lower than one it previously accepted from the same source.

> This is local verifier-side downgrade protection. It is not an append-only proof and does not provide transparency-log guarantees.

## Schemas

- `ds.defaultsettlement_publication_key.v0.1` — minimal publication-key anchor/reference document (unsigned in v0.1).
- `ds.agent_key_binding_assertion.v0.1` — the signed Agent Key Binding Assertion.

## Publication-key fingerprint

`publication_key_fingerprint` is `sha256:<64 lowercase hex>` computed over the **raw SPKI DER bytes** of the publication public key — not over the base64 string and not over any other encoding. From a base64 SPKI DER string, base64-decode to the raw DER bytes first and hash those; from a `KeyObject`, export SPKI DER bytes and hash those. The `publicationKeyFingerprint(publicKey: KeyObject | string)` helper does this.

## Signing format

The assertion reuses the **same** signed-record envelope as continuity / outcome records, from `@defaultsettlement/canonical` — there is no second signing format:

```text
signed_core = document without its signature block
signature   = Ed25519.sign(canonicalJson(signed_core))
signature block excluded from the signed bytes
```

## Composing verification

```ts
import {
  verifyAgentKeyBindingAssertion,
  resolveTrustedKeyForSignedRecord,
  verifyEnvelope,
  importPublicKeyB64,
} from '@defaultsettlement/key-bindings'

// 1. Verify the assertion with the trusted publication key (pinned out of band
//    or read from the publication-key document).
const publicationKey = importPublicKeyB64(publicationKeyDoc.public_key)
const assertionCore = verifyAgentKeyBindingAssertion(signedAssertion, publicationKey)

// 2. Resolve the signed record's presented key against the assertion.
const resolved = resolveTrustedKeyForSignedRecord(signedRecord, assertionCore)
if (!resolved.ok) {
  // 'unresolved_trust_binding' | 'key_binding_mismatch' | 'malformed_signature_block'
  throw new Error(resolved.status)
}

// 3. Pass the resolved trusted key to canonical envelope verification.
const core = verifyEnvelope(signedRecord, {
  expectedPublicKey: resolved.public_key,
  expectedKeyId: resolved.signer_id,
})
```

### Resolver outcomes

- `verified` — a trusted binding exists and the record presented exactly the bound key.
- `unresolved_trust_binding` — **no** trusted binding exists for this signer identity. The verifier simply cannot resolve a trusted key.
- `key_binding_mismatch` — a trusted binding **exists**, but the record presented a *different* key. This is security-relevant and must **not** be softened into "unresolved".
- `malformed_signature_block` — the record's signature block is missing or malformed.

The resolver performs binding resolution **only**; it does not verify the Ed25519 signature. Keep that composable: use canonical `verifyEnvelope` with the resolved key for the cryptographic check.

## Well-known paths (not deployed by this package)

Default Settlement intends to serve these documents at:

```text
/.well-known/defaultsettlement-publication-key.json
/.well-known/defaultsettlement-agent-key-bindings.json
```

These are **not** deployed by this task and are **not** claimed to be live. The committed fixtures under `fixtures/` are the repo-side anchor/reference copies.

## Fixtures

Regenerate deterministically (after a repo build):

```bash
npx tsx packages/key-bindings/fixtures/derive.ts
```

This writes `fixtures/defaultsettlement-publication-key.json` and `fixtures/defaultsettlement-agent-key-bindings.json`. Signing keys are derived from fixed seeds so the public artifacts are byte-stable across runs. Those seeds are illustrative test material only — not deployable production keys. **No private key material is ever written to fixture JSON.**

## Future work

A transparency log is possible future work. This package makes no transparency-log claim today.

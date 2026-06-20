# Default Settlement SDK

Public SDK for emitting **Settlement Attestation Receipts (SAR-402)** around paid
[x402](https://x402.org) actions.

> **Doctrine.** Capability ≠ Authority. Authority ≠ Execution. Execution ≠
> Verification. Verification must leave evidence. DefaultVerifier records
> evidence — it does not execute your API, authorize delivery, custody funds, or
> control resource release. **Verified restraint is the product.**

## Packages

| Package | Status | What it does |
| --- | --- | --- |
| [`@defaultsettlement/sar-402`](packages/sar-402) | Phase 1 | Node/TypeScript Express middleware that lets an x402 resource server emit a Settlement Attestation Receipt after a paid action, with a live Explorer link — without giving Default Settlement control over the API, funds, authorization, or delivery logic. |

See [`packages/sar-402/README.md`](packages/sar-402/README.md) for install and usage.

## Repo layout

```
packages/sar-402/      # @defaultsettlement/sar-402 (Phase 1)
reports/sdk/           # design + implementation reports
tsconfig.base.json     # shared TypeScript compiler options
```

## License

[Apache-2.0](LICENSE).

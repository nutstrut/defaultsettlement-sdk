# VIC + SAR composition fixture (SAR side)

This is the **SAR side** of the VIC + SAR composition agreed in
[x402 issue #1195](https://github.com/x402-foundation/x402/issues/1195). It pairs a
real on-chain **VIC** (Verifiable Invoice Commitment) with a **SAR-402** Settlement
Attestation Receipt through the additive `_ext.invoice` envelope.

The VIC side lives in
[`javierpmateos/verifiable-invoice-commitment/fixtures/sar-composition`](https://github.com/javierpmateos/verifiable-invoice-commitment/tree/main/fixtures/sar-composition).
This directory holds the SAR receipt that references it.

## Layer separation (doctrine)

Neither layer subsumes the other. The composed pair is a **cross-layer audit
artifact**, not a single super-receipt.

- **VIC is authoritative** for: the invoice, the tax breakdown, the fiscal
  jurisdiction, the commitment, and the payment reference.
- **SAR is authoritative** for: **delivery proof only** — that the paid resource
  was delivered (`http_response` evidence, status code, digest, timestamp).
- `_ext.invoice.payment_tx_ref` is an **audit-link field**. It lets an auditor join
  the SAR receipt to the VIC commitment; it is not a SAR-issued claim about the
  payment.

SAR explicitly does **not** claim, and this fixture must never be read as claiming:
fiscal semantics, invoice verification, tax verification, payment execution, access
authorization, resource-release control, or legal finality. Those either belong to
VIC or to no layer here at all.

## Files

- `receipt-with-vic-ext.json` — a SAR-402 receipt whose `_ext.invoice` envelope
  references the VIC commitment. Delivery evidence only on the SAR side.
- `ext-invoice.json` — the drop-in `_ext.invoice` payload, copied verbatim from the
  upstream VIC fixture. This is exactly what is embedded into the receipt above.
- `commitment-data.json` — the upstream VIC on-chain commitment data (tx hashes,
  Arbiscan links, parties). Included so the verification flow below can be replayed
  from this repo. VIC remains authoritative for its contents.

## The `_ext.invoice` shape

```json
{
  "_ext": {
    "invoice": {
      "schema_id": "vic.invoice.v1",
      "invoice_hash": "0xad9cfdcbd843098786ad0f84068c8810246706e1ffaa1969bba83948352dea2c",
      "chain_id": 421614,
      "registrar": "0xa8C5b7D5B413297343ca6CeCe3931F9770D7A2FD",
      "payment_tx_ref": "0x7e9480557acd0eeebb416e683d01f0524b1e313d8e09abbb9866d5e78b245381"
    }
  }
}
```

`_ext` is an **additive** envelope: it sits alongside the canonical
`sar_402_settlement_v0.1` fields and changes none of them. A SAR verifier that does
not understand VIC ignores `_ext` and still validates the receipt as a normal
delivery attestation.

## Verification flow (cross-layer audit)

This is the replayable audit trail. SAR and VIC are verified **independently** and
then joined on the audit-link field — neither layer is trusted to vouch for the
other.

1. **Read the SAR receipt.** Validate `receipt-with-vic-ext.json` as a SAR-402
   receipt (schema, authority binding, delivery evidence). The SAR layer attests
   only that the resource was delivered.
2. **Extract `_ext.invoice`** from the receipt. This is the audit link into the VIC
   layer — not a SAR claim about the invoice.
3. **Verify the VIC commitment independently**, using `chain_id`, `registrar`, and
   `invoice_hash` — directly against the chain, not via the SAR receipt:

   ```bash
   # Is a VIC commitment registered for this invoiceHash?
   cast call 0xa8C5b7D5B413297343ca6CeCe3931F9770D7A2FD \
     "isCommitted(bytes32)(bool)" \
     0xad9cfdcbd843098786ad0f84068c8810246706e1ffaa1969bba83948352dea2c \
     --rpc-url https://sepolia-rollup.arbitrum.io/rpc
   # Expected: true
   ```

4. **Confirm the payment reference matches.** Check that the VIC commitment's
   `paymentTxRef` equals the SAR receipt's `_ext.invoice.payment_tx_ref`
   (`0x7e9480557acd0eeebb416e683d01f0524b1e313d8e09abbb9866d5e78b245381`). The same
   value also appears as the SAR `payment.payment_ref`, which is how the delivery
   evidence and the invoice commitment are joined.
5. **Treat the result as a composed cross-layer audit fixture.** A passing SAR
   delivery attestation plus an independently verified VIC commitment, joined on a
   matching payment reference — not one receipt that proves everything. A tax
   authority or compliance layer can replay steps 1–4 without trusting either
   issuer to speak for the other.

## On-chain reference (VIC side, for convenience)

| Property | Value |
|----------|-------|
| Chain | Arbitrum Sepolia (`chain_id` 421614) |
| VIC registrar | `0xa8C5b7D5B413297343ca6CeCe3931F9770D7A2FD` |
| Invoice hash | `0xad9cfdcbd843098786ad0f84068c8810246706e1ffaa1969bba83948352dea2c` |
| Payment tx | `0x7e9480557acd0eeebb416e683d01f0524b1e313d8e09abbb9866d5e78b245381` |

Full party, tax, and transaction detail lives in `commitment-data.json` and in the
upstream VIC fixture. SAR does not restate or vouch for those fiscal facts.

## References

- VIC + SAR composition discussion: [x402 issue #1195](https://github.com/x402-foundation/x402/issues/1195)
- Upstream VIC fixture: [verifiable-invoice-commitment/fixtures/sar-composition](https://github.com/javierpmateos/verifiable-invoice-commitment/tree/main/fixtures/sar-composition)
- SAR-402 SDK: [`@defaultsettlement/sar-402`](../../README.md)

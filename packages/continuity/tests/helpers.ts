import { generateEd25519KeyPair } from '../src/signing.js'

/** A valid sha256 action_ref for tests. */
export const ACTION_REF = 'sha256:' + 'a'.repeat(64)
export const OTHER_ACTION_REF = 'sha256:' + 'b'.repeat(64)

/** A stable evaluator/executor keypair pair for tests. */
export function keypair() {
  return generateEd25519KeyPair()
}

/** A SAR-402-shaped delivery receipt fixture carrying the operation binding. */
export function sarReceipt(actionRef: string): Record<string, unknown> {
  return {
    schema_id: 'sar_402_settlement_v0.1',
    profile: 'sar-402',
    sar_type: 'Settlement Attestation Receipt',
    sar_verdict: 'PASS',
    delivery_state: 'confirmed',
    settlement_state: 'delivered',
    _ext: {
      operation_binding: {
        schema_id: 'ds.operation_binding.v0.1',
        action_ref: actionRef,
      },
    },
  }
}

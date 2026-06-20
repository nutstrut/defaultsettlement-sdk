/**
 * Opt-in integration test against a live DefaultVerifier.
 *
 * Skipped by default. It runs only when SAR402_INTEGRATION=1 is set, and it does
 * NOT hit the network during a normal `npm test`. Configure with:
 *
 *   SAR402_INTEGRATION=1 \
 *   SAR402_ENDPOINT=https://defaultverifier.com \
 *   SAR402_API_KEY=... \
 *   npm run test:integration
 */
import { describe, it, expect } from 'vitest'
import { DefaultVerifierClient, buildSar402Payload } from '../src/index.js'
import { samplePaymentContext } from './helpers.js'

const RUN = process.env.SAR402_INTEGRATION === '1'

describe.skipIf(!RUN)('live DefaultVerifier integration', () => {
  it('submits a receipt and returns metadata', async () => {
    const client = new DefaultVerifierClient({
      endpoint: process.env.SAR402_ENDPOINT,
      apiKey: process.env.SAR402_API_KEY,
      timeoutMs: 10000,
    })
    const payload = buildSar402Payload(
      samplePaymentContext(),
      {
        deliveredResource: samplePaymentContext().resource,
        evidenceType: 'http_response',
        statusCode: 200,
        deliveredAt: new Date().toISOString(),
        failed: false,
      },
      { mode: 'record', environment: 'test' },
    )
    const result = await client.submit(payload, 'record')
    expect(result.ok).toBe(true)
    // eslint-disable-next-line no-console
    console.log('receipt:', result.receiptId, result.explorerUrl)
  })
})

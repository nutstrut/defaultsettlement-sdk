import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The integration test is opt-in (guarded by SAR402_INTEGRATION) and skips
    // itself by default; it never hits a live DefaultVerifier during `npm test`.
  },
})

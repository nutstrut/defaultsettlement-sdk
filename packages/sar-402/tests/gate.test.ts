import { describe, it, expect } from 'vitest'
import { sar402, GateModeUnsupportedError, Sar402ConfigError } from '../src/index.js'

describe('gate mode is rejected (Phase 1)', () => {
  it('throws GateModeUnsupportedError when mode is gate', () => {
    expect(() => sar402({ mode: 'gate' as unknown as 'observe' })).toThrow(GateModeUnsupportedError)
  })

  it('GateModeUnsupportedError is a config error and explains the boundary', () => {
    try {
      sar402({ mode: 'gate' as unknown as 'observe' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(Sar402ConfigError)
      expect((err as Error).message).toMatch(/gate mode is not supported/i)
      expect((err as Error).message).toMatch(/execution authority/i)
    }
  })

  it('rejects unknown modes too', () => {
    expect(() => sar402({ mode: 'audit' as unknown as 'observe' })).toThrow(Sar402ConfigError)
  })
})

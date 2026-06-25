import { describe, it, expect } from 'vitest'
import { checkBindingAssertionVersion } from '../src/index.js'

describe('verifier-side monotonicity', () => {
  it('a fetched version equal to the previous passes', () => {
    expect(checkBindingAssertionVersion(3, 3)).toEqual({ ok: true })
  })

  it('a fetched version greater than the previous passes', () => {
    expect(checkBindingAssertionVersion(4, 3)).toEqual({ ok: true })
  })

  it('a fetched version lower than the previous returns binding_document_downgrade', () => {
    const result = checkBindingAssertionVersion(2, 3)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe('binding_document_downgrade')
      expect(result.fetched_version).toBe(2)
      expect(result.previously_accepted_version).toBe(3)
    }
  })

  it('an absent previous version passes', () => {
    expect(checkBindingAssertionVersion(1)).toEqual({ ok: true })
  })
})

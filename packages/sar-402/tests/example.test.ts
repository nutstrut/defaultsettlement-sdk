/**
 * Proves the published example compiles against the public type surface.
 * Runs `tsc --noEmit` over tsconfig.examples.json (which maps the package name
 * to ./src). Type-only — no server is started.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
// Resolve tsc even when hoisted to the workspace root node_modules.
const tscBin = createRequire(import.meta.url).resolve('typescript/bin/tsc')

describe('example compiles', () => {
  it('examples/express-url-summary.ts typechecks', () => {
    let ok = true
    let output = ''
    try {
      execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.examples.json'], {
        cwd: pkgRoot,
        stdio: 'pipe',
      })
    } catch (err) {
      ok = false
      output = String((err as { stdout?: Buffer }).stdout ?? (err as Error).message)
    }
    expect(ok, output).toBe(true)
  }, 60000)
})

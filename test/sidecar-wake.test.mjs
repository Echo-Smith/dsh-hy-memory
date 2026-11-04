import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

// Needs the real virtualenv this machine already installed; CI has none, so it
// skips there rather than pretending to pass.
const realVenv = join(homedir(), '.dsh', 'integrations', 'hy-memory', 'venv')
const python = join(realVenv, 'bin', 'python')

test('a stopped sidecar can be started again before the old child exits', { skip: !existsSync(python) }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'hy-wake-test-'))
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'integrations', 'hy-memory'), { recursive: true })
  symlinkSync(realVenv, join(home, 'integrations', 'hy-memory', 'venv'), 'dir')

  const { Sidecar } = await import('../src/sidecar.js')
  const sidecar = new Sidecar({
    settings: () => ({ mode: 'lite', embedding: { mode: 'local' }, sidecar: { idleStopMs: 61_000, prewarm: false } }),
    getRoute: () => null,
    emit: () => {},
  })
  try {
    await sidecar.ensureStarted()
    assert.equal(sidecar.status().state, 'ready')
    sidecar.stop()
    assert.equal(sidecar.status().state, 'idle')
    // The old child's exit lands asynchronously; a wake-up must survive it.
    await new Promise((resolve) => setTimeout(resolve, 150))
    const started = Date.now()
    await sidecar.ensureStarted()
    assert.equal(sidecar.status().state, 'ready')
    assert.ok(Date.now() - started < 20_000, 'the wake-up finishes in seconds')
  } finally {
    sidecar.stop()
    rmSync(home, { recursive: true, force: true })
  }
})

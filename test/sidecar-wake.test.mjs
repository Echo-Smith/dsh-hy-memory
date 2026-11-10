import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

// Needs the real virtualenv this machine already installed; CI has none, so it
// skips there rather than pretending to pass.
const realVenv = join(homedir(), '.dsh', 'integrations', 'hy-memory', 'venv')
const python = join(realVenv, 'bin', 'python')
// A venv that exists but cannot import the SDK (a bare CI runner, for one)
// would spawn a bridge that dies; only run where a usable one is installed.
const usable = (() => {
  if (!existsSync(python)) return false
  try {
    return spawnSync(python, ['-c', 'import hy_memory'], { timeout: 10_000 }).status === 0
  } catch {
    return false
  }
})()

test('a stopped sidecar can be started again before the old child exits', { skip: !usable }, async () => {
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

test('a missing route retries instead of latching the sidecar into idle+error', { skip: !usable }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'hy-startretry-'))
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'integrations', 'hy-memory'), { recursive: true })
  symlinkSync(realVenv, join(home, 'integrations', 'hy-memory', 'venv'), 'dir')

  const { Sidecar } = await import('../src/sidecar.js')
  let attempts = 0
  const sidecar = new Sidecar({
    settings: () => ({ mode: 'pro', llm: { source: 'dsh', provider: '', model: '' }, sidecar: { idleStopMs: 0, prewarm: false } }),
    getRoute: () => { attempts += 1; return null }, // no route at all
    emit: () => {},
  })
  try {
    await sidecar.ensureStarted().catch(() => {})
    assert.equal(sidecar.status().state, 'starting', 'the state stays starting, not idle/failed')
    assert.match(sidecar.status().lastError, /No OpenAI-compatible provider/, 'the reason is recorded')
  } finally {
    sidecar.stop()
    rmSync(home, { recursive: true, force: true })
  }
})

test('plugin shutdown never deletes the data directory', async () => {
  // Removing the plugin must not destroy the user's memories: the data lives
  // outside the package on purpose, and uninstalling is reversible by design.
  const sources = ['index.js', 'src/sidecar.js', 'src/paths.js']
  for (const file of sources) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(text, /rm(?:Sync)?\(\s*integrationDir\(\)/, `${file} must not remove the integration directory`)
    assert.doesNotMatch(text, /rm(?:Sync)?\(\s*dataDir\(\)/, `${file} must not remove the data directory`)
  }
})

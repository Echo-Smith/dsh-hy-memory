#!/usr/bin/env node
/**
 * End-to-end idle-stop and wake benchmark for the sidecar.
 *
 * Runs against a throwaway DSH_HOME that borrows the real virtualenv, so the
 * live app and its store are untouched. The idle window is the shortest the
 * sidecar accepts (61s), which is why this script takes about two minutes.
 *
 *   node scripts/bench-wake.mjs [--idle-ms 61000]
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const idleArg = args.indexOf('--idle-ms')
const idleMs = idleArg >= 0 ? Number(args[idleArg + 1]) : 61_000

const home = mkdtempSync(join(tmpdir(), 'hy-wake-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'integrations', 'hy-memory'), { recursive: true })
const realVenv = join(homedir(), '.dsh', 'integrations', 'hy-memory', 'venv')
symlinkSync(realVenv, join(home, 'integrations', 'hy-memory', 'venv'), 'dir')

const { Sidecar } = await import('../src/sidecar.js')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const settings = { mode: 'lite', embedding: { mode: 'local' }, sidecar: { idleStopMs: idleMs, prewarm: false } }
const events = []
const sidecar = new Sidecar({
  settings: () => settings,
  getRoute: () => null,
  emit: (event) => {
    if (event?.type === 'sidecar') events.push({ state: event.state, at: Date.now() })
  },
})

console.log('cold start: spawning')
const watchdog = setTimeout(() => {
  console.log('watchdog: status =', JSON.stringify(sidecar.status()))
  sidecar.stop()
  process.exit(3)
}, 240_000)
watchdog.unref?.()
try {
  const coldStart = Date.now()
  await sidecar.ensureStarted()
  const coldMs = Date.now() - coldStart
  console.log(`cold start: ${coldMs} ms -> ${sidecar.status().state}`)

  const idleStart = Date.now()
  let lastLog = 0
  while (sidecar.status().state !== 'idle' && Date.now() - idleStart < idleMs + 120_000) {
    await sleep(500)
    if (Date.now() - lastLog > 10_000) {
      lastLog = Date.now()
      console.log(`idle wait: ${Date.now() - idleStart} ms, state ${sidecar.status().state}`)
    }
  }
  const idleAfter = Date.now() - idleStart
  console.log(`idle stop observed after ${idleAfter} ms -> ${sidecar.status().state}`)

  const wakeStart = Date.now()
  await sidecar.ensureStarted()
  const wakeMs = Date.now() - wakeStart
  console.log(`wake: ${wakeMs} ms -> ${sidecar.status().state}`)
  console.log(`cold start and wake differ by ${wakeMs - coldMs} ms`)
} catch (error) {
  try {
    const { readFileSync } = await import('node:fs')
    const { logPath } = await import('../src/paths.js')
    const log = readFileSync(logPath(), 'utf8').trim().split('\n').slice(-8).join('\n')
    console.error('sidecar log tail:\n' + log)
  } catch {}
  console.error(`kept ${home} for inspection`)
  process.exitCode = 1
} finally {
  sidecar.stop()
  if (process.exitCode !== 1) rmSync(home, { recursive: true, force: true })
}

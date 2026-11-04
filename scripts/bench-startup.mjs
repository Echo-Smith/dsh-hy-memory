#!/usr/bin/env node
/**
 * Cold start benchmark for the sidecar.
 *
 * Spawns the bridge against a scratch data directory and reports how long it
 * takes to answer /healthz and the first bridge call. Nothing here touches the
 * live store: MEMORY_DATA_DIR points at a temporary directory.
 *
 *   node scripts/bench-startup.mjs [--runs 2]
 */

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const runsArg = args.indexOf('--runs')
const runs = runsArg >= 0 ? Number(args[runsArg + 1]) : 2
const VENV = join(process.env.DSH_HOME ?? `${process.env.HOME}/.dsh`, 'integrations', 'hy-memory', 'venv', 'bin', 'python')
const BRIDGE = new URL('../bridge/hy_bridge.py', import.meta.url).pathname

async function waitHealthy(port, deadlineMs) {
  const started = Date.now()
  while (Date.now() - started < deadlineMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(800) })
      if (response.ok) return Date.now() - started
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`sidecar not healthy within ${deadlineMs} ms`)
}

function freePort() {
  return new Promise((resolve, reject) => {
    import('node:net').then(({ createServer }) => {
      const server = createServer()
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port
        server.close(() => resolve(port))
      })
      server.on('error', reject)
    })
  })
}

for (let run = 1; run <= runs; run += 1) {
  const dataDir = mkdtempSync(join(tmpdir(), 'hy-bench-'))
  const port = await freePort()
  const started = Date.now()
  const child = spawn(VENV, [BRIDGE, '--port', String(port)], {
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      MEMORY_MODE: process.env.MEMORY_MODE ?? 'lite',
      MEMORY_DATA_DIR: dataDir,
      MEMORY_LOG_LEVEL: 'WARNING',
      MEMORY_EMBEDDING_DIMS: '384',
      HY_MEMORY_LOCAL_EMBED: '1',
      HY_MEMORY_SERVER_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderrTail = ''
  child.stderr.on('data', (chunk) => { stderrTail += String(chunk) })
  const healthyMs = await waitHealthy(port, 240_000)
  const healthAt = Date.now()
  const listStart = Date.now()
  let rows = 0
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/bridge/v1/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_ids: ['bench'], scene: 'all', limit: 1 }),
    })
    if (response.ok) { rows = 1; break }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  const firstCallMs = Date.now() - listStart
  const totalMs = Date.now() - started
  child.kill('SIGTERM')
  console.log(`run ${run}: spawn->healthy ${healthyMs} ms, first bridge call ${firstCallMs} ms, total ${totalMs} ms, health at ${healthAt - started} ms, bridge call ok=${rows === 1}`)
  if (stderrTail.trim()) console.log(`  stderr: ${stderrTail.trim().split('\n').slice(-2).join(' | ').slice(0, 200)}`)
}

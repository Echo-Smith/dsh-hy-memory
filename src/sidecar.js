import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir, integrationDir, logPath, venvDir } from './paths.js'
import { buildModelEnv } from './model.js'
import { MemoryClient } from './client.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const BRIDGE = join(HERE, '..', 'bridge', 'hy_bridge.py')
const SDK_PACKAGE = process.env.HY_MEMORY_SDK_PACKAGE || 'hy-memory'
const SDK_VERSION = process.env.HY_MEMORY_SDK_VERSION || '2.0.13'
const IS_WINDOWS = process.platform === 'win32'

export class Sidecar {
  #settings
  #getRoute
  #emit
  #child = null
  #port = 0
  #state = 'idle'
  #lastError = ''
  #startedAt = 0
  #startPromise = null
  #idleTimer = null
  #restarts = 0
  #logTail = []

  constructor({ settings, getRoute, emit = () => {} }) {
    this.#settings = settings
    this.#getRoute = getRoute
    this.#emit = emit
  }

  get client() {
    if (!this.#port) return null
    return new MemoryClient({ port: this.#port })
  }

  status() {
    return {
      state: this.#state,
      port: this.#port,
      pid: this.#child?.pid ?? 0,
      startedAt: this.#startedAt,
      lastError: this.#lastError,
      restarts: this.#restarts,
      logTail: this.#logTail.slice(-40),
      venvReady: existsSync(venvPython()),
    }
  }

  #set(state, error = '') {
    this.#state = state
    if (error) this.#lastError = error
    this.#emit({ type: 'sidecar', state, error, port: this.#port, at: Date.now() })
  }

  #log(chunk) {
    const text = String(chunk)
    this.#logTail.push(text.trimEnd())
    if (this.#logTail.length > 200) this.#logTail.shift()
    appendFile(logPath(), text).catch(() => {})
  }

  async ensureVenv() {
    const python = venvPython()
    if (existsSync(python)) return python
    this.#set('installing')
    await mkdir(integrationDir(), { recursive: true })
    const uv = await findUv()
    const log = (text) => this.#log(`${text}\n`)
    if (uv) {
      await run(uv, ['venv', '--python', '3.12', venvDir()], log)
      await run(uv, ['pip', 'install', '--python', python, `${SDK_PACKAGE}==${SDK_VERSION}`], log)
    } else {
      const fallback = await findSystemPython()
      if (!fallback) {
        throw new Error(
          'Hy-Memory needs Python 3.12 and no usable interpreter was found. Install uv (https://docs.astral.sh/uv/) or Python 3.12, then retry.',
        )
      }
      await run(fallback, ['-m', 'venv', venvDir()], log)
      await run(python, ['-m', 'pip', 'install', '--upgrade', 'pip'], log)
      await run(python, ['-m', 'pip', 'install', `${SDK_PACKAGE}==${SDK_VERSION}`], log)
    }
    await writeFile(join(integrationDir(), 'state.json'), JSON.stringify({ sdkVersion: SDK_VERSION, installedAt: new Date().toISOString() }, null, 2))
    this.#set('idle')
    return python
  }

  /** Start (or return) a healthy sidecar. Concurrent callers share one start attempt. */
  async ensureStarted() {
    if (this.#state === 'ready' && this.#child && this.#child.exitCode === null) {
      this.#touch()
      return this.client
    }
    if (this.#startPromise) return this.#startPromise
    this.#startPromise = this.#start().finally(() => { this.#startPromise = null })
    return this.#startPromise
  }

  async #start() {
    try {
      const python = await this.ensureVenv()
      if (!existsSync(BRIDGE)) throw new Error(`sidecar bridge missing at ${BRIDGE}`)
      this.#port = await freePort()
      const settings = this.#settings()
      const route = this.#getRoute()
      const mode = settings.mode === 'lite' || settings.mode === 'ultra' ? settings.mode : 'pro'
      if (!route && mode !== 'lite') {
        throw new Error('No OpenAI-compatible provider found in this DSH profile. Configure a model, or switch memory to lite mode.')
      }
      const env = {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        MEMORY_MODE: mode,
        MEMORY_DATA_DIR: dataDir(),
        MEMORY_LOG_LEVEL: 'WARNING',
        MEMORY_EMBEDDER_TIMEOUT: '30',
        // Gateway models default to a thinking channel; the SDK's reconcile prompt
        // expects plain JSON and gets an empty string when thinking is on.
        HY_MEMORY_THINKING_MODE: settings.llm?.thinking === 'enabled' ? 'enabled' : 'disabled',
        HY_MEMORY_SERVER_PORT: String(this.#port),
        ...buildModelEnv(route, settings),
      }
      if (settings.language && settings.language !== 'auto') env.MEMORY_LANGUAGE = settings.language
      if (settings.embedding?.mode === 'remote') {
        env.HY_MEMORY_LOCAL_EMBED = '0'
        if (settings.embedding.baseURL) env.MEMORY_EMBEDDER_BASE_URL = settings.embedding.baseURL
        if (settings.embedding.model) env.MEMORY_EMBEDDER_MODEL = settings.embedding.model
        if (settings.embedding.apiKey) env.MEMORY_EMBEDDER_API_KEY = settings.embedding.apiKey
        if (settings.embedding.dims) env.MEMORY_EMBEDDING_DIMS = String(settings.embedding.dims)
      } else {
        env.HY_MEMORY_LOCAL_EMBED = '1'
        env.MEMORY_EMBEDDING_DIMS = '384'
      }
      await mkdir(dirname(logPath()), { recursive: true })
      this.#set('starting')
      this.#child = spawn(python, [BRIDGE, '--port', String(this.#port)], { env, stdio: ['ignore', 'pipe', 'pipe'] })
      this.#child.stdout.on('data', (chunk) => this.#log(chunk))
      this.#child.stderr.on('data', (chunk) => this.#log(chunk))
      this.#child.on('exit', (code, signal) => this.#onExit(code, signal))
      await this.#waitHealthy()
      this.#startedAt = Date.now()
      this.#restarts = 0
      this.#set('ready')
      this.#touch()
      return this.client
    } catch (error) {
      this.#lastError = error?.message ?? String(error)
      this.#set('failed', this.#lastError)
      this.stop()
      throw error
    }
  }

  async #waitHealthy() {
    const deadline = Date.now() + 240_000
    const client = new MemoryClient({ port: this.#port })
    let attempt = 0
    while (Date.now() < deadline) {
      attempt += 1
      if (this.#child?.exitCode !== null) {
        throw new Error(`sidecar exited during startup (code ${this.#child?.exitCode}); see ${logPath()}`)
      }
      try {
        await client.healthz()
        return
      } catch {
        if (attempt % 40 === 0) this.#emit({ type: 'sidecar', state: 'starting', detail: `still starting after ${Math.round((Date.now() - (deadline - 240_000)) / 1000)}s` })
        await sleep(500)
      }
    }
    throw new Error(`sidecar did not become healthy within 240s; see ${logPath()}`)
  }

  #onExit(code, signal) {
    if (this.#state === 'stopping' || this.#state === 'idle') return
    this.#lastError = `sidecar exited (code ${code ?? 'null'} signal ${signal ?? 'none'})`
    this.#set('failed', this.#lastError)
    this.#child = null
    this.#port = 0
  }

  #touch() {
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    const idleMs = this.#settings().sidecar?.idleStopMs ?? 1_800_000
    if (!idleMs || idleMs < 60_000) return
    this.#idleTimer = setTimeout(() => this.stop(), idleMs)
    this.#idleTimer.unref?.()
  }

  stop() {
    if (this.#idleTimer) { clearTimeout(this.#idleTimer); this.#idleTimer = null }
    this.#state = 'stopping'
    const child = this.#child
    this.#child = null
    this.#port = 0
    if (child && child.exitCode === null) {
      try { child.kill('SIGTERM') } catch {}
      setTimeout(() => { try { if (child.exitCode === null) child.kill('SIGKILL') } catch {} }, 5000).unref?.()
    }
    this.#set('idle')
  }
}

export function venvPython() {
  return IS_WINDOWS ? join(venvDir(), 'Scripts', 'python.exe') : join(venvDir(), 'bin', 'python')
}

async function findUv() {
  const candidates = [process.env.UV, join(homedir(), '.local', 'bin', 'uv'), '/opt/homebrew/bin/uv', '/usr/local/bin/uv', join(homedir(), '.cargo', 'bin', 'uv')]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    } catch {}
  }
  try {
    await run('uv', ['--version'], () => {})
    return 'uv'
  } catch {
    return null
  }
}

async function findSystemPython() {
  for (const candidate of ['python3.12', 'python3.13', 'python3.11', 'python3']) {
    try {
      const output = await runCapture(candidate, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'])
      const [major, minor] = output.trim().split('.').map(Number)
      if (major === 3 && minor >= 11) return candidate
    } catch {}
  }
  return null
}

function run(command, args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => onLine(chunk))
    child.stderr.on('data', (chunk) => onLine(chunk))
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))))
  })
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(err || `${command} exited with ${code}`))))
  })
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('could not allocate a port'))))
    })
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function readState() {
  try {
    return JSON.parse(await readFile(join(integrationDir(), 'state.json'), 'utf8'))
  } catch {
    return {}
  }
}

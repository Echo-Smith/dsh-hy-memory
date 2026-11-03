/**
 * MemHub link: read-only detection of the MemHub product at `~/.one-memory`,
 * export of our own store, import into the personal tier, and a read-only pull
 * from MemHub's own Hy-Memory store.
 *
 * Guards from CONTRACT.md ("MemHub link (addendum)"):
 * - nothing here writes under `~/.one-memory`; detection only stats files and
 *   the pull script copies the source store to a temp dir before reading it;
 * - imports always land in the personal tier;
 * - dedupe state lives in `state.json` under `memhub.importedHashes`;
 * - at most 500 entries are imported per call, 20k hashes are retained;
 * - every public operation records exactly one activity event and never throws
 *   from anywhere but its own returned promise.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { integrationDir, venvDir } from './paths.js'
import { normalizeItem, resolveUser, writeScope } from './tiers.js'
import { MemoryRequestError, MemoryUnavailableError } from './tools.js'

/** Fixed by bridge/hy_bridge.py: the local ONNX MiniLM embedder is 384-dim. */
export const LOCAL_EMBEDDING_DIMS = 384
/** One import call never writes more than this many entries. */
export const MAX_IMPORT_ENTRIES = 500
/** Retained content hashes; the oldest are dropped past this. */
export const MAX_IMPORT_HASHES = 20_000

const EXPORT_PAGE = 200
const EXPORT_CAP = 10_000
const PULL_LIMIT = MAX_IMPORT_ENTRIES
const PULL_TIMEOUT_MS = 180_000
const IS_WINDOWS = process.platform === 'win32'
const HERE = dirname(fileURLToPath(import.meta.url))
const PULL_SCRIPT = join(HERE, '..', 'bridge', 'memhub_pull.py')
const EMPTY_HASHES = Object.freeze([])

const ERROR_STATUS = Object.freeze({
  memhub_not_detected: 404,
  memhub_unavailable: 503,
  memhub_locked: 409,
  embedding_mismatch: 409,
  venv_missing: 503,
  import_missing: 404,
  import_invalid: 400,
  import_unreadable: 400,
})

export class MemHubError extends MemoryRequestError {
  constructor(code, message, status = ERROR_STATUS[code] ?? 400, details = undefined) {
    super(message, code)
    this.name = 'MemHubError'
    this.status = status
    if (details !== undefined) this.details = details
  }
}

/** `~/.one-memory`, or `$ONE_MEMORY_HOME` when the user moved it. */
export function memhubHome() {
  const configured = process.env.ONE_MEMORY_HOME
  return configured && configured.trim() ? configured.trim() : join(homedir(), '.one-memory')
}

/** The venv interpreter that has hy_memory installed (see src/paths.js). */
export function venvPythonPath() {
  return IS_WINDOWS ? join(venvDir(), 'Scripts', 'python.exe') : join(venvDir(), 'bin', 'python')
}

function isDir(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function fileBytes(path) {
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

/**
 * Sum file sizes below `dir`, one directory level deep and bounded by an
 * entry budget. Status polls call this, so it must never recurse a whole tree.
 */
function shallowBytes(dir, depth = 0, budget = { left: 512 }) {
  if (budget.left <= 0) return 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    if (budget.left <= 0) break
    budget.left -= 1
    const path = join(dir, entry.name)
    if (entry.isFile()) total += fileBytes(path)
    else if (entry.isDirectory() && depth === 0) total += shallowBytes(path, 1, budget)
  }
  return total
}

/**
 * MemHub keeps its Hy-Memory data under `<home>/hy-memory`. Version 1.0.5 nests
 * a `governed-v2` generation with explicit config paths (`vector/chroma.sqlite3`,
 * `cache.sqlite3`, ...); a plain `MEMORY_DATA_DIR` store would live directly in
 * the same root with the SDK's `data/vector_db` layout. Both are detected.
 */
export function detectHyMemoryStore(home = memhubHome()) {
  const base = join(home, 'hy-memory')
  const roots = [join(base, 'governed-v2'), base]
  for (const root of roots) {
    for (const [layout, vector] of [['memhub', join(root, 'vector')], ['sdk', join(root, 'data', 'vector_db')]]) {
      if (isFile(join(vector, 'chroma.sqlite3'))) {
        return { present: true, path: root, layout, vector, bytes: shallowBytes(root) }
      }
    }
  }
  return { present: isDir(base), path: base, layout: '', vector: '', bytes: 0 }
}

/**
 * Cheap, read-only MemHub detection for the status route. Never throws: an
 * absent, unreadable or half-installed MemHub simply reports `detected: false`.
 */
export function detectMemHub({ home = memhubHome() } = {}) {
  const empty = {
    detected: false,
    path: typeof home === 'string' ? home : '',
    sizeBytes: 0,
    stores: {},
  }
  try {
    if (!isDir(home)) return empty
    const controlPath = join(home, 'one-memory.sqlite3')
    const control = {
      path: controlPath,
      present: isFile(controlPath),
      bytes: fileBytes(controlPath) + fileBytes(`${controlPath}-wal`) + fileBytes(`${controlPath}-shm`),
    }
    const hyMemory = detectHyMemoryStore(home)
    if (!control.present && !hyMemory.present) return { ...empty, stores: { control, hyMemory } }
    return {
      detected: true,
      path: home,
      sizeBytes: shallowBytes(home) + (hyMemory.present ? shallowBytes(hyMemory.path) : 0),
      stores: { control, hyMemory },
    }
  } catch {
    return empty
  }
}

/** Whitespace-normalized content: the dedupe key must survive formatting churn. */
export function normalizeContent(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim()
}

export function hashContent(value) {
  return createHash('sha256').update(normalizeContent(value)).digest('hex')
}

/** The embedding dimension our own sidecar writes with, or 0 when unknown. */
export function expectedEmbeddingDims(settings) {
  const embedding = settings?.embedding ?? {}
  if (embedding.mode === 'remote') {
    const dims = Number(embedding.dims)
    return Number.isFinite(dims) && dims > 0 ? Math.trunc(dims) : 0
  }
  return LOCAL_EMBEDDING_DIMS
}

/** Milliseconds from either seconds or milliseconds, matching tiers.toMillis. */
function millisOf(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.round(numeric < 1e12 ? numeric * 1000 : numeric)
}

function statusFor(code) {
  return ERROR_STATUS[code] ?? 502
}

function lastJsonObject(text) {
  const lines = String(text ?? '').trim().split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line.startsWith('{')) continue
    try {
      return JSON.parse(line)
    } catch {}
  }
  return null
}

function entriesOf(parsed) {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) return parsed.items
  throw new MemHubError(
    'import_invalid',
    'the file must be a JSON array of memories or an export object with an items array',
    400,
  )
}

/**
 * Run bridge/memhub_pull.py with the venv interpreter. Resolves to the array of
 * `{ content, tags?, createdAt? }` entries, or rejects with a mapped MemHubError:
 * `embedding_mismatch`, `memhub_locked`, `memhub_not_detected`, `venv_missing`,
 * `pull_failed`. The script owns every read; this function only transports JSON.
 */
export function runPullProcess({
  python,
  script = PULL_SCRIPT,
  home,
  storePath,
  expectDims = 0,
  limit = PULL_LIMIT,
  timeoutMs = PULL_TIMEOUT_MS,
  spawnImpl = spawn,
}) {
  const args = [script, '--one-memory-home', home, '--data-dir', storePath, '--limit', String(limit)]
  if (expectDims > 0) args.push('--expect-dims', String(expectDims))
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnImpl(python, args, {
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(new MemHubError('venv_missing', `could not run ${python}: ${error?.message ?? error}`, 503))
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (settle, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      settle(value)
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {}
      finish(reject, new MemHubError('pull_failed', `memhub_pull.py timed out after ${timeoutMs}ms`, 502))
    }, timeoutMs)
    timer.unref?.()
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      finish(reject, new MemHubError('venv_missing', `could not run ${python}: ${error?.message ?? error}`, 503))
    })
    child.on('close', (code) => {
      if (code !== 0) {
        const parsed = lastJsonObject(stderr)
        const errorCode = typeof parsed?.error === 'string' ? parsed.error : 'pull_failed'
        const tail = stderr.trim().split('\n').pop() || `memhub_pull.py exited with ${code}`
        const message = typeof parsed?.message === 'string' ? parsed.message : tail
        finish(reject, new MemHubError(errorCode, message, statusFor(errorCode), parsed?.details))
        return
      }
      try {
        const payload = JSON.parse(stdout.trim() || '[]')
        const entries = Array.isArray(payload) ? payload : Array.isArray(payload?.memories) ? payload.memories : null
        if (!entries) throw new Error('expected a JSON array')
        finish(resolve, entries)
      } catch (error) {
        finish(reject, new MemHubError('pull_failed', `memhub_pull.py printed invalid JSON: ${error?.message ?? error}`, 502))
      }
    })
  })
}

/** Resolve and read one import source without modifying it. */
async function resolveImportPath(path) {
  if (typeof path === 'string' && path.trim()) return path.trim()
  const dir = join(integrationDir(), 'exports')
  let names
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json'))
  } catch {
    names = []
  }
  if (names.length === 0) {
    throw new MemHubError('import_missing', 'pass { path } to a JSON export; no exports exist yet', 400)
  }
  names.sort()
  return join(dir, names[names.length - 1])
}

export function createMemHub(deps = {}) {
  const settings = deps.settings ?? (() => ({}))
  const state = deps.state ?? null
  const activity = deps.activity ?? null
  const getClient = deps.getClient ?? (() => null)
  const ensureClient = deps.ensureClient ?? getClient
  const log = deps.log ?? (() => {})
  const now = deps.now ?? (() => new Date())
  const runPull = deps.runPull ?? runPullProcess
  const pythonPath = deps.pythonPath ?? venvPythonPath

  function resolveHome() {
    return deps.home ?? memhubHome()
  }

  function record(event) {
    try {
      activity?.record(event)
    } catch {}
  }

  /** Persisted `memhub.importedHashes`, created lazily so older state files load. */
  function importedHashes() {
    const data = state?.data
    if (!data || typeof data !== 'object') return null
    if (!data.memhub || typeof data.memhub !== 'object' || Array.isArray(data.memhub)) data.memhub = {}
    if (!Array.isArray(data.memhub.importedHashes)) data.memhub.importedHashes = []
    return data.memhub.importedHashes
  }

  async function persistState() {
    try {
      state?.save?.()
    } catch {}
    try {
      if (typeof state?.flush === 'function') await state.flush()
    } catch {}
  }

  /** Write one memory into the personal tier through the sidecar. */
  async function writePersonal({ content, createdAt } = {}) {
    const client = await ensureClient()
    if (!client) throw new MemoryUnavailableError()
    const payload = {
      data: [{ role: 'user', content }],
      ...writeScope('personal', { settings: settings() }),
      scene: 'chat',
    }
    // The SDK's add() takes historical timestamps through memory_at; the export
    // and MemHub pull both carry createdAt, so a round trip keeps recency.
    if (Number.isFinite(createdAt) && createdAt > 0) payload.memory_at = new Date(createdAt).toISOString()
    const result = await client.add(payload, { timeoutMs: 240_000 })
    if (result?.success === false) {
      throw new MemoryRequestError(
        String(result?.agent_error_code ?? result?.error_code ?? 'memory write failed'),
        'write_failed',
      )
    }
    return result
  }

  async function doExport() {
    const client = await ensureClient()
    if (!client) throw new MemoryUnavailableError()
    if (typeof client.bridgeList !== 'function') {
      throw new MemoryRequestError('memory bridge routes are unavailable; update the Hy-Memory sidecar', 'bridge_unavailable')
    }
    const user = resolveUser(settings())
    const items = []
    let scanned = 0
    let offset = 0
    while (scanned < EXPORT_CAP) {
      const limit = Math.min(EXPORT_PAGE, EXPORT_CAP - scanned)
      const response = await client.bridgeList({
        user_ids: [user],
        scene: 'all',
        limit,
        offset,
        order: 'desc',
      })
      const page = Array.isArray(response?.memories) ? response.memories : []
      if (page.length === 0) break
      for (const raw of page) {
        const normalized = normalizeItem(raw)
        if (!normalized.content.trim()) continue
        const entry = {
          id: normalized.id,
          content: normalized.content,
          tags: normalized.tags,
          createdAt: normalized.createdAt,
          updatedAt: normalized.updatedAt,
        }
        entry.scene = typeof raw?.scene === 'string' && raw.scene ? raw.scene : 'chat'
        items.push(entry)
      }
      scanned += page.length
      offset += page.length
      const total = Number(response?.total)
      if (Number.isFinite(total) && offset >= total) break
      if (page.length < limit) break
    }
    const exportedAt = now().toISOString()
    const file = { version: 1, source: 'dsh-hy-memory', exportedAt, count: items.length, items }
    const body = `${JSON.stringify(file, null, 2)}\n`
    const dir = join(integrationDir(), 'exports')
    await mkdir(dir, { recursive: true })
    const path = join(dir, `hy-memory-${exportedAt.replace(/[:.]/gu, '-')}.json`)
    const temp = `${path}.${process.pid}.tmp`
    await writeFile(temp, body, 'utf8')
    await rename(temp, path)
    return { path, count: items.length, bytes: Buffer.byteLength(body) }
  }

  async function importEntries(entries, { path } = {}) {
    const hashes = importedHashes()
    const known = new Set(hashes ?? EMPTY_HASHES)
    const all = Array.isArray(entries) ? entries : []
    const batch = all.slice(0, MAX_IMPORT_ENTRIES)
    let imported = 0
    let skipped = all.length - batch.length
    let failed = 0
    for (const raw of batch) {
      const text = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? raw.content : ''
      const content = normalizeContent(text)
      if (!content) {
        skipped += 1
        continue
      }
      const hash = hashContent(content)
      if (known.has(hash)) {
        skipped += 1
        continue
      }
      try {
        await writePersonal({ content, createdAt: millisOf(raw && raw.createdAt) })
        imported += 1
        known.add(hash)
        hashes?.push(hash)
      } catch (error) {
        failed += 1
        log('MemHub import write failed', error)
      }
    }
    if (hashes && hashes.length > MAX_IMPORT_HASHES) hashes.splice(0, hashes.length - MAX_IMPORT_HASHES)
    await persistState()
    return { imported, skipped, failed, path: path ?? '' }
  }

  async function exportOurs() {
    try {
      const result = await doExport()
      record({
        kind: 'capture',
        summary: `exported ${result.count} memories for MemHub`,
        detail: basename(result.path),
        ok: true,
      })
      return result
    } catch (error) {
      record({ kind: 'error', summary: 'MemHub export failed', detail: String(error?.message ?? error), ok: false })
      throw error
    }
  }

  async function importFile({ path } = {}) {
    try {
      const target = await resolveImportPath(path)
      let parsed
      try {
        parsed = JSON.parse(await readFile(target, 'utf8'))
      } catch (error) {
        if (error?.code === 'ENOENT') throw new MemHubError('import_missing', `no file at ${target}`, 404)
        if (error instanceof MemHubError) throw error
        throw new MemHubError('import_invalid', `${target} is not valid JSON`, 400)
      }
      const result = await importEntries(entriesOf(parsed), { path: target })
      record({
        kind: 'capture',
        tier: 'personal',
        summary: `imported ${result.imported} memories from a file`,
        detail: basename(target),
        ok: true,
      })
      return result
    } catch (error) {
      record({
        kind: 'error',
        summary: 'MemHub import failed',
        detail: `${error?.code ?? 'error'}: ${String(error?.message ?? error)}`,
        ok: false,
      })
      throw error
    }
  }

  async function pull() {
    try {
      const home = resolveHome()
      const detection = detectMemHub({ home })
      if (!detection.detected) {
        throw new MemHubError('memhub_not_detected', `MemHub is not installed at ${home}`, 404)
      }
      const store = detection.stores.hyMemory
      if (!store?.present) {
        throw new MemHubError('memhub_not_detected', `MemHub has no Hy-Memory store under ${join(home, 'hy-memory')}`, 404)
      }
      const python = pythonPath()
      if (!existsSync(python)) {
        throw new MemHubError(
          'venv_missing',
          'the Hy-Memory Python environment is not installed yet; open Settings > Memory and start the sidecar first',
          503,
        )
      }
      const entries = await runPull({
        python,
        script: PULL_SCRIPT,
        home,
        storePath: store.path,
        expectDims: expectedEmbeddingDims(settings()),
        limit: PULL_LIMIT,
        timeoutMs: PULL_TIMEOUT_MS,
      })
      if (!Array.isArray(entries)) {
        throw new MemHubError('pull_failed', 'memhub_pull.py did not return an entry array', 502)
      }
      const result = await importEntries(entries, { path: store.path })
      record({
        kind: 'capture',
        tier: 'personal',
        summary: `pulled ${result.imported} memories from MemHub`,
        detail: `${entries.length} read, ${result.skipped} skipped, ${result.failed} failed`,
        ok: true,
      })
      return {
        ...result,
        path: store.path,
        source: { store: store.path, layout: store.layout, entries: entries.length },
      }
    } catch (error) {
      record({
        kind: 'error',
        summary: 'MemHub pull failed',
        detail: `${error?.code ?? 'error'}: ${String(error?.message ?? error)}`,
        ok: false,
      })
      throw error
    }
  }

  return { detect: () => detectMemHub({ home: resolveHome() }), exportOurs, importFile, pull }
}

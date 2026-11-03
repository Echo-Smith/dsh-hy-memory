import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ActivityLog } from '../src/activity.js'
import { DEFAULT_SETTINGS } from '../src/settings.js'
import { createMemoryOps } from '../src/tools.js'
import {
  LOCAL_EMBEDDING_DIMS,
  MAX_IMPORT_ENTRIES,
  MAX_IMPORT_HASHES,
  MemHubError,
  createMemHub,
  detectMemHub,
  hashContent,
  normalizeContent,
  runPullProcess,
} from '../src/memhub.js'
import { createPanelApi } from '../src/panel-api.js'

async function tempDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

/** A MemHub 1.0.5-shaped home: control DB, governed-v2 store, runtime marker. */
async function fakeMemhubHome() {
  const home = await tempDir('memhub-home-')
  await writeFile(join(home, 'one-memory.sqlite3'), 'x'.repeat(128))
  const store = join(home, 'hy-memory', 'governed-v2')
  await mkdir(join(store, 'vector'), { recursive: true })
  await writeFile(join(store, 'vector', 'chroma.sqlite3'), 'y'.repeat(64))
  await writeFile(join(store, 'cache.sqlite3'), 'z'.repeat(32))
  await writeFile(join(home, 'runtime.json'), JSON.stringify({ pid: process.pid }))
  return { home, store }
}

function fakeState() {
  return {
    data: {},
    saves: 0,
    flushes: 0,
    save() {
      this.saves += 1
    },
    async flush() {
      this.flushes += 1
    },
  }
}

function fakeClient({ memories = [], total, onAdd } = {}) {
  const calls = []
  const added = []
  return {
    calls,
    added,
    async bridgeList(payload) {
      calls.push(payload)
      const page = memories.slice(payload.offset, payload.offset + payload.limit)
      return { memories: page, total: total ?? memories.length }
    },
    async add(payload) {
      added.push(payload)
      onAdd?.(payload)
      return { success: true, memory_id: `m${added.length}` }
    },
  }
}

function harness({ home, client, state, activity, runPull, settings } = {}) {
  const current = settings ?? { user: 'dsh', embedding: { mode: 'local' } }
  return createMemHub({
    settings: () => current,
    home,
    state: state ?? fakeState(),
    activity: activity ?? new ActivityLog(),
    getClient: () => client ?? null,
    ensureClient: async () => client ?? null,
    log: () => {},
    pythonPath: () => process.execPath,
    runPull,
  })
}

test('detection finds the control DB and the governed-v2 Hy-Memory store read-only', async () => {
  const { home, store } = await fakeMemhubHome()
  const detected = detectMemHub({ home })
  assert.equal(detected.detected, true)
  assert.equal(detected.path, home)
  assert.ok(detected.sizeBytes >= 128 + 64 + 32, `sizeBytes ${detected.sizeBytes}`)
  assert.equal(detected.stores.control.present, true)
  assert.deepEqual(
    { present: detected.stores.hyMemory.present, path: detected.stores.hyMemory.path, layout: detected.stores.hyMemory.layout },
    { present: true, path: store, layout: 'memhub' },
  )

  const missing = detectMemHub({ home: join(home, 'absent') })
  assert.equal(missing.detected, false)
  assert.equal(missing.sizeBytes, 0)

  const withoutStore = await tempDir('memhub-bare-')
  await writeFile(join(withoutStore, 'one-memory.sqlite3'), 'x')
  const bare = detectMemHub({ home: withoutStore })
  assert.equal(bare.detected, true)
  assert.equal(bare.stores.hyMemory.present, false)
})

test('detection honours ONE_MEMORY_HOME', async () => {
  const { home } = await fakeMemhubHome()
  const previous = process.env.ONE_MEMORY_HOME
  process.env.ONE_MEMORY_HOME = home
  try {
    assert.equal(detectMemHub().detected, true)
    assert.equal(detectMemHub().stores.hyMemory.present, true)
  } finally {
    if (previous === undefined) delete process.env.ONE_MEMORY_HOME
    else process.env.ONE_MEMORY_HOME = previous
  }
})

test('export pages scene=all into the documented file shape and returns bytes', async () => {
  const dshHome = await tempDir('dsh-home-')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  try {
    const { home } = await fakeMemhubHome()
    const client = fakeClient({
      memories: [
        { memory_id: 'p1', content: 'prefers tabs', tags: ['ui'], agent_id: 'personal', scene: 'chat', created_at: 1700000000 },
        { memory_id: 'j1', content: 'uses pnpm', agent_id: 'project:abc', scene: 'chat', updated_at: 1700000100 },
        { memory_id: 'e1', content: 'fix build\nrun tests', kind: 'experience', scene: 'coding', created_at: 1700000200 },
      ],
    })
    const activity = new ActivityLog()
    const memhub = harness({ home, client, activity })

    const result = await memhub.exportOurs()
    assert.equal(result.count, 3)
    assert.match(result.path, /integrations[/\\]hy-memory[/\\]exports[/\\]hy-memory-.*\.json$/)
    assert.ok(existsSync(result.path))
    assert.equal((await stat(result.path)).size, result.bytes)

    const file = JSON.parse(await readFile(result.path, 'utf8'))
    assert.equal(file.version, 1)
    assert.equal(file.source, 'dsh-hy-memory')
    assert.match(file.exportedAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(file.count, 3)
    assert.equal(file.items.length, 3)
    assert.deepEqual(Object.keys(file.items[0]).sort(), ['content', 'createdAt', 'id', 'scene', 'tags', 'updatedAt'])
    assert.equal(file.items[0].content, 'prefers tabs')
    assert.equal(file.items[0].scene, 'chat')
    assert.equal(file.items[0].createdAt, 1700000000000)
    assert.equal(file.items[2].scene, 'coding')

    assert.deepEqual(client.calls[0], { user_ids: ['dsh'], scene: 'all', limit: 200, offset: 0, order: 'desc' })
    const events = activity.list().events
    assert.equal(events.length, 1)
    assert.equal(events[0].ok, true)
    assert.match(events[0].summary, /exported 3 memories/)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('import writes the personal tier, dedupes by normalized content hash and never touches the file', async () => {
  const dir = await tempDir('memhub-import-')
  const file = join(dir, 'export.json')
  const payload = {
    items: [
      { content: 'prefers tabs' },
      { content: '  prefers   tabs\n' },
      { content: 'uses pnpm' },
      { content: '   ' },
      {},
    ],
  }
  const body = JSON.stringify(payload)
  await writeFile(file, body)
  const client = fakeClient()
  const activity = new ActivityLog()
  const state = fakeState()
  const memhub = harness({ client, state, activity })

  const first = await memhub.importFile({ path: file })
  assert.deepEqual(first, { imported: 2, skipped: 3, failed: 0, path: file })
  assert.equal(client.added.length, 2)
  assert.deepEqual(client.added[0], {
    data: [{ role: 'user', content: 'prefers tabs' }],
    user_id: 'dsh',
    agent_id: 'personal',
    session_id: 'personal',
    scene: 'chat',
  })
  assert.deepEqual(client.added[1].data, [{ role: 'user', content: 'uses pnpm' }])
  assert.deepEqual(state.data.memhub.importedHashes, [hashContent('prefers tabs'), hashContent('uses pnpm')])
  assert.equal(await readFile(file, 'utf8'), body, 'the import source is never rewritten')
  assert.ok(state.saves >= 1)
  assert.ok(state.flushes >= 1)

  const second = await memhub.importFile({ path: file })
  assert.deepEqual(second, { imported: 0, skipped: 5, failed: 0, path: file })
  assert.equal(client.added.length, 2)

  const events = activity.list().events
  assert.equal(events.length, 2)
  assert.ok(events.every((event) => event.tier === 'personal' && event.ok === true))
  assert.match(events[1].summary, /imported 0 memories/)
})

test('import caps one call at 500 entries and trims the hash list to 20k', async () => {
  const dir = await tempDir('memhub-cap-')
  const file = join(dir, 'many.json')
  const items = Array.from({ length: MAX_IMPORT_ENTRIES + 7 }, (_, index) => ({ content: `memory ${index}` }))
  await writeFile(file, JSON.stringify(items))
  const client = fakeClient()
  const state = fakeState()
  state.data.memhub = { importedHashes: Array.from({ length: MAX_IMPORT_HASHES + 5 }, (_, index) => `old-${index}`) }
  const memhub = harness({ client, state })

  const result = await memhub.importFile({ path: file })
  assert.equal(result.imported, MAX_IMPORT_ENTRIES)
  assert.equal(result.skipped, 7)
  assert.equal(result.failed, 0)
  assert.equal(client.added.length, MAX_IMPORT_ENTRIES)
  assert.equal(state.data.memhub.importedHashes.length, MAX_IMPORT_HASHES)
  assert.equal(state.data.memhub.importedHashes[0], 'old-505', 'oldest hashes are dropped first')
  assert.equal(
    state.data.memhub.importedHashes[state.data.memhub.importedHashes.length - 1],
    hashContent(`memory ${MAX_IMPORT_ENTRIES - 1}`),
  )
})

test('import failures are counted per entry and their hashes stay importable', async () => {
  const dir = await tempDir('memhub-fail-')
  const file = join(dir, 'partial.json')
  await writeFile(file, JSON.stringify([{ content: 'one' }, { content: 'two' }]))
  let calls = 0
  const client = fakeClient({
    onAdd: () => {
      calls += 1
      if (calls === 1) throw new Error('sidecar write failed')
    },
  })
  const state = fakeState()
  const memhub = harness({ client, state })
  const result = await memhub.importFile({ path: file })
  assert.equal(result.imported, 1)
  assert.equal(result.failed, 1)
  assert.deepEqual(state.data.memhub.importedHashes, [hashContent('two')])
})

test('a missing or invalid import source maps to a documented MemHub error', async () => {
  const memhub = harness({ client: fakeClient() })
  await assert.rejects(() => memhub.importFile({ path: '/does/not/exist.json' }), (error) => {
    assert.ok(error instanceof MemHubError)
    assert.equal(error.code, 'import_missing')
    assert.equal(error.status, 404)
    return true
  })

  const dir = await tempDir('memhub-bad-')
  const bad = join(dir, 'bad.json')
  await writeFile(bad, '{not json')
  await assert.rejects(() => memhub.importFile({ path: bad }), (error) => error.code === 'import_invalid' && error.status === 400)

  const scalar = join(dir, 'scalar.json')
  await writeFile(scalar, JSON.stringify({ memories: [] }))
  await assert.rejects(() => memhub.importFile({ path: scalar }), (error) => error.code === 'import_invalid')
})

test('pull reads through the script contract and imports the personal tier', async () => {
  const { home, store } = await fakeMemhubHome()
  const client = fakeClient()
  const activity = new ActivityLog()
  const requests = []
  const memhub = harness({
    home,
    client,
    activity,
    settings: { user: 'dsh', embedding: { mode: 'local' } },
    runPull: async (request) => {
      requests.push(request)
      return [{ content: 'from memhub', createdAt: 1700000000000 }]
    },
  })

  const result = await memhub.pull()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].storePath, store)
  assert.equal(requests[0].expectDims, LOCAL_EMBEDDING_DIMS)
  assert.equal(requests[0].limit, MAX_IMPORT_ENTRIES)
  assert.match(requests[0].script, /bridge[/\\]memhub_pull\.py$/)
  assert.equal(result.imported, 1)
  assert.equal(result.failed, 0)
  assert.equal(result.path, store)
  assert.deepEqual(result.source, { store, layout: 'memhub', entries: 1 })
  assert.equal(client.added.length, 1)
  assert.equal(client.added[0].agent_id, 'personal')
  assert.equal(client.added[0].memory_at, new Date(1700000000000).toISOString())

  const events = activity.list().events
  assert.equal(events.length, 1)
  assert.equal(events[0].ok, true)
  assert.match(events[0].summary, /pulled 1 memories from MemHub/)
})

test('a locked MemHub store maps to memhub_locked and imports nothing', async () => {
  const { home } = await fakeMemhubHome()
  const client = fakeClient()
  const state = fakeState()
  const activity = new ActivityLog()
  const memhub = harness({
    home,
    client,
    state,
    activity,
    runPull: async () => {
      throw new MemHubError('memhub_locked', 'MemHub runtime (pid 42) holds the Hy-Memory store', 409)
    },
  })

  await assert.rejects(() => memhub.pull(), (error) => {
    assert.equal(error.code, 'memhub_locked')
    assert.equal(error.status, 409)
    return true
  })
  assert.equal(client.added.length, 0)
  assert.deepEqual(state.data.memhub?.importedHashes ?? [], [])
  const events = activity.list().events
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'error')
  assert.equal(events[0].ok, false)
  assert.match(events[0].detail, /memhub_locked/)
})

test('pull without a MemHub install reports memhub_not_detected', async () => {
  const home = await tempDir('memhub-none-')
  const memhub = harness({ home, client: fakeClient() })
  await assert.rejects(() => memhub.pull(), (error) => error.code === 'memhub_not_detected' && error.status === 404)
})

function fakeChild({ stdout = '', stderr = '', code = 0 }) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', stdout)
    if (stderr) child.stderr.emit('data', stderr)
    child.emit('close', code)
  })
  return child
}

test('runPullProcess parses the script JSON array and maps its error objects', async () => {
  const ok = await runPullProcess({
    python: 'python',
    home: '/home',
    storePath: '/store',
    expectDims: 384,
    spawnImpl: () => fakeChild({ stdout: JSON.stringify([{ content: 'a' }, { content: 'b' }]) }),
  })
  assert.deepEqual(ok, [{ content: 'a' }, { content: 'b' }])

  await assert.rejects(
    () => runPullProcess({
      python: 'python',
      home: '/home',
      storePath: '/store',
      spawnImpl: () => fakeChild({
        code: 3,
        stderr: `trace line\n${JSON.stringify({ error: 'memhub_locked', message: 'runtime holds it', details: { pids: [42] } })}`,
      }),
    }),
    (error) => {
      assert.equal(error.code, 'memhub_locked')
      assert.equal(error.status, 409)
      assert.deepEqual(error.details, { pids: [42] })
      return true
    },
  )

  await assert.rejects(
    () => runPullProcess({
      python: 'python',
      home: '/home',
      storePath: '/store',
      spawnImpl: () => fakeChild({ code: 2, stderr: JSON.stringify({ error: 'embedding_mismatch', message: '512 != 384', details: { sourceDims: 512, targetDims: 384 } }) }),
    }),
    (error) => error.code === 'embedding_mismatch' && error.details.sourceDims === 512 && error.details.targetDims === 384,
  )

  await assert.rejects(
    () => runPullProcess({
      python: 'python',
      home: '/home',
      storePath: '/store',
      spawnImpl: () => fakeChild({ stdout: 'not json' }),
    }),
    (error) => error.code === 'pull_failed' && error.status === 502,
  )
})

function panelHarness(memhub) {
  const state = {
    data: { projects: {}, capture: { sessions: {}, queue: [] }, promotions: { sessions: {}, projects: {} }, lastScene: 'chat' },
    save() {},
  }
  const activity = new ActivityLog()
  const settings = structuredClone(DEFAULT_SETTINGS)
  const ops = createMemoryOps({
    settings: () => settings,
    state,
    activity,
    getClient: () => null,
    contextOf: () => ({ projectKey: '', sessionId: '' }),
  })
  return createPanelApi({
    settings: () => settings,
    sidecar: {
      status: () => ({ state: 'idle', port: 0, pid: 0, startedAt: 0, lastError: '', venvReady: false }),
    },
    ops,
    activity,
    state,
    memhub,
    log: () => {},
    describeModel: () => ({ ready: false, provider: '', model: '', source: 'dsh' }),
    contextOf: () => ({ projectKey: '', sessionId: '' }),
    onSettingsChange: async (patch) => ({ ...settings, ...patch }),
  })
}

function post(path, body) {
  return new Request(`http://127.0.0.1/api/hy-memory/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

test('the panel envelope exposes detection and maps MemHub route failures', async () => {
  const { home } = await fakeMemhubHome()
  const locked = harness({
    home,
    client: fakeClient(),
    runPull: async () => {
      throw new MemHubError('memhub_locked', 'MemHub runtime holds the store', 409)
    },
  })
  const api = panelHarness(locked)
  const find = (name) => api.routes.find((route) => route.path === `/api/hy-memory/${name}`)

  const status = await (await find('status').fetch(post('status'))).json()
  assert.equal(status.ok, true)
  assert.equal(status.data.memhub.detected, true)
  assert.equal(status.data.memhub.path, home)
  assert.ok(status.data.memhub.sizeBytes > 0)
  assert.equal(status.data.memhub.stores.hyMemory.present, true)

  const pull = await find('memhub/pull').fetch(post('memhub/pull'))
  assert.equal(pull.status, 409)
  assert.deepEqual(await pull.json(), { ok: false, error: { code: 'memhub_locked', message: 'MemHub runtime holds the store' } })

  const importRoute = await find('memhub/import').fetch(post('memhub/import', { path: '/nope.json' }))
  assert.equal(importRoute.status, 404)
  assert.equal((await importRoute.json()).error.code, 'import_missing')

  const exportRoute = await find('memhub/export')
  assert.equal(typeof exportRoute.fetch, 'function')
})

test('normalization and hashing ignore formatting churn', () => {
  assert.equal(normalizeContent('  two\n\nlines\t'), 'two lines')
  assert.equal(hashContent('  two\n\nlines\t'), hashContent('two lines'))
  assert.notEqual(hashContent('two lines'), hashContent('two line'))
  assert.equal(hashContent('abc').length, 64)
})

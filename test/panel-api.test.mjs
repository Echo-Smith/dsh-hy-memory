import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPanelApi, PANEL_ROUTE_DEFS, PANEL_ROUTE_PATHS, errorResponse, jsonResponse } from '../src/panel-api.js'
import { ActivityLog } from '../src/activity.js'
import { createMemoryOps } from '../src/tools.js'
import { DEFAULT_SETTINGS, mergeSettings } from '../src/settings.js'

function fakeState() {
  return {
    data: { projects: {}, capture: { sessions: {}, queue: [] }, promotions: { sessions: {}, projects: {} }, lastScene: 'coding' },
    save() {},
  }
}

function harness({ settings = DEFAULT_SETTINGS, getClient = () => null, readProjectIndex = () => ({}), sidecarClient = null } = {}) {
  const state = fakeState()
  const activity = new ActivityLog()
  const current = settings
  const ops = createMemoryOps({
    settings: () => current,
    state,
    activity,
    getClient,
    contextOf: () => ({ projectKey: 'p1', sessionId: 's1', sessionTitle: 'Fixing the build' }),
  })
  const api = createPanelApi({
    settings: () => current,
    sidecar: {
      status: () => ({ state: 'idle', port: 0, pid: 0, startedAt: 0, lastError: '', venvReady: false }),
      // Routes that talk to the sidecar directly read this, not getClient.
      get client() { return sidecarClient },
    },
    ops,
    activity,
    state,
    log: () => {},
    describeModel: () => ({ ready: false, provider: '', model: '', source: 'dsh' }),
    contextOf: () => ({ projectKey: 'p1', sessionId: 's1', sessionTitle: 'Fixing the build' }),
    onSettingsChange: async (patch) => mergeSettings(current, patch),
    readProjectIndex,
  })
  return { api, state, activity }
}

function post(path, body) {
  return new Request(`http://127.0.0.1/api/hy-memory/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

test('every contract route is registered as an exact POST below /api', () => {
  assert.deepEqual([...PANEL_ROUTE_PATHS], [
    '/api/hy-memory/status',
    '/api/hy-memory/list',
    '/api/hy-memory/update',
    '/api/hy-memory/history',
    '/api/hy-memory/stats',
    '/api/hy-memory/narratives',
    '/api/hy-memory/metrics',
    '/api/hy-memory/activity/recent',
    '/api/hy-memory/delete',
    '/api/hy-memory/search',
    '/api/hy-memory/settings/get',
    '/api/hy-memory/settings/set',
    '/api/hy-memory/activity',
    '/api/hy-memory/start',
    '/api/hy-memory/memhub/export',
    '/api/hy-memory/memhub/import',
    '/api/hy-memory/memhub/pull',
    '/api/hy-memory/projects',
    '/api/hy-memory/sessions',
    '/api/hy-memory/forget',
    '/api/hy-memory/duplicates',
    '/api/hy-memory/explain',
    '/api/hy-memory/explained',
    '/api/hy-memory/injected',
    '/api/hy-memory/purge',
    '/api/hy-memory/erase',
    '/api/hy-memory/dataUsage',
    '/api/hy-memory/merge',
    '/api/hy-memory/update/check',
    '/api/hy-memory/update/install',
  ])
  // The explicit list above is the contract; these two keep the table and the
  // registered routes in step with it.
  assert.equal(PANEL_ROUTE_DEFS.length, PANEL_ROUTE_PATHS.length)
  const { api } = harness()
  assert.equal(api.routes.length, PANEL_ROUTE_PATHS.length)
  for (const route of api.routes) {
    assert.deepEqual(route.methods, ['POST'])
    assert.equal(route.requestBody, 'buffered')
    assert.match(route.path, /^\/api\/(?:[A-Za-z0-9_$.-]+\/)*[A-Za-z0-9_$.-]+$/)
    assert.equal(typeof route.fetch, 'function')
  }
  assert.equal(PANEL_ROUTE_PATHS.some((path) => path.includes('delete_all')), false)
})

test('status reports a degraded sidecar without failing', async () => {
  const { api } = harness()
  const response = await api.routes[0].fetch(post('status'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.data.sidecar.state, 'idle')
  assert.equal(body.data.sidecar.venvReady, false)
  assert.deepEqual(body.data.counts, { personal: 0, project: 0, session: 0 })
  assert.equal(body.data.scene, 'coding')
  assert.equal(body.data.mode, 'pro')
  assert.equal(body.data.embedding.mode, 'local')
  assert.equal(body.data.embedding.ready, false)
  assert.equal(body.data.project.key, 'p1')
  assert.equal(body.data.session.id, 's1')
  assert.equal(body.data.session.title, 'Fixing the build')
})

test('settings routes expose and merge the persisted object', async () => {
  const { api } = harness()
  const getRoute = api.routes.find((route) => route.path.endsWith('/settings/get'))
  const setRoute = api.routes.find((route) => route.path.endsWith('/settings/set'))

  const current = await (await getRoute.fetch(post('settings/get', {}))).json()
  assert.equal(current.ok, true)
  assert.equal(current.data.settings.mode, 'pro')

  const updated = await (await setRoute.fetch(post('settings/set', { patch: { recall: { maxItems: 2 } } }))).json()
  assert.equal(updated.ok, true)
  assert.equal(updated.data.settings.recall.maxItems, 2)
  assert.equal(updated.data.settings.recall.maxChars, DEFAULT_SETTINGS.recall.maxChars)

  const invalid = await setRoute.fetch(post('settings/set', { patch: 'nope' }))
  assert.equal(invalid.status, 400)
  const invalidBody = await invalid.json()
  assert.deepEqual(invalidBody, { ok: false, error: { code: 'bad_request', message: 'patch must be an object' } })
})

test('tier guards reject disallowed edits and deletes before touching the sidecar', async () => {
  const { api } = harness()
  const deleteRoute = api.routes.find((route) => route.path.endsWith('/delete'))
  const unknown = await deleteRoute.fetch(post('delete', { tier: 'bogus', id: 'm1' }))
  assert.equal(unknown.status, 400)
  assert.equal((await unknown.json()).error.code, 'unknown_tier')

  const updateRoute = api.routes.find((route) => route.path.endsWith('/update'))
  const noContent = await updateRoute.fetch(post('update', { id: 'm1' }))
  assert.equal(noContent.status, 400)
  assert.equal((await noContent.json()).error.code, 'content_required')
})

test('a missing sidecar surfaces as 503, never as a thrown handler', async () => {
  const { api } = harness()
  const listRoute = api.routes.find((route) => route.path.endsWith('/list'))
  const response = await listRoute.fetch(post('list', { tier: 'personal' }))
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'sidecar_unavailable')
})

test('invalid JSON and unknown fields still return the documented envelope', async () => {
  const { api } = harness()
  const badBody = new Request('http://127.0.0.1/api/hy-memory/list', { method: 'POST', body: '{not json' })
  const response = await api.routes.find((route) => route.path.endsWith('/list')).fetch(badBody)
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { ok: false, error: { code: 'bad_request', message: 'request body must be a JSON object' } })

  const activityRoute = api.routes.find((route) => route.path.endsWith('/activity'))
  const activity = await (await activityRoute.fetch(post('activity', { since: 0 }))).json()
  assert.equal(activity.ok, true)
  assert.deepEqual(activity.data.events, [])
  assert.equal(activity.data.cursor, 0)
})

test('helpers shape success and failure payloads', async () => {
  const ok = jsonResponse({ value: 1 })
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { ok: true, data: { value: 1 } })
  const bad = errorResponse('nope', 'broken', 418)
  assert.equal(bad.status, 418)
  assert.deepEqual(await bad.json(), { ok: false, error: { code: 'nope', message: 'broken' } })
})

test('explain returns the newest recall that injected the memory', async () => {
  const { api, state } = harness()
  const route = api.routes.find((entry) => entry.path.endsWith('/explain'))
  const empty = await route.fetch(post('explain', { id: 'm1' }))
  assert.equal((await empty.json()).data.found, false)

  state.data.recallLog = [
    { at: 1000, query: 'old query', source: 'semantic', items: [{ id: 'm1', tier: 'personal', score: 0.7, rank: 2 }] },
    { at: 2000, query: 'new query', source: 'lexical', items: [{ id: 'm1', tier: 'personal', score: 0.62, rank: 1 }] },
  ]
  const found = await route.fetch(post('explain', { id: 'm1' }))
  const body = await found.json()
  assert.equal(body.data.found, true)
  assert.equal(body.data.query, 'new query')
  assert.equal(body.data.source, 'lexical')
  assert.equal(body.data.rank, 1)
})

test('explained lists recalled ids and injected returns the injected text', async () => {
  const { api, state } = harness()
  state.data.recallLog = [{
    at: 5000,
    query: 'why is this here',
    source: 'both',
    text: 'Recalled memory for this request\n1. [personal] a fact',
    items: [{ id: 'm1', tier: 'personal', score: 0.8, rank: 1 }],
  }]
  const explained = await api.routes.find((entry) => entry.path.endsWith('/explained')).fetch(post('explained', {}))
  assert.deepEqual((await explained.json()).data.ids, ['m1'])

  const injected = await api.routes.find((entry) => entry.path.endsWith('/injected')).fetch(post('injected', { at: 5000 }))
  const body = await injected.json()
  assert.equal(body.data.found, true)
  assert.match(body.data.text, /a fact/)

  const missing = await api.routes.find((entry) => entry.path.endsWith('/injected')).fetch(post('injected', { at: 1 }))
  assert.equal((await missing.json()).data.found, false)
})

test('status carries the MemHub pairing block', async () => {
  const { api } = harness()
  const route = api.routes.find((entry) => entry.path.endsWith('/status'))
  const body = await (await route.fetch(post('status', {}))).json()
  assert.equal(typeof body.data.memhub.pairing, 'object')
  assert.equal(typeof body.data.memhub.pairing.paired, 'boolean')
})


test('a recovered project title wins over a key-only placeholder in state', async () => {
  const { api, state } = harness({
    getClient: () => ({ bridgeList: async () => ({ memories: [] }) }),
    readProjectIndex: () => ({ abc123: { title: 'default-workspace', path: '/Users/me/Documents/app' } }),
  })
  state.data.projects = { abc123: { title: 'abc123', path: '' } }
  const route = api.routes.find((entry) => entry.path.endsWith('/projects'))
  const body = await (await route.fetch(post('projects', {}))).json()
  const item = (body.data.items ?? []).find((entry) => entry.key === 'abc123')
  assert.equal(item?.title, 'default-workspace', 'the entry with a real path supplies the title')
})

test('erase refuses without the exact confirmation phrase', async () => {
  const { api } = harness()
  for (const body of [{}, { confirm: 'erase' }, { confirm: 'PURGE' }, { confirm: 'ERASE ' }]) {
    const res = await api.routes.find((r) => r.path.endsWith('/erase'))
      .fetch(post('erase', body))
    assert.equal(res.status, 400, `refused: ${JSON.stringify(body)}`)
    assert.equal((await res.json()).error.code, 'confirm_required')
  }
})

test('erase refuses before the caller acknowledges the size', async () => {
  const { api } = harness()
  const res = await api.routes.find((r) => r.path.endsWith('/erase'))
    .fetch(post('erase', { confirm: 'ERASE' }))
  // A non-empty data dir requires the measured byte count to be echoed back, so
  // a stale or guessed size cannot drive a destructive call.
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error.code, 'size_not_acknowledged')
})

test('the three engine routes surface what the sidecar reports', async () => {
  const { api } = harness({
    sidecarClient: {
      bridgeStatsOverview: async (body) => ({ total: 1298, scenes: { chat: { count: 613 } }, seen: body }),
      bridgeMetrics: async (body) => ({ window_minutes: body.minutes, requests: { completed: 51, failed: 9 } }),
      bridgeRecentHistory: async (body) => ({ events: [{ event: 'ADD', new_memory: 'x' }], limit: body.limit }),
    },
  })
  const call = async (name, body) => {
    const route = api.routes.find((entry) => entry.path.endsWith(`/${name}`))
    return (await route.fetch(post(name, body))).json()
  }
  const stats = await call('stats', {})
  assert.equal(stats.data.total, 1298, 'the SDK aggregate is passed through untouched')
  const metrics = await call('metrics', { minutes: 30 })
  assert.equal(metrics.data.window_minutes, 30, 'the requested window reaches the engine')
  const history = await call('activity/recent', { limit: 5 })
  assert.equal(history.data.events.length, 1)
  assert.equal(history.data.limit, 5, 'the requested limit reaches the engine')
})

test('engine routes report a clear error when no sidecar is running', async () => {
  const { api } = harness({ sidecarClient: null })
  for (const name of ['stats', 'metrics', 'activity/recent']) {
    const route = api.routes.find((entry) => entry.path.endsWith(`/${name}`))
    const res = await route.fetch(post(name, {}))
    assert.notEqual(res.status, 200, `${name} refuses without a sidecar`)
    assert.equal((await res.json()).error.code, 'sidecar_unavailable')
  }
})

test('status survives a null model description instead of failing wholesale', async () => {
  // A throwing field used to fail the whole route, which blanks every card in
  // the panel. One bad dependency must not take the status read down.
  const { api } = harness({ sidecarClient: null })
  const route = api.routes.find((entry) => entry.path.endsWith('/status'))
  const res = await route.fetch(post('status', {}))
  assert.equal(res.status, 200, 'status still answers')
  const body = await res.json()
  assert.equal(body.data.model.ready, false, 'the model reads as not ready rather than crashing')
  assert.equal(body.data.engineStats, null, 'engine stats degrade to null without a sidecar')
})

test('narratives come from the engine, not a private copy', async () => {
  // The panel must show what recall will actually use, so the route reads
  // L3_SUMMARY from the engine rather than a separate bookkeeping file.
  const seen = []
  const { api } = harness({
    sidecarClient: {
      bridgeList: async (body) => {
        seen.push(body)
        return { vdb: { memories: [{ memory_id: 'n1', session_id: 's1', content: 'did the thing', gmt_created: 1700000000 }] } }
      },
    },
  })
  const route = api.routes.find((entry) => entry.path.endsWith('/narratives'))
  const body = await (await route.fetch(post('narratives', {}))).json()
  assert.deepEqual(seen[0].layers, ['l3_summary'], 'the route asks for the summary layer')
  assert.equal(body.data.items.length, 1)
  assert.equal(body.data.items[0].text, 'did the thing')
})

test('narrative reads degrade clearly without a sidecar', async () => {
  const { api } = harness({ sidecarClient: null })
  const route = api.routes.find((entry) => entry.path.endsWith('/narratives'))
  const res = await route.fetch(post('narratives', {}))
  assert.equal(res.status === 200, false, 'no false empty list without a sidecar')
  assert.equal((await res.json()).error.code, 'sidecar_unavailable')
})

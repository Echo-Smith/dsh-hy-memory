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

function harness({ settings = DEFAULT_SETTINGS, getClient = () => null } = {}) {
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
    },
    ops,
    activity,
    state,
    log: () => {},
    describeModel: () => ({ ready: false, provider: '', model: '', source: 'dsh' }),
    contextOf: () => ({ projectKey: 'p1', sessionId: 's1', sessionTitle: 'Fixing the build' }),
    onSettingsChange: async (patch) => mergeSettings(current, patch),
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
    '/api/hy-memory/update/check',
  ])
  assert.equal(PANEL_ROUTE_DEFS.length, 15)
  const { api } = harness()
  assert.equal(api.routes.length, 15)
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

import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply, inject, name } from '../index.js'
import { PANEL_ROUTE_PATHS } from '../src/panel-api.js'

function fakeContext() {
  const listeners = new Map()
  const disposers = []
  const registeredTools = []
  const panels = []

  const fakeScope = {
    connection: {
      fetch: {
        register(route) {
          panels.push(route)
          return async () => {}
        },
      },
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
  }

  const ctx = {
    logger: { warn() {}, info() {}, debug() {} },
    on(event, handler) {
      const list = listeners.get(event) ?? []
      list.push(handler)
      listeners.set(event, list)
      return () => listeners.set(event, list.filter((entry) => entry !== handler))
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    inject(services, callback) {
      assert.deepEqual(services, ['connection'])
      callback(fakeScope)
    },
    get() {
      return undefined
    },
    tools: {
      register(definition) {
        registeredTools.push(definition)
        return () => {}
      },
    },
  }

  return {
    ctx,
    listeners,
    panels,
    registeredTools,
    dispose() {
      for (const dispose of disposers.reverse()) {
        try {
          const result = dispose()
          if (result && typeof result.then === 'function') result.catch(() => {})
        } catch {}
      }
    },
  }
}

async function waitFor(check, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return check()
}

test('the host entry exports name, inject and apply', () => {
  assert.equal(name, 'hy-memory')
  assert.deepEqual(inject, ['tools', 'sessions', 'llm'])
  assert.equal(typeof apply, 'function')
})

test('apply writes the boot marker and wires tools, routes and listeners', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hy-memory-host-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const harness = fakeContext()
  try {
    assert.doesNotThrow(() => apply(harness.ctx, { enabled: true }))

    const markerPath = join(home, 'integrations', 'hy-memory', 'boot.json')
    assert.ok(existsSync(markerPath), 'boot marker is written synchronously')
    const marker = JSON.parse(await readFile(markerPath, 'utf8'))
    assert.equal(marker.pid, process.pid)
    assert.equal(marker.version, '0.1.0')
    assert.match(marker.at, /^\d{4}-\d{2}-\d{2}T/)
    assert.deepEqual(marker.routes, [...PANEL_ROUTE_PATHS])
    assert.deepEqual(marker.inject, ['tools', 'sessions', 'llm'])

    // Route count follows PANEL_ROUTE_PATHS; assert against it rather than a
    // literal so adding a route does not read as a regression.
    const wired = await waitFor(() => harness.registeredTools.length === 7 && harness.panels.length === PANEL_ROUTE_PATHS.length)
    assert.ok(wired, `expected 7 tools and ${PANEL_ROUTE_PATHS.length} routes, saw ${harness.registeredTools.length}/${harness.panels.length}`)
    assert.deepEqual(harness.registeredTools.map((tool) => tool.name).sort(), [
      'memory_add',
      'memory_delete',
      'memory_forget',
      'memory_get',
      'memory_list',
      'memory_search',
      'memory_update',
    ])
    for (const tool of harness.registeredTools) {
      assert.equal(tool.output.schema.type, 'string')
      assert.equal(typeof tool.output.render, 'function')
      assert.equal(tool.parameters.type, 'object')
    }
    assert.deepEqual(harness.panels.map((route) => route.path).sort(), [...PANEL_ROUTE_PATHS].sort())
    assert.deepEqual([...harness.listeners.keys()].sort(), ['agent/pre-step', 'session/disposed', 'session/event'])
  } finally {
    harness.dispose()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('listeners degrade quietly with no running sidecar', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hy-memory-host-silent-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const harness = fakeContext()
  try {
    apply(harness.ctx, {})
    await waitFor(() => harness.registeredTools.length === 7)

    const session = { id: 's1', header: { cwd: home }, title: 'demo' }
    for (const handler of harness.listeners.get('session/event')) {
      assert.doesNotThrow(() => handler(session, { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] } }))
      assert.doesNotThrow(() => handler(session, { seq: 2, type: 'turn/end', data: { turn: 1 } }))
    }
    for (const handler of harness.listeners.get('session/disposed')) {
      assert.doesNotThrow(() => handler(session))
    }

    const preStep = harness.listeners.get('agent/pre-step')[0]
    const captured = { kind: 'proceed', messages: [] }
    const decision = await preStep({ agent: { session }, messages: [], turn: 1, step: 1 }, async () => captured)
    assert.equal(decision, captured)
  } finally {
    harness.dispose()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

/**
 * Smoke harness for the Hy-Memory client half.
 *
 * Loads the committed `client.js` in a vm sandbox with a stubbed
 * `window.__ModuleLoader__` and a stubbed `fetch`, then calls the exported lazy
 * factory with a fake client context that records slot registrations. It asserts
 * the two surfaces the contract requires (settings section, optional session
 * pane), that no sidebar navigation row is contributed, and that the status
 * route is actually requested through the documented same-origin POST.
 *
 * It also mounts the settings section with a tiny hook-capable React stand-in so
 * the MemHub card and the poll isolation can be asserted against rendered
 * output: the card's three actions must issue the documented POSTs, and a 3 s
 * activity tick must re-render only the activity subtree.
 *
 * Run: node test/panel-smoke.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const clientPath = fileURLToPath(new URL('../client.js', import.meta.url))
const source = await readFile(clientPath, 'utf8')
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const STATUS = Object.freeze({
  enabled: true,
  sidecar: { state: 'ready', port: 4310, pid: 42, startedAt: 1, lastError: '', venvReady: true },
  model: {
    ready: true, provider: 'dsh', model: 'test-model', source: 'dsh',
    maxTokens: 4096, timeoutMs: 180000, disableReasoning: true,
    options: [{ provider: 'magpie', model: 'auto/glm-5.3-flash', label: 'auto/glm-5.3-flash · magpie' }],
  },
  recall: { halfLifeDays: 30 },
  captureSettings: { concurrency: 2, maxPerDrain: 8 },
  capture: { pending: 7 },
  counts: { personal: 2, project: 1, session: 3 },
  scene: 'chat',
  mode: 'pro',
  embedding: { mode: 'local', ready: true },
  project: { key: 'abcdef012345', path: '/tmp/work', title: 'Work' },
  session: { id: 'sess-a1b2c3d4', title: 'Testing' },
  dataDirSize: 4096,
  // Folded into status by the host; the card must render this verbatim.
  memhub: { detected: true, path: '/Users/test/.one-memory', sizeBytes: 20480 },
  package: { name: 'dsh-hy-memory', version: '0.1.0', repoUrl: 'https://github.com/example/hy-memory4dsh.git' },
  context: { memoryTokens: 120, memoryItems: 2, lastAt: 1, totalTokens: 3400, totalItems: 9 },
})

const PAGE_TOTAL = 45
const ACTIVITY_AT = 1700000000000
const INJECTED_TEXT = '## injected memory\nremember the release checklist'

const PERSONAL_ITEM = Object.freeze({
  id: 'm1',
  content: 'remember the release checklist',
  tier: 'personal',
  layer: 'core',
  status: 'active',
  tags: ['release'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const WORKSPACES = Object.freeze({
  items: [
    { key: 'abcdef012345', title: 'Work', path: '/tmp/work', projectCount: 2, sessionCount: 3 },
    { key: 'feedface0000', title: 'Side project', path: '/tmp/side', projectCount: 1, sessionCount: 0 },
  ],
  current: 'abcdef012345',
})

const SESSIONS = Object.freeze({
  projectKey: 'abcdef012345',
  current: 'sess-a1b2c3d4',
  items: [
    { sessionId: 'sess-a1b2c3d4', count: 1, updatedAt: Date.now(), sample: 'session note' },
    { sessionId: 'sess-9e8d7c6b', count: 1, updatedAt: Date.now() - 60000, sample: 'other note' },
  ],
})

const PROJECT_ITEM = Object.freeze({
  id: 'p1',
  content: 'project decision: keep the warm cache',
  tier: 'project',
  layer: 'core',
  status: 'active',
  tags: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  projectKey: 'abcdef012345',
})

const SESSION_ITEMS = Object.freeze([
  Object.freeze({
    id: 's1',
    content: 'session note: verify the rebuild',
    tier: 'session',
    layer: 'core',
    status: 'active',
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectKey: 'abcdef012345',
    sessionId: 'sess-a1b2c3d4',
  }),
  Object.freeze({
    id: 's2',
    content: 'other note: second session',
    tier: 'session',
    layer: 'core',
    status: 'active',
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now() - 60000,
    projectKey: 'abcdef012345',
    sessionId: 'sess-9e8d7c6b',
  }),
])

const MEMHUB_EXPORT = Object.freeze({ path: '/tmp/hy-memory-2026.json', count: 3, bytes: 1200 })
const MEMHUB_IMPORT = Object.freeze({ imported: 1, skipped: 0, failed: 0, path: '/tmp/mem.json' })
const MEMHUB_PULL = Object.freeze({
  imported: 2,
  skipped: 1,
  failed: 0,
  path: '/Users/test/.one-memory/hy-memory',
})

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

/** A tiny hook-capable React stand-in: mounts, re-renders the dirty subtree only. */
function createMiniReact() {
  const Fragment = Symbol('Fragment')
  const instances = new Map()
  const renderCounts = new Map()
  let current = null
  let rootOutput = null
  let scheduled = false
  let renderedThisPass = new Set()
  let flushing = false

  class Component {
    constructor(props) {
      this.props = props ?? {}
      this.state = {}
    }

    setState(next) {
      this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state) : next ?? {}) }
      const instance = this.__instance
      if (instance !== undefined && instance !== null) {
        instance.dirty = true
        schedule()
      }
    }
  }

  function countRender(type) {
    const name = type.displayName || type.name || 'anonymous'
    renderCounts.set(name, (renderCounts.get(name) ?? 0) + 1)
  }

  function schedule() {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      flush()
    })
  }

  function flush() {
    if (flushing) return
    flushing = true
    try {
      let guard = 0
      for (;;) {
        const dirty = [...instances.values()].filter((instance) => instance.dirty === true)
        if (dirty.length === 0) break
        renderedThisPass = new Set()
        for (const instance of dirty) renderInstance(instance, true)
        for (const instance of renderedThisPass) runEffects(instance)
        guard += 1
        if (guard > 50) throw new Error('mini-react: render loop did not settle')
      }
    } finally {
      flushing = false
    }
  }

  function renderInstance(instance, force) {
    if (instance.kind === 'class') renderClassInstance(instance, force)
    else renderFunctionInstance(instance, force)
  }

  function ensureInstance(type, props, path) {
    const isClass = type.prototype !== undefined && type.prototype !== null && typeof type.prototype.render === 'function'
    const kind = isClass ? 'class' : 'function'
    let instance = instances.get(path)
    if (instance === undefined || instance.type !== type || instance.kind !== kind) {
      instance = { kind, type, props, path, hooks: [], dirty: false, output: null, effects: [] }
      instances.set(path, instance)
      if (isClass) {
        const component = new type(props)
        component.__instance = instance
        instance.component = component
      }
    }
    return instance
  }

  function renderFunction(type, props, path, force) {
    const instance = ensureInstance(type, props, path)
    instance.props = props
    if (force !== true && instance.dirty !== true) return { kind: 'component', path }
    renderFunctionInstance(instance, true)
    return { kind: 'component', path }
  }

  function renderFunctionInstance(instance, force) {
    if (force !== true && instance.dirty !== true) return
    instance.dirty = false
    countRender(instance.type)
    const frame = { instance, index: 0, effects: [] }
    const previous = current
    current = frame
    let output
    try {
      output = instance.type(instance.props)
    } finally {
      current = previous
    }
    instance.effects = frame.effects
    instance.output = renderNode(output, `${instance.path}>out`, true)
    renderedThisPass.add(instance)
  }

  function renderClass(type, props, path, force) {
    const instance = ensureInstance(type, props, path)
    instance.props = props
    if (force !== true && instance.dirty !== true && instance.component !== undefined) {
      return { kind: 'component', path }
    }
    renderClassInstance(instance, true)
    return { kind: 'component', path }
  }

  function renderClassInstance(instance, force) {
    if (force !== true && instance.dirty !== true) return
    instance.dirty = false
    instance.component.props = instance.props
    countRender(instance.type)
    instance.output = renderNode(instance.component.render(), `${instance.path}>out`, true)
    renderedThisPass.add(instance)
  }

  function renderNode(element, path, force) {
    if (element === null || element === undefined || element === false || element === true) return null
    if (Array.isArray(element)) return { kind: 'fragment', children: renderChildren(element, path, force) }
    if (typeof element === 'string' || typeof element === 'number') return { kind: 'text', text: String(element) }
    if (typeof element !== 'object') return null
    const type = element.type
    const props = element.props ?? {}
    if (type === Fragment) return { kind: 'fragment', children: renderChildren(props.children, path, force) }
    if (typeof type === 'function') {
      const isClass = type.prototype !== undefined && type.prototype !== null && typeof type.prototype.render === 'function'
      return isClass ? renderClass(type, props, path, force) : renderFunction(type, props, path, force)
    }
    return {
      kind: 'host',
      type: String(type),
      props,
      children: renderChildren(props.children, path, force),
    }
  }

  function renderChildren(children, path, force) {
    const list = Array.isArray(children) ? children : [children]
    const counters = new Map()
    const out = []
    for (const child of list) {
      if (Array.isArray(child)) {
        out.push(...renderChildren(child, path, force))
        continue
      }
      if (child === null || child === undefined || child === false || child === true) continue
      const name = childName(child)
      const index = counters.get(name) ?? 0
      counters.set(name, index + 1)
      const node = renderNode(child, `${path}/${name}#${index}`, force)
      if (node !== null) out.push(node)
    }
    return out
  }

  function childName(element) {
    if (element === null || typeof element !== 'object') return 'text'
    const type = element.type
    if (typeof type === 'string') return type
    if (typeof type === 'function') return type.displayName || type.name || 'Component'
    if (type === Fragment) return 'Fragment'
    return 'node'
  }

  function hookSlot() {
    if (current === null) throw new Error('mini-react: hook used outside a component render')
    const index = current.index
    current.index += 1
    if (current.instance.hooks[index] === undefined) current.instance.hooks[index] = {}
    return { hook: current.instance.hooks[index], index }
  }

  function depsEqual(left, right) {
    if (left === undefined || right === undefined) return false
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
      if (!Object.is(left[index], right[index])) return false
    }
    return true
  }

  function useState(initial) {
    const { hook } = hookSlot()
    if (hook.initialized !== true) {
      hook.initialized = true
      hook.value = typeof initial === 'function' ? initial() : initial
      hook.instance = current.instance
      hook.setter = (next) => {
        const value = typeof next === 'function' ? next(hook.value) : next
        if (Object.is(value, hook.value)) return
        hook.value = value
        hook.instance.dirty = true
        schedule()
      }
    }
    return [hook.value, hook.setter]
  }

  function useEffect(fn, deps) {
    const { hook, index } = hookSlot()
    hook.kind = 'effect'
    current.effects.push({ index, fn, deps })
  }

  function useMemo(factory, deps) {
    const { hook } = hookSlot()
    if (hook.initialized !== true || !depsEqual(hook.deps, deps)) {
      hook.initialized = true
      hook.deps = deps
      hook.value = factory()
    }
    return hook.value
  }

  function useCallback(fn, deps) {
    const { hook } = hookSlot()
    if (hook.initialized !== true || !depsEqual(hook.deps, deps)) {
      hook.initialized = true
      hook.deps = deps
      hook.fn = fn
    }
    return hook.fn
  }

  function useRef(value) {
    const { hook } = hookSlot()
    if (hook.initialized !== true) {
      hook.initialized = true
      hook.value = { current: value }
    }
    return hook.value
  }

  function useId() {
    const { hook, index } = hookSlot()
    if (hook.initialized !== true) {
      hook.initialized = true
      hook.value = `mini-id-${current.instance.path}-${index}`
    }
    return hook.value
  }

  function runEffects(instance) {
    for (const effect of instance.effects ?? []) {
      const hook = instance.hooks[effect.index] ?? (instance.hooks[effect.index] = {})
      if (hook.deps !== undefined && depsEqual(hook.deps, effect.deps)) continue
      if (typeof hook.cleanup === 'function') {
        try {
          hook.cleanup()
        } catch {
          // A failed cleanup must not abort the remaining effects.
        }
      }
      hook.deps = effect.deps
      const cleanup = effect.fn()
      hook.cleanup = typeof cleanup === 'function' ? cleanup : null
    }
  }

  function resolve(node) {
    let cursor = node
    let guard = 0
    while (cursor !== null && cursor !== undefined && cursor.kind === 'component') {
      const instance = instances.get(cursor.path)
      if (instance === undefined) return null
      cursor = instance.output
      guard += 1
      if (guard > 100) throw new Error('mini-react: component resolution loop')
    }
    return cursor ?? null
  }

  function textOf(node) {
    const resolved = resolve(node)
    if (resolved === null || resolved === undefined) return ''
    if (resolved.kind === 'text') return resolved.text
    if (resolved.kind === 'host' || resolved.kind === 'fragment') {
      return (resolved.children ?? []).map(textOf).join('')
    }
    return ''
  }

  function text() {
    return textOf(rootOutput)
  }

  function collectHosts(node = rootOutput, out = []) {
    const resolved = resolve(node)
    if (resolved === null) return out
    if (resolved.kind === 'host') {
      out.push(resolved)
      for (const child of resolved.children ?? []) collectHosts(child, out)
    } else if (resolved.kind === 'fragment') {
      for (const child of resolved.children ?? []) collectHosts(child, out)
    }
    return out
  }

  function mount(element) {
    renderedThisPass = new Set()
    rootOutput = renderNode(element, 'root', true)
    for (const instance of renderedThisPass) runEffects(instance)
    return rootOutput
  }

  function unmount() {
    for (const instance of instances.values()) {
      for (const hook of instance.hooks) {
        if (hook !== null && hook !== undefined && typeof hook.cleanup === 'function') {
          try {
            hook.cleanup()
          } catch {
            // Best-effort teardown.
          }
          hook.cleanup = null
        }
      }
    }
    instances.clear()
    rootOutput = null
  }

  const lib = {
    Fragment,
    Component,
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children } }
    },
    useState,
    useEffect,
    useLayoutEffect: useEffect,
    useMemo,
    useCallback,
    useRef,
    useId,
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot()
    },
    createContext(value) {
      return { Provider: Symbol('Provider'), value }
    },
    forwardRef(render) {
      return (props) => render(props, null)
    },
  }

  return { lib, mount, unmount, renderCounts, text, textOf, collectHosts, instances }
}

function createFakePrimitives(react) {
  const host = (type) => (props) => {
    const { children, ...rest } = props ?? {}
    return react.createElement(type, rest, children)
  }
  return {
    Button: host('button'),
    Input: host('input'),
    Tag: host('span'),
    StateDot: host('span'),
    SegmentedTabs: (props) => react.createElement('div', { role: 'tablist' },
      (props.items ?? []).map((item) => react.createElement('button', {
        key: item.value,
        type: 'button',
        role: 'tab',
        id: item.id,
        'aria-selected': item.value === props.value ? 'true' : 'false',
        onClick: () => { props.onChange(item.value) },
      }, item.label))),
    DisclosureRow: (props) => react.createElement('div', null,
      react.createElement('button', { type: 'button', onClick: () => props.onToggle() }, props.title),
      props.open === true ? props.children : null),
    Modal: (props) => (props.open === true ? react.createElement('div', null, props.title, props.children, props.footer) : null),
    Tooltip: (props) => props.children ?? null,
    relativeTime: (at, now) => ({ unit: 'minutes', n: Math.max(1, Math.round((now - at) / 60000)) }),
  }
}

/** Deterministic timers for the sandbox so a poll tick can be advanced on demand. */
function createScheduler() {
  let nextId = 1
  let now = 0
  const timers = []

  function schedule(fn, delay, repeat) {
    const wait = Math.max(0, Number(delay) || 0)
    const timer = { id: nextId, fn, at: now + wait, every: repeat ? Math.max(1, wait) : null }
    nextId += 1
    timers.push(timer)
    return timer.id
  }

  function clear(id) {
    const index = timers.findIndex((timer) => timer.id === id)
    if (index >= 0) timers.splice(index, 1)
  }

  return {
    setTimeout: (fn, delay) => schedule(fn, delay, false),
    clearTimeout: (id) => { clear(id) },
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearInterval: (id) => { clear(id) },
    pending: () => timers.length,
    async advance(ms) {
      const target = now + ms
      let guard = 0
      while (guard < 60) {
        guard += 1
        const due = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0]
        if (due === undefined) break
        now = Math.max(now, due.at)
        if (due.every !== null) due.at = now + due.every
        else clear(due.id)
        due.fn()
        await Promise.resolve()
        await new Promise((done) => setTimeout(done, 0))
      }
      now = target
      await new Promise((done) => setTimeout(done, 20))
    },
  }
}

function createFetch(fetchCalls, options = {}) {
  const sessionPanel = options.sessionPanel !== false
  const memhubDetected = options.memhubDetected !== false
  const withContext = options.context !== false
  const autoUpdate = options.autoUpdate ?? 'current'
  const duplicates = options.duplicates ?? 'some'
  const explain = options.explain ?? 'found'
  const explained = Array.isArray(options.explained) ? options.explained : ['m1']
  const injectedMode = options.injected ?? 'found'
  // The host persists `enabled`; status reads it back, so the fake keeps it too.
  const settings = { enabled: true, permissions: { disabledCaptureProjects: [] } }
  let activityPolls = 0
  return async (url, callOptions = {}) => {
    const target = String(url)
    const marker = '/api/hy-memory/'
    const verb = target.startsWith(marker) ? target.slice(marker.length) : target.slice(target.lastIndexOf('/') + 1)
    fetchCalls.push({ url: target, options: callOptions })
    if (verb === 'status' || verb === 'start') {
      return jsonResponse({
        ok: true,
        data: {
          ...STATUS,
          enabled: settings.enabled,
          memhub: memhubDetected ? STATUS.memhub : { detected: false, path: '', sizeBytes: 0 },
          context: withContext ? STATUS.context : null,
        },
      })
    }
    if (verb === 'settings/get') {
      return jsonResponse({
        ok: true,
        data: {
          settings: {
            enabled: settings.enabled,
            ui: { sessionPanel },
            permissions: { disabledCaptureProjects: settings.permissions.disabledCaptureProjects.slice() },
          },
        },
      })
    }
    if (verb === 'settings/set') {
      const body = JSON.parse(callOptions.body ?? '{}')
      const patch = body.patch ?? {}
      if (typeof patch.enabled === 'boolean') settings.enabled = patch.enabled
      const disabled = patch.permissions?.disabledCaptureProjects
      if (Array.isArray(disabled)) settings.permissions.disabledCaptureProjects = disabled.slice()
      return jsonResponse({
        ok: true,
        data: {
          settings: {
            enabled: settings.enabled,
            ui: { sessionPanel },
            permissions: { disabledCaptureProjects: settings.permissions.disabledCaptureProjects.slice() },
          },
        },
      })
    }
    if (verb === 'projects') return jsonResponse({ ok: true, data: WORKSPACES })
    if (verb === 'update/check') {
      const body = JSON.parse(callOptions.body ?? '{}')
      // The automatic (non-force) read answers from the host cache; the button
      // forces a fresh fetch, so the two can differ in a test.
      const mode = body.force === true ? options.updateCheck : autoUpdate
      if (mode === 'error') {
        return jsonResponse({
          ok: true,
          data: { current: '0.1.0', latest: '', behind: false, url: '', checkedAt: 1, error: 'github 404' },
        })
      }
      if (mode === 'behind') {
        return jsonResponse({
          ok: true,
          data: {
            current: '0.1.0',
            latest: '0.2.0',
            behind: true,
            url: 'https://github.com/example/hy-memory4dsh/releases/tag/v0.2.0',
            checkedAt: 1,
          },
        })
      }
      return jsonResponse({
        ok: true,
        data: { current: '0.1.0', latest: '0.1.0', behind: false, url: '', checkedAt: 1 },
      })
    }
    if (verb === 'sessions') {
      const body = JSON.parse(callOptions.body ?? '{}')
      return jsonResponse({
        ok: true,
        data: { ...SESSIONS, projectKey: body.projectKey ?? SESSIONS.projectKey },
      })
    }
    if (verb === 'list') {
      const body = JSON.parse(callOptions.body ?? '{}')
      const limit = typeof body.limit === 'number' ? body.limit : 20
      const offset = typeof body.offset === 'number' ? body.offset : 0
      // Unfiltered lists report a multi-page total; a session-scoped read is exact.
      if (body.tier === 'personal' && !body.query) {
        return jsonResponse({ ok: true, data: { items: [PERSONAL_ITEM], total: PAGE_TOTAL, offset, limit } })
      }
      if (body.tier === 'project') {
        return jsonResponse({ ok: true, data: { items: [PROJECT_ITEM], total: PAGE_TOTAL, offset, limit } })
      }
      if (body.tier === 'session') {
        const scoped = typeof body.sessionId === 'string' && body.sessionId !== ''
        const items = SESSION_ITEMS.filter((item) => !scoped || item.sessionId === body.sessionId)
        return jsonResponse({ ok: true, data: { items, total: scoped ? items.length : PAGE_TOTAL, offset, limit } })
      }
      return jsonResponse({ ok: true, data: { items: [], total: 0, offset, limit } })
    }
    if (verb === 'activity') {
      activityPolls += 1
      if (activityPolls === 1) return jsonResponse({ ok: true, data: { events: [], cursor: null } })
      return jsonResponse({
        ok: true,
        data: {
          events: [{
            at: ACTIVITY_AT,
            kind: 'recall',
            tier: 'personal',
            summary: 'polled recall',
            detail: '',
            ok: true,
          }],
          cursor: 2,
        },
      })
    }
    if (verb === 'update') return jsonResponse({ ok: true, data: { item: { id: 'm1', content: 'edited' } } })
    if (verb === 'delete') return jsonResponse({ ok: true, data: { deleted: true } })
    if (verb === 'forget') return jsonResponse({ ok: true, data: { deleted: true, forgotten: true } })
    if (verb === 'duplicates') {
      if (duplicates === 'error') {
        return jsonResponse({ ok: false, error: { code: 'memory_error', message: 'scan failed' } }, 500)
      }
      if (duplicates === 'none') return jsonResponse({ ok: true, data: { groups: [], total: 0 } })
      return jsonResponse({
        ok: true,
        data: {
          groups: [
            { tier: 'personal', keep: 'm1', drop: ['m2', 'm3'], count: 2, preview: 'remember this' },
            { tier: 'project', keep: 'p1', drop: ['p2'], count: 1, preview: 'project note' },
          ],
          total: 3,
        },
      })
    }
    if (verb === 'merge') return jsonResponse({ ok: true, data: { merged: 1, kept: 'm1' } })
    if (verb === 'purge') {
      if (options.purge === 'error') {
        return jsonResponse({ ok: false, error: { code: 'bad_confirm', message: 'confirm must be PURGE' } }, 400)
      }
      return jsonResponse({ ok: true, data: { purged: 6, archived: 6, archive: '/tmp/purge-1.jsonl' } })
    }
    if (verb === 'explained') return jsonResponse({ ok: true, data: { ids: explained } })
    if (verb === 'injected') {
      const body = JSON.parse(callOptions.body ?? '{}')
      if (injectedMode === 'error') {
        return jsonResponse({ ok: false, error: { code: 'memory_error', message: 'injected failed' } }, 500)
      }
      if (injectedMode === 'missing') return jsonResponse({ ok: true, data: { found: false } })
      return jsonResponse({
        ok: true,
        data: {
          found: true,
          at: body.at,
          query: 'how do I rebuild the panel',
          source: 'both',
          text: INJECTED_TEXT,
        },
      })
    }
    if (verb === 'explain') {
      if (explain === 'error') {
        return jsonResponse({ ok: false, error: { code: 'memory_error', message: 'explain failed' } }, 500)
      }
      if (explain === 'missing') return jsonResponse({ ok: true, data: { found: false } })
      return jsonResponse({
        ok: true,
        data: {
          found: true,
          at: Date.now() - 60000,
          query: 'how do I rebuild the panel',
          source: 'both',
          tier: 'personal',
          score: 0.8432,
          rank: 2,
        },
      })
    }
    if (verb === 'memhub/export') {
      if (options.memhubErrors === true) {
        return jsonResponse({ ok: false, error: { code: 'memhub_locked', message: 'store is locked by the MemHub runtime' } }, 409)
      }
      return jsonResponse({ ok: true, data: MEMHUB_EXPORT })
    }
    if (verb === 'memhub/pull') {
      if (options.memhubErrors === true) {
        return jsonResponse({ ok: false, error: { code: 'embedding_mismatch', message: 'dims differ' } }, 409)
      }
      return jsonResponse({ ok: true, data: MEMHUB_PULL })
    }
    if (verb === 'memhub/import') {
      if (options.memhubErrors === true) {
        return jsonResponse({ ok: false, error: { code: 'not_found', message: 'ENOENT' } }, 404)
      }
      return jsonResponse({ ok: true, data: MEMHUB_IMPORT })
    }
    return jsonResponse({ ok: true, data: {} })
  }
}

/** Just enough DOM for the plugin's one injected stylesheet and its listeners. */
function createDocumentStub() {
  const head = {
    children: [],
    appendChild(node) {
      node.parentNode = head
      head.children.push(node)
    },
    removeChild(node) {
      const index = head.children.indexOf(node)
      if (index >= 0) head.children.splice(index, 1)
      node.parentNode = null
    },
  }
  return {
    visibilityState: 'visible',
    head,
    body: { appendChild() {}, removeChild() {} },
    addEventListener() {},
    removeEventListener() {},
    createElement(tag) {
      return { tagName: String(tag).toUpperCase(), id: '', textContent: '', parentNode: null }
    },
    getElementById(id) {
      return head.children.find((child) => child.id === id) ?? null
    },
  }
}

function createHarness({
  withPrimitives, sessionPanel = true, memhubErrors = false, memhubDetected = true,
  updateCheck = 'current', autoUpdate = 'current', duplicates = 'some', explain = 'found',
  explained = ['m1'], injected = 'found', purge = 'ok', context = true, localeConflict = false,
  slotConflict = false,
}) {
  const slotRegistrations = []
  const tabRegistrations = []
  const localeRegistrations = []
  const effectLabels = []
  const fetchCalls = []
  const clipboardWrites = []
  const listeners = new Map()
  const mini = createMiniReact()
  const primitives = createFakePrimitives(mini.lib)
  const scheduler = createScheduler()
  const documentStub = createDocumentStub()
  const fetchImpl = createFetch(fetchCalls, {
    sessionPanel, memhubErrors, memhubDetected, updateCheck, autoUpdate, duplicates, explain,
    explained, injected, purge, context, localeConflict, slotConflict,
  })

  const requireStub = (specifier) => {
    if (specifier === 'react' || specifier === 'react-dom' || specifier === 'react/jsx-runtime') return mini.lib
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
      if (withPrimitives) return primitives
      throw new Error('primitives seed module is unavailable')
    }
    throw new Error(`unexpected runtime require("${specifier}")`)
  }

  const fakeCtx = {
    effect(fn, label) {
      effectLabels.push(label)
      const dispose = fn()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    slots: {
      inject(_name, callback) {
        const dispose = callback()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      register(options, component) {
        if (slotConflict && options.name === 'settings.section' && options.id === 'hy-memory'
          && (options.priority ?? 0) === 0) {
          // A page sync re-applying the bundle while the previous seat is still held.
          throw new Error('list slot "settings.section" already has an entry with id "hy-memory" at priority 0 (registered by Gb)')
        }
        slotRegistrations.push({ options, component })
        return () => {
          const index = slotRegistrations.findIndex((entry) => entry.options === options)
          if (index >= 0) slotRegistrations.splice(index, 1)
        }
      },
    },
    locale: {
      register(ns, localeOrDicts, dict) {
        const dicts = typeof localeOrDicts === 'string' ? { [localeOrDicts]: dict } : localeOrDicts
        if (localeConflict && ns === 'hy-memory' && dicts?.zh !== undefined) {
          // A page sync applying the bundle again while the previous effect still
          // owns the namespace: the real service throws, the plugin must survive.
          throw new Error(`locale namespace "${ns}" already has locale "zh"`)
        }
        localeRegistrations.push({ ns, dicts })
        return () => {}
      },
      bind(ns) {
        // Resolve through the dictionaries the plugin registered, so slot labels
        // exercise the same strings the host would show.
        return (key, params) => {
          const entry = localeRegistrations.filter((registered) => registered.ns === ns).pop()
          const template = entry?.dicts?.zh?.[key]
          if (typeof template === 'string') {
            if (params === undefined) return template
            return template.replace(/\{(\w+)\}/g, (match, name) => (
              params[name] === undefined ? match : String(params[name])
            ))
          }
          if (params === undefined) return key
          const pairs = Object.entries(params).map(([name, value]) => `${name}=${String(value)}`)
          return `${key}(${pairs.join(',')})`
        }
      },
      getLocale() {
        return { active: 'zh' }
      },
    },
    inject(_deps, callback) {
      return callback(fakeCtx)
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      return () => { set.delete(listener) }
    },
    sidebarRightTabs: {
      register(definition) {
        tabRegistrations.push(definition)
        return () => {
          const index = tabRegistrations.indexOf(definition)
          if (index >= 0) tabRegistrations.splice(index, 1)
        }
      },
    },
  }

  const sandbox = {
    console,
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
    setInterval: scheduler.setInterval,
    clearInterval: scheduler.clearInterval,
    fetch: fetchImpl,
    document: documentStub,
    navigator: { clipboard: { writeText: async (text) => { clipboardWrites.push(text) } } },
    Date,
    JSON,
    Promise,
    URL,
    URLSearchParams,
    Error,
    Object,
    Array,
    String,
    Number,
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  const loaded = { registration: null }
  sandbox.window.__ModuleLoader__ = {
    load(registration) {
      loaded.registration = registration
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })

  return {
    sandbox,
    loaded,
    requireStub,
    fakeCtx,
    mini,
    scheduler,
    slotRegistrations,
    tabRegistrations,
    localeRegistrations,
    localeConflict,
    slotConflict,
    effectLabels,
    fetchCalls,
    clipboardWrites,
    document: documentStub,
  }
}

async function exerciseSlotConflict(harness) {
  await settle()
  const sections = harness.slotRegistrations.filter((entry) => entry.options.name === 'settings.section')
  assert.equal(sections.length, 0, 'the occupied seat is left to its current owner instead of duplicating the nav row')
  await new Promise((resolve) => setTimeout(resolve, 400))
  assert.equal(
    harness.slotRegistrations.filter((entry) => entry.options.name === 'settings.section').length,
    0,
    'a retry does not add a second seat while the namespace stays occupied',
  )
}

async function exerciseLocaleConflict(harness) {
  await settle()
  assert.ok(harness.slotRegistrations.length > 0, 'the settings section registers despite a locale conflict')
  const registered = harness.localeRegistrations.filter((entry) => entry.ns === 'hy-memory')
  assert.equal(registered.length, 1, 'the locale the old owner does not hold is registered')
  assert.equal(registered[0].dicts.zh, undefined, 'the occupied locale is left to its current owner')
  await settle()
  assert.ok(harness.slotRegistrations.length > 0, 'the plugin stays mounted after the retry window')
}

function settle() {
  return new Promise((resolve) => { setTimeout(resolve, 80) })
}

function makeTranslator(dictionary) {
  return (key, params) => {
    const template = dictionary[key]
    if (typeof template !== 'string') return key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (
      params[name] === undefined ? match : String(params[name])
    ))
  }
}

function assertCommon(harness, label, { expectSessionPanel = true } = {}) {
  const { slotRegistrations, tabRegistrations, localeRegistrations, fetchCalls, loaded } = harness

  assert.ok(loaded.registration !== null, `${label}: client.js registered with __ModuleLoader__`)
  assert.equal(loaded.registration.id, manifest.name, `${label}: lazy factory id matches the package name`)
  assert.equal(typeof loaded.registration.factory, 'function', `${label}: factory is a function`)

  const settingsSections = slotRegistrations.filter((entry) => entry.options.name === 'settings.section')
  if (harness.slotConflict === true) {
    // The dedicated exercise covers this harness: the occupied seat stays with
    // its current owner and nothing else is asserted about this bundle instance.
    assert.equal(settingsSections.length, 0, `${label}: the occupied seat is not duplicated`)
    return
  }
  assert.equal(settingsSections.length, 1, `${label}: exactly one settings.section registration`)
  assert.equal(settingsSections[0].options.id, 'hy-memory', `${label}: settings section id`)
  assert.equal(settingsSections[0].options.locale, 'hy-memory', `${label}: settings section locale namespace`)
  assert.equal(typeof settingsSections[0].options.label, 'function', `${label}: section label is a thunk`)
  assert.ok(settingsSections[0].options.order >= 21, `${label}: section sits after general sections`)

  const paneSlots = slotRegistrations.filter((entry) => entry.options.name === 'sidebar.right.pane.tab')
  if (expectSessionPanel) {
    assert.ok(paneSlots.length >= 1, `${label}: sessionpanel slot registration present`)
    assert.ok(paneSlots.some((entry) => entry.options.key === 'hy-memory'), `${label}: session pane keyed by hy-memory`)
    assert.ok(tabRegistrations.length >= 1, `${label}: sidebarRightTabs registration present`)
    assert.ok(tabRegistrations.some((definition) => definition.id === 'hy-memory'), `${label}: tab type id hy-memory`)
    assert.ok(tabRegistrations.every((definition) => definition.kind === 'hy-memory'), `${label}: tab kind hy-memory`)
  } else {
    assert.equal(paneSlots.length, 0, `${label}: no session pane seat is contributed`)
    assert.equal(tabRegistrations.length, 0, `${label}: no tab type is contributed`)
  }

  assert.equal(
    slotRegistrations.some((entry) => entry.options.name === 'sidebar.panellist'),
    false,
    `${label}: no sidebar.panellist navigation row`,
  )

  const statusCalls = fetchCalls.filter((call) => call.url === '/api/hy-memory/status')
  assert.ok(statusCalls.length >= 1, `${label}: fetch called for status`)
  assert.equal(statusCalls[0].options.method, 'POST', `${label}: status is a POST`)
  assert.equal(statusCalls[0].options.credentials, 'include', `${label}: same-origin credentials`)
  assert.equal(statusCalls[0].options.headers['content-type'], 'application/json', `${label}: JSON content type`)
  assert.ok(statusCalls[0].options.body.length > 0, `${label}: status body is JSON`)
  assert.equal(typeof JSON.parse(statusCalls[0].options.body), 'object', `${label}: status body parses`)

  const settingsCalls = fetchCalls.filter((call) => call.url === '/api/hy-memory/settings/get')
  assert.equal(settingsCalls.length, 1, `${label}: session panel flag is read once and cached`)

  const dictionaries = localeRegistrations.filter((entry) => entry.ns === 'hy-memory')
  if (harness.localeConflict === true) {
    // The dedicated exercise owns the assertions for the occupied-namespace case.
    assert.equal(dictionaries.length, 1, `${label}: the free locale registers`)
    return
  }
  assert.equal(dictionaries.length, 1, `${label}: locale registered in the hy-memory namespace`)
  assert.equal(typeof dictionaries[0].dicts.zh['nav.label'], 'string', `${label}: zh catalog present`)
  assert.equal(typeof dictionaries[0].dicts.en['nav.label'], 'string', `${label}: en catalog present`)
  assert.deepEqual(
    Object.keys(dictionaries[0].dicts.zh).sort(),
    Object.keys(dictionaries[0].dicts.en).sort(),
    `${label}: zh and en key sets match`,
  )
  for (const key of ['memhub.title', 'memhub.explain', 'memhub.export', 'memhub.pull', 'memhub.import']) {
    assert.equal(typeof dictionaries[0].dicts.zh[key], 'string', `${label}: zh has ${key}`)
    assert.equal(typeof dictionaries[0].dicts.en[key], 'string', `${label}: en has ${key}`)
  }
  for (const code of ['memhub_locked', 'embedding_mismatch', 'not_found']) {
    const key = `memhub.error.${code}`
    assert.equal(typeof dictionaries[0].dicts.zh[key], 'string', `${label}: zh explains ${code}`)
    assert.equal(typeof dictionaries[0].dicts.en[key], 'string', `${label}: en explains ${code}`)
  }
}

async function run({
  withPrimitives, label, sessionPanel = true, memhubErrors = false, memhubDetected = true,
  updateCheck = 'current', autoUpdate = 'current', duplicates = 'some', explain = 'found',
  explained = ['m1'], injected = 'found', purge = 'ok', context = true, localeConflict = false,
  slotConflict = false,
}) {
  const harness = createHarness({
    withPrimitives, sessionPanel, memhubErrors, memhubDetected, updateCheck, autoUpdate, duplicates, explain,
    explained, injected, purge, context, localeConflict, slotConflict,
  })
  const exported = harness.loaded.registration.factory(harness.requireStub)
  assert.ok(Array.isArray(exported.inject), `${label}: factory exports inject`)
  assert.ok(exported.inject.includes('slots') && exported.inject.includes('locale'), `${label}: required services`)
  assert.equal(typeof exported.apply, 'function', `${label}: factory exports apply`)
  exported.apply(harness.fakeCtx)
  await settle()
  assertCommon(harness, label, { expectSessionPanel: sessionPanel })
  return harness
}

function dictionariesOf(harness) {
  return harness.localeRegistrations.find((entry) => entry.ns === 'hy-memory').dicts
}

async function mountSection(harness, locale = 'zh') {
  const dictionaries = dictionariesOf(harness)
  const t = makeTranslator(dictionaries[locale] ?? dictionaries.zh)
  const section = harness.slotRegistrations.find((entry) => entry.options.name === 'settings.section')
  assert.ok(section !== undefined, 'settings section is registered before mounting')
  harness.mini.mount(harness.mini.lib.createElement(section.component, {
    t,
    translate: t,
    api: {},
    subscribeLocale: () => () => {},
    localeSnapshot: () => locale,
  }))
  await settle()
  return t
}

function hostsOf(harness) {
  return harness.mini.collectHosts()
}

function findButton(harness, label) {
  return hostsOf(harness).find((node) => node.type === 'button' && harness.mini.textOf(node) === label)
}

function findInput(harness, predicate) {
  return hostsOf(harness).find((node) => node.type === 'input' && predicate(node.props ?? {}))
}

function findTextarea(harness) {
  return hostsOf(harness).find((node) => node.type === 'textarea')
}

/** The master switch: `role="switch"`, whichever implementation the panel picked. */
function findSwitch(harness) {
  return hostsOf(harness).find((node) => node.type === 'button' && (node.props ?? {}).role === 'switch')
}

function findSelect(harness, predicate) {
  return hostsOf(harness).find((node) => node.type === 'select' && predicate(node.props ?? {}))
}

/** Icon-only controls carry their name in `aria-label`, not in text. */
function findByLabel(harness, label) {
  return hostsOf(harness).find((node) => node.type === 'button' && (node.props ?? {})['aria-label'] === label)
}

function findButtons(harness, label) {
  return hostsOf(harness).filter((node) => node.type === 'button' && harness.mini.textOf(node) === label)
}

/** Press one specific rendered control (used for icon buttons and the switch). */
async function activate(harness, node, label) {
  assert.ok(node !== undefined, `rendered ${label}`)
  node.props.onClick()
  await settle()
}

/** Open a card's action menu unless a re-render left it open already. */
async function ensureRowMenu(harness, t) {
  if (findButton(harness, t('row.copy')) === undefined) {
    const main = hostsOf(harness).find((node) => String(node.props?.className ?? '') === 'hm-fileMain')
  assert.ok(main !== undefined, 'the row content area is its own control')
  assert.equal(main.props['aria-expanded'], 'false', 'the row starts collapsed')
  await activate(harness, main, 'the row content area')
  const expanded = hostsOf(harness).find((node) => String(node.props?.className ?? '') === 'hm-fileMain')
  assert.equal(expanded.props['aria-expanded'], 'true', 'clicking the content expands it')
  assert.ok(hostsOf(harness).some((node) => String(node.props?.className ?? '').includes('hm-fileBody')),
    'the expanded row renders the full memory body')
  await activate(harness, expanded, 'the expanded row content area')
  assert.equal(
    hostsOf(harness).find((node) => String(node.props?.className ?? '') === 'hm-fileMain').props['aria-expanded'],
    'false',
    'clicking again collapses it',
  )
  assert.equal(hostsOf(harness).some((node) => String(node.props?.className ?? '').includes('hm-fileBody')), false,
    'the body leaves the tree when collapsed')

  await activate(harness, findByLabel(harness, t('row.actions')), 'the row action button')
  }
}

function lastCall(harness, url) {
  return harness.fetchCalls.filter((call) => call.url === url).pop()
}

async function click(harness, label) {
  const button = findButton(harness, label)
  assert.ok(button !== undefined, `rendered a button labelled "${label}"`)
  button.props.onClick()
  await settle()
}

function assertPost(harness, url, expectedBody) {
  const call = lastCall(harness, url)
  assert.ok(call !== undefined, `POST ${url} was issued`)
  assert.equal(call.options.method, 'POST', `${url} is a POST`)
  assert.equal(call.options.credentials, 'include', `${url} carries same-origin credentials`)
  assert.equal(call.options.headers['content-type'], 'application/json', `${url} sends JSON`)
  const body = JSON.parse(call.options.body)
  assert.deepEqual(body, expectedBody, `${url} body`)
}

async function exerciseMemhubCard(harness) {
  const t = await mountSection(harness, 'zh')
  const text = harness.mini.text()
  assert.ok(text.includes(t('memhub.title')), 'MemHub card title renders')
  assert.ok(text.includes(t('memhub.detected')), 'MemHub detection state renders')
  assert.equal(text.includes('/Users/test/.one-memory'), false, 'the store path is collapsed behind 详细信息')
  assert.equal(text.includes('20 KB'), false, 'the store size is collapsed behind 详细信息')
  assert.equal(text.includes(t('memhub.explain')), false, 'the explanation is collapsed behind 详细信息')

  assert.ok(findButton(harness, t('memhub.export')) !== undefined, 'export action renders')
  assert.ok(findButton(harness, t('memhub.pull')) !== undefined, 'pull action renders')
  assert.ok(findButton(harness, t('memhub.import')) !== undefined, 'file-import action renders')
  assert.equal(findInput(harness, (props) => props['aria-label'] === t('memhub.importPath')), undefined,
    'the import path input stays hidden until 从文件导入 is chosen')

  // The card that renders last owns the last 详细信息 toggle (diagnostics first).
  await activate(harness, findButtons(harness, t('common.details')).pop(), 'the MemHub 详细信息 toggle')
  const opened = harness.mini.text()
  assert.ok(opened.includes(t('memhub.explain')), '详细信息 reveals the explanation')
  assert.ok(opened.includes('个人层'), 'the explanation names the personal tier')
  assert.ok(opened.includes('/Users/test/.one-memory'), '详细信息 reveals the store path')
  assert.ok(opened.includes('20 KB'), '详细信息 reveals the store size')

  await click(harness, t('memhub.export'))
  assertPost(harness, '/api/hy-memory/memhub/export', {})
  assert.ok(harness.mini.text().includes('已导出 3 条到 /tmp/hy-memory-2026.json'), 'export result shows counts and path')
  assert.ok(harness.mini.text().includes('1.2 KB'), 'export result shows the file size')
  assert.ok(findButton(harness, t('memhub.export')) !== undefined, 'export button returns to its idle label')

  await click(harness, t('memhub.pull'))
  assertPost(harness, '/api/hy-memory/memhub/pull', {})
  assert.ok(harness.mini.text().includes('已从 MemHub 导入 2 条，跳过 1 条，失败 0 条'), 'pull result shows counts')
  const personalCalls = harness.fetchCalls.filter((call) => call.url === '/api/hy-memory/list')
  assert.ok(personalCalls.length >= 2, 'a successful pull re-reads the tier lists')

  await click(harness, t('memhub.import'))
  const pathInput = findInput(harness, (props) => props['aria-label'] === t('memhub.importPath'))
  assert.ok(pathInput !== undefined, 'choosing 从文件导入 reveals the absolute-path input')
  pathInput.props.onChange({ target: { value: '/tmp/mem.json' } })
  await settle()
  await click(harness, t('memhub.importConfirm'))
  assertPost(harness, '/api/hy-memory/memhub/import', { path: '/tmp/mem.json' })
  assert.ok(harness.mini.text().includes('已导入 1 条，跳过 0 条，失败 0 条'), 'import result shows counts')
  assert.equal(findInput(harness, (props) => props['aria-label'] === t('memhub.importPath')), undefined,
    'the import form closes after a successful import')

  return harness
}

async function exerciseMemhubErrors(harness) {
  const t = await mountSection(harness, 'zh')
  await click(harness, t('memhub.export'))
  assert.ok(harness.mini.text().includes(t('memhub.error.memhub_locked')), 'memhub_locked renders its human message')
  assert.ok(!harness.mini.text().includes('store is locked by the MemHub runtime'), 'the raw host message is not shown')

  await click(harness, t('memhub.pull'))
  assert.ok(harness.mini.text().includes(t('memhub.error.embedding_mismatch')), 'embedding_mismatch renders its human message')

  await click(harness, t('memhub.import'))
  const pathInput = findInput(harness, (props) => props['aria-label'] === t('memhub.importPath'))
  pathInput.props.onChange({ target: { value: '/tmp/missing.json' } })
  await settle()
  await click(harness, t('memhub.importConfirm'))
  assert.ok(harness.mini.text().includes(t('memhub.error.not_found')), 'not_found renders its human message')
  return harness
}

async function exercisePollIsolation(harness) {
  const t = await mountSection(harness, 'zh')
  assert.ok(harness.mini.text().includes(PERSONAL_ITEM.content), 'the personal list renders before polling')

  const sectionRenders = harness.mini.renderCounts.get('SettingsSection')
  const activityRenders = harness.mini.renderCounts.get('ActivityPanel')
  assert.ok(sectionRenders >= 1 && activityRenders >= 1, 'both the section and the activity subtree rendered')

  const main = hostsOf(harness).find((node) => String(node.props?.className ?? '') === 'hm-fileMain')
  assert.ok(main !== undefined, 'the row content area is its own control')
  assert.equal(main.props['aria-expanded'], 'false', 'the row starts collapsed')
  await activate(harness, main, 'the row content area')
  const expanded = hostsOf(harness).find((node) => String(node.props?.className ?? '') === 'hm-fileMain')
  assert.equal(expanded.props['aria-expanded'], 'true', 'clicking the content expands it')
  assert.ok(hostsOf(harness).some((node) => String(node.props?.className ?? '').includes('hm-fileBody')),
    'the expanded row renders the full memory body')
  await activate(harness, expanded, 'the expanded row content area')
  assert.equal(
    hostsOf(harness).find((node) => String(node.props?.className ?? '') === 'hm-fileMain').props['aria-expanded'],
    'false',
    'clicking again collapses it',
  )
  assert.equal(hostsOf(harness).some((node) => String(node.props?.className ?? '').includes('hm-fileBody')), false,
    'the body leaves the tree when collapsed')

  await activate(harness, findByLabel(harness, t('row.actions')), 'the row action button')
  await click(harness, t('row.edit'))
  const editor = findTextarea(harness)
  assert.ok(editor !== undefined, 'the inline editor opened')
  editor.props.onChange({ target: { value: 'draft kept across poll' } })
  await settle()
  assert.equal(findTextarea(harness).props.value, 'draft kept across poll', 'the draft is held in section state')

  const sectionBefore = harness.mini.renderCounts.get('SettingsSection')
  const activityBefore = harness.mini.renderCounts.get('ActivityPanel')
  await harness.scheduler.advance(3000)
  const tick = {
    sectionDelta: harness.mini.renderCounts.get('SettingsSection') - sectionBefore,
    activityDelta: harness.mini.renderCounts.get('ActivityPanel') - activityBefore,
  }

  assert.equal(tick.sectionDelta, 0, 'a 3 s activity tick does not re-render the settings section')
  assert.ok(tick.activityDelta > 0, 'a 3 s activity tick re-renders the activity subtree')
  assert.equal(findTextarea(harness).props.value, 'draft kept across poll',
    'an in-progress edit survives a poll tick')
  assert.ok(hostsOf(harness).filter((node) => node.type === 'li').length >= 1,
    'the tier list row survives a poll tick')

  const searchInput = findInput(harness, (props) => props.type === 'search')
  assert.ok(searchInput !== undefined, 'the search box renders')
  searchInput.props.onChange({ target: { value: 'needle' } })
  await settle()
  assert.equal(findInput(harness, (props) => props.type === 'search').props.value, 'needle', 'the search text is held in section state')

  await harness.scheduler.advance(3000)
  assert.equal(findInput(harness, (props) => props.type === 'search').props.value, 'needle',
    'search text survives a poll tick')

  // Guard the isolation assertion against a vacuous counter: an explicit refresh
  // must still be observed as a SettingsSection re-render.
  const beforeRefresh = harness.mini.renderCounts.get('SettingsSection')
  await activate(harness, findByLabel(harness, t('files.refresh')), 'the circular files refresh button')
  assert.ok(harness.mini.renderCounts.get('SettingsSection') > beforeRefresh,
    'the render counter still observes a deliberate section re-render')
  return { ...tick, sectionTotal: harness.mini.renderCounts.get('SettingsSection') }
}

async function exerciseEnglishCard(harness) {
  const t = await mountSection(harness, 'en')
  const text = harness.mini.text()
  assert.ok(text.includes(t('memhub.title')), 'the MemHub card renders in English')
  assert.ok(text.includes(t('memhub.detected')), 'the detection state renders in English')
  await activate(harness, findButtons(harness, t('common.details')).pop(), 'the MemHub details toggle')
  assert.ok(harness.mini.text().includes(t('memhub.explain')), 'the explanation renders in English')
  assert.ok(harness.mini.text().includes('personal tier'), 'the English explanation names the personal tier')
  return harness
}

function exerciseNavLabel(harness) {
  const section = harness.slotRegistrations.find((entry) => entry.options.name === 'settings.section')
  assert.equal(typeof section.options.label, 'function', 'the section label is still a thunk')
  const node = section.options.label()
  assert.equal(typeof node, 'object', 'the label thunk returns a React node (the shell renders it as children)')
  assert.equal(node.props?.className, 'hm-navLabel', 'the nav label node is scoped by class')
  const [icon, text] = node.props.children
  assert.equal(icon.props?.name, 'brain', 'the nav row asks for the brain icon')
  assert.equal(icon.props?.className, 'hm-navBrain', 'the nav glyph is scoped by class')
  assert.deepEqual(text.props?.children, ['记忆'], 'the nav row keeps the section name after the glyph')

  const styles = harness.document.head.children.filter((child) => child.id === 'hy-memory-nav-glyph')
  assert.equal(styles.length, 1, 'exactly one nav stylesheet is injected')
  assert.ok(styles[0].textContent.includes('button:has(> span > .hm-navLabel) > svg:first-child{display:none}'),
    'the scoped rule hides the shell gear that precedes the label')
}

async function exerciseMasterSwitch(harness) {
  const t = await mountSection(harness, 'zh')

  let toggle = findSwitch(harness)
  assert.ok(toggle !== undefined, 'the panel renders the master switch')
  const nodesAtMount = hostsOf(harness)
  const switchIndex = nodesAtMount.findIndex((node) => (node.props ?? {}).role === 'switch')
  const tabIndex = nodesAtMount.findIndex((node) => node.type === 'button' && harness.mini.textOf(node) === t('tabs.personal'))
  assert.ok(switchIndex < tabIndex, 'the switch sits in the header block, above the tab row')
  assert.equal(nodesAtMount.filter((node) => String(node.props?.className ?? '') === 'hm-headerSwitch').length, 1,
    'the header carries the switch in its own right-edge cell')
  assert.equal(nodesAtMount.filter((node) => String(node.props?.className ?? '') === 'hm-tabsRow').length, 1,
    'the tab row exists')
  assert.equal(toggle.props['aria-checked'], 'true', 'the switch reflects status.enabled')
  assert.equal(toggle.props['aria-label'], t('master.label'), 'the switch keeps its accessible name')
  assert.equal(harness.mini.text().includes(t('master.label')), false, 'the visible 记忆功能 text is gone')
  assert.ok(harness.mini.text().includes(t('section.title')), 'the header keeps the title')
  assert.ok(harness.mini.text().includes(t('section.subtitle')), 'the header keeps the description')
  assert.ok(findButton(harness, t('tabs.personal')) !== undefined, 'the tabs render while enabled')
  assert.ok(findInput(harness, (props) => props.type === 'search') !== undefined, 'the search renders while enabled')

  await activate(harness, findByLabel(harness, t('row.actions')), 'the personal row action button')
  assert.ok(findButton(harness, t('row.edit')) !== undefined, 'a personal row offers edit while enabled')

  await activate(harness, findSwitch(harness), 'the master switch')
  assertPost(harness, '/api/hy-memory/settings/set', { patch: { enabled: false } })
  toggle = findSwitch(harness)
  assert.equal(toggle.props['aria-checked'], 'false', 'the switch mirrors the saved setting')

  const offText = harness.mini.text()
  assert.equal(findButton(harness, t('tabs.personal')), undefined, 'the tabs disappear when the switch is off')
  assert.equal(offText.includes(t('files.title')), false, 'the files header disappears when the switch is off')
  assert.equal(offText.includes(t('memhub.title')), false, 'the MemHub card disappears when the switch is off')
  assert.equal(offText.includes(t('diag.title')), false, 'the diagnostics card disappears when the switch is off')
  assert.equal(offText.includes(t('activity.title')), false, 'the activity list disappears when the switch is off')
  assert.equal(hostsOf(harness).filter((node) => node.type === 'li').length, 0, 'no memory rows survive the switch-off')
  assert.equal(findInput(harness, (props) => props.type === 'search'), undefined, 'no search box survives the switch-off')
  assert.equal(findByLabel(harness, t('row.actions')), undefined, 'no row actions survive the switch-off')
  assert.ok(offText.includes(t('section.title')), 'the header survives the switch-off')
  assert.ok(findSwitch(harness) !== undefined, 'the switch stays reachable while the content is hidden')

  await activate(harness, findSwitch(harness), 'the master switch')
  assertPost(harness, '/api/hy-memory/settings/set', { patch: { enabled: true } })
  assert.equal(findSwitch(harness).props['aria-checked'], 'true', 'the switch turns back on')
  assert.ok(findButton(harness, t('tabs.personal')) !== undefined, 'the tabs return with the switch')
  await ensureRowMenu(harness, t)
  assert.ok(findButton(harness, t('row.edit')) !== undefined, 'editing returns with the switch')
}

async function exerciseWorkspaceBlocks(harness) {
  const t = await mountSection(harness, 'zh')

  // 个人: no workspace scope at all; the search field moves into the files header.
  assert.equal(findByLabel(harness, t('project.select')), undefined, 'the 个人 tab has no workspace selector')
  assert.equal(harness.mini.text().includes(t('project.workspace')), false, 'no workspace text on 个人')
  const searchBox = findInput(harness, (props) => props.type === 'search')
  assert.ok(searchBox !== undefined, 'the search field renders')
  const filesHead = hostsOf(harness).find((node) => String(node.props?.className ?? '') === 'hm-filesHead')
  assert.ok(filesHead !== undefined && harness.mini.textOf(filesHead).includes(t('files.title')),
    '文件 sits in the same header row as the search field')
  const personalRefresh = findByLabel(harness, t('files.refresh'))
  assert.ok(personalRefresh !== undefined, '个人 keeps the refresh button in the 文件 header')
  assert.ok(hostsOf(harness).indexOf(searchBox) > hostsOf(harness).indexOf(filesHead),
    '个人 keeps the search inside the 文件 header')

  await click(harness, t('tabs.workspace'))
  assert.equal(hostsOf(harness).filter((node) => String(node.props?.className ?? '') === 'hm-filesHead').length, 0,
    'the 文件 header is hidden on 项目与会话')
  const workspaceNodes = hostsOf(harness)
  const workspaceSearch = findInput(harness, (props) => props.type === 'search')
  assert.ok(workspaceSearch !== undefined, 'the search field moves into the workspace row')
  const pill = findByLabel(harness, t('project.select'))
  assert.ok(workspaceNodes.indexOf(workspaceSearch) > workspaceNodes.indexOf(pill),
    'the search sits to the right of the project pill on the same row')
  const workspaceRefresh = findByLabel(harness, t('files.refresh'))
  assert.ok(workspaceRefresh !== undefined, 'the refresh button renders on 项目与会话 too')
  assert.ok(workspaceNodes.indexOf(workspaceRefresh) > workspaceNodes.indexOf(workspaceSearch),
    'the refresh button sits right of the inline search')
  assert.equal(pill.props['aria-expanded'], 'false', 'the picker starts closed')
  assert.ok(harness.mini.textOf(pill).includes(STATUS.project.title), 'the picker shows the current project')

  // Two separate blocks, not one merged list.
  assert.ok(harness.mini.text().includes(t('project.memories')), 'the 项目记忆 block head renders')
  assert.ok(harness.mini.text().includes(t('session.memories')), 'the 会话记忆 block head renders')
  assert.ok(harness.mini.text().includes(PROJECT_ITEM.content), 'project memories render in their own block')
  assert.ok(harness.mini.text().includes(SESSION_ITEMS[0].content), 'session memories render in their own block')

  const listBodies = () => harness.fetchCalls
    .filter((call) => call.url === '/api/hy-memory/list')
    .map((call) => JSON.parse(call.options.body))
  const projectCall = listBodies().filter((body) => body.tier === 'project').pop()
  const sessionCall = listBodies().filter((body) => body.tier === 'session').pop()
  assert.equal(projectCall.projectKey, 'abcdef012345', 'the project block follows the active workspace')
  assert.equal(sessionCall.sessionId, '', 'the session block reads every session of the workspace')

  // The picker is a project picker only: opening it adds no memory rows.
  const rowsBefore = hostsOf(harness).filter((node) => node.type === 'li').length
  await activate(harness, pill, 'the workspace picker')
  assert.equal(findByLabel(harness, t('project.select')).props['aria-expanded'], 'true',
    'the picker reports itself open')
  assert.ok(harness.mini.text().includes(t('project.workspace')), 'the dropdown is titled 工作区')
  const workspaceRows = hostsOf(harness).filter((node) => (node.props ?? {}).role === 'menuitemradio')
  assert.equal(workspaceRows.length, WORKSPACES.items.length, 'the dropdown lists only the workspaces')
  assert.ok(workspaceRows.some((row) => row.props['aria-checked'] === 'true'), 'the active workspace is checked')
  assert.equal(hostsOf(harness).filter((node) => node.type === 'li').length, rowsBefore,
    'opening the picker adds no memory rows to the dropdown')

  await activate(harness, findButtons(harness, 'Side project')[0], 'the other workspace row')
  assert.equal(findByLabel(harness, t('project.select')).props['aria-expanded'], 'false', 'the picker closes after a pick')
  const afterPick = listBodies().filter((body) => body.tier === 'project').pop()
  assert.equal(afterPick.projectKey, 'feedface0000', 'the project block follows the chosen workspace')
  assert.ok(harness.mini.textOf(findByLabel(harness, t('project.select'))).includes('Side project'),
    'the picker shows the chosen workspace')

  // Rows carry no provenance badge now that the blocks separate the tiers.
  assert.equal(hostsOf(harness).filter((node) => String(node.props?.className ?? '') === 'hm-fileBadge').length, 0,
    'no provenance badges remain on merged rows')

  await activate(harness, findByLabel(harness, t('row.actions')), 'the first project row action button')
  assert.ok(findButton(harness, t('row.delete')) !== undefined, 'project memories are deletable')
  assert.ok(findButton(harness, t('row.forget')) !== undefined, 'project memories can be forgotten too')
  assert.equal(findButton(harness, t('row.edit')), undefined, 'project memories are not editable')

  await activate(harness, findButton(harness, t('row.delete')), 'the delete action')
  assert.ok(harness.mini.text().includes(t('row.confirmDelete.title')), 'deleting asks for confirmation first')
  assert.equal(lastCall(harness, '/api/hy-memory/delete'), undefined, 'nothing is deleted before the confirmation')
  await activate(harness, findButton(harness, t('row.confirmDelete.cancel')), 'the cancel button')
  assert.equal(harness.mini.text().includes(t('row.confirmDelete.title')), false, 'cancelling closes the confirmation')
}

async function exerciseSessionGrouping(harness) {
  const t = await mountSection(harness, 'zh')
  await click(harness, t('tabs.workspace'))

  assert.ok(harness.mini.text().includes(t('session.memories')), 'the 会话记忆 block head renders')

  const sessionsCall = lastCall(harness, '/api/hy-memory/sessions')
  assert.ok(sessionsCall !== undefined, 'the session list is read through POST /sessions')
  assert.deepEqual(JSON.parse(sessionsCall.options.body), { projectKey: 'abcdef012345' },
    'the session list is scoped to the active workspace')

  const groups = () => hostsOf(harness)
    .filter((node) => node.type === 'h4' && String(node.props?.className ?? '') === 'hm-groupLabel')
  assert.equal(groups().length, 2, 'session memories are grouped by session')
  assert.ok(harness.mini.textOf(groups()[0]).includes('sess-a1b'), 'the current session group renders first')
  assert.ok(harness.mini.textOf(groups()[1]).includes('sess-9e8'), 'the other session group follows')
  const groupHeads = hostsOf(harness)
    .filter((node) => String(node.props?.className ?? '') === 'hm-groupHead')
  assert.ok(harness.mini.textOf(groupHeads[0]).includes(t('count.items', { n: 1 })),
    'each group header shows its own count')
  assert.ok(harness.mini.text().includes(SESSION_ITEMS[0].content), 'session memories render as file rows')
  assert.equal(hostsOf(harness).filter((node) => String(node.props?.className ?? '') === 'hm-fileBadge').length, 0,
    'session rows carry no provenance badge')

  assert.ok(findButton(harness, t('session.all')) !== undefined, 'the picker starts on 全部会话')
  await activate(harness, findButton(harness, t('session.all')), 'the session picker')
  await activate(harness, findButtons(harness, 'sess-9e8')[0], 'the second session option')
  assert.equal(groups().length, 1, 'picking a session narrows the list to that group')
  assert.ok(harness.mini.textOf(groups()[0]).includes('sess-9e8'), 'the picked group renders')
  assert.equal(harness.mini.text().includes(SESSION_ITEMS[0].content), false, 'other sessions are filtered out')
}

async function exerciseFileRows(harness) {
  const t = await mountSection(harness, 'zh')
  const text = harness.mini.text()
  assert.ok(text.includes(PERSONAL_ITEM.content), 'the card title derives from the memory body')
  assert.ok(
    text.includes(t('row.updatedAt', { time: t('time.minutes', { n: 1 }) })),
    'the card shows a muted relative date line',
  )

  const cards = hostsOf(harness).filter((node) => node.type === 'li')
  assert.equal(cards.length, 1, 'one rounded card per memory')
  assert.ok(String(cards[0].props.className).includes('hm-file'), 'the card uses the file-row shell')
  assert.equal(hostsOf(harness).filter((node) => String(node.props?.className ?? '').includes('hm-fileIcon')).length, 1,
    'each card carries a square icon badge')
  assert.ok(findByLabel(harness, t('row.actions')) !== undefined, 'each card carries its action button')

  const main = hostsOf(harness).find((node) => String(node.props?.className ?? '') === 'hm-fileMain')
  assert.ok(main !== undefined, 'the row content area is its own control')
  assert.equal(main.props['aria-expanded'], 'false', 'the row starts collapsed')
  await activate(harness, main, 'the row content area')
  const expanded = hostsOf(harness).find((node) => String(node.props?.className ?? '') === 'hm-fileMain')
  assert.equal(expanded.props['aria-expanded'], 'true', 'clicking the content expands it')
  assert.ok(hostsOf(harness).some((node) => String(node.props?.className ?? '').includes('hm-fileBody')),
    'the expanded row renders the full memory body')
  await activate(harness, expanded, 'the expanded row content area')
  assert.equal(
    hostsOf(harness).find((node) => String(node.props?.className ?? '') === 'hm-fileMain').props['aria-expanded'],
    'false',
    'clicking again collapses it',
  )
  assert.equal(hostsOf(harness).some((node) => String(node.props?.className ?? '').includes('hm-fileBody')), false,
    'the body leaves the tree when collapsed')

  await activate(harness, findByLabel(harness, t('row.actions')), 'the row action button')
  await activate(harness, findButton(harness, t('row.copy')), 'the copy action')
  assert.equal(harness.clipboardWrites[0], PERSONAL_ITEM.content, 'copy writes the memory body to the clipboard')
  assert.ok(harness.mini.text().includes(t('row.copied')), 'copy reports back inside the row')
}

async function exercisePagination(harness) {
  const t = await mountSection(harness, 'zh')
  const bodies = () => harness.fetchCalls
    .filter((call) => call.url === '/api/hy-memory/list')
    .map((call) => JSON.parse(call.options.body))
  const personalCall = () => bodies().filter((body) => body.tier === 'personal').pop()

  assert.equal(personalCall().limit, 20, 'the list requests the default page size')
  assert.equal(personalCall().offset, 0, 'the first page starts at offset 0')
  assert.equal(hostsOf(harness).filter((node) => String(node.props?.className ?? '') === 'hm-pager').length, 1,
    '个人 renders one pager under the list')
  assert.ok(harness.mini.text().includes(t('pager.total', { n: PAGE_TOTAL })), 'the pager shows the route total')
  assert.ok(harness.mini.text().includes(t('pager.page', { page: 1, pages: 3 })), 'the pager shows page 1 of 3')

  await activate(harness, findByLabel(harness, t('pager.next')), 'the next-page button')
  assert.equal(personalCall().offset, 20, 'the next page offsets by the page size')
  assert.ok(harness.mini.text().includes(t('pager.page', { page: 2, pages: 3 })), 'the pager advances')

  const sizeSelect = findSelect(harness, (props) => props['aria-label'] === t('pager.size'))
  assert.ok(sizeSelect !== undefined, 'the page-size selector renders')
  sizeSelect.props.onChange({ target: { value: '50' } })
  await settle()
  assert.equal(personalCall().limit, 50, 'changing the page size refetches with it')
  assert.equal(personalCall().offset, 0, 'changing the page size returns to page 1')
  assert.ok(harness.mini.text().includes(t('pager.page', { page: 1, pages: 1 })), '45 rows fit on one page of 50')

  await click(harness, t('tabs.workspace'))
  const projectCall = () => bodies().filter((body) => body.tier === 'project').pop()
  const sessionCall = () => bodies().filter((body) => body.tier === 'session').pop()
  assert.equal(projectCall().limit, 20, '项目记忆 keeps its own page size')
  assert.equal(sessionCall().limit, 20, '会话记忆 keeps its own page size')
  assert.equal(projectCall().offset, 0, '项目记忆 starts on its own first page')
  assert.equal(sessionCall().offset, 0, '会话记忆 starts on its own first page')
  assert.equal(hostsOf(harness).filter((node) => String(node.props?.className ?? '') === 'hm-pager').length, 2,
    'each workspace block renders its own pager')

  const nextButtons = () => hostsOf(harness)
    .filter((node) => node.type === 'button' && (node.props ?? {})['aria-label'] === t('pager.next'))
  assert.equal(nextButtons().length, 2, 'both block pagers render their navigation')
  await activate(harness, nextButtons()[0], 'the project pager next button')
  assert.equal(projectCall().offset, 20, 'the project block paginates on its own')
  assert.equal(sessionCall().offset, 0, 'moving the project page leaves the session page alone')
  await activate(harness, nextButtons()[1], 'the session pager next button')
  assert.equal(sessionCall().offset, 20, 'the session block paginates on its own')
  assert.equal(projectCall().offset, 20, 'the project page stays where it was')
}

async function exercisePersonalDelete(harness) {
  const t = await mountSection(harness, 'zh')
  await activate(harness, findByLabel(harness, t('row.actions')), 'the personal row action button')
  assert.ok(findButton(harness, t('row.edit')) !== undefined, 'personal rows still offer edit')
  assert.ok(findButton(harness, t('row.delete')) !== undefined, 'personal rows now offer delete')

  await activate(harness, findButton(harness, t('row.delete')), 'the personal delete action')
  assert.ok(harness.mini.text().includes(t('row.confirmDelete.title')), 'personal delete asks for confirmation first')
  assert.equal(lastCall(harness, '/api/hy-memory/delete'), undefined, 'nothing is deleted before the confirmation')

  await activate(harness, findButton(harness, t('row.confirmDelete.confirm')), 'the confirm button')
  assertPost(harness, '/api/hy-memory/delete', { tier: 'personal', id: PERSONAL_ITEM.id })
}

async function exerciseMemhubMissing(harness) {
  const t = await mountSection(harness, 'zh')
  const text = harness.mini.text()
  assert.ok(text.includes(t('memhub.title')), 'the MemHub card still renders when MemHub is absent')
  assert.ok(text.includes(t('memhub.missing')), 'the absent card states MemHub is not installed')
  assert.equal(findButton(harness, t('memhub.export')), undefined, 'export is hidden when MemHub is absent')
  assert.equal(findButton(harness, t('memhub.pull')), undefined, 'pull is hidden when MemHub is absent')
  assert.equal(findButton(harness, t('memhub.import')), undefined, 'import is hidden when MemHub is absent')
  assert.equal(hostsOf(harness).filter((node) => String(node.props?.className ?? '').includes('hm-cardMissing')).length, 1,
    'the absent card uses the dashed variant')
  assert.equal(findButtons(harness, t('common.details')).length, 1,
    'only the diagnostics card keeps its details toggle')
}

async function exerciseFooterAndTokens(harness) {
  const t = await mountSection(harness, 'zh')
  const text = harness.mini.text()

  // Repository link: status.package.repoUrl, made web-safe, opened in a new tab.
  const link = hostsOf(harness).find((node) => (
    node.type === 'a' && (node.props ?? {}).href === 'https://github.com/example/hy-memory4dsh'
  ))
  assert.ok(link !== undefined, 'the footer links the repository from status.package.repoUrl')
  assert.equal(link.props.target, '_blank', 'the repository link opens in a new tab')
  assert.ok(String(link.props.rel).includes('noopener'), 'the repository link uses rel=noopener')
  assert.equal(link.props['aria-label'], t('update.repo'), 'the icon link carries an accessible name')

  // Memory footprint line from status.context.
  assert.ok(text.includes(t('diag.memoryTokens', { round: 120, total: 3400 })),
    'the diagnostics card shows the memory token line')
  assert.ok(text.includes(t('counts.total', { n: 6 })),
    'the diagnostics card shows the summed total across the three tiers')

  // Pending-write line from status.capture.pending.
  assert.ok(text.includes(t('diag.pending', { n: 7 })), 'the diagnostics card shows the pending-write count')

  // The engine form is a disclosure with a picker and numeric limits.
  const engine = hostsOf(harness).find((node) => node.type === 'details' && String(node.props?.className ?? '').includes('hm-engine'))
  assert.ok(engine !== undefined, 'the diagnostics card offers the engine settings')
  const picker = hostsOf(harness).find((node) => node.type === 'select' && String(node.props?.className ?? '').includes('hm-input'))
  assert.ok(picker !== undefined, 'the engine form has a model picker')
  assert.ok(hostsOf(harness).some((node) => node.props?.value === 'auto/glm-5.3-flash' || node.props?.value === 'magpie\u0000auto/glm-5.3-flash'),
    'the picker lists a model option from status.model.options')
  const numbers = hostsOf(harness).filter((node) => node.type === 'input' && node.props?.type === 'number')
  assert.ok(numbers.length >= 5, 'the engine form exposes budget, timeout, half-life, concurrency and cap')

  const tokenInput = numbers[0]
  tokenInput.props.onChange({ target: { value: '8192' } })
  await settle()
  const saveButton = findButton(harness, t('engine.save'))
  assert.ok(saveButton !== undefined, 'the engine form has a save button')
  await activate(harness, saveButton, 'the engine save button')
  const saved = harness.fetchCalls.filter((call) => call.url === '/api/hy-memory/settings/set').pop()
  assert.deepEqual(JSON.parse(saved.options.body).patch.llm.maxTokens, 8192,
    'saving sends the edited budget in the settings patch')
  assert.deepEqual(JSON.parse(saved.options.body).patch.llm.disableReasoning, true,
    'the reasoning switch is part of the patch')

  // The automatic check: exactly one, without force, before any click.
  const updateCalls = () => harness.fetchCalls.filter((call) => call.url === '/api/hy-memory/update/check')
  assert.equal(updateCalls().length, 1, 'mounting the panel runs exactly one automatic update check')
  assert.deepEqual(JSON.parse(updateCalls()[0].options.body), { force: false },
    'the automatic check asks for the cached answer')
  assert.equal(hostsOf(harness).filter((node) => String(node.props?.className ?? '') === 'hm-updatePill').length, 0,
    'a current install shows no update notice')

  // Manual 检查更新 is the force-refresh path.
  assert.ok(findButton(harness, t('update.check')) !== undefined, 'the update check button renders')
  await click(harness, t('update.check'))
  assertPost(harness, '/api/hy-memory/update/check', { force: true })
  assert.ok(harness.mini.text().includes(t('update.latest', { version: '0.1.0' })),
    'a current install reports 已是最新 vX.Y.Z')

  // A tab switch and a full re-mount never re-run the automatic check.
  await click(harness, t('tabs.workspace'))
  assert.equal(updateCalls().length, 2, 'switching tabs does not re-run the update check')
  harness.mini.unmount()
  await mountSection(harness, 'zh')
  assert.equal(updateCalls().length, 2, 're-mounting the panel does not re-run the automatic check')
}

async function exerciseUpdateBehind(harness) {
  const t = await mountSection(harness, 'zh')
  await click(harness, t('update.check'))
  assert.ok(harness.mini.text().includes(t('update.behind', { version: '0.2.0' })),
    'a newer release renders 发现新版本 vA.B.C')
  const release = hostsOf(harness).find((node) => (
    node.type === 'a' && String((node.props ?? {}).href ?? '').includes('/releases/tag/v0.2.0')
  ))
  assert.ok(release !== undefined, 'the newer-version line links the release URL')
  assert.equal(release.props.target, '_blank', 'the release link opens in a new tab')
}

async function exerciseUpdateError(harness) {
  const t = await mountSection(harness, 'zh')
  await click(harness, t('update.check'))
  assert.ok(harness.mini.text().includes(t('update.failed')), 'a failed check renders a short failure line')
  assert.equal(harness.mini.text().includes(t('update.latest', { version: '0.1.0' })), false,
    'a failed check makes no up-to-date claim')
  assert.equal(harness.mini.text().includes(t('diag.memoryTokens', { round: 120, total: 3400 })), false,
    'the token line is hidden when status.context is absent')
}

async function exerciseAutoUpdateNotice(harness) {
  const t = await mountSection(harness, 'zh')
  const pills = () => hostsOf(harness).filter((node) => String(node.props?.className ?? '') === 'hm-updatePill')
  assert.equal(pills().length, 1, 'a behind:true automatic result renders one quiet notice pill')
  const pill = pills()[0]
  assert.equal(harness.mini.textOf(pill), t('update.newVersion', { version: '0.2.0' }),
    'the pill names the new version')
  assert.equal(pill.type, 'a', 'the pill links to the release')
  assert.equal(pill.props.href, 'https://github.com/example/hy-memory4dsh/releases/tag/v0.2.0')
  assert.equal(pill.props.target, '_blank', 'the release pill opens in a new tab')
  assert.ok(String(pill.props.rel).includes('noopener'), 'the release pill uses rel=noopener')
  assert.ok(harness.mini.text().includes(t('update.manualHint')),
    'the notice says installation is manual')

  // The forced manual check takes over from the quiet notice.
  await click(harness, t('update.check'))
  assertPost(harness, '/api/hy-memory/update/check', { force: true })
  assert.equal(pills().length, 0, 'the manual result clears the automatic notice')
  assert.ok(harness.mini.text().includes(t('update.latest', { version: '0.1.0' })),
    'the manual result renders its own line')
}

async function exerciseForget(harness) {
  const t = await mountSection(harness, 'zh')
  await activate(harness, findByLabel(harness, t('row.actions')), 'the personal row action button')
  assert.ok(findButton(harness, t('row.delete')) !== undefined, '删除 renders for personal rows')
  assert.ok(findButton(harness, t('row.forget')) !== undefined, '永久遗忘 renders next to 删除')

  await activate(harness, findButton(harness, t('row.forget')), 'the forget action')
  assert.ok(harness.mini.text().includes(t('row.confirmForget.title')), 'forgetting has its own confirmation')
  assert.ok(harness.mini.text().includes(t('row.confirmForget.body')),
    'the confirmation explains promotion will not bring the fact back')
  assert.equal(lastCall(harness, '/api/hy-memory/forget'), undefined, 'nothing is forgotten before confirming')
  assert.equal(lastCall(harness, '/api/hy-memory/delete'), undefined, 'forget never goes through the delete route')

  await activate(harness, findButton(harness, t('row.confirmForget.confirm')), 'the forget confirm button')
  assertPost(harness, '/api/hy-memory/forget', { id: PERSONAL_ITEM.id })
  assert.equal(harness.mini.text().includes(t('row.confirmForget.title')), false, 'the confirmation closes')
  const listCalls = harness.fetchCalls.filter((call) => call.url === '/api/hy-memory/list').length
  assert.ok(listCalls >= 2, 'a forgotten memory refreshes the list')
}

async function exerciseDuplicates(harness) {
  const t = await mountSection(harness, 'zh')
  assert.ok(findButton(harness, t('dupes.action')) !== undefined, 'the diagnostics card offers 整理重复项')
  const dangerButtons = hostsOf(harness).filter((node) => String(node.props?.className ?? '').includes('hm-dangerAction'))
  assert.ok(dangerButtons.length >= 1, 'destructive actions carry the red class')
  const rowHosts = hostsOf(harness).filter((node) => String(node.props?.className ?? '') === 'hm-dupeRow')
  assert.equal(rowHosts.length, 1, 'both diagnostics actions share one row')
  assert.equal(lastCall(harness, '/api/hy-memory/duplicates'), undefined, 'nothing is scanned before the click')

  await click(harness, t('dupes.action'))
  assertPost(harness, '/api/hy-memory/duplicates', {})
  assert.ok(harness.mini.text().includes(t('dupes.confirm.title')), 'a scan with duplicates asks for confirmation')
  assert.ok(harness.mini.text().includes(t('dupes.confirm.body', { rows: 3, groups: 2 })),
    'the confirmation states how many rows across how many groups would go')
  assert.equal(lastCall(harness, '/api/hy-memory/merge'), undefined, 'nothing is merged before confirming')

  await click(harness, t('dupes.confirm.confirm'))
  const merges = harness.fetchCalls.filter((call) => call.url === '/api/hy-memory/merge')
  assert.equal(merges.length, 2, 'one merge call per duplicate group')
  assert.deepEqual(JSON.parse(merges[0].options.body), { tier: 'personal', keep: 'm1', drop: ['m2', 'm3'] },
    'the first merge keeps the newest personal row and drops the rest')
  assert.deepEqual(JSON.parse(merges[1].options.body), { tier: 'project', keep: 'p1', drop: ['p2'] },
    'the second merge carries the project tier')
  assert.equal(harness.mini.text().includes(t('dupes.confirm.title')), false, 'the confirmation closes')
  assert.ok(harness.mini.text().includes(t('dupes.done', { n: 3 })), 'the result reports how many rows were removed')
  const listCalls = harness.fetchCalls.filter((call) => call.url === '/api/hy-memory/list').length
  assert.ok(listCalls >= 2, 'a merge refreshes the lists')
}

async function exerciseDuplicatesEmpty(harness) {
  const t = await mountSection(harness, 'zh')
  await click(harness, t('dupes.action'))
  assertPost(harness, '/api/hy-memory/duplicates', {})
  assert.ok(harness.mini.text().includes(t('dupes.none')), 'a clean store reports 没有重复项')
  // The two-second auto-hide runs on a timer; the mini renderer only repaints
  // from its own event path, so that timing is verified in the browser instead.
  assert.equal(findButton(harness, t('dupes.confirm.confirm')), undefined,
    'no confirmation opens when nothing is duplicated')
  assert.equal(lastCall(harness, '/api/hy-memory/merge'), undefined, 'no merge is attempted for an empty scan')
}

async function exerciseDuplicatesError(harness) {
  const t = await mountSection(harness, 'zh')
  await click(harness, t('dupes.action'))
  assert.ok(harness.mini.text().includes(t('dupes.failed', { message: 'scan failed' })),
    'a failed scan shows one short failure line')
}

async function exerciseWhyFound(harness) {
  const t = await mountSection(harness, 'zh')
  await activate(harness, findByLabel(harness, t('row.actions')), 'the personal row action button')
  assert.ok(findButton(harness, t('row.why')) !== undefined, 'the menu offers 为什么召回')
  await activate(harness, findButton(harness, t('row.why')), 'the why action')
  assertPost(harness, '/api/hy-memory/explain', { id: PERSONAL_ITEM.id })

  const text = harness.mini.text()
  assert.ok(text.includes(t('why.title')), 'the explanation dialog opens')
  assert.ok(text.includes('how do I rebuild the panel'), 'it shows the matched request')
  assert.ok(text.includes(t('why.query')), 'it labels the matched request')
  assert.ok(text.includes('0.843'), 'it shows the recall score')
  assert.ok(text.includes('#2'), 'it shows the rank in the injected list')
  assert.ok(text.includes(t('time.minutes', { n: 1 })), 'it shows a relative time')
  assert.ok(text.includes(t('why.source.both')), 'it names semantic + keyword as the source')
  assert.ok(text.includes(t('tabs.personal')), 'it shows the tier')
}

async function exerciseWhyMissing(harness) {
  const t = await mountSection(harness, 'zh')
  await activate(harness, findByLabel(harness, t('row.actions')), 'the personal row action button')
  await activate(harness, findButton(harness, t('row.why')), 'the why action')
  assertPost(harness, '/api/hy-memory/explain', { id: PERSONAL_ITEM.id })
  assert.ok(harness.mini.text().includes(t('why.never')), 'an unrecalled memory says 这条记忆还没有被召回过')
  assert.equal(harness.mini.text().includes('#2'), false, 'no rank is invented for an unrecalled memory')
}

async function exerciseWhyError(harness) {
  const t = await mountSection(harness, 'zh')
  await activate(harness, findByLabel(harness, t('row.actions')), 'the personal row action button')
  await activate(harness, findButton(harness, t('row.why')), 'the why action')
  assert.ok(harness.mini.text().includes(t('why.failed', { message: 'explain failed' })),
    'a failed lookup shows one short failure line')
}

async function exerciseWhyGated(harness) {
  const t = await mountSection(harness, 'zh')
  const explainedCall = lastCall(harness, '/api/hy-memory/explained')
  assert.ok(explainedCall !== undefined, 'the explained set is read when the lists load')
  assert.equal(explainedCall.options.method, 'POST', '/explained is a POST')

  await activate(harness, findByLabel(harness, t('row.actions')), 'the personal row action button')
  assert.ok(findButton(harness, t('row.copy')) !== undefined, 'the menu still renders')
  assert.equal(findButton(harness, t('row.why')), undefined,
    'a row that was never recalled does not offer 为什么召回')
}

async function exerciseWhyOffered(harness) {
  const t = await mountSection(harness, 'zh')
  await activate(harness, findByLabel(harness, t('row.actions')), 'the personal row action button')
  assert.ok(findButton(harness, t('row.why')) !== undefined, 'a recalled row offers 为什么召回')
}

async function exerciseInjectedText(harness) {
  const t = await mountSection(harness, 'zh')
  await click(harness, t('activity.title'))
  await harness.scheduler.advance(3000)

  const row = findByLabel(harness, t('injected.open'))
  assert.ok(row !== undefined, 'a recall entry in the activity feed is clickable')
  await activate(harness, row, 'the recall entry')
  assertPost(harness, '/api/hy-memory/injected', { at: ACTIVITY_AT })

  const text = harness.mini.text()
  assert.ok(text.includes(t('injected.title')), 'the injected-text dialog opens')
  assert.ok(text.includes('injected memory'), 'it shows the injected text')
  assert.ok(text.includes('how do I rebuild the panel'), 'it shows the matched query')
  assert.ok(text.includes(t('why.source.both')), 'it shows the match source')
  assert.ok(hostsOf(harness).some((node) => node.type === 'pre'
    && String(node.props?.className ?? '').includes('hm-injectedText')), 'the text renders as a mono block')
}

async function exerciseInjectedMissing(harness) {
  const t = await mountSection(harness, 'zh')
  await click(harness, t('activity.title'))
  await harness.scheduler.advance(3000)
  await activate(harness, findByLabel(harness, t('injected.open')), 'the recall entry')
  assertPost(harness, '/api/hy-memory/injected', { at: ACTIVITY_AT })
  assert.ok(harness.mini.text().includes(t('injected.missing')),
    'a dropped recall text shows 这次召回的文本已不在记录里')
}

async function exercisePurgeGate(harness) {
  const t = await mountSection(harness, 'zh')
  assert.equal(lastCall(harness, '/api/hy-memory/purge'), undefined, 'nothing is purged before the user asks')

  await click(harness, t('purge.action'))
  assert.ok(harness.mini.text().includes(t('purge.body', { n: 6 })),
    'the dialog states how many memories the purge would take')
  assert.ok(harness.mini.text().includes(t('purge.hint')), 'the dialog asks for the confirmation phrase')

  let confirm = findButton(harness, t('purge.confirm'))
  assert.ok(confirm !== undefined, 'the destructive button is present')
  assert.equal(confirm.props.disabled, true, 'it is disabled before anything is typed')

  const input = findInput(harness, (props) => props['aria-label'] === t('purge.hint'))
  assert.ok(input !== undefined, 'the confirmation input renders')
  input.props.onChange({ target: { value: 'PURG' } })
  await settle()
  confirm = findButton(harness, t('purge.confirm'))
  assert.equal(confirm.props.disabled, true, 'a partial phrase keeps the button disabled')
  assert.equal(lastCall(harness, '/api/hy-memory/purge'), undefined, 'a partial phrase calls nothing')

  findInput(harness, (props) => props['aria-label'] === t('purge.hint')).props.onChange({ target: { value: 'PURGE' } })
  await settle()
  confirm = findButton(harness, t('purge.confirm'))
  assert.equal(confirm.props.disabled, false, 'typing PURGE enables the button')

  await activate(harness, confirm, 'the purge confirm button')
  assertPost(harness, '/api/hy-memory/purge', { confirm: 'PURGE' })
  assert.ok(harness.mini.text().includes(t('purge.done', { n: 6 })),
    'success reports how many memories were cleared and archived')
}

async function exercisePurgeRefused(harness) {
  const t = await mountSection(harness, 'zh')
  await click(harness, t('purge.action'))
  findInput(harness, (props) => props['aria-label'] === t('purge.hint')).props.onChange({ target: { value: 'PURGE' } })
  await settle()
  await activate(harness, findButton(harness, t('purge.confirm')), 'the purge confirm button')
  assert.ok(harness.mini.text().includes(t('purge.failed', { message: 'confirm must be PURGE' })),
    'a refused purge surfaces the host error')
  assert.ok(findButton(harness, t('purge.confirm')) !== undefined, 'the dialog stays open after a refusal')
}

async function exerciseCaptureToggle(harness) {
  const t = await mountSection(harness, 'zh')
  await click(harness, t('tabs.workspace'))

  const label = hostsOf(harness).find((node) => node.type === 'label'
    && String(node.props?.className ?? '').includes('hm-captureToggle'))
  assert.ok(label !== undefined, 'the workspace row carries the per-project switch')
  assert.equal(label.props.title, t('capture.disabledHint'),
    'the tooltip says it stops new captures for this project only')

  let box = findInput(harness, (props) => props.type === 'checkbox')
  assert.ok(box !== undefined, 'the switch renders as a checkbox')
  assert.equal(box.props.checked, false, 'the active project is captured by default')
  assert.equal(box.props['aria-label'], t('capture.disabled'), 'the checkbox carries an accessible name')

  box.props.onChange({ target: { checked: true } })
  await settle()
  assertPost(harness, '/api/hy-memory/settings/set', {
    patch: { permissions: { disabledCaptureProjects: ['abcdef012345'] } },
  })
  box = findInput(harness, (props) => props.type === 'checkbox')
  assert.equal(box.props.checked, true, 'the switch reflects the saved value')

  box.props.onChange({ target: { checked: false } })
  await settle()
  assertPost(harness, '/api/hy-memory/settings/set', {
    patch: { permissions: { disabledCaptureProjects: [] } },
  })
  assert.equal(findInput(harness, (props) => props.type === 'checkbox').props.checked, false,
    'the switch clears again')
}

const withSeed = await run({ withPrimitives: true, label: 'with host primitives' })
const withoutSeed = await run({ withPrimitives: false, label: 'without host primitives (fallbacks)' })
const sessionPanelOff = await run({ withPrimitives: true, label: 'session panel disabled', sessionPanel: false })
assert.equal(
  sessionPanelOff.slotRegistrations.filter((entry) => entry.options.name === 'settings.section').length,
  1,
  'disabled: the settings section still exists',
)

exerciseNavLabel(withSeed)
assert.ok(withSeed.document.head.children.some((child) => child.id === 'hy-memory-nav-glyph'),
  'the nav stylesheet is installed at plugin boot')

const memhub = await exerciseMemhubCard(withSeed)
withSeed.mini.unmount()

const errors = await run({ withPrimitives: true, label: 'memhub errors', memhubErrors: true })
await exerciseMemhubErrors(errors)
errors.mini.unmount()

const isolated = await run({ withPrimitives: true, label: 'poll isolation' })
const isolation = await exercisePollIsolation(isolated)
isolated.mini.unmount()

const english = await run({ withPrimitives: false, label: 'english card (fallbacks)' })
await exerciseEnglishCard(english)
english.mini.unmount()

const master = await run({ withPrimitives: true, label: 'master switch' })
await exerciseMasterSwitch(master)
master.mini.unmount()

const workspaces = await run({ withPrimitives: true, label: 'workspace blocks' })
await exerciseWorkspaceBlocks(workspaces)
workspaces.mini.unmount()

const files = await run({ withPrimitives: true, label: 'file rows' })
await exerciseFileRows(files)
files.mini.unmount()

const grouped = await run({ withPrimitives: true, label: 'session grouping' })
await exerciseSessionGrouping(grouped)
grouped.mini.unmount()

const paged = await run({ withPrimitives: true, label: 'pagination' })
await exercisePagination(paged)
paged.mini.unmount()

const deleted = await run({ withPrimitives: true, label: 'personal delete' })
await exercisePersonalDelete(deleted)
deleted.mini.unmount()

const absent = await run({ withPrimitives: true, label: 'memhub absent', memhubDetected: false })
await exerciseMemhubMissing(absent)
absent.mini.unmount()

const footerRun = await run({ withPrimitives: true, label: 'footer + tokens' })
await exerciseFooterAndTokens(footerRun)
footerRun.mini.unmount()

const behindRun = await run({ withPrimitives: true, label: 'update behind', updateCheck: 'behind' })
await exerciseUpdateBehind(behindRun)
behindRun.mini.unmount()

const updateErrorRun = await run({ withPrimitives: true, label: 'update error', updateCheck: 'error', context: false })
await exerciseUpdateError(updateErrorRun)
updateErrorRun.mini.unmount()

const noticeRun = await run({ withPrimitives: true, label: 'auto update notice', autoUpdate: 'behind' })
await exerciseAutoUpdateNotice(noticeRun)
noticeRun.mini.unmount()

const forgetRun = await run({ withPrimitives: true, label: 'forget' })
await exerciseForget(forgetRun)
forgetRun.mini.unmount()

const dupeRun = await run({ withPrimitives: true, label: 'duplicates' })
await exerciseDuplicates(dupeRun)
dupeRun.mini.unmount()

const dupeEmptyRun = await run({ withPrimitives: true, label: 'duplicates none', duplicates: 'none' })
await exerciseDuplicatesEmpty(dupeEmptyRun)
dupeEmptyRun.mini.unmount()

const dupeErrorRun = await run({ withPrimitives: true, label: 'duplicates error', duplicates: 'error' })
await exerciseDuplicatesError(dupeErrorRun)
dupeErrorRun.mini.unmount()

const slotConflictRun = await run({ withPrimitives: true, label: 'slot conflict', slotConflict: true })
await exerciseSlotConflict(slotConflictRun)
slotConflictRun.mini.unmount()
console.log('  slot conflict: settings section shadows the occupied seat')

const localeConflictRun = await run({ withPrimitives: true, label: 'locale conflict', localeConflict: true })
await exerciseLocaleConflict(localeConflictRun)
localeConflictRun.mini.unmount()
console.log('  locale conflict: settings section survives an occupied namespace')

const whyRun = await run({ withPrimitives: true, label: 'why recalled' })
await exerciseWhyFound(whyRun)
whyRun.mini.unmount()

const whyMissingRun = await run({ withPrimitives: true, label: 'why not recalled', explain: 'missing' })
await exerciseWhyMissing(whyMissingRun)
whyMissingRun.mini.unmount()

const whyErrorRun = await run({ withPrimitives: true, label: 'why error', explain: 'error' })
await exerciseWhyError(whyErrorRun)
whyErrorRun.mini.unmount()

const whyGatedRun = await run({ withPrimitives: true, label: 'why gated', explained: [] })
await exerciseWhyGated(whyGatedRun)
whyGatedRun.mini.unmount()

const whyOfferedRun = await run({ withPrimitives: true, label: 'why offered' })
await exerciseWhyOffered(whyOfferedRun)
whyOfferedRun.mini.unmount()

const injectedRun = await run({ withPrimitives: true, label: 'injected text' })
await exerciseInjectedText(injectedRun)
injectedRun.mini.unmount()

const injectedMissingRun = await run({ withPrimitives: true, label: 'injected missing', injected: 'missing' })
await exerciseInjectedMissing(injectedMissingRun)
injectedMissingRun.mini.unmount()

const purgeRun = await run({ withPrimitives: true, label: 'purge' })
await exercisePurgeGate(purgeRun)
purgeRun.mini.unmount()

const purgeRefusedRun = await run({ withPrimitives: true, label: 'purge refused', purge: 'error' })
await exercisePurgeRefused(purgeRefusedRun)
purgeRefusedRun.mini.unmount()

const captureRun = await run({ withPrimitives: true, label: 'capture switch' })
await exerciseCaptureToggle(captureRun)
captureRun.mini.unmount()

console.log('panel-smoke: PASS')
console.log(`  client.js: ${clientPath}`)
console.log(`  with primitives: ${withSeed.slotRegistrations.length} slot registration(s), ${withSeed.tabRegistrations.length} tab type(s)`)
console.log(`  with primitives: fetches -> ${[...new Set(withSeed.fetchCalls.map((call) => call.url))].join(', ')}`)
console.log(`  fallback path: ${withoutSeed.slotRegistrations.length} slot registration(s), ${withoutSeed.tabRegistrations.length} tab type(s)`)
console.log(`  session panel disabled: ${sessionPanelOff.tabRegistrations.length} tab type(s), ${sessionPanelOff.slotRegistrations.filter((e) => e.options.name === 'sidebar.right.pane.tab').length} pane seat(s)`)
console.log(`  memhub card: export/pull/import POSTs verified, ${memhub.fetchCalls.filter((call) => call.url.startsWith('/api/hy-memory/memhub/')).length} memhub route call(s)`)
console.log(`  memhub errors: memhub_locked, embedding_mismatch, not_found rendered as human messages`)
console.log(`  nav glyph: label thunk returns a node (brain + 记忆), one scoped stylesheet hides the shell gear`)
console.log(`  master switch: settings/set POSTs verified, off state hides tabs/files/search/rows, header survives`)
console.log(`  workspace blocks: picker switches only the project; 项目记忆 and 会话记忆 render separately`)
console.log(`  file rows: derived title/date/actions verified, copy wrote ${files.clipboardWrites.length} clipboard value(s)`)
console.log(`  session grouping: sessions POST verified, all-session groups + picker filter verified`)
console.log(`  pagination: limit/offset verified for 个人, 项目记忆 and 会话记忆 independently (10/20/50)`)
console.log(`  personal delete: menu 删除 + confirmation + POST /delete {tier:'personal'} verified`)
console.log(`  memhub absent: dashed card, short not-installed line, all three actions hidden`)
console.log(`  footer: repo link (rel=noopener) + update/check POST with 已是最新 / 发现新版本 / failure states`)
console.log(`  memory tokens: diagnostics line reads status.context.memoryTokens/totalTokens`)
console.log(`  auto update: one force:false check per page load, quiet notice only when behind, button forces`)
console.log(`  forget: 永久遗忘 next to 删除, own confirmation, POST /forget {id}; diagnostics totals all three tiers`)
console.log(`  duplicates: scan button, 没有重复项 for a clean store, one /merge POST per group with tier/keep/drop`)
console.log(`  why recalled: 为什么召回 posts /explain {id}, shows query/tier/score/rank/time, not-found copy`)
console.log(`  why gated: 为什么召回 only for ids in /explained (absent for a never-recalled row)`)
console.log(`  injected text: clicking a recall entry posts /injected {at} and shows the capped mono block`)
console.log(`  purge: typed PURGE gate, /purge {confirm:'PURGE'}, 已清除 N 条并归档, host refusals surfaced`)
console.log(`  capture switch: 不捕获此项目 posts settings/set with permissions.disabledCaptureProjects`)
console.log(`  poll isolation: section re-renders across a tick: ${isolation.sectionDelta}, activity subtree: +${isolation.activityDelta}, section total ${isolation.sectionTotal}`)
console.log(`  effects: ${withSeed.effectLabels.join(' | ')}`)

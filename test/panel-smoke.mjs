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
  model: { ready: true, provider: 'dsh', model: 'test-model', source: 'dsh' },
  counts: { personal: 2, project: 1, session: 3 },
  scene: 'chat',
  mode: 'pro',
  embedding: { mode: 'local', ready: true },
  project: { key: 'abcdef012345', path: '/tmp/work', title: 'Work' },
  session: { id: 'sess-a1b2c3d4', title: 'Testing' },
  dataDirSize: 4096,
  // Folded into status by the host; the card must render this verbatim.
  memhub: { detected: true, path: '/Users/test/.one-memory', sizeBytes: 20480 },
})

const PAGE_TOTAL = 45

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
    DisclosureRow: (props) => react.createElement('div', null, props.title, props.open === true ? props.children : null),
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
  // The host persists `enabled`; status reads it back, so the fake keeps it too.
  const settings = { enabled: true }
  let activityPolls = 0
  return async (url, callOptions = {}) => {
    const target = String(url)
    const marker = '/api/hy-memory/'
    const verb = target.startsWith(marker) ? target.slice(marker.length) : target.slice(target.lastIndexOf('/') + 1)
    fetchCalls.push({ url: target, options: callOptions })
    if (verb === 'status' || verb === 'start') {
      return jsonResponse({ ok: true, data: { ...STATUS, enabled: settings.enabled } })
    }
    if (verb === 'settings/get') {
      return jsonResponse({ ok: true, data: { settings: { enabled: settings.enabled, ui: { sessionPanel } } } })
    }
    if (verb === 'settings/set') {
      const body = JSON.parse(callOptions.body ?? '{}')
      const patch = body.patch ?? {}
      if (typeof patch.enabled === 'boolean') settings.enabled = patch.enabled
      return jsonResponse({ ok: true, data: { settings: { enabled: settings.enabled, ui: { sessionPanel } } } })
    }
    if (verb === 'projects') return jsonResponse({ ok: true, data: WORKSPACES })
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
            at: Date.now(),
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

function createHarness({ withPrimitives, sessionPanel = true, memhubErrors = false }) {
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
  const fetchImpl = createFetch(fetchCalls, { sessionPanel, memhubErrors })

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
        slotRegistrations.push({ options, component })
        return () => {
          const index = slotRegistrations.findIndex((entry) => entry.options === options)
          if (index >= 0) slotRegistrations.splice(index, 1)
        }
      },
    },
    locale: {
      register(ns, dicts) {
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
    effectLabels,
    fetchCalls,
    clipboardWrites,
    document: documentStub,
  }
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

async function run({ withPrimitives, label, sessionPanel = true, memhubErrors = false }) {
  const harness = createHarness({ withPrimitives, sessionPanel, memhubErrors })
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
  assert.ok(switchIndex > tabIndex, 'the switch sits in the tab row, after the tabs')
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
console.log(`  poll isolation: section re-renders across a tick: ${isolation.sectionDelta}, activity subtree: +${isolation.activityDelta}, section total ${isolation.sectionTotal}`)
console.log(`  effects: ${withSeed.effectLabels.join(' | ')}`)

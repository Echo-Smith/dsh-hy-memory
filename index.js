/**
 * Host half of the Hy-Memory component: sidecar lifecycle, three-tier recall,
 * session capture, the six memory tools, and the panel API.
 *
 * Nothing in this module may throw out of a session/event or pre-step
 * listener: a memory failure degrades to one log line and an activity record.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ActivityLog } from './src/activity.js'
import { createCapture } from './src/capture.js'
import { createMemHub } from './src/memhub.js'
import { registerPanelApi, PANEL_ROUTE_PATHS } from './src/panel-api.js'
import { createRecall } from './src/recall.js'
import { createMemoryOps, createTools } from './src/tools.js'
import { describeModel as describeModelRoute, readDotEnv, readProviders, resolveDshRoute } from './src/model.js'
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, saveSettings } from './src/settings.js'
import { integrationDir, statePath } from './src/paths.js'
import { projectKey, projectTitleForPath } from './src/tiers.js'
import { Sidecar } from './src/sidecar.js'

export const name = 'hy-memory'
export const inject = ['tools', 'sessions', 'llm']

const HOST_VERSION = '0.1.0'
const STATE_SAVE_DEBOUNCE_MS = 250
const ROUTE_REFRESH_MS = 300_000
const AUTO_START_RETRY_MS = 60_000
const SESSION_TRACK_LIMIT = 200

const STATE_DEFAULTS = Object.freeze({
  version: 1,
  projects: {},
  capture: { sessions: {}, queue: [] },
  promotions: { sessions: {}, projects: {} },
  lastScene: 'chat',
  lastProject: '',
  lastSession: '',
})

function cloneDefaults() {
  return JSON.parse(JSON.stringify(STATE_DEFAULTS))
}

/** Record proof of activation where a running Harness can be inspected without restarting it. */
function writeBootMarker() {
  try {
    mkdirSync(integrationDir(), { recursive: true })
    const marker = {
      pid: process.pid,
      at: new Date().toISOString(),
      version: HOST_VERSION,
      routes: [...PANEL_ROUTE_PATHS],
      inject: [...inject],
    }
    writeFileSync(join(integrationDir(), 'boot.json'), `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
  } catch {}
}

class StateStore {
  #path
  #data
  #timer = null
  #writing = null

  constructor(path, data) {
    this.#path = path
    this.#data = data
  }

  static async open() {
    let stored = {}
    try {
      const parsed = JSON.parse(await readFile(statePath(), 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed
    } catch {}
    const data = { ...cloneDefaults(), ...stored }
    data.projects = stored.projects && typeof stored.projects === 'object' ? stored.projects : {}
    data.capture = stored.capture && typeof stored.capture === 'object' ? stored.capture : {}
    if (!data.capture.sessions || typeof data.capture.sessions !== 'object') data.capture.sessions = {}
    if (!Array.isArray(data.capture.queue)) data.capture.queue = []
    data.promotions = stored.promotions && typeof stored.promotions === 'object' ? stored.promotions : {}
    if (!data.promotions.sessions || typeof data.promotions.sessions !== 'object') data.promotions.sessions = {}
    if (!data.promotions.projects || typeof data.promotions.projects !== 'object') data.promotions.projects = {}
    return new StateStore(statePath(), data)
  }

  get data() {
    return this.#data
  }

  save() {
    if (this.#timer) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.flush()
    }, STATE_SAVE_DEBOUNCE_MS)
    this.#timer.unref?.()
  }

  async flush() {
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    if (this.#writing) await this.#writing.catch(() => {})
    this.#writing = this.#write()
    try {
      await this.#writing
    } finally {
      this.#writing = null
    }
  }

  async #write() {
    try {
      await mkdir(integrationDir(), { recursive: true })
      const target = this.#path
      const temp = `${target}.${process.pid}.tmp`
      await writeFile(temp, `${JSON.stringify(this.#data, null, 2)}\n`, 'utf8')
      const handle = await open(temp, 'r+')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temp, target)
    } catch {}
  }
}

function dedupeLogger(logger) {
  const seen = new Map()
  return (message, error) => {
    try {
      const text = `${message}: ${String(error?.message ?? error)}`
      const now = Date.now()
      if (now - (seen.get(text) ?? 0) < 60_000) return
      if (seen.size > 100) seen.clear()
      seen.set(text, now)
      logger?.warn?.(`hy-memory: ${text}`)
    } catch {}
  }
}

function createRuntime(ctx, config) {
  const activity = new ActivityLog()
  const log = dedupeLogger(ctx.logger)
  const preStepModels = new Map()
  const titles = new Map()
  let settings = structuredClone(DEFAULT_SETTINGS)
  let state = null
  let sidecar = null
  let route = null
  let routeResolvedAt = 0
  let routeRefresh = null
  let startAttemptedAt = 0
  let lastSessionId = ''
  let lastCwd = ''
  let stopped = false
  let recall = null
  let capture = null
  let ops = null

  const settingsNow = () => settings

  function getClient() {
    if (!sidecar) return null
    const status = sidecar.status()
    if (status.state === 'ready' && status.port) return sidecar.client
    maybeAutoStart()
    return null
  }

  function contextOf(payload) {
    const session = payload?.agent?.session
    const sessionId = session?.id ?? lastSessionId
    const cwd = (typeof session?.header?.cwd === 'string' ? session.header.cwd : '') || lastCwd
    return {
      sessionId: sessionId ?? '',
      projectKey: projectKey(cwd),
      projectPath: cwd,
      sessionTitle: titles.get(sessionId ?? '') ?? '',
    }
  }

  function modelFor(session) {
    const known = session?.id ? preStepModels.get(session.id) : null
    if (known) return known
    try {
      const header = session?.requestHeader?.()?.config
      if (header && typeof header.provider === 'string' && typeof header.model === 'string') {
        return { provider: header.provider, model: header.model }
      }
    } catch {}
    if (route) return { provider: route.provider, model: route.model }
    return null
  }

  async function refreshRoute() {
    const resolved = await (async () => {
      const dotEnv = await readDotEnv()
      const providers = await readProviders()
      return resolveDshRoute(providers, {}, settings, dotEnv)
    })().catch(() => null)
    route = resolved
    routeResolvedAt = Date.now()
    return route
  }

  function ensureRoute() {
    if (route || Date.now() - routeResolvedAt < ROUTE_REFRESH_MS) return Promise.resolve(route)
    if (!routeRefresh) {
      routeRefresh = refreshRoute().finally(() => {
        routeRefresh = null
      })
    }
    return routeRefresh
  }

  function maybeAutoStart() {
    if (stopped || !sidecar) return
    if (!sidecar.status().venvReady) return
    if (Date.now() - startAttemptedAt < AUTO_START_RETRY_MS) return
    startAttemptedAt = Date.now()
    void ensureRoute().then(() => sidecar.ensureStarted()).catch((error) => {
      log('sidecar start failed', error)
      activity.record({ kind: 'error', summary: 'sidecar failed to start', detail: String(error?.message ?? error), ok: false })
    })
  }

  async function ensureClient() {
    if (!sidecar) return null
    const client = sidecar.client
    if (client && sidecar.status().state === 'ready') return client
    await ensureRoute()
    startAttemptedAt = Date.now()
    return sidecar.ensureStarted()
  }

  async function applySettingsPatch(patch) {
    const previous = settings
    settings = mergeSettings(previous, patch)
    await saveSettings(settings)
    activity.record({ kind: 'sidecar', summary: 'settings updated', ok: true })
    void ensureRoute()
    const needsRestart = ['mode', 'embedding', 'language', 'llm']
      .some((key) => JSON.stringify(previous[key]) !== JSON.stringify(settings[key]))
    if (needsRestart && sidecar && sidecar.status().state === 'ready') {
      try {
        sidecar.stop()
      } catch {}
      maybeAutoStart()
    }
    return settings
  }

  function trackSession(session, event) {
    if (!session?.id) return
    lastSessionId = session.id
    if (typeof session.header?.cwd === 'string' && session.header.cwd) lastCwd = session.header.cwd
    if (event?.type === 'session/title' && typeof event.data?.title === 'string') {
      titles.set(session.id, event.data.title)
    }
    if (titles.size > SESSION_TRACK_LIMIT) titles.delete(titles.keys().next().value)
    if (state) {
      state.data.lastSession = session.id
      state.save()
    }
  }

  function recordPreStep(payload) {
    const session = payload?.agent?.session
    if (!session?.id) return
    lastSessionId = session.id
    const selection = payload?.modelSelection
    if (selection && typeof selection.provider === 'string' && typeof selection.model === 'string') {
      preStepModels.set(session.id, { provider: selection.provider, model: selection.model })
      if (preStepModels.size > SESSION_TRACK_LIMIT) preStepModels.delete(preStepModels.keys().next().value)
    }
    const cwd = typeof session.header?.cwd === 'string' ? session.header.cwd : ''
    if (cwd) {
      lastCwd = cwd
      const key = projectKey(cwd)
      if (key && state) {
        const known = state.data.projects[key]
        if (!known) state.data.projects[key] = { path: cwd, title: projectTitleForPath(cwd), lastSeenAt: Date.now() }
        else known.lastSeenAt = Date.now()
        state.data.lastProject = key
        state.save()
      }
    }
  }

  function preStep(payload, next) {
    try {
      recordPreStep(payload)
    } catch (error) {
      log('pre-step bookkeeping failed', error)
    }
    if (!recall) return next()
    return recall.handlePreStep(payload, next)
  }

  function sessionEvent(session, event) {
    try {
      trackSession(session, event)
    } catch (error) {
      log('session tracking failed', error)
    }
    if (capture) capture.handleSessionEvent(session, event)
  }

  function sessionDisposed(session) {
    try {
      if (capture) capture.handleSessionDisposed(session)
    } catch (error) {
      log('session disposal failed', error)
    }
  }

  async function start() {
    try {
      state = await StateStore.open()
      settings = await loadSettings()
      if (config?.enabled === false) settings = { ...settings, enabled: false }
      await ensureRoute()
      sidecar = new Sidecar({
        settings: settingsNow,
        getRoute: () => route,
        emit: (event) => {
          try {
            // ensureVenv() writes state.json itself; re-persist our fields after
            // any sidecar transition so a first install cannot erase the cursors.
            if (event?.state === 'ready' || event?.state === 'idle') state?.save()
            if (event?.type !== 'sidecar') return
            const failed = event.state === 'failed'
            activity.record({
              kind: failed ? 'error' : 'sidecar',
              summary: `sidecar ${event.state}${event.error ? `: ${event.error}` : ''}`,
              detail: event.port ? `port ${event.port}` : undefined,
              ok: !failed,
            })
          } catch {}
        },
      })

      ops = createMemoryOps({
        settings: settingsNow,
        state,
        activity,
        getClient,
        ensureClient,
        contextOf,
        projectKeys: () => Object.keys(state?.data?.projects ?? {}),
        log,
      })
      recall = createRecall({ settings: settingsNow, activity, getClient, contextOf, log })
      capture = createCapture({
        settings: settingsNow,
        state,
        activity,
        getClient,
        modelFor,
        resolveModel: async (session) => {
          await ensureRoute()
          return modelFor(session)
        },
        getLlm: () => ctx.get('llm'),
        log,
      })

      const memhub = createMemHub({
        settings: settingsNow,
        state,
        activity,
        getClient,
        ensureClient,
        log,
      })

      registerPanelApi(ctx, {
        settings: settingsNow,
        sidecar,
        ops,
        activity,
        state,
        memhub,
        contextOf,
        log,
        describeModel: () => describeModelRoute(route, settings),
        onSettingsChange: applySettingsPatch,
      })

      const definitions = createTools({ settings: settingsNow, state, activity, getClient, ensureClient, contextOf, log })
      ctx.effect(() => {
        const disposers = []
        for (const definition of definitions) {
          try {
            disposers.push(ctx.tools.register(definition))
          } catch (error) {
            log(`tool registration failed for ${definition?.name}`, error)
          }
        }
        return () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {}
          }
        }
      }, 'hy-memory: tools')

      const timer = setInterval(() => {
        void ensureRoute()
      }, ROUTE_REFRESH_MS)
      timer.unref?.()
      ctx.effect(() => () => clearInterval(timer), 'hy-memory: route refresh')

      if (ops) void capture.drain()
      maybeAutoStart()
    } catch (error) {
      log('hy-memory failed to start', error)
      activity.record({ kind: 'error', summary: 'hy-memory failed to start', detail: String(error?.message ?? error), ok: false })
    }
  }

  async function stop() {
    if (stopped) return
    stopped = true
    try {
      if (capture) {
        await capture.flushAll('shutdown')
        capture.dispose()
      }
    } catch {}
    try {
      if (state) await state.flush()
    } catch {}
    try {
      sidecar?.stop()
    } catch {}
  }

  return {
    start,
    stop,
    preStep,
    sessionEvent,
    sessionDisposed,
    get settings() {
      return settings
    },
    get sidecar() {
      return sidecar
    },
    get activity() {
      return activity
    },
    get state() {
      return state
    },
    ops: () => ops,
    capture: () => capture,
    recall: () => recall,
  }
}

export function apply(ctx, config) {
  writeBootMarker()
  const runtime = createRuntime(ctx, config ?? {})

  ctx.on('agent/pre-step', (payload, next) => runtime.preStep(payload, next), { prepend: true })
  ctx.on('session/event', (session, event) => runtime.sessionEvent(session, event))
  ctx.on('session/disposed', (session) => runtime.sessionDisposed(session))

  ctx.effect(() => () => {
    void runtime.stop()
  }, 'hy-memory: runtime')

  void runtime.start()
}

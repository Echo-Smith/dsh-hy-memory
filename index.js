/**
 * Host half of the Hy-Memory component: sidecar lifecycle, three-tier recall,
 * session capture, the six memory tools, and the panel API.
 *
 * Nothing in this module may throw out of a session/event or pre-step
 * listener: a memory failure degrades to one log line and an activity record.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ActivityLog } from './src/activity.js'
import { createCapture } from './src/capture.js'
import { createMemHub } from './src/memhub.js'
import { registerPanelApi, PANEL_ROUTE_PATHS } from './src/panel-api.js'
import { createRecall } from './src/recall.js'
import { createMemoryOps, createTools } from './src/tools.js'
import { describeModel as describeModelRoute, readDotEnv, readProviders, resolveDshRoute } from './src/model.js'
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, saveSettings } from './src/settings.js'
import { dshHome, integrationDir, projectsPath, statePath } from './src/paths.js'
import { projectKeysFromRows, projectKey, projectTitleForPath, resolveUser } from './src/tiers.js'
import { addToDay } from './src/usage.js'
import { sessionDirPathCandidates } from './src/session-path.js'
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

/**
 * One writer, many readers.
 *
 * A host reload can leave the previous plugin instance alive for a while. Both
 * instances then hold their own copy of `state.json` and each save overwrites
 * the other: queue progress oscillates and retry counters reset to zero, so the
 * backlog never drains. The instance that wins `state.owner.json` writes; anyone
 * who finds a live owner treats the file as read-only instead of clobbering it.
 */
class StateStore {
  #path
  #data
  #timer = null
  #writing = null
  #owner = false
  #retryAt = 0

  constructor(path, data, owner = false) {
    this.#path = path
    this.#data = data
    this.#owner = owner
  }

  get owner() {
    return this.#owner
  }

  static async tryAcquire() {
    return StateStore.#acquireOwner()
  }

  static async #acquireOwner() {
    const ownerPath = `${statePath()}.owner.json`
    const alive = (pid) => {
      if (!Number.isFinite(pid) || pid <= 0) return false
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        return error?.code === 'EPERM'
      }
    }
    try {
      const current = JSON.parse(await readFile(ownerPath, 'utf8'))
      const pid = Number(current?.pid)
      if (pid !== process.pid && alive(pid)) return false
    } catch {}
    try {
      await mkdir(dirname(ownerPath), { recursive: true })
      await writeFile(ownerPath, `${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`, 'utf8')
      return true
    } catch {
      return false
    }
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
    const owner = await StateStore.#acquireOwner()
    return new StateStore(statePath(), data, owner)
  }

  get data() {
    return this.#data
  }

  save() {
    if (!this.#owner) {
      // Probe for a released lease at most every few seconds: save() is hot.
      if (Date.now() < this.#retryAt) return
      this.#retryAt = Date.now() + 5_000
      void this.flush()
      return
    }
    if (this.#timer) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.flush()
    }, STATE_SAVE_DEBOUNCE_MS)
    this.#timer.unref?.()
  }

  async release() {
    if (!this.#owner) return
    this.#owner = false
    try {
      // Delete only our own lease: a reload can hand it to the next instance
      // before this one finishes disposing.
      const current = JSON.parse(await readFile(`${this.#path}.owner.json`, 'utf8'))
      if (Number(current?.pid) !== process.pid) return
      await rm(`${this.#path}.owner.json`, { force: true })
    } catch {}
  }

  async flush() {
    if (!this.#owner) {
      // The previous instance may have held the lease when this one started; if
      // it has exited, take the lease instead of staying read-only forever.
      if (!(await StateStore.tryAcquire())) return
      this.#owner = true
    }
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
  let defaultRoute = null
  let defaultRouteAt = 0
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
      // Subagent sessions name their lead here; sharing its memory is the
      // difference between a teammate with context and one starting cold.
      parentSessionId: typeof session?.header?.parentSession === 'string' ? session.header.parentSession : '',
      projectKey: projectKey(cwd),
      projectPath: cwd,
      sessionTitle: titles.get(sessionId ?? '') ?? '',
    }
  }

  /**
   * The model this session is actually calling, in order of authority:
   * the selection the host reported for this turn, the session's own request
   * header, and only then the profile default. The last one is a fallback for
   * sessions that have not reported yet, not a policy — writing through a
   * different model than the conversation uses is what the user objected to.
   */
  /**
   * The model each live session is calling, keyed by session id.
   *
   * The sidecar is one process with one model, so "follow the session" cannot
   * mean "follow whichever session spoke last": two sessions on different models
   * would restart it on every turn (observed: seven restarts in ten minutes).
   * The sidecar runs on the model of the most recently active session, and only
   * restarts when that session genuinely changes model — not when the user
   * switches to another session that happens to use something else.
   */
  // Every live session's model, for display only.
  const sessionModels = new Map()

  /**
   * Record which model a session is calling. This is deliberately *not* fed to
   * the sidecar.
   *
   * The SDK reads MEMORY_LLM_MODEL from the environment once, at process start,
   * so one sidecar serves exactly one model and cannot switch per request. That
   * makes "follow the session" impossible without restarting the sidecar on
   * every turn — measured at seven restarts in ten minutes with two sessions,
   * each restart dropping the in-flight batches. Both candidate models answer
   * on this gateway, so the fixed model is a working model; when it is not, the
   * banner says so and offers a picker. Correctness of memory content does not
   * depend on which model wrote it.
   */
  function recordSessionModel(sessionId, selection) {
    if (!sessionId) return
    if (!selection || typeof selection.provider !== 'string' || typeof selection.model !== 'string') return
    if (!selection.provider || !selection.model) return
    sessionModels.set(sessionId, { provider: selection.provider, model: selection.model })
    if (sessionModels.size > SESSION_TRACK_LIMIT) sessionModels.delete(sessionModels.keys().next().value)
  }

  function modelFor(session) {
    const known = session?.id ? preStepModels.get(session.id) : null
    if (known) return { ...known, source: 'session-turn' }
    try {
      const header = session?.requestHeader?.()?.config
      if (header && typeof header.provider === 'string' && typeof header.model === 'string') {
        return { provider: header.provider, model: header.model, source: 'session-header' }
      }
    } catch {}
    if (route) return { provider: route.provider, model: route.model, source: 'profile-default' }
    return null
  }

  /**
   * Rebuild the project index from the store.
   *
   * Project keys used to be recorded only in state.json, which a venv-marker
   * write could erase, taking the panel's project picker with it. The store is
   * the authority for which projects exist, so it can be re-derived at boot.
   */
  /** Read the standalone project index; tolerant of a missing or broken file. */
  function readProjectIndex() {
    try {
      return JSON.parse(readFileSync(projectsPath(), 'utf8'))
    } catch {
      return {}
    }
  }

  /** Merge into the standalone index; the panel reads it directly. */
  function writeProjectIndex(entries) {
    try {
      const merged = { ...readProjectIndex(), ...entries }
      writeFileSync(projectsPath(), `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
      return merged
    } catch {
      return null
    }
  }

  async function recoverProjects(attempt = 0) {
    const store = state?.data
    const client = sidecar?.client
    if (store) {
      // Record every attempt, including the ones that cannot run yet, so a silent
      // no-op is distinguishable from "never called".
      store.projectsRecovery = { at: Date.now(), attempt, client: Boolean(client) }
      state.save()
    }
    if (!store || !client || typeof client.bridgeList !== 'function') {
      // The sidecar may still be starting when the prewarm chain resolves.
      if (attempt < 5) setTimeout(() => { void recoverProjects(attempt + 1) }, 4000).unref?.()
      return 0
    }
    const known = store.projects && typeof store.projects === 'object' ? store.projects : (store.projects = {})
    try {
      const user = resolveUser(settings)
      const keys = new Set()
      for (let offset = 0; offset < 5000; offset += 200) {
        const page = await client.bridgeList({ user_ids: [user], scene: 'all', limit: 200, offset })
        const rows = Array.isArray(page?.memories) ? page.memories : []
        for (const key of projectKeysFromRows(rows)) keys.add(key)
        if (rows.length < 200) break
      }
      let added = 0
      for (const key of keys) {
        if (known[key]) continue
        known[key] = { title: key, path: '' }
        added += 1
      }
      // Names come from session directories: one directory per workspace cwd, so
      // the key in `project:<sha1>` can be matched back to a real path and title.
      const named = {}
      try {
        const wanted = new Set(keys)
        for (const entry of await readdir(join(dshHome(), 'sessions'), { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          // The directory name is ambiguous about literal hyphens, so test the
          // candidates against the disk and against the keys we are recovering.
          for (const candidate of sessionDirPathCandidates(entry.name)) {
            const key = projectKey(candidate)
            if (!wanted.has(key) || named[key]) continue
            if (!existsSync(candidate)) continue
            named[key] = { path: candidate, title: projectTitleForPath(candidate) }
            break
          }
        }
      } catch {}

      const standaloneBefore = readProjectIndex()
      const recovered = {}
      for (const key of keys) recovered[key] = standaloneBefore[key]?.path ? standaloneBefore[key] : { title: key, path: '' }
      const merged = { ...recovered, ...named }
      const toAdd = {}
      for (const [key, entry] of Object.entries(merged)) {
        if (standaloneBefore[key]?.path === entry.path && standaloneBefore[key]?.title === entry.title) continue
        toAdd[key] = entry
      }
      if (Object.keys(toAdd).length > 0) writeProjectIndex(toAdd)
      if (state?.data) {
        // Visible evidence for the panel and for debugging: recovery used to run
        // silently and could not be told apart from "never ran".
        state.data.projectsRecovery = { at: Date.now(), attempt, looked: keys.size, added, standalone: Object.keys(readProjectIndex()).length }
        state.save()
      }
      if (added > 0) log(`recovered ${added} project key(s) from the memory store`)
      return added
    } catch (error) {
      log('project recovery failed', error)
      return 0
    }
  }

  /** OpenAI-compatible providers/models this profile offers, for the panel picker. */
  async function listModelOptions() {
    try {
      const providers = await readProviders()
      const options = []
      for (const [providerName, provider] of Object.entries(providers)) {
        if (!provider || provider.api !== 'openai-completions') continue
        const models = Array.isArray(provider.models) ? provider.models : []
        for (const entry of models) {
          const id = typeof entry?.id === 'string' ? entry.id : ''
          if (!id) continue
          options.push({ provider: providerName, model: id, label: `${id} · ${providerName}` })
        }
      }
      return options
    } catch {
      return []
    }
  }

  /**
   * What DSH would pick with no plugin override. The panel shows this next to
   * "follow the DSH default" so the choice is never abstract.
   */
  async function resolveDshDefaultRoute() {
    if (defaultRoute && Date.now() - defaultRouteAt < ROUTE_REFRESH_MS) return defaultRoute
    try {
      const dotEnv = await readDotEnv()
      const providers = await readProviders()
      const top = { ...(settings.llm ?? {}), provider: '', model: '' }
      defaultRoute = resolveDshRoute(providers, {}, { ...settings, llm: top }, dotEnv)
    } catch {
      defaultRoute = null
    }
    defaultRouteAt = Date.now()
    return defaultRoute
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

  /**
   * Move memory onto a model that answers. Runs in the background after repeated
   * write failures; the user sees a notice, not a configuration task.
   */
  async function failoverModel(info) {
    try {
      // Never override a choice the user made explicitly. Failover exists for
      // the case where nobody chose and the default happens to be broken; if the
      // user picked a model, a failure is reported, not silently replaced.
      if (state?.data?.modelChosenByUser === true) {
        log('memory model is failing, but it was chosen by the user; not switching')
        activity.record({
          kind: 'error',
          summary: 'memory model keeps failing',
          detail: `chosen by the user: ${settings?.llm?.provider ?? ''}/${settings?.llm?.model ?? ''}`,
          ok: false,
        })
        return
      }
      const options = await listModelOptions()
      if (!Array.isArray(options) || options.length === 0) return
      const current = settings?.llm ?? {}
      const currentModel = current.model || route?.model || ''
      const next = options.find((option) => option.model !== currentModel)
      if (!next) return
      log(`memory model failing (${info?.code ?? 'unknown'} x${info?.consecutive ?? 0}); moving to ${next.model}`)
      await applySettingsPatch({ llm: { ...current, provider: next.provider, model: next.model } })
      if (state?.data) {
        state.data.modelFailover = { at: Date.now(), from: currentModel, to: next.model, code: String(info?.code ?? '') }
        state.save()
      }
      activity.record({ kind: 'error', summary: `memory model switched to ${next.model}`, detail: `from ${currentModel}`, ok: true })
    } catch (error) {
      log('model failover failed', error)
    }
  }

  /**
   * Adopt a model once and keep it.
   *
   * The rule the user asked for: an explicit configuration always wins; with no
   * configuration the first model the profile resolves (which reflects the
   * session's own model) is adopted and recorded as configuration. After that
   * the choice is stable — switching sessions must not move memory onto a
   * different model, because a switch costs a sidecar restart and drops the
   * in-flight writes.
   */
  async function adoptInitialModel() {
    const configured = settings?.llm ?? {}
    if (configured.provider && configured.model) return null
    if (configured.source === 'custom') return null
    const resolved = route ?? (await ensureRoute())
    if (!resolved || !resolved.provider || !resolved.model) return null
    // Prefer a cheap model for this one-time choice: it runs in the background
    // and its job is to turn conversation into facts, not to reason.
    const options = await listModelOptions()
    const cheap = pickCheapModel(options, resolved.provider)
    const provider = cheap?.provider ?? resolved.provider
    const model = cheap?.model ?? resolved.model
    await applySettingsPatch({ llm: { ...settings.llm, provider, model } })
    if (state?.data) {
      state.data.modelAdopted = { at: Date.now(), provider, model, source: cheap ? 'cheap' : 'session' }
      state.save()
    }
    log(`adopted memory model ${provider}/${model}`)
    return { provider, model }
  }

  /** Cheapest usable option: small/flash/mini tiers first, same provider if possible. */
  function pickCheapModel(options, preferProvider) {
    if (!Array.isArray(options) || options.length === 0) return null
    const cheapness = (option) => {
      const id = String(option.model ?? '').toLowerCase()
      if (/nano|mini|small|lite|flash/.test(id)) return 0
      if (/pro|max|opus|large/.test(id)) return 2
      return 1
    }
    const ranked = [...options].sort((a, b) => {
      const byCost = cheapness(a) - cheapness(b)
      if (byCost !== 0) return byCost
      const aPreferred = a.provider === preferProvider ? 0 : 1
      const bPreferred = b.provider === preferProvider ? 0 : 1
      return aPreferred - bPreferred
    })
    return ranked[0] ?? null
  }

  // Settings are written from three places (the panel, model adoption, and
  // failover). Two writers racing left a saved model and the running model
  // disagreeing, so writes are serialised.
  let settingsWrite = Promise.resolve()

  async function applySettingsPatch(patch) {
    const run = () => applySettingsPatchNow(patch)
    const chained = settingsWrite.then(run, run)
    settingsWrite = chained.catch(() => {})
    return chained
  }

  async function applySettingsPatchNow(patch) {
    const previous = settings
    settings = mergeSettings(previous, patch)
    await saveSettings(settings)
    activity.record({ kind: 'sidecar', summary: 'settings updated', ok: true })
    void ensureRoute()
    // Only a real change restarts the sidecar: saving an unchanged form must not
    // interrupt writes (the user asked to verify that a save takes effect, not
    // to pay for it).
    const llmChanged = (previous.llm?.provider ?? '') !== (settings.llm?.provider ?? '')
      || (previous.llm?.model ?? '') !== (settings.llm?.model ?? '')
      || (previous.llm?.source ?? '') !== (settings.llm?.source ?? '')
      || (previous.llm?.baseURL ?? '') !== (settings.llm?.baseURL ?? '')
      || (previous.llm?.apiKey ?? '') !== (settings.llm?.apiKey ?? '')
    const needsRestart = ['mode', 'embedding', 'language'].some((key) => JSON.stringify(previous[key]) !== JSON.stringify(settings[key])) || llmChanged
    if (needsRestart && sidecar) {
      // Stop whatever is running regardless of the reported state: a sidecar in
      // 'starting' also holds the old model, and leaving it up meant a saved
      // model change silently kept serving writes on the previous model.
      const before = sidecar.status().state
      try {
        sidecar.stop()
      } catch {}
      if (state?.data) {
        state.data.lastLlmRestart = { at: Date.now(), from: before, provider: settings.llm?.provider, model: settings.llm?.model }
        state.save()
      }
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
      recordSessionModel(session.id, selection)
      if (preStepModels.size > SESSION_TRACK_LIMIT) preStepModels.delete(preStepModels.keys().next().value)
    }
    const cwd = typeof session.header?.cwd === 'string' ? session.header.cwd : ''
    if (cwd) {
      lastCwd = cwd
      const key = projectKey(cwd)
      if (key && state) {
        const known = state.data.projects[key]
        if (!known) {
          state.data.projects[key] = { path: cwd, title: projectTitleForPath(cwd), lastSeenAt: Date.now() }
          state.save()
        } else if (!known.path || !known.title || known.title === key) {
          // A placeholder written during recovery used to be permanent: the
          // title stayed the hash even though the real cwd was right here, which
          // is why the panel showed keys long after the data was known.
          known.path = cwd
          known.title = projectTitleForPath(cwd)
          known.lastSeenAt = Date.now()
          if (typeof writeProjectIndex === 'function') writeProjectIndex({ [key]: { path: cwd, title: known.title } })
          state.save()
        } else {
          known.lastSeenAt = Date.now()
        }
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
      // Freeze the model before the sidecar starts, so the first start already
      // uses the model this profile will keep.
      await adoptInitialModel().catch((error) => log('initial model adoption failed', error))
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

      // Cold start costs about a second; warming at boot means the first turn
      // does not have to spend it, and an idle stop later is invisible.
      if (settings?.enabled !== false && settings?.sidecar?.prewarm !== false) {
        void sidecar.ensureStarted()
          .then(() => recoverProjects())
          .then(() => log('sidecar prewarmed'))
          .catch((error) => {
            log('sidecar prewarm failed', error?.message ?? error)
            // A missing model route at true app start is usually temporary (DSH
            // is still writing its own config). Retry on the same cadence as
            // maybeAutoStart instead of leaving the panel on a stale banner.
            const retryable = String(error?.name ?? '') === 'StartRetry'
            if (retryable && !stopped) {
              const retry = setTimeout(() => {
                void sidecar.ensureStarted()
                  .then(() => recoverProjects())
                  .then(() => log('sidecar started on retry'))
                  .catch(() => {})
              }, AUTO_START_RETRY_MS)
              retry.unref?.()
            }
          })
      }
      ops = createMemoryOps({
        settings: settingsNow,
        state,
        activity,
        getClient,
        ensureClient,
        contextOf,
        projectKeys: () => Object.keys(state?.data?.projects ?? {}),
        readProjectIndex,
        log,
      })
      const memoryContext = { lastTokens: 0, lastItems: 0, lastTiers: [], lastAt: 0, totalTokens: 0, totalItems: 0 }
      recall = createRecall({
        settings: settingsNow,
        activity,
        getClient,
        warmClient: async () => {
          await sidecar.ensureStarted()
          return sidecar.client
        },
        contextOf,
        log,
        onInjected: (info) => {
          const tokens = Math.ceil((info?.chars ?? 0) / 2.2)
          memoryContext.lastTokens = tokens
          memoryContext.lastItems = info?.items ?? 0
          memoryContext.lastTiers = info?.tiers ?? []
          memoryContext.lastSource = info?.source ?? 'semantic'
          if (info?.source === 'lexical' || info?.source === 'both') memoryContext.lexicalTurns = (memoryContext.lexicalTurns ?? 0) + 1
          memoryContext.turns = (memoryContext.turns ?? 0) + 1
          const store = state?.data
          if (store && Array.isArray(info?.entries) && info.entries.length > 0) {
            if (!Array.isArray(store.recallLog)) store.recallLog = []
            store.recallLog.push({
              at: Date.now(),
              query: String(info.query ?? '').slice(0, 200),
              text: String(info.text ?? '').slice(0, 4000),
              source: info.source ?? 'semantic',
              items: info.entries,
            })
            if (store.recallLog.length > 50) store.recallLog.splice(0, store.recallLog.length - 50)
            state.save()
          }
          memoryContext.lastAt = Date.now()
          memoryContext.totalTokens += tokens
          memoryContext.totalItems += info?.items ?? 0
          // Persist the running totals: the panel showed zeros after every
          // reload, which read as a bug rather than an empty window.
          const usageStore = state?.data
          if (usageStore) {
            const previous = usageStore.recallUsage && typeof usageStore.recallUsage === 'object'
              ? usageStore.recallUsage
              : { turns: 0, items: 0, tokens: 0, lexical: 0 }
            usageStore.recallUsage = {
              turns: (previous.turns ?? 0) + 1,
              items: (previous.items ?? 0) + (info?.items ?? 0),
              tokens: (previous.tokens ?? 0) + tokens,
              lexical: (previous.lexical ?? 0) + (info?.source === 'lexical' || info?.source === 'both' ? 1 : 0),
              lastAt: Date.now(),
            }
            usageStore.recallUsageByDay = addToDay(usageStore.recallUsageByDay, {
              turns: 1,
              items: info?.items ?? 0,
              tokens,
              lexical: info?.source === 'lexical' || info?.source === 'both' ? 1 : 0,
            })
            state.save()
          }
        },
      })
      capture = createCapture({
        settings: settingsNow,
        state,
        activity,
        getClient,
        modelFor,
        resolveModel: async (session) => {
          // Ask the session first. Refreshing the profile route before answering
          // could only ever replace a live selection with the profile default.
          const fromSession = modelFor(session)
          if (fromSession && fromSession.source !== 'profile-default') return fromSession
          await ensureRoute()
          return modelFor(session) ?? fromSession
        },
        getLlm: () => ctx.get('llm'),
        // Memory writes use the sidecar's fixed model; when it keeps failing the
        // plugin moves itself to another model rather than asking the user to.
        onModelUnhealthy: (info) => { void failoverModel(info) },
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
        contextUsage: () => memoryContext,
        queueDepth: () => capture?.queueDepth?.() ?? 0,
        // Which models the live sessions are on, for display.
        sessionModels: () => [...sessionModels.values()],
        // A model that keeps failing is a user-visible problem only if nothing
        // recovers on its own. When memory writes have failed repeatedly, offer
        // the next usable model instead of asking the user to configure one.
        suggestFallbackModel: async () => {
          const health = state?.data?.modelHealth
          if (!health || Number(health.consecutive ?? 0) < 3) return null
          const options = await listModelOptions()
          const tried = String(health.model ?? '')
          const next = options.find((option) => option.model !== tried)
          return next ? { from: tried, to: next.model, failures: Number(health.consecutive) } : null
        },
        listModelOptions,
        recoverProjects,
        readProjectIndex,
        describeDefaultModel: async () => describeModelRoute(await resolveDshDefaultRoute(), settings),
        ops,
        activity,
        state,
        memhub,
        contextOf,
        log,
        describeModel: () => describeModelRoute(route, settings),
        onSettingsChange: async (patch) => {
          // A model coming from the panel is the user's decision: record it so
          // failover will not override it later.
          const chosen = Boolean(patch?.llm?.provider && patch?.llm?.model)
          const next = await applySettingsPatch(patch)
          if (chosen && state?.data) {
            state.data.modelChosenByUser = true
            state.data.modelChoice = { at: Date.now(), provider: next.llm?.provider, model: next.llm?.model }
            state.save()
          }
          return next
        },
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
      if (state) await state.release()
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

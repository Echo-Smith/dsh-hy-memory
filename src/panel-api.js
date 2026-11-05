/**
 * Panel HTTP surface: exact Fetch routes below `/api`, owner-only by the
 * connection carrier. Every route answers JSON, including failures.
 */
import { readFileSync } from 'node:fs'
import { MemHubError, detectPairing } from './memhub.js'
import { MemoryRequestError, MemoryUnavailableError } from './tools.js'

export const PANEL_PREFIX = '/api/hy-memory'

const EMPTY_MEMHUB = Object.freeze({ detected: false, path: '', sizeBytes: 0, stores: {} })

export const PANEL_ROUTE_DEFS = Object.freeze([
  { name: 'status', request: '{}' },
  { name: 'list', request: '{ tier, projectKey?, sessionId?, query?, limit?, offset? }' },
  { name: 'update', request: '{ tier, id, content }' },
  { name: 'delete', request: '{ tier, id }' },
  { name: 'search', request: '{ query, tiers?, limit? }' },
  { name: 'settings/get', request: '{}' },
  { name: 'settings/set', request: '{ patch }' },
  { name: 'activity', request: '{ since? }' },
  { name: 'start', request: '{}' },
  { name: 'memhub/export', request: '{}' },
  { name: 'memhub/import', request: '{ path? }' },
  { name: 'memhub/pull', request: '{}' },
  { name: 'projects', request: '{}' },
  { name: 'sessions', request: '{ projectKey? }' },
  { name: 'forget', request: '{ id }' },
  { name: 'duplicates', request: '{ tier? }' },
  { name: 'explain', request: '{ id }' },
  { name: 'explained', request: '{}' },
  { name: 'injected', request: '{ at }' },
  { name: 'purge', request: '{ confirm }' },
  { name: 'merge', request: '{ tier, keep?, drop }' },
  { name: 'update/check', request: '{}' },
])

export const PANEL_ROUTE_PATHS = Object.freeze(PANEL_ROUTE_DEFS.map((def) => `${PANEL_PREFIX}/${def.name}`))

export function jsonResponse(data, status = 200) {
  return Response.json({ ok: true, data }, { status })
}

export function errorResponse(code, message, status = 400) {
  return Response.json({ ok: false, error: { code, message } }, { status })
}

async function readBody(request) {
  try {
    const text = await request.text()
    if (!text.trim()) return {}
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return null
  }
}

function failureStatus(error) {
  if (error instanceof MemHubError) return error.status
  if (error instanceof MemoryUnavailableError) return 503
  if (error instanceof MemoryRequestError) {
    if (error.code === 'not_found') return 404
    return 400
  }
  if (error?.status === 404) return 404
  if (error?.status === 409) return 409
  if (error?.status === 400) return 400
  return 500
}

function failureCode(error) {
  if (error instanceof MemHubError) return error.code
  if (error instanceof MemoryUnavailableError) return error.code
  if (error instanceof MemoryRequestError) return error.code
  if (error?.status === 404) return 'not_found'
  return 'memory_error'
}

export function createPanelApi(deps) {
  const settings = deps.settings
  const sidecar = deps.sidecar
  const ops = deps.ops
  const activity = deps.activity
  const state = deps.state
  const describeModel = deps.describeModel
  const contextOf = deps.contextOf
  const memhub = deps.memhub ?? null
  const contextUsage = typeof deps.contextUsage === 'function' ? deps.contextUsage : () => null
  const queueDepth = typeof deps.queueDepth === 'function' ? deps.queueDepth : () => 0
  const listModelOptions = typeof deps.listModelOptions === 'function' ? deps.listModelOptions : async () => []
  const describeDefaultModel = typeof deps.describeDefaultModel === 'function' ? deps.describeDefaultModel : async () => null
  const recoverProjects = typeof deps.recoverProjects === 'function' ? deps.recoverProjects : null
  const readProjectIndex = typeof deps.readProjectIndex === 'function' ? deps.readProjectIndex : () => ({})
  const onSettingsChange = deps.onSettingsChange ?? (() => {})

  function contextOfRequest(body) {
    const base = typeof contextOf === 'function' ? contextOf() : {}
    return {
      projectKey: typeof body.projectKey === 'string' ? body.projectKey : base.projectKey,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : base.sessionId,
      projectPath: base.projectPath,
      sessionTitle: base.sessionTitle,
    }
  }

  async function statusPayload() {
    const config = settings()
    const context = contextOfRequest({})
    let counts = { personal: 0, project: 0, session: 0 }
    try {
      counts = await ops.counts(context)
    } catch {}
    const status = sidecar.status()
    const model = describeModel()
    const defaultModel = await describeDefaultModel().catch(() => null)
    const embedding = config.embedding ?? { mode: 'local' }
    const embeddingReady = embedding.mode === 'local'
      ? status.state === 'ready' && status.venvReady === true
      : Boolean(embedding.baseURL && embedding.model)
    const project = ops.projectInfo(context)
    const sessionTitle = context.sessionTitle ?? ''
    return {
      enabled: config.enabled !== false,
      sidecar: {
        state: status.state,
        port: status.port,
        pid: status.pid,
        startedAt: status.startedAt,
        lastError: status.lastError,
        venvReady: status.venvReady,
      },
      model: {
        ready: model.ready === true,
        provider: model.provider ?? '',
        model: model.model ?? '',
        source: model.source ?? 'dsh',
        maxTokens: Number((config.llm ?? {}).maxTokens) || 4096,
        timeoutMs: Number((config.llm ?? {}).timeoutMs) || 180000,
        disableReasoning: (config.llm ?? {}).disableReasoning !== false,
        options: await listModelOptions(),
        dshDefault: (() => {
          const fallback = defaultModel
          return {
            provider: fallback?.provider ?? '',
            model: fallback?.model ?? '',
            ready: fallback?.ready === true,
          }
        })(),
      },
      counts,
      scene: state?.data?.lastScene ?? 'chat',
      mode: config.mode ?? 'pro',
      embedding: { mode: embedding.mode ?? 'local', ready: embeddingReady },
      project,
      session: { id: context.sessionId ?? '', title: sessionTitle },
      memhub: detectMemHubStatus(),
      recall: { halfLifeDays: Number((config.recall ?? {}).halfLifeDays) || 30 },
      captureSettings: {
        concurrency: Number((config.capture ?? {}).concurrency) || 1,
        maxPerDrain: Number((config.capture ?? {}).maxPerDrain) || 8,
        maxAttempts: Number((config.capture ?? {}).maxAttempts) || 20,
      },
      capture: (() => {
        let pending = 0
        try {
          pending = Number(queueDepth()) || 0
        } catch {}
        return { pending }
      })(),
      package: (() => {
        const pkg = readPackage() ?? {}
        return { name: String(pkg.name ?? ''), version: String(pkg.version ?? ''), repoUrl: String(pkg.repository?.url ?? '') }
      })(),
      context: (() => {
        const usage = contextUsage()
        if (!usage) return null
        return {
          memoryTokens: usage.lastTokens ?? 0,
          memoryItems: usage.lastItems ?? 0,
          lastAt: usage.lastAt ?? 0,
          totalTokens: usage.totalTokens ?? 0,
          totalItems: usage.totalItems ?? 0,
          lexicalTurns: usage.lexicalTurns ?? 0,
          turns: usage.turns ?? 0,
        }
      })(),
    }
  }

  /** Cheap read-only detection; a status poll must never fail because of it. */
  function detectMemHubStatus() {
    const pairing = (() => {
      try {
        return detectPairing()
      } catch {
        return { paired: false, credentials: 0, brokerRunning: false, host: '', port: 0 }
      }
    })()
    if (!memhub) return { ...EMPTY_MEMHUB, pairing }
    try {
      return { ...memhub.detect(), pairing }
    } catch {
      return { ...EMPTY_MEMHUB, pairing }
    }
  }

  function requireMemHub() {
    if (memhub) return memhub
    throw new MemHubError('memhub_unavailable', 'the MemHub link is not wired in this host build', 503)
  }

  /** Latest published version of this plugin, compared with the installed one. */
  /** Cached for the client's automatic check; a manual click bypasses the cache. */
  const UPDATE_TTL_MS = 12 * 60 * 60 * 1000

  async function checkUpdate(body = {}) {
    const force = body?.force === true
    const cached = state?.data?.updateCheck
    if (!force && cached && typeof cached.at === 'number' && Date.now() - cached.at < UPDATE_TTL_MS) {
      return { ...cached.result, cached: true }
    }
    const result = await fetchUpdate()
    if (state?.data) state.data.updateCheck = { at: Date.now(), result }
    return result
  }

  async function fetchUpdate() {
    const pkg = readPackage()
    const current = String(pkg?.version ?? '0.0.0')
    const repoUrl = typeof pkg?.repository?.url === 'string' ? pkg.repository.url : ''
    const match = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(repoUrl)
    if (!match) return { current, latest: '', behind: false, url: '', checkedAt: Date.now(), error: 'repository_unknown' }
    const [, owner, repo] = match
    const getJson = deps.fetchJson ?? defaultFetchJson
    const api = `https://api.github.com/repos/${owner}/${repo}`
    try {
      let latest = ''
      let url = ''
      const release = await getJson(`${api}/releases/latest`)
      if (release && typeof release.tag_name === 'string') {
        latest = release.tag_name
        url = typeof release.html_url === 'string' ? release.html_url : ''
      } else {
        const tags = await getJson(`${api}/tags?per_page=1`)
        if (Array.isArray(tags) && tags.length > 0) {
          latest = String(tags[0].name ?? '')
          url = `https://github.com/${owner}/${repo}/releases`
        }
      }
      const clean = (value) => String(value).replace(/^v/i, '')
      const behind = latest !== '' && compareVersions(clean(latest), clean(current)) > 0
      return { current, latest: clean(latest), behind, url, checkedAt: Date.now() }
    } catch (error) {
      return { current, latest: '', behind: false, url: `https://github.com/${owner}/${repo}`, checkedAt: Date.now(), error: String(error?.message ?? error) }
    }
  }

  function compareVersions(left, right) {
    const parse = (value) => String(value).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
    const a = parse(left)
    const b = parse(right)
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const delta = (a[index] ?? 0) - (b[index] ?? 0)
      if (delta !== 0) return delta
    }
    return 0
  }

  function readPackage() {
    try {
      return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    } catch {
      return null
    }
  }

  async function defaultFetchJson(url) {
    const response = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'hy-memory4dsh' } })
    if (!response.ok) throw new Error(`github ${response.status}`)
    return response.json()
  }

  /** Projects known to the plugin, each with its project and session tier counts. */
  async function listProjects() {
    // A lost project index must not hide other workspaces: re-derive it from the
    // store on first use instead of returning an empty picker.
    if (Object.keys(state?.data?.projects ?? {}).length === 0 && recoverProjects !== null) {
      await recoverProjects().catch(() => 0)
    }
    // Merge per key, preferring the entry that carries a real path: the state
    // file may still hold key-only placeholders written during recovery, and
    // those would otherwise overwrite recovered titles.
    const known = {}
    for (const source of [state?.data?.projects ?? {}, readProjectIndex() ?? {}]) {
      for (const [key, entry] of Object.entries(source)) {
        const current = known[key]
        const better = current === undefined || (!current?.path && entry?.path)
        if (better) known[key] = entry
      }
    }
    const items = []
    for (const [key, meta] of Object.entries(known)) {
      let projectCount = 0
      let sessionCount = 0
      try {
        projectCount = (await ops.list({ tier: 'project', projectKey: key, limit: 1 })).total ?? 0
        sessionCount = (await ops.list({ tier: 'session', projectKey: key, limit: 1, sessionId: '' })).total ?? 0
      } catch {}
      items.push({
        key,
        title: meta?.title || key,
        path: meta?.path || '',
        projectCount,
        sessionCount,
        lastSeenAt: meta?.lastSeenAt ?? 0,
      })
    }
    items.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    return { items, current: contextOf().projectKey ?? '' }
  }

  /** Distinct sessions that have session-tier memories inside one project. */
  async function listSessions(body = {}) {
    const projectKey = typeof body.projectKey === 'string' && body.projectKey ? body.projectKey : contextOf().projectKey
    if (!projectKey) return { projectKey: '', items: [] }
    const page = await ops.list({ tier: 'session', projectKey, sessionId: '', limit: 500, offset: 0 })
    const seen = new Map()
    for (const item of page.items ?? []) {
      const id = item.sessionId || ''
      if (!id) continue
      const entry = seen.get(id) ?? { sessionId: id, count: 0, updatedAt: 0, sample: '' }
      entry.count += 1
      entry.updatedAt = Math.max(entry.updatedAt, Number(item.updatedAt) || 0)
      if (!entry.sample) entry.sample = String(item.content ?? '').slice(0, 80)
      seen.set(id, entry)
    }
    const items = [...seen.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    return { projectKey, current: contextOf().sessionId ?? '', items }
  }

  async function handle(name, body) {
    switch (name) {
      case 'status':
        return jsonResponse(await statusPayload())
      case 'list': {
        const tier = typeof body.tier === 'string' ? body.tier : 'personal'
        const page = await ops.list({
          tier,
          query: body.query,
          limit: body.limit,
          offset: body.offset,
          ...contextOfRequest(body),
        })
        return jsonResponse(page)
      }
      case 'update': {
        const result = await ops.update({ id: body.id, content: body.content })
        let item = { id: body.id, content: body.content, tier: 'personal' }
        try {
          const found = await ops.get({ id: body.id })
          if (found.item) item = found.item
        } catch {}
        return jsonResponse({ item, result })
      }
      case 'delete':
        return jsonResponse(await ops.remove({ id: body.id, tier: body.tier, ...contextOfRequest(body) }))
      case 'search': {
        const groups = await ops.search({
          query: body.query,
          tiers: body.tiers,
          limit: body.limit,
          ...contextOfRequest(body),
        })
        return jsonResponse({ groups })
      }
      case 'settings/get':
        return jsonResponse({ settings: settings() })
      case 'settings/set': {
        const patch = body.patch
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
          return errorResponse('bad_request', 'patch must be an object', 400)
        }
        const next = await onSettingsChange(patch)
        return jsonResponse({ settings: next })
      }
      case 'activity':
        return jsonResponse(activity.list({ since: Number(body.since) || 0 }))
      case 'start': {
        await ops.start()
        return jsonResponse(await statusPayload())
      }
      case 'forget':
        return jsonResponse(await ops.forget({ id: body?.id }))
      case 'explained': {
        const log = Array.isArray(state?.data?.recallLog) ? state.data.recallLog : []
        const ids = new Set()
        for (const entry of log) for (const item of entry.items ?? []) if (item.id) ids.add(item.id)
        return jsonResponse({ ids: [...ids] })
      }
      case 'purge':
        return jsonResponse(await ops.purge({ confirm: body?.confirm }))
      case 'injected': {
        const at = Number(body?.at)
        const log = Array.isArray(state?.data?.recallLog) ? state.data.recallLog : []
        const entry = log.find((candidate) => candidate.at === at)
        if (!entry) return jsonResponse({ found: false })
        return jsonResponse({ found: true, at: entry.at, query: entry.query, source: entry.source, text: entry.text ?? '' })
      }
      case 'explain': {
        const id = String(body?.id ?? '')
        const log = Array.isArray(state?.data?.recallLog) ? state.data.recallLog : []
        for (let index = log.length - 1; index >= 0; index -= 1) {
          const entry = log[index]
          const hit = (entry.items ?? []).find((item) => item.id === id)
          if (hit) return jsonResponse({ found: true, at: entry.at, query: entry.query, source: entry.source, tier: hit.tier, score: hit.score, rank: hit.rank })
        }
        return jsonResponse({ found: false })
      }
      case 'duplicates':
        return jsonResponse(await ops.duplicates(body ?? {}))
      case 'merge':
        return jsonResponse(await ops.merge(body ?? {}))
      case 'update/check':
        return jsonResponse(await checkUpdate(body))
      case 'projects':
        return jsonResponse(await listProjects())
      case 'sessions':
        return jsonResponse(await listSessions(body))
      case 'memhub/export':
        return jsonResponse(await requireMemHub().exportOurs())
      case 'memhub/import':
        return jsonResponse(await requireMemHub().importFile({ path: body.path }))
      case 'memhub/pull':
        return jsonResponse(await requireMemHub().pull())
      default:
        return errorResponse('not_found', `unknown hy-memory route ${name}`, 404)
    }
  }

  const routes = PANEL_ROUTE_DEFS.map((def) => ({
    path: `${PANEL_PREFIX}/${def.name}`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const body = await readBody(request)
      if (body === null) return errorResponse('bad_request', 'request body must be a JSON object', 400)
      try {
        return await handle(def.name, body)
      } catch (error) {
        deps.log?.(`panel route ${def.name} failed`, error)
        return errorResponse(failureCode(error), String(error?.message ?? error), failureStatus(error))
      }
    },
  }))

  return { routes, status: statusPayload, handle }
}

/**
 * Register every panel route on `ctx.connection.fetch`. The plugin keeps
 * loading when Connection is absent: the panel simply has no routes then.
 */
export function registerPanelApi(ctx, deps) {
  const api = createPanelApi(deps)
  ctx.inject(['connection'], (scope) => {
    scope.effect(() => {
      const disposers = api.routes.map((route) => scope.connection.fetch.register(route))
      return () => {
        for (const dispose of disposers) {
          try {
            void dispose()
          } catch {}
        }
      }
    }, 'hy-memory: panel routes')
  })
  return api
}

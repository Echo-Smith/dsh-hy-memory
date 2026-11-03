/**
 * Panel HTTP surface: exact Fetch routes below `/api`, owner-only by the
 * connection carrier. Every route answers JSON, including failures.
 */
import { MemHubError } from './memhub.js'
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
      },
      counts,
      scene: state?.data?.lastScene ?? 'chat',
      mode: config.mode ?? 'pro',
      embedding: { mode: embedding.mode ?? 'local', ready: embeddingReady },
      project,
      session: { id: context.sessionId ?? '', title: sessionTitle },
      memhub: detectMemHubStatus(),
    }
  }

  /** Cheap read-only detection; a status poll must never fail because of it. */
  function detectMemHubStatus() {
    if (!memhub) return { ...EMPTY_MEMHUB }
    try {
      return memhub.detect()
    } catch {
      return { ...EMPTY_MEMHUB }
    }
  }

  function requireMemHub() {
    if (memhub) return memhub
    throw new MemHubError('memhub_unavailable', 'the MemHub link is not wired in this host build', 503)
  }

  /** Projects known to the plugin, each with its project and session tier counts. */
  async function listProjects() {
    const known = state?.data?.projects ?? {}
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

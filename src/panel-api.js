/**
 * Panel HTTP surface: exact Fetch routes below `/api`, owner-only by the
 * connection carrier. Every route answers JSON, including failures.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MemHubError, detectPairing } from './memhub.js'
import { installRelease } from './updater.js'
import { projectAgentId, resolveUser } from './tiers.js'
import { MemoryRequestError, MemoryUnavailableError } from './tools.js'

export const PANEL_PREFIX = '/api/hy-memory'

const EMPTY_MEMHUB = Object.freeze({ detected: false, path: '', sizeBytes: 0, stores: {} })

export const PANEL_ROUTE_DEFS = Object.freeze([
  { name: 'status', request: '{}' },
  { name: 'list', request: '{ tier, projectKey?, sessionId?, query?, limit?, offset? }' },
  { name: 'update', request: '{ tier, id, content }' },
  { name: 'history', request: '{ id }' },
  { name: 'stats', request: '{}' },
  { name: 'narratives', request: '{}' },
  { name: 'metrics', request: '{ minutes? }' },
  { name: 'activity/recent', request: '{ limit? }' },
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
  // Deleting everything the plugin ever stored: memories, the venv, logs.
  // Separate from `purge`, which only clears memory rows.
  { name: 'erase', request: '{ confirm }' },
  { name: 'dataUsage', request: '{}' },
  { name: 'merge', request: '{ tier, keep?, drop }' },
  { name: 'update/check', request: '{}' },
  // Installing is separate from checking: it writes to the profile, and it is
  // deliberately the only way this plugin runs a package manager.
  { name: 'update/install', request: '{ version, url }' },
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
    // A null here used to throw and take the whole status route with it, which
    // blanks the entire panel. Every field below is read defensively instead.
    const model = describeModel() ?? { ready: false, provider: '', model: '', source: 'dsh' }
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
      // SDK-native aggregation: instant and consistent with the engine's own
      // view, where the per-tier counters below scan rows by tier.
      engineStats: await (async () => {
        const client = sidecar?.client
        if (!client || typeof client.bridgeStatsOverview !== 'function') return null
        try {
          const user = resolveUser(settings)
          return await client.bridgeStatsOverview({ user_id: user })
        } catch {
          return null
        }
      })(),
      // Live engine load; a failure here must not break the whole status read.
      engineMetrics: await (async () => {
        const client = sidecar?.client
        if (!client || typeof client.bridgeMetrics !== 'function') return null
        try {
          return await client.bridgeMetrics({ minutes: 60 })
        } catch {
          return null
        }
      })(),
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
      // Which model last did memory work through the session's own route.
      lastPromotionModel: state?.data?.lastPromotionModel ?? null,
      // Whether the configured model is actually answering. The user asked to be
      // told to switch models when calls keep failing, so this is surfaced rather
      // than left in the log.
      modelHealth: (() => {
        const health = state?.data?.modelHealth
        if (!health || typeof health !== 'object') return null
        const consecutive = Number(health.consecutive ?? 0)
        return {
          healthy: consecutive === 0,
          consecutive,
          lastError: String(health.lastError ?? ''),
          lastCode: String(health.lastCode ?? ''),
          lastAt: Number(health.lastAt ?? 0),
          provider: String(health.provider ?? ''),
          model: String(health.model ?? ''),
        }
      })(),
      context: (() => {
        const usage = contextUsage()
        const persisted = state?.data?.recallUsage ?? null
        if (!usage && !persisted) return null
        // Persisted totals survive a reload; the in-process counters are the
        // same numbers during one process, so either source is safe to report.
        return {
          memoryTokens: usage?.lastTokens ?? 0,
          memoryItems: usage?.lastItems ?? 0,
          lastAt: usage?.lastAt ?? persisted?.lastAt ?? 0,
          totalTokens: persisted?.tokens ?? usage?.totalTokens ?? 0,
          totalItems: persisted?.items ?? usage?.totalItems ?? 0,
          lexicalTurns: persisted?.lexical ?? usage?.lexicalTurns ?? 0,
          turns: persisted?.turns ?? usage?.turns ?? 0,
        }
      })(),
      // What writing memory actually cost, measured by the SDK per write.
      writeUsage: state?.data?.memoryUsage ?? null,
      // Last 7 local days for both counters, zero-filled so a chart always has
      // seven bars.
      usageDays: await (async () => {
        const { recentDays } = await import('./usage.js')
        return {
          days: recentDays(state?.data?.recallUsageByDay, 7).map((row) => ({
            day: row.day,
            turns: row.turns ?? 0,
            items: row.items ?? 0,
            tokens: row.tokens ?? 0,
          })),
          writes: recentDays(state?.data?.memoryUsageByDay, 7).map((row) => ({
            day: row.day,
            writes: row.writes ?? 0,
            total: row.total ?? 0,
          })),
        }
      })(),
    }
  }

  /** How much disk this plugin occupies, so a destructive action can state it. */
  async function describeDataUsage() {
    const { statSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { integrationDir } = await import('./paths.js')
    const walk = (path) => {
      let total = 0
      let entries = []
      try {
        entries = readdirSync(path, { withFileTypes: true })
      } catch {
        return 0
      }
      for (const entry of entries) {
        const child = join(path, entry.name)
        try {
          total += entry.isDirectory() ? walk(child) : statSync(child).size
        } catch {}
      }
      return total
    }
    return { path: integrationDir(), bytes: walk(integrationDir()) }
  }

  /** Remove the data, the venv, the logs and the settings file. */
  async function eraseStoredData() {
    const { rm } = await import('node:fs/promises')
    const { integrationDir, dataDir, venvDir, settingsPath } = await import('./paths.js')
    const before = (await describeDataUsage()).bytes
    for (const target of [dataDir(), venvDir(), settingsPath()]) {
      await rm(target, { recursive: true, force: true }).catch(() => {})
    }
    // Everything else the plugin wrote (state, queue, logs, projects index).
    const { readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    try {
      for (const entry of readdirSync(integrationDir())) {
        await rm(join(integrationDir(), entry), { recursive: true, force: true }).catch(() => {})
      }
    } catch {}
    return before
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
      const tarball = `https://github.com/${owner}/${repo}/releases/download/${latest}/${String(pkg?.name ?? 'dsh-hy-memory')}-${clean(latest)}.tgz`
      return { current, latest: clean(latest), behind, url, tarball, checkedAt: Date.now() }
    } catch (error) {
      return { current, latest: '', behind: false, url: `https://github.com/${owner}/${repo}`, checkedAt: Date.now(), error: String(error?.message ?? error) }
    }
  }

  /** The tarball for the release the checker reported; never taken from a request. */
  function releaseTarballUrl(checked) {
    if (typeof checked?.tarball !== 'string' || !checked.tarball.startsWith('https://github.com/')) {
      throw new MemHubError('update_no_artifact', 'this release publishes no plugin tarball', 404)
    }
    return checked.tarball
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
    const response = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-hy-memory' } })
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
      case 'update/install': {
        // Only the version the checker just reported may be installed, and its
        // URL must come from that same GitHub result rather than the request.
        const wanted = String(body?.version ?? '')
        const checked = await checkUpdate({ force: true })
        if (checked.error) throw new MemHubError('update_check_failed', checked.error, 502)
        if (!wanted || wanted !== checked.latest) {
          throw new MemHubError('update_version_mismatch', `asked for ${wanted || '(none)'}, latest is ${checked.latest}`, 409)
        }
        const result = await installRelease({
          packageDir: deps.packageDir ?? fileURLToPath(new URL('..', import.meta.url)),
          url: releaseTarballUrl(checked),
          version: wanted,
          log: (message) => log(`[update] ${message}`),
        })
        activity?.record({ kind: 'sidecar', summary: `updated ${result.previous} -> ${result.version}`, ok: true })
        return jsonResponse({ ...result, restart: 'restart-required' })
      }
      case 'dataUsage':
        return jsonResponse(await describeDataUsage())
      case 'erase': {
        // Two doors: an explicit phrase, and an acknowledgement of the size.
        if (String(body?.confirm ?? '') !== 'ERASE') {
          throw new MemHubError('confirm_required', 'confirm ERASE is required', 400)
        }
        const usage = await describeDataUsage()
        if (usage.bytes > 0 && body?.acknowledgeBytes !== usage.bytes) {
          throw new MemHubError('size_not_acknowledged', `call again with acknowledgeBytes: ${usage.bytes}`, 409)
        }
        // Stop first: SQLite and the vector store must not be written while the
        // directory underneath them disappears.
        try {
          sidecar?.stop?.()
        } catch {}
        const removed = await eraseStoredData()
        activity?.record({ kind: 'delete', summary: 'erased all memory data', detail: `${removed} bytes freed`, ok: true })
        return jsonResponse({ erased: true, bytes: removed })
      }
      case 'history':
        return jsonResponse(await ops.history({ id: body.id, ...runOptions }))
      case 'narratives': {
        // Read the narratives the engine actually stored (L3_SUMMARY), so what the
        // panel shows is what recall will use, not a separate copy.
        const client = sidecar?.client
        if (!client || typeof client.bridgeList !== 'function') {
          throw new MemoryUnavailableError('narratives need a running sidecar')
        }
        const user = resolveUser(settings)
        const key = contextOf().projectKey
        const page = await client.bridgeList({
          user_ids: [user],
          ...(key ? { agent_ids: [projectAgentId(key)] } : {}),
          scene: 'chat',
          limit: 20,
          layers: ['l3_summary'],
        })
        const rows = (page?.vdb?.memories ?? page?.memories ?? [])
        return jsonResponse({
          items: rows.map((row) => ({
            id: String(row?.memory_id ?? ''),
            sessionId: String(row?.session_id ?? ''),
            at: Number(row?.gmt_created ?? row?.created_at ?? 0) || 0,
            text: String(row?.content ?? ''),
          })),
        })
      }
      case 'stats': {
        const client = sidecar?.client
        if (!client || typeof client.bridgeStatsOverview !== 'function') throw new MemoryUnavailableError('stats need a running sidecar')
        const user = typeof body.user === 'string' && body.user ? body.user : undefined
        return jsonResponse(await client.bridgeStatsOverview(user ? { user_id: user } : {}))
      }
      case 'metrics': {
        const client = sidecar?.client
        if (!client || typeof client.bridgeMetrics !== 'function') throw new MemoryUnavailableError('metrics need a running sidecar')
        return jsonResponse(await client.bridgeMetrics({ minutes: Number(body.minutes) || 60 }))
      }
      case 'activity/recent': {
        const client = sidecar?.client
        if (!client || typeof client.bridgeRecentHistory !== 'function') throw new MemoryUnavailableError('history needs a running sidecar')
        return jsonResponse(await client.bridgeRecentHistory({ limit: Number(body.limit) || 20 }))
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

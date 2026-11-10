/**
 * Shared memory operations plus the six model-facing tools.
 *
 * Reads go through the sidecar bridge (`/bridge/v1/*`) because the SDK's own
 * HTTP routes drop `scene`: batches captured as working/coding live in separate
 * productivity stores and are invisible to `/api/v1/list` and `/api/v1/search`.
 * The bridge forwards scene and the multi-value scopes; tier attribution stays
 * here so both stores share one tier model.
 */
import { collectSearchItems } from './recall.js'
import {
  PERSONAL_AGENT,
  PROJECT_SESSION,
  contentHash,
  inferTier,
  isTier,
  normalizeItems,
  projectAgentId,
  projectKey,
  resolveUser,
  tierOfItem,
  writeScope,
} from './tiers.js'

const BRIDGE_PAGE = 200
const LIST_SCAN_CAP = 800
const COUNT_SCAN_CAP = 500
const COUNT_CACHE_MS = 5000

export class MemoryUnavailableError extends Error {
  constructor(message = 'memory sidecar is not running; open Settings > Memory and start it') {
    super(message)
    this.name = 'MemoryUnavailableError'
    this.code = 'sidecar_unavailable'
  }
}

export class MemoryRequestError extends Error {
  constructor(message, code = 'bad_request') {
    super(message)
    this.name = 'MemoryRequestError'
    this.code = code
  }
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(numeric)))
}

function normalizeTierList(tiers, fallback = ['personal', 'project', 'session']) {
  if (!Array.isArray(tiers) || tiers.length === 0) return fallback
  const filtered = tiers.filter(isTier)
  return filtered.length > 0 ? filtered : fallback
}

function optionsOf(scope) {
  return {
    ...scope?.signal ? { signal: scope.signal } : {},
    ...Number.isFinite(scope?.timeoutMs) ? { timeoutMs: scope.timeoutMs } : {},
  }
}

/** Unified chat/working/coding scene, tolerating the productivity GET shape. */
export function sceneOf(item) {
  const scene = typeof item?.scene === 'string' ? item.scene : ''
  if (scene === 'chat' || scene === 'working' || scene === 'coding') return scene
  if (scene === 'productivity' || kindOf(item) !== 'chat') {
    return String(item?.variant ?? '') === 'coding' ? 'coding' : 'working'
  }
  return 'chat'
}

export function kindOf(item) {
  const kind = item?.kind
  return kind === 'experience' || kind === 'fact' ? kind : 'chat'
}

export function isProductivityScene(scene) {
  return scene === 'working' || scene === 'coding'
}

/**
 * Whether one stored memory belongs to a tier. `strict` drops items whose scope
 * column is absent; productivity search hits omit `session_id`, so search runs
 * lenient and lets the request scope stand in for the missing column.
 */
export function matchesTier(item, tier, context = {}, { strict = true } = {}) {
  if (!item || typeof item !== 'object') return false
  const agent = typeof item.agent_id === 'string' ? item.agent_id : ''
  const session = typeof item.session_id === 'string' ? item.session_id : ''
  if (tier === 'personal') {
    if (!agent) return !strict
    return agent === PERSONAL_AGENT
  }
  if (!context.projectKey) return false
  if (!agent) return !strict
  if (agent !== projectAgentId(context.projectKey)) return false
  if (tier === 'project') return session ? session === PROJECT_SESSION : !strict
  if (!session) return !strict
  // No requested session means every session of the project (list view). Rows
  // parked on the project sentinel belong to the project tier, not here.
  if (!context.sessionId) return session !== PROJECT_SESSION
  return session === context.sessionId
}

/** Scene and scope one tier's search runs with. Only the session tier spans stores. */
export function searchScopeFor(tier, context = {}) {
  const base = { user_ids: [context.user] }
  if (tier === 'personal') return { ...base, agent_ids: [PERSONAL_AGENT], scene: 'chat' }
  if (tier === 'project') {
    return {
      ...base,
      agent_ids: [projectAgentId(context.projectKey), context.projectKey].filter(Boolean),
      session_ids: [PROJECT_SESSION],
      scene: 'chat',
    }
  }
  return {
    ...base,
    agent_ids: [projectAgentId(context.projectKey)].filter(Boolean),
    session_ids: [context.sessionId].filter(Boolean),
    scene: 'all',
  }
}

export function createMemoryOps(deps) {
  const settings = deps.settings
  const activity = deps.activity
  const getClient = deps.getClient
  const ensureClient = deps.ensureClient ?? deps.getClient
  const contextOf = deps.contextOf
  /** Known project keys, used only by an explicit cross-project search. */
  const projectKeys = typeof deps.projectKeys === 'function' ? deps.projectKeys : () => []
  const countCache = new Map()

  function ready() {
    const client = getClient()
    if (!client) throw new MemoryUnavailableError()
    return client
  }

  async function start() {
    const client = await ensureClient()
    if (!client) throw new MemoryUnavailableError()
    return client
  }

  function context(scope = {}) {
    const base = typeof contextOf === 'function' ? contextOf() : {}
    const config = settings()
    return {
      settings: config,
      user: resolveUser(config),
      projectKey: scope.projectKey ?? base.projectKey ?? '',
      sessionId: scope.sessionId ?? base.sessionId ?? '',
    }
  }

  function bridgeMethod(client, name) {
    const method = client?.[name]
    if (typeof method !== 'function') {
      throw new MemoryRequestError('memory bridge routes are unavailable; update the Hy-Memory sidecar', 'bridge_unavailable')
    }
    return method.bind(client)
  }

  /**
   * Page through the unified scene='all' stream, filtering host-side: the SDK
   * applies agent/session filters to the chat lane only, so tier attribution
   * cannot be delegated to the query for productivity items.
   */
  async function scanUnified(client, ctx, { cap, filter, need, options } = {}) {
    const bridgeList = bridgeMethod(client, 'bridgeList')
    const collected = []
    let offset = 0
    let scanned = 0
    let total = 0
    while (scanned < cap) {
      const limit = Math.min(BRIDGE_PAGE, cap - scanned)
      const response = await bridgeList({
        user_ids: [ctx.user],
        scene: 'all',
        limit,
        offset,
        order: 'desc',
      }, options)
      total = Number(response?.total) || total
      const items = Array.isArray(response?.memories) ? response.memories : []
      for (const item of items) {
        if (!filter || filter(item)) collected.push(item)
      }
      scanned += items.length
      offset += items.length
      if (items.length < limit) break
      if (need !== undefined && collected.length >= need) break
    }
    return { items: collected, scanned, total }
  }

  /** Exact id first (the SDK resolves chat and productivity namespaces), then the unified scan. */
  async function locate(client, ctx, id, options) {
    try {
      const raw = await client.get(id, {}, options)
      if (raw) return raw
    } catch (error) {
      const status = error?.status
      if (status !== 404 && status !== 409) throw error
    }
    const { items } = await scanUnified(client, ctx, {
      cap: LIST_SCAN_CAP,
      need: 1,
      options,
      filter: (item) => String(item?.memory_id ?? item?.id ?? '') === id,
    })
    return items[0] ?? null
  }

  function normalizeOne(raw, tier, ctx) {
    return normalizeItems([raw], { tier, projectKey: ctx.projectKey, sessionId: ctx.sessionId })[0] ?? null
  }

  function assertEnabled() {
    if (settings()?.enabled === false) {
      throw new MemoryRequestError('memory_disabled', 'The memory component is switched off in Settings > Memory.')
    }
  }

  async function search(
    scope = {}) {
    assertEnabled()
    const query = typeof scope.query === 'string' ? scope.query.trim() : ''
    if (!query) throw new MemoryRequestError('query is required', 'query_required')
    const client = ready()
    const ctx = context(scope)
    const tiers = normalizeTierList(scope.tiers)
    const limit = clampInteger(scope.limit, 10, 1, 30)
    const options = optionsOf(scope)
    const bridgeSearch = bridgeMethod(client, 'bridgeSearch')
    const groups = { personal: [], project: [], session: [] }
    const crossProject = scope.allProjects === true
    const searchable = tiers.filter((tier) => {
      if (crossProject && tier === 'session') return false
      if (tier === 'personal') return true
      if (!ctx.projectKey) return false
      return tier !== 'session' || Boolean(ctx.sessionId)
    })
    await Promise.all(searchable.map(async (tier) => {
      if (crossProject && tier === 'project') {
        const keys = [...new Set([ctx.projectKey, ...projectKeys()].filter(Boolean))]
        const perProject = await Promise.all(keys.map(async (key) => {
          try {
            const response = await bridgeSearch({
              query,
              limit,
              ...searchScopeFor('project', { ...ctx, projectKey: key }),
            }, options)
            return normalizeItems(
              collectSearchItems(response).filter((item) => matchesTier(item, 'project', { ...ctx, projectKey: key }, { strict: false })),
              { tier: 'project', projectKey: key, sessionId: ctx.sessionId },
            )
          } catch (error) {
            if (error?.status === 0) throw error
            return []
          }
        }))
        groups.project = perProject.flat().sort((left, right) => (Number(right.score) || 0) - (Number(left.score) || 0))
        return
      }
      try {
        const response = await bridgeSearch({
          query,
          limit,
          ...searchScopeFor(tier, ctx),
        }, options)
        groups[tier] = normalizeItems(
          collectSearchItems(response).filter((item) => matchesTier(item, tier, ctx, { strict: false })),
          { tier, projectKey: ctx.projectKey, sessionId: ctx.sessionId },
        )
      } catch (error) {
        groups[tier] = []
        if (error?.status === 0) throw error
      }
    }))
    activity?.record({
      kind: 'recall',
      summary: `manual search across ${tiers.join(', ')}`,
      detail: query.slice(0, 160),
      ok: true,
    })
    return groups
  }

  async function list(
    scope = {}) {
    assertEnabled()
    const ctx = context(scope)
    let tier = isTier(scope.tier) ? scope.tier : inferTier(content)
    if (!isTier(tier)) throw new MemoryRequestError(`unknown tier ${JSON.stringify(tier)}`, 'unknown_tier')
    // Without a project there is nowhere for a project memory to live.
    if (tier === 'project' && !ctx.projectKey) tier = 'personal'
    const limit = clampInteger(scope.limit, 20, 1, 200)
    const offset = clampInteger(scope.offset, 0, 0, 100_000)
    if (typeof scope.query === 'string' && scope.query.trim()) {
      const groups = await search({ ...scope, tiers: [tier], limit: limit + offset })
      const items = groups[tier] ?? []
      return { items: items.slice(offset, offset + limit), total: items.length, offset, limit }
    }
    // An empty sessionId means "every session of this project", which is what
    // the panel's session list asks for. Only a missing project key makes the
    // query impossible.
    if (tier !== 'personal' && !ctx.projectKey) {
      return { items: [], total: 0, offset, limit }
    }
    const { items } = await scanUnified(ready(), ctx, {
      cap: LIST_SCAN_CAP,
      need: offset + limit,
      options: optionsOf(scope),
      filter: (item) => matchesTier(item, tier, ctx),
    })
    const page = items
      .slice(offset, offset + limit)
      .map((raw) => normalizeOne(raw, tier, ctx))
      .filter(Boolean)
    return { items: page, total: items.length, offset, limit }
  }

  async function get(scope = {}) {
    const id = typeof scope.id === 'string' ? scope.id.trim() : ''
    if (!id) throw new MemoryRequestError('id is required', 'id_required')
    const ctx = context(scope)
    const raw = await locate(ready(), ctx, id, optionsOf(scope))
    if (!raw) throw new MemoryRequestError('memory not found', 'not_found')
    const tier = scope.tier ?? tierOfItem(raw, { projectKey: ctx.projectKey }) ?? 'personal'
    return { item: normalizeOne(raw, tier, ctx), raw, scene: sceneOf(raw), kind: kindOf(raw) }
  }

  async function update(
    scope = {}) {
    assertEnabled()
    const id = typeof scope.id === 'string' ? scope.id.trim() : ''
    const content = typeof scope.content === 'string' ? scope.content.trim() : ''
    if (!id) throw new MemoryRequestError('id is required', 'id_required')
    if (!content) throw new MemoryRequestError('content is required', 'content_required')
    const client = ready()
    const ctx = context(scope)
    const raw = await locate(client, ctx, id, optionsOf(scope))
    if (!raw) throw new MemoryRequestError('memory not found', 'not_found')
    const scene = sceneOf(raw)
    if (isProductivityScene(scene) || kindOf(raw) !== 'chat') {
      throw new MemoryRequestError(
        `this memory was captured with scene '${scene}' and cannot be edited; only chat memories are editable`,
        'edit_unsupported_for_scene',
      )
    }
    if (!matchesTier(raw, 'personal', ctx)) {
      throw new MemoryRequestError('only personal memories are editable', 'tier_not_editable')
    }
    // The SDK's own PUT route is not registered on the sidecar (404), so the edit
    // goes through the bridge, which calls `client.update()` on the live client.
    const kind = kindOf(raw)
    const payload = { memory_id: id, content }
    if (kind && kind !== 'chat') payload.kind = kind
    if (isProductivityScene(scene)) payload.variant = scene
    const bridgeUpdate = bridgeMethod(client, 'bridgeUpdate')
    const result = bridgeUpdate
      ? await bridgeUpdate(payload, optionsOf(scope))
      : await client.update(id, { content }, optionsOf(scope))
    countCache.clear()
    activity?.record({ kind: 'update', tier: 'personal', summary: 'updated a personal memory', detail: content.slice(0, 120), ok: true })
    return { id, updated: true, result }
  }

  async function remove(
    scope = {}) {
    assertEnabled()
    const id = typeof scope.id === 'string' ? scope.id.trim() : ''
    const tier = scope.tier
    if (!id) throw new MemoryRequestError('id is required', 'id_required')
    if (tier !== 'personal' && tier !== 'project' && tier !== 'session') {
      throw new MemoryRequestError(`unknown tier ${JSON.stringify(tier)}`, 'unknown_tier')
    }
    const client = ready()
    const ctx = context(scope)
    const raw = await locate(client, ctx, id, optionsOf(scope))
    if (!raw) throw new MemoryRequestError('memory not found', 'not_found')
    if (!matchesTier(raw, tier, ctx)) {
      throw new MemoryRequestError('memory does not belong to the requested tier', 'tier_mismatch')
    }
    const scene = sceneOf(raw)
    const kind = kindOf(raw)
    const payload = { id, kind }
    if (isProductivityScene(scene)) payload.variant = scene
    await bridgeMethod(client, 'bridgeDelete')(payload, optionsOf(scope))
    countCache.clear()
    activity?.record({ kind: 'delete', tier, summary: 'deleted a memory', detail: String(raw?.content ?? '').slice(0, 120), ok: true })
    return { deleted: true }
  }

  /** The change history of one memory, newest first. */
  async function history(scope = {}) {
    assertEnabled()
    const id = typeof scope.id === 'string' ? scope.id.trim() : ''
    if (!id) throw new MemoryRequestError('id is required', 'id_required')
    const client = ready()
    const bridgeHistory = bridgeMethod(client, 'bridgeHistory')
    if (!bridgeHistory) return { id, events: [] }
    const response = await bridgeHistory({ memory_id: id }, optionsOf(scope))
    const events = Array.isArray(response?.events) ? response.events : []
    return {
      id,
      events: events.map((event) => ({
        at: Number(event?.timestamp ?? event?.at ?? 0) || 0,
        kind: String(event?.event ?? event?.kind ?? ''),
        before: String(event?.old_memory ?? '').slice(0, 400),
        after: String(event?.new_memory ?? '').slice(0, 400),
      })),
    }
  }

  /** Delete one memory and remember its text so capture cannot reintroduce it. */
  async function forget(scope = {}) {
    assertEnabled()
    const id = typeof scope.id === 'string' ? scope.id.trim() : ''
    if (!id) throw new MemoryRequestError('id is required', 'id_required')
    const ctx = context(scope)
    const client = ready()
    const raw = await locate(client, ctx, id, optionsOf(scope))
    if (!raw) throw new MemoryRequestError('memory not found', 'not_found')
    const scene = sceneOf(raw)
    const kind = kindOf(raw)
    const payload = { id, kind }
    if (isProductivityScene(scene)) payload.variant = scene
    await bridgeMethod(client, 'bridgeDelete')(payload, optionsOf(scope))
    countCache.clear()
    const text = String(raw?.content ?? '')
    const store = deps.state?.data
    if (store) {
      if (!Array.isArray(store.forgottenHashes)) store.forgottenHashes = []
      const hash = contentHash(text)
      if (!store.forgottenHashes.includes(hash)) store.forgottenHashes.push(hash)
      if (store.forgottenHashes.length > 1000) store.forgottenHashes.splice(0, store.forgottenHashes.length - 1000)
      deps.state.save?.()
    }
    activity?.record({ kind: 'delete', tier: tierOfItem(raw, ctx) ?? 'session', summary: 'forgot a memory for good', detail: text.slice(0, 120), ok: true })
    return { forgotten: true, content: text.slice(0, 160) }
  }

  /** Delete every memory for this user, after writing a JSONL archive. */
  async function purge(scope = {}) {
    assertEnabled()
    if (scope.confirm !== 'PURGE') throw new MemoryRequestError('confirm PURGE is required', 'confirm_required')
    const ctx = context(scope)
    const client = ready()
    const tiers = normalizeTierList(undefined, ['personal', 'project', 'session'])
    const rows = []
    for (const tier of tiers) {
      if (tier !== 'personal' && !ctx.projectKey) continue
      if (tier === 'session' && !ctx.sessionId) continue
      const page = await list({ tier, limit: 500, offset: 0, projectKey: ctx.projectKey, sessionId: ctx.sessionId })
      for (const item of page.items ?? []) rows.push({ tier, id: item.id, content: item.content })
    }
    if (rows.length === 0) return { purged: 0, archived: 0 }
    const { mkdirSync, appendFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { integrationDir } = await import('./paths.js')
    const dir = join(integrationDir(), 'archive')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `purge-${Date.now()}.jsonl`)
    for (const row of rows) appendFileSync(file, `${JSON.stringify(row)}\n`)
    let purged = 0
    for (const row of rows) {
      try {
        const raw = await locate(client, ctx, row.id, optionsOf(scope))
        if (!raw) continue
        const payload = { id: row.id, kind: kindOf(raw) }
        const scene = sceneOf(raw)
        if (isProductivityScene(scene)) payload.variant = scene
        await bridgeMethod(client, 'bridgeDelete')(payload, optionsOf(scope))
        purged += 1
      } catch (error) {
        log('purge delete failed', error)
      }
    }
    countCache.clear()
    activity?.record({ kind: 'delete', tier: 'personal', summary: `purged ${purged} memories`, detail: `archive ${file}`, ok: true })
    return { purged, archived: rows.length, archive: file }
  }

  /** Groups of memories whose text is identical after whitespace and case folding. */
  async function duplicates(scope = {}) {
    assertEnabled()
    const ctx = context(scope)
    const tiers = normalizeTierList(scope.tier ?? scope.tiers, ['personal', 'project', 'session'])
    const groups = []
    for (const tier of tiers) {
      if (tier !== 'personal' && !ctx.projectKey) continue
      if (tier === 'session' && !ctx.sessionId) continue
      let page
      try {
        page = await list({ tier, limit: 500, offset: 0, projectKey: ctx.projectKey, sessionId: ctx.sessionId })
      } catch {
        continue
      }
      const byHash = new Map()
      for (const item of page.items ?? []) {
        const hash = contentHash(item.content)
        if (!byHash.has(hash)) byHash.set(hash, [])
        byHash.get(hash).push({ id: item.id, content: String(item.content ?? '').slice(0, 200), createdAt: item.createdAt ?? 0 })
      }
      for (const [hash, items] of byHash) {
        if (items.length < 2) continue
        items.sort((left, right) => right.createdAt - left.createdAt)
        groups.push({ tier, hash, keep: items[0].id, drop: items.slice(1).map((item) => item.id), count: items.length, preview: items[0].content.slice(0, 120) })
      }
    }
    return { groups, total: groups.reduce((sum, group) => sum + group.drop.length, 0) }
  }

  /** Keep one row of a duplicate group and delete the rest. */
  async function merge(scope = {}) {
    assertEnabled()
    const tier = scope.tier
    if (!isTier(tier)) throw new MemoryRequestError('tier is required', 'tier_required')
    const drop = Array.isArray(scope.drop) ? scope.drop.map(String).filter(Boolean) : []
    const keep = typeof scope.keep === 'string' ? scope.keep : ''
    if (drop.length === 0) throw new MemoryRequestError('drop is required', 'drop_required')
    if (keep && drop.includes(keep)) throw new MemoryRequestError('keep cannot be dropped', 'keep_dropped')
    const client = ready()
    const ctx = context(scope)
    let merged = 0
    for (const id of drop) {
      const raw = await locate(client, ctx, id, optionsOf(scope))
      if (!raw) continue
      const scene = sceneOf(raw)
      const payload = { id, kind: kindOf(raw) }
      if (isProductivityScene(scene)) payload.variant = scene
      await bridgeMethod(client, 'bridgeDelete')(payload, optionsOf(scope))
      merged += 1
    }
    countCache.clear()
    activity?.record({ kind: 'delete', tier, summary: `merged ${merged} duplicate memories`, detail: keep ? `kept ${keep}` : '', ok: true })
    return { merged, kept: keep }
  }

  async function add(
    scope = {}) {
    assertEnabled()
    const content = typeof scope.content === 'string' ? scope.content.trim() : ''
    if (!content) throw new MemoryRequestError('content is required', 'content_required')
    const ctx = context(scope)
    let tier = isTier(scope.tier) ? scope.tier : inferTier(content)
    if (!isTier(tier)) throw new MemoryRequestError(`unknown tier ${JSON.stringify(tier)}`, 'unknown_tier')
    // Without a project there is nowhere for a project memory to live.
    if (tier === 'project' && !ctx.projectKey) tier = 'personal'
    if (tier !== 'personal' && !ctx.projectKey) throw new MemoryRequestError('project tier needs a project key', 'project_required')
    if (tier === 'session' && !ctx.sessionId) throw new MemoryRequestError('session tier needs a session id', 'session_required')
    const client = scope.awaitStart === false ? ready() : await start()
    const result = await client.add({
      data: [{ role: 'user', content }],
      ...writeScope(tier, ctx),
      scene: 'chat',
    }, { ...optionsOf(scope), timeoutMs: 240_000 })
    if (result?.success === false) {
      throw new MemoryRequestError(String(result?.agent_error_code ?? result?.error_code ?? 'memory write failed'), 'write_failed')
    }
    countCache.clear()
    activity?.record({ kind: 'capture', tier, summary: 'added a memory from a tool call', detail: content.slice(0, 120), ok: true })
    return { added: true, tier, id: String(result?.memory_id ?? '') }
  }

  async function counts(
    scope = {}) {
    assertEnabled()
    const ctx = context(scope)
    const cacheKey = `${ctx.user}|${ctx.projectKey}|${ctx.sessionId}`
    const cached = countCache.get(cacheKey)
    if (cached && Date.now() - cached.at < COUNT_CACHE_MS) return { ...cached.value }
    const result = { personal: 0, project: 0, session: 0 }
    try {
      const { items } = await scanUnified(ready(), ctx, { cap: COUNT_SCAN_CAP, options: optionsOf(scope) })
      for (const item of items) {
        for (const tier of ['personal', 'project', 'session']) {
          if (matchesTier(item, tier, ctx)) {
            result[tier] += 1
            break
          }
        }
      }
      countCache.set(cacheKey, { at: Date.now(), value: { ...result } })
    } catch {
      return result
    }
    return result
  }

  function projectInfo(scope = {}) {
    const ctx = context(scope)
    const projects = deps.state?.data?.projects ?? {}
    const record = projects[ctx.projectKey]
    // The state file can hold key-only placeholders from a recovery; the
    // standalone index carries the real path and name, and the status card
    // reads this. Without the merge the title flickered from hash to name as
    // the panel's project list finished loading.
    const indexed = typeof deps.readProjectIndex === 'function' ? deps.readProjectIndex()?.[ctx.projectKey] : null
    const path = record?.path || indexed?.path || ''
    const title = (record?.path && record?.title) || indexed?.title || record?.title || ''
    return { key: ctx.projectKey, path, title }
  }

  return { search, forget, merge, duplicates, purge, list, get, update, history, remove, add, counts, projectInfo, start, context, projectKey }
}

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : String(value ?? '') }],
}

function formatItems(items) {
  return items.map((item, index) => `${index + 1}. [${item.tier}] ${item.content}`).join('\n')
}

function describeFailure(error) {
  if (error instanceof MemoryUnavailableError) return 'Memory is unavailable: the Hy-Memory sidecar is not running. Open Settings > Memory and press Start, then retry.'
  const message = String(error?.message ?? error)
  return `Memory request failed: ${message}`
}

function guard(fn) {
  return async (args, exec) => {
    try {
      return await fn(args ?? {}, exec)
    } catch (error) {
      throw new Error(describeFailure(error))
    }
  }
}

export function createTools(deps) {
  const ops = createMemoryOps(deps)
  const runOptions = (exec) => {
    const session = exec?.agent?.session
    const cwd = typeof session?.header?.cwd === 'string' ? session.header.cwd : ''
    const key = projectKey(cwd)
    return {
      ...exec?.signal ? { signal: exec.signal } : {},
      ...key ? { projectKey: key } : {},
      ...session?.id ? { sessionId: session.id } : {},
    }
  }

  return [
    {
      name: 'memory_search',
      description:
        'Search the user\'s long-term memory across three tiers (personal, current project, current session). '
        + 'Use it before a nontrivial task to recover preferences, project conventions, and earlier decisions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for, in natural language.' },
          tiers: {
            type: 'array',
            description: 'Tiers to search; defaults to all three.',
            items: { type: 'string', enum: ['personal', 'project', 'session'] },
          },
          limit: { type: 'integer', description: 'Maximum hits per tier (1-30, default 8).' },
        },
        required: ['query'],
      },
      output: TEXT_OUTPUT,
      timeoutMs: 45_000,
      execute: guard(async (args, exec) => {
        const groups = await ops.search({ query: args.query, tiers: args.tiers, limit: args.limit, allProjects: args.allProjects, ...runOptions(exec) })
        const sections = []
        for (const tier of ['personal', 'project', 'session']) {
          const items = groups[tier] ?? []
          if (items.length === 0) continue
          sections.push(`## ${tier}\n${formatItems(items)}`)
        }
        return sections.length > 0 ? sections.join('\n\n') : 'No memories matched that query.'
      }),
    },
    {
      name: 'memory_add',
      description:
        'Store a durable memory. The tier is inferred from the content: repository facts, paths, commands '
        + 'and conventions go to the project tier, preferences and facts about the user go to the personal '
        + 'tier; pass tier explicitly to override. The result states where it was stored.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Self-contained statement to remember.' },
          tier: { type: 'string', enum: ['personal', 'project', 'session'], description: 'Defaults to personal.' },
        },
        required: ['content'],
      },
      output: TEXT_OUTPUT,
      timeoutMs: 300_000,
      execute: guard(async (args, exec) => {
        const result = await ops.add({ content: args.content, tier: args.tier, ...runOptions(exec) })
        return `Stored in ${result.tier} memory${result.id ? ` (id ${result.id})` : ''}.`
      }),
    },
    {
      name: 'memory_list',
      description: 'List stored memories for one tier, newest first.',
      parameters: {
        type: 'object',
        properties: {
          tier: { type: 'string', enum: ['personal', 'project', 'session'], description: 'Defaults to personal.' },
          query: { type: 'string', description: 'Optional filter applied by semantic search.' },
          limit: { type: 'integer', description: 'Page size (1-200, default 20).' },
          offset: { type: 'integer', description: 'Page offset, default 0.' },
        },
      },
      output: TEXT_OUTPUT,
      timeoutMs: 60_000,
      execute: guard(async (args, exec) => {
        const page = await ops.list({ tier: args.tier, query: args.query, limit: args.limit, offset: args.offset, ...runOptions(exec) })
        if (page.items.length === 0) return `No ${args.tier ?? 'personal'} memories.`
        return `${page.total} ${args.tier ?? 'personal'} memories (offset ${page.offset}, showing ${page.items.length}):\n${formatItems(page.items)}`
      }),
    },
    {
      name: 'memory_get',
      description: 'Read one memory by its id.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory id returned by search or list.' },
        },
        required: ['id'],
      },
      output: TEXT_OUTPUT,
      timeoutMs: 30_000,
      execute: guard(async (args, exec) => {
        const found = await ops.get({ id: args.id, ...runOptions(exec) })
        if (!found.item) return `No memory with id ${args.id}.`
        const item = found.item
        return `id: ${item.id}\ntier: ${item.tier}\nlayer: ${item.layer}\nstatus: ${item.status}\n\n${item.content}`
      }),
    },
    {
      name: 'memory_update',
      description: 'Rewrite the content of a personal memory. Project and session memories cannot be edited.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id of the personal memory to rewrite.' },
          content: { type: 'string', description: 'Complete replacement text.' },
        },
        required: ['id', 'content'],
      },
      output: TEXT_OUTPUT,
      timeoutMs: 60_000,
      execute: guard(async (args, exec) => {
        await ops.update({ id: args.id, content: args.content, ...runOptions(exec) })
        return `Updated personal memory ${args.id}.`
      }),
    },
    {
      name: 'memory_delete',
      description: 'Delete one project or session memory. Personal memories are never deletable this way.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id of the memory to delete.' },
          tier: { type: 'string', enum: ['project', 'session'], description: 'Tier the memory belongs to.' },
        },
        required: ['id', 'tier'],
      },
      output: TEXT_OUTPUT,
      timeoutMs: 30_000,
      execute: guard(async (args, exec) => {
        await ops.remove({ id: args.id, tier: args.tier, ...runOptions(exec) })
        return `Deleted ${args.tier} memory ${args.id}.`
      }),
    },
    {
      name: 'memory_forget',
      description: 'Delete a memory and remember its text, so later capture cannot bring the same fact back. Use when the user says to forget something for good.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id of the memory to forget.' },
        },
        required: ['id'],
      },
      output: TEXT_OUTPUT,
      timeoutMs: 120_000,
      execute: guard(async (args, exec) => {
        const result = await ops.forget({ id: args.id, ...runOptions(exec) })
        return `Forgotten for good: ${result.content}`
      }),
    },
  ]
}

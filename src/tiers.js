/**
 * Three-tier namespace mapping between DSH concepts and hy_memory scopes.
 *
 * Pure functions only: no I/O, no SDK access, so this module is safe to unit
 * test and to import from the sidecar-free panels.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { basename } from 'node:path'

export const DEFAULT_USER = 'dsh'
export const PERSONAL_AGENT = 'personal'
export const PROJECT_SESSION = 'project'
export const TIERS = Object.freeze(['personal', 'project', 'session'])

const FILE_EDIT_TOOLS = new Set([
  'edit', 'write', 'str_replace', 'apply_patch', 'multi_edit', 'notebook_edit',
  'write_file', 'edit_file', 'create_file', 'delete_file', 'move_file', 'fs_write', 'fs_edit',
])

const SHELL_TOOLS = new Set(['bash', 'shell', 'exec', 'terminal', 'run_command', 'shell_command', 'powershell'])

/** Toolchain invocations that mark a shell command as software work rather than browsing. */
const CODING_COMMAND = new RegExp(
  '(?:^|[\\s;&|(`])(?:git|gh|cargo|rustc|pnpm|npm|npx|yarn|bun|node|deno|python3?|pip|uv|pytest|vitest|jest|mocha'
  + '|make|cmake|go|docker|kubectl|terraform|tsc|eslint|biome|vite|webpack|rollup|gradle|mvn|dotnet|swift|xcodebuild'
  + '|test|build|lint|typecheck)(?=$|[\\s;&|)`])',
  'i',
)

export function projectKey(cwd) {
  const value = typeof cwd === 'string' ? cwd.trim() : ''
  if (!value) return ''
  return createHash('sha1').update(value).digest('hex').slice(0, 12)
}

export function projectAgentId(key) {
  return typeof key === 'string' && key ? `project:${key}` : ''
}

export function projectTitleForPath(path) {
  if (typeof path !== 'string' || !path) return ''
  const name = basename(path)
  return name || path
}

export function resolveUser(settings) {
  const configured = settings?.user
  return typeof configured === 'string' && configured.trim() ? configured.trim() : DEFAULT_USER
}

export function isTier(value) {
  return TIERS.includes(value)
}

function requireProjectKey(scope) {
  if (!scope.projectKey) throw new Error('project tier needs a project key')
  return scope.projectKey
}

/**
 * Reads a tier's memories. Personal is scoped by its dedicated agent; project
 * and session share the project agent and differ only by the session column.
 */
export function tierScope(tier, scope = {}) {
  const user = resolveUser(scope.settings)
  const key = scope.projectKey
  switch (tier) {
    case 'personal':
      return { user_ids: [user], agent_ids: [PERSONAL_AGENT] }
    case 'project':
      return { user_ids: [user], agent_ids: [projectAgentId(key), key].filter(Boolean), session_ids: [PROJECT_SESSION] }
    case 'session':
      return { user_ids: [user], agent_ids: [projectAgentId(key)].filter(Boolean), session_ids: [scope.sessionId].filter(Boolean) }
    default:
      throw new Error(`unknown memory tier ${JSON.stringify(tier)}`)
  }
}

/** The exact scope columns written with add(); all three trackers. */
export function writeScope(tier, scope = {}) {
  const user = resolveUser(scope.settings)
  switch (tier) {
    case 'personal':
      return { user_id: user, agent_id: PERSONAL_AGENT, session_id: PERSONAL_AGENT }
    case 'project':
      return { user_id: user, agent_id: projectAgentId(requireProjectKey(scope)), session_id: PROJECT_SESSION }
    case 'session':
      return {
        user_id: user,
        agent_id: projectAgentId(requireProjectKey(scope)),
        session_id: scope.sessionId || '',
      }
    default:
      throw new Error(`unknown memory tier ${JSON.stringify(tier)}`)
  }
}

/**
 * The three searches one recall runs. Project search names both `project:<key>`
 * and the bare key: CONTRACT.md spells the project scope both ways and only the
 * prefixed form is actually written, so reading both keeps recall robust.
 */
export function recallPlan(scope = {}) {
  const user = resolveUser(scope.settings)
  const key = scope.projectKey
  const plan = [
    { tier: 'personal', params: { user_ids: [user], agent_ids: [PERSONAL_AGENT] } },
    // Chat search ignores `session_ids` (verified against 2.0.13: a session filter
    // returns zero hits, an agent filter returns them), so the session tier
    // searches by agent and narrows to its own session host-side.
    // The session tier narrows the same project agent host-side, so asking the
    // store for it again duplicates every candidate and lets one long memory win
    // the character budget twice. Skip it when the project tier already covers
    // that agent; with no project key there is nothing else to search.
    { tier: 'session', params: { user_ids: [user], agent_ids: [projectAgentId(key)].filter(Boolean) } },
  ]
  if (key) {
    plan.splice(1, 0, {
      tier: 'project',
      // Same reason as the session tier: a session filter is dropped by chat
      // search, so narrow to the project sentinel host-side.
      params: { user_ids: [user], agent_ids: [projectAgentId(key), key] },
    })
  }
  const enabled = scope.tiers ?? {}
  return plan.filter((entry) => enabled[entry.tier] !== false)
}

export function classifyTool(name, args) {
  if (typeof name !== 'string' || !name) return null
  if (FILE_EDIT_TOOLS.has(name)) return 'coding'
  if (SHELL_TOOLS.has(name)) {
    const command = typeof args === 'string'
      ? args
      : typeof args?.command === 'string'
        ? args.command
        : typeof args?.cmd === 'string'
          ? args.cmd
          : ''
    return CODING_COMMAND.test(command) ? 'coding' : 'working'
  }
  return 'working'
}

/**
 * Scene for one captured batch. The SDK falls back to chat when a forced
 * working/coding write carries no tool message, so callers must only force a
 * productivity scene when tools are actually included in the payload.
 */
export function pickScene(tools = []) {
  let seen = false
  let coding = false
  for (const tool of tools) {
    const kind = classifyTool(tool?.name, tool?.args)
    if (kind === null) continue
    seen = true
    if (kind === 'coding') {
      coding = true
      break
    }
  }
  if (coding) return 'coding'
  return seen ? 'working' : 'chat'
}

function toMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value)
  }
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return toMillis(numeric)
  }
  return 0
}

function scoreOf(raw) {
  const value = raw?.score ?? raw?.lane_score
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function normalizeItem(raw, context = {}) {
  const tier = context.tier ?? 'personal'
  const id = String(raw?.memory_id ?? raw?.id ?? raw?.node_id ?? '')
  const score = scoreOf(raw)
  const item = {
    id,
    content: String(raw?.content ?? raw?.text ?? ''),
    tier,
    layer: String(raw?.layer ?? ''),
    status: String(raw?.status ?? 'active'),
    tags: Array.isArray(raw?.tags) ? raw.tags.map(String) : [],
    createdAt: toMillis(raw?.gmt_created ?? raw?.created_at ?? raw?.memory_at ?? raw?.createdAt),
    updatedAt: toMillis(raw?.gmt_modified ?? raw?.updated_at ?? raw?.gmt_created ?? raw?.created_at ?? raw?.updatedAt ?? raw?.createdAt),
  }
  if (score !== undefined) item.score = score
  if (tier !== 'personal' && context.projectKey) item.projectKey = context.projectKey
  // The row's own session, not the query's: listing "all sessions" passes an
  // empty filter, and keying the result on that hid every row from the panel's
  // session list.
  const ownSession = String(raw?.session_id ?? '')
  if (tier === 'session') {
    const sessionId = ownSession || context.sessionId || ''
    if (sessionId) item.sessionId = sessionId
  }
  return item
}

export function normalizeItems(raws, context = {}) {
  const list = Array.isArray(raws) ? raws : []
  const out = []
  const seenIds = new Set()
  const seenContent = new Set()
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const item = normalizeItem(raw, context)
    const contentKey = item.content.trim().toLowerCase()
    if (!item.id && !contentKey) continue
    if (item.id && seenIds.has(item.id)) continue
    if (contentKey && seenContent.has(contentKey)) continue
    if (item.id) seenIds.add(item.id)
    if (contentKey) seenContent.add(contentKey)
    out.push(item)
  }
  return out
}

/** Tier an already-persisted memory belongs to, or null when it is foreign. */
export function tierOfItem(raw, context = {}) {
  const agent = String(raw?.agent_id ?? '')
  const session = String(raw?.session_id ?? '')
  if (agent === PERSONAL_AGENT) return 'personal'
  if (context.projectKey) {
    const expected = projectAgentId(context.projectKey)
    if (agent === expected) return session && session !== PROJECT_SESSION ? 'session' : 'project'
  }
  return null
}


/**
 * Repository identity for the productivity pipelines, which only return a
 * memory to search when it carries a workspace id. Prefer the git origin URL
 * (stable across clones), then the repository root path.
 */
export function workspaceIdFor(cwd) {
  if (typeof cwd !== 'string' || !cwd) return ''
  try {
    const config = readFileSync(join(cwd, '.git', 'config'), 'utf8')
    const match = /\[remote "origin"\][^[]*?url\s*=\s*(.+)/.exec(config)
    if (match && match[1]) return match[1].trim()
  } catch {}
  return `path:${cwd}`
}


const PERSONAL_SIGNALS = /(?:我|本人|自己).{0,6}(?:喜欢|偏好|习惯|希望|要求|讨厌|不喜欢|想要|常用)|\b(?:my|I)\b.{0,12}(?:prefer|like|always|never|hate)|偏好|习惯上|个人口味/i
const PROJECT_SIGNALS = /(?:仓库|项目|目录|路径|文件|模块|接口|端口|配置|依赖|版本|脚本|命令|构建|测试|部署|约定|规范|流程|数据库|服务)|\b(?:repo|repository|project|package|build|test|deploy|config|port|endpoint|schema|migration)\b|(?:^|\s)(?:pnpm|npm|yarn|bun|git|docker|kubectl|cargo|pytest|vitest|jest)\b|`[^`]+`|\/[\w.-]+\/|\.[a-z]{2,4}\b/i

/**
 * Where a tool-initiated memory belongs when the caller did not say.
 *
 * The model used to default everything to the personal tier, which polluted the
 * user profile with project conventions. Project-shaped content (paths, commands,
 * repository facts) goes to the project tier; preference-shaped content stays
 * personal. An explicit `tier` argument always wins.
 */
export function inferTier(content) {
  const text = typeof content === 'string' ? content : ''
  if (!text.trim()) return 'personal'
  const personal = PERSONAL_SIGNALS.test(text)
  const project = PROJECT_SIGNALS.test(text)
  if (personal && !project) return 'personal'
  if (project && !personal) return 'project'
  // Both or neither: project-shaped evidence is the narrower claim, so keep the
  // user profile clean and only fall back to personal when nothing is technical.
  return project ? 'project' : 'personal'
}


/** Stable hash of a memory's text, used to keep a forgotten memory from returning. */
export function contentHash(content) {
  return createHash('sha256').update(String(content ?? '').replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex')
}


/** Project keys named by `project:<key>` agent ids in store rows, for recovery. */
export function projectKeysFromRows(rows) {
  const keys = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    const agent = String(row?.agent_id ?? '')
    if (agent.startsWith('project:') && agent.length > 'project:'.length) keys.add(agent.slice('project:'.length))
  }
  return [...keys]
}

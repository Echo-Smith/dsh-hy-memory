/**
 * Session capture: buffer user/assistant/tool events per session, flush a
 * window of turns (or an idle period) into one hy_memory `add()` write, and
 * promote durable material up the tier ladder with at most one model call per
 * promotion.
 *
 * Every entry point is total: the session/event listener must never throw into
 * the harness, so all work is wrapped and failures become activity records.
 */
import { randomUUID } from 'node:crypto'
import { collectSearchItems, truncateChars } from './recall.js'
import { contentHash, projectAgentId, projectKey, projectTitleForPath, pickScene, resolveUser, workspaceIdFor, writeScope } from './tiers.js'
import { integrationDir } from './paths.js'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const MAX_BUFFER_EVENTS = 400
export const MAX_QUEUE_JOBS = 60
export const MAX_QUEUE_ATTEMPTS = 20

/** Attempts before a job is demoted to the lite layer; configurable per queue. */
function maxAttempts(settingsValue) {
  const configured = Number(settingsValue?.capture?.maxAttempts)
  return Number.isFinite(configured) && configured > 0 ? Math.min(50, Math.floor(configured)) : MAX_QUEUE_ATTEMPTS
}
export const BACKOFF_BASE_MS = 1000
export const BACKOFF_CAP_MS = 600_000

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bpassword\s*[:=]\s*\S{6,}/i,
]

/** True when a message looks like it carries a credential. */
export function looksSensitive(text) {
  const value = String(text ?? '')
  return SECRET_PATTERNS.some((pattern) => pattern.test(value))
}

const ADD_TIMEOUT_MS = 240_000
// One drain batch can legitimately take minutes on a slow model, but a hung
// request must never leave `draining` latched forever: that stalls the queue
// until the plugin reloads.
const DRAIN_WATCHDOG_MIN_MS = 60_000

/** A batch may take its configured request timeout plus slack before it counts as hung. */
function drainWatchdogMs(settingsValue) {
  const timeout = Number(settingsValue?.llm?.timeoutMs)
  return Math.max(DRAIN_WATCHDOG_MIN_MS, (Number.isFinite(timeout) && timeout > 0 ? timeout : 180_000) + 15_000)
}
const SEARCH_TIMEOUT_MS = 15_000
const PROMOTE_TIMEOUT_MS = 90_000
const PROMPT_INPUT_CHARS = 6000
const SESSION_TRACK_LIMIT = 200
const MISSING_CLIENT_RETRY_MS = 15_000

/**
 * The capture queue lives in its own file.
 *
 * A host reload can leave the previous plugin instance running; it keeps writing
 * its own copy of `state.json`, which used to reset this queue and every retry
 * counter. A dedicated file with a single reader/writer keeps progress stable
 * even while such an instance is still around.
 */
function captureQueuePath(explicit) {
  return explicit || join(integrationDir(), 'capture-queue.json')
}

function readCaptureQueue(path = captureQueuePath()) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (Array.isArray(parsed)) return parsed.filter((job) => job && typeof job === 'object' && job.payload)
  } catch {}
  return []
}

function writeCaptureQueue(jobs, path = captureQueuePath()) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const target = path
    const temp = `${target}.${process.pid}.tmp`
    writeFileSync(temp, `${JSON.stringify(jobs)}\n`, 'utf8')
    renameSync(temp, target)
  } catch {}
}

export function nextBackoff(attempt, base = BACKOFF_BASE_MS, cap = BACKOFF_CAP_MS) {
  const exponent = Math.max(0, Math.min(10, (Number(attempt) || 1) - 1))
  return Math.min(cap, base * 2 ** exponent)
}

export function isDuplicate(cursor, seq) {
  return Number.isFinite(cursor) && Number.isFinite(seq) && seq <= cursor
}

function textOfBlocks(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function parseArguments(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Turn the buffered events into the SDK's chat-message payload plus the scene
 * that is actually safe to force.
 */
export function buildBatch(buffer, settings = {}) {
  const includeTools = settings.capture?.includeToolCalls !== false
  const resultChars = Number.isFinite(settings.capture?.toolResultChars) ? settings.capture.toolResultChars : 1200
  const items = Array.isArray(buffer) ? buffer : Array.isArray(buffer?.items) ? buffer.items : []
  const tools = Array.isArray(buffer?.tools) ? buffer.tools : []
  const messages = []
  for (const item of items) {
    if (!item) continue
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (!content) continue
    if (item.role === 'tool') {
      if (!includeTools) continue
      const message = { role: 'tool', content: truncateChars(content, resultChars) }
      if (item.name) message.tool_name = item.name
      if (item.callId) message.tool_call_id = item.callId
      messages.push(message)
      continue
    }
    if (item.role === 'user' || item.role === 'assistant') messages.push({ role: item.role, content })
  }
  // Never ship a credential to the sidecar, even inside a normal turn.
  const safeMessages = messages.filter((message) => !looksSensitive(message.content))
  const dropped = messages.length - safeMessages.length
  messages.length = 0
  messages.push(...safeMessages)
  let scene = includeTools ? pickScene(tools) : 'chat'
  if (scene !== 'chat' && !messages.some((message) => message.role === 'tool')) scene = 'chat'

  if (!messages.some((message) => message.role === 'user' || message.role === 'assistant')) {
    return { messages: [], scene: 'chat', writeScene: 'chat' }
  }
  return { messages, scene, writeScene: scene }
}

export function promotionLines(text) {
  const value = typeof text === 'string' ? text : ''
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0 && !/^none\.?$/i.test(line) && !/^```/.test(line))
    .map((line) => truncateChars(line, 400))
    .slice(0, 8)
}

export function sessionToProjectPrompt(items) {
  const material = items.map((item, index) => `${index + 1}. ${item}`).join('\n')
  return [
    'You maintain a project-level memory for a coding assistant.',
    'Below are memories recorded during one work session in this project.',
    'Extract only durable, project-scoped knowledge that will still help in a later session:',
    'architecture decisions, conventions, build/test commands, non-obvious constraints, unresolved risks.',
    'Exclude the user’s personal preferences, secrets, one-off debugging details, and anything already obvious from the code.',
    'Return at most 5 lines, one self-contained statement per line, no numbering, no preamble.',
    'Return exactly NONE when nothing is durable.',
    '',
    'SESSION MEMORIES:',
    material,
  ].join('\n')
}

export function projectToPersonalPrompt(items) {
  const material = items.map((item, index) => `${index + 1}. ${item}`).join('\n')
  return [
    'You maintain a long-term user profile for a coding assistant.',
    'Below are project-level memories recorded across this user’s projects.',
    'Extract only stable facts about the user: preferred languages, tools, style, workflow, standing constraints.',
    'Exclude project-specific details, secrets, and anything that will change soon.',
    'Return at most 5 lines, one self-contained statement per line, no numbering, no preamble.',
    'Return exactly NONE when nothing is stable.',
    '',
    'PROJECT MEMORIES:',
    material,
  ].join('\n')
}

export function createCapture(deps) {
  const settings = deps.settings
  const state = deps.state
  const activity = deps.activity
  const getClient = deps.getClient
  const modelFor = deps.modelFor ?? (() => null)
  const getLlm = deps.getLlm
  const resolveModel = deps.resolveModel ?? (() => null)
  const log = deps.log ?? (() => {})

  const sessions = new Map()
  let draining = false
  // Queue state is persisted on its own; see captureQueuePath().
  let queue = []
  let queueTimer = null
  const queuePath = typeof deps.queuePath === 'string' && deps.queuePath !== '' ? deps.queuePath : captureQueuePath()
  let retryTimer = null
  // A queue survives a plugin reload, but drain used to be triggered only by a
  // flush or a retry timer owned by the previous instance. A ticker keeps a
  // backlog moving even when no new turn arrives.
  let drainTicker = null
  // Keyed by session: a single global flag made a parallel session's promotion
  // wait behind another's whole model call, and the waiting one was simply
  // dropped. Sessions are independent work; only their own promotion is serial.
  const promoting = new Set()
  // One queued promotion per session: with parallel sessions a single slot let a
  // second session's request overwrite the first one's.
  const pendingPromotion = new Map()
  let disposed = false

  function ensureState() {
    const data = state.data
    if (!data.capture || typeof data.capture !== 'object') data.capture = { sessions: {}, queue: [] }
    if (!data.capture.sessions || typeof data.capture.sessions !== 'object') data.capture.sessions = {}
    if (!Array.isArray(data.capture.queue)) data.capture.queue = []
    if (!data.promotions || typeof data.promotions !== 'object') data.promotions = { sessions: {}, projects: {} }
    if (!data.promotions.sessions || typeof data.promotions.sessions !== 'object') data.promotions.sessions = {}
    if (!data.promotions.projects || typeof data.promotions.projects !== 'object') data.promotions.projects = {}
    if (!data.projects || typeof data.projects !== 'object') data.projects = {}
    return data
  }

  function entryFor(session) {
    const data = ensureState()
    const id = session.id
    let entry = sessions.get(id)
    if (entry) return entry
    const stored = data.capture.sessions[id]
    entry = {
      id,
      session,
      cwd: typeof session.header?.cwd === 'string' ? session.header.cwd : '',
      title: '',
      cursor: Number.isFinite(stored?.cursor) ? stored.cursor : -1,
      turnsSinceFlush: Number.isFinite(stored?.turnsSinceFlush) ? stored.turnsSinceFlush : 0,
      turnsSincePromotion: 0,
      turnsSincePersonal: 0,
      turn: 0,
      buffer: [],
      tools: [],
      pendingCalls: new Map(),
      lastQuery: '',
      lastActivityAt: Date.now(),
      timer: null,
      flushing: false,
    }
    sessions.set(id, entry)
    pruneSessions(data)
    return entry
  }

  function pruneSessions(data) {
    const ids = Object.keys(data.capture.sessions)
    if (ids.length <= SESSION_TRACK_LIMIT) return
    const ordered = ids
      .map((id) => ({ id, at: Number(data.capture.sessions[id]?.at) || 0 }))
      .sort((left, right) => left.at - right.at)
    for (const stale of ordered.slice(0, ids.length - SESSION_TRACK_LIMIT)) {
      delete data.capture.sessions[stale.id]
    }
  }

  function persistEntry(entry) {
    const data = ensureState()
    data.capture.sessions[entry.id] = {
      cursor: entry.cursor,
      turnsSinceFlush: entry.turnsSinceFlush,
      at: Date.now(),
    }
    if (entry.cwd) {
      const key = projectKey(entry.cwd)
      if (key && !data.projects[key]) {
        data.projects[key] = { path: entry.cwd, title: projectTitleForPath(entry.cwd) }
        data.lastProject = key
      }
    }
    state.save()
  }

  function armIdle(entry) {
    const idleMs = settings()?.capture?.idleFlushMs
    if (!(idleMs > 0)) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      void flush(entry, 'idle')
    }, idleMs)
    entry.timer.unref?.()
  }

  function push(entry, item) {
    entry.buffer.push(item)
    if (entry.buffer.length > MAX_BUFFER_EVENTS) entry.buffer.splice(0, entry.buffer.length - MAX_BUFFER_EVENTS)
    entry.lastActivityAt = Date.now()
  }

  function handleSessionEvent(session, event) {
    if (disposed) return
    try {
      const config = settings()
      if (config?.enabled === false) return
      if (!config?.capture?.enabled) return
      if (!session?.id || !event || typeof event.type !== 'string') return
      const entry = entryFor(session)
      const seq = Number(event.seq)
      if (isDuplicate(entry.cursor, seq)) return
      if (Number.isFinite(seq)) entry.cursor = seq
      const data = event.data ?? {}
      switch (event.type) {
        case 'user/message': {
          if (data.source?.kind !== 'user') break
          const text = textOfBlocks(data.content).trim()
          if (!text) break
          push(entry, { role: 'user', content: text, seq })
          entry.lastQuery = truncateChars(text.replace(/\s+/g, ' ').trim(), 500)
          break
        }
        case 'assistant/message': {
          const text = textOfBlocks(data.message?.content).trim()
          if (text) push(entry, { role: 'assistant', content: text, seq })
          break
        }
        case 'tool/call': {
          const name = typeof data.name === 'string' ? data.name : ''
          if (!name) break
          entry.pendingCalls.set(String(data.callId ?? ''), name)
          entry.tools.push({ name, args: parseArguments(data.arguments) })
          if (entry.tools.length > 60) entry.tools.splice(0, entry.tools.length - 60)
          break
        }
        case 'tool/result': {
          const callId = String(data.message?.toolCallId ?? '')
          const text = textOfBlocks(data.message?.content).trim()
          const name = entry.pendingCalls.get(callId) ?? ''
          entry.pendingCalls.delete(callId)
          if (text) push(entry, { role: 'tool', content: text, name, callId, seq })
          break
        }
        case 'turn/end': {
          entry.turn = Number(data.turn) || entry.turn
          entry.turnsSinceFlush += 1
          entry.turnsSincePromotion += 1
          entry.turnsSincePersonal += 1
          const windowTurns = Number(config.capture?.windowTurns) || 3
          if (entry.turnsSinceFlush >= windowTurns) void flush(entry, 'window')
          break
        }
        case 'session/title': {
          if (typeof data.title === 'string') entry.title = data.title
          break
        }
        default:
          break
      }
      persistEntry(entry)
      armIdle(entry)
      if (event.type === 'turn/end') void maybePromote(entry, 'turn')
    } catch (error) {
      log('capture failed', error)
      activity?.record({ kind: 'error', summary: 'capture failed', detail: String(error?.message ?? error), ok: false })
    }
  }

  async function flush(entry, reason) {
    if (disposed || !entry || entry.flushing) return
    entry.flushing = true
    try {
      const config = settings()
      const captureKey = projectKey(entry.cwd)
      const disabledProjects = Array.isArray(config.permissions?.disabledCaptureProjects) ? config.permissions.disabledCaptureProjects : []
      if (disabledProjects.includes(captureKey)) {
        entry.buffer = []
        entry.tools = []
        entry.turnsSinceFlush = 0
        persistEntry(entry)
        activity?.record({ kind: 'capture', tier: 'session', summary: 'capture skipped for a project the user excluded', detail: captureKey, ok: true })
        return
      }
      const toolsSeen = entry.tools.map((tool) => tool.name)
      const batch = buildBatch({ items: entry.buffer, tools: entry.tools }, config)
      // Keep tools and text together: an idle flush can arrive when only tool
      // calls are pending (between steps), and clearing then would downgrade the
      // next text flush to the chat scene.
      if (batch.messages.length === 0) return
      if (state?.data) {
        state.data.lastFlush = {
          at: Date.now(),
          reason,
          scene: batch.scene,
          tools: toolsSeen,
          roles: batch.messages.map((message) => message.role),
          productivity: config.capture?.productivity === true,
        }
      }
      entry.buffer = []
      entry.tools = []
      entry.lastFlushedText = batch.messages.find((message) => message.role === 'user')?.content
        ?? batch.messages[0]?.content
        ?? entry.lastFlushedText
        ?? ''
      entry.turnsSinceFlush = 0
      if (entry.timer) {
        clearTimeout(entry.timer)
        entry.timer = null
      }
      persistEntry(entry)
      ensureState().lastScene = batch.scene
      state.save()
      if (batch.messages.length === 0) return
      const key = projectKey(entry.cwd)
      const job = {
        id: randomUUID(),
        sessionId: entry.id,
        projectKey: key,
        scene: batch.scene,
        attempts: 0,
        createdAt: Date.now(),
        payload: {
          // The HTTP add route ignores `scene` and re-derives it from tool
          // messages, so routing to chat requires dropping them; the detected
          // scene stays in the activity label.
          data: config.capture?.productivity === true ? batch.messages : batch.messages.filter((message) => message.role !== 'tool'),
          // The SDK's HTTP add route currently ignores `scene` and re-derives it
          // from the payload; tool messages above are what actually select the
          // productivity pipeline. Sending it keeps the intent explicit.
          // Productivity stores are only reachable by search when the memory
          // carries a workspace_id, so capture routes to chat unless the
          // productivity pipeline is explicitly enabled. The detected scene
          // stays as a label for the activity feed and the panel.
          scene: config.capture?.productivity === true ? batch.scene : 'chat',
          ...config.capture?.productivity === true && batch.scene !== 'chat'
            ? { workspace_id: workspaceIdFor(entry.cwd) }
            : {},
          ...writeScope('session', { settings: config, projectKey: key, sessionId: entry.id }),
        },
      }
      enqueue(job)
      activity?.record({
        kind: 'capture',
        tier: 'session',
        summary: `queued ${batch.messages.length} messages (${batch.scene}, ${reason})`,
        detail: entry.title || entry.cwd,
        ok: true,
      })
      void drain()
    } catch (error) {
      log('capture flush failed', error)
      activity?.record({ kind: 'error', summary: 'capture flush failed', detail: String(error?.message ?? error), ok: false })
    } finally {
      entry.flushing = false
    }
  }

  function enqueue(job) {
    const data = ensureState()
    queue.push(job)
    persistQueue()
    if (queue.length > MAX_QUEUE_JOBS) {
      const dropped = queue.splice(0, queue.length - MAX_QUEUE_JOBS)
      activity?.record({ kind: 'error', summary: `dropped ${dropped.length} queued captures`, ok: false })
    }
    state.save()
  }

  function persistQueue() {
    if (state?.data) state.data.capture.queue = queue.slice()
    if (queueTimer !== null) return
    queueTimer = setTimeout(() => {
      queueTimer = null
      writeCaptureQueue(queue, queuePath)
      // Mirror for the status route and diagnostics; the file stays the truth.
      if (state?.data) state.data.capture.queue = queue.slice()
    }, 200)
    queueTimer.unref?.()
  }

  function scheduleRetry(delayMs) {
    if (disposed || retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      void drain()
    }, Math.max(250, delayMs))
    retryTimer.unref?.()
  }

  /**
   * Send one queued job. Returns 'ok', 'retry' (kept in the queue with backoff)
   * or 'drop' (handled: fallback written or deliberately discarded).
   */
  async function sendJob(job) {
    const client = getClient()
    if (!client) return 'retry'
    const configured = Number(settings()?.llm?.timeoutMs)
    const watchdogMs = drainWatchdogMs(settings())
    const timeoutMs = Math.min(configured > 0 ? configured : ADD_TIMEOUT_MS, watchdogMs - 5_000)
    try {
      const addScene = typeof client.bridgeAddScene === 'function'
        && job.scene !== 'chat'
        && job.payload?.scene !== 'chat'
        ? client.bridgeAddScene(job.payload, { timeoutMs })
        : client.add(job.payload, { timeoutMs })
      const result = await addScene
      if (result?.success === false) {
        const code = String(result?.agent_error_code ?? result?.error_code ?? 'unknown')
        if (state?.data) {
          state.data.lastAddError = { at: Date.now(), code, keys: Object.keys(result ?? {}).slice(0, 12), scene: job.scene }
        }
        recordModelFailure({ message: code, code })
        if (transientFailure(result) && (job.attempts ?? 0) < maxAttempts(settings())) return 'retry'
        const kept = await fallbackToLite(client, job)
        activity?.record({
          kind: 'error',
          summary: kept ? 'capture reconcile failed; raw text kept' : 'capture write rejected',
          detail: code,
          ok: false,
        })
        return 'drop'
      }
      recordModelSuccess()
      void enforceCapacity(client, job)
      activity?.record({
        kind: 'capture',
        tier: 'session',
        summary: `wrote ${job.payload.data.length} messages to session memory`,
        detail: job.scene,
        ok: true,
      })
      return 'ok'
    } catch (error) {
      job.attempts = (job.attempts ?? 0) + 1
      const retryable = error?.retryable !== false && (error?.status === undefined || error.status === 0 || error.status === 429 || error.status >= 500)
      if (retryable && job.attempts < maxAttempts(settings())) return 'retry'
      log('capture write dropped', error)
      // Record the model's health separately from the write: the user asked to be
      // told when the configured model is failing, not only that a batch was lost.
      recordModelFailure(error)
      const kept = await fallbackToLite(client, job)
      activity?.record({
        kind: 'error',
        summary: kept ? 'capture write dropped; raw text kept' : 'capture write dropped after retries',
        detail: String(error?.message ?? error),
        ok: false,
      })
      return 'drop'
    }
  }

  /**
   * Track repeated model failures so the panel can tell the user to switch.
   * A single timeout is noise; three consecutive failures is a signal.
   */
  function recordModelFailure(error) {
    const store = state?.data
    if (!store) return
    const model = settings()?.llm ?? {}
    const previous = store.modelHealth && typeof store.modelHealth === 'object' ? store.modelHealth : { consecutive: 0 }
    const message = String(error?.message ?? error)
    const code = String(error?.code ?? error?.status ?? 'unknown')
    store.modelHealth = {
      consecutive: (previous.consecutive ?? 0) + 1,
      lastError: message.slice(0, 300),
      lastCode: code,
      lastAt: Date.now(),
      provider: String(model.provider ?? ''),
      model: String(model.model ?? ''),
    }
    state.save()
  }

  /** A successful call clears the streak. */
  function recordModelSuccess() {
    const store = state?.data
    if (!store || !store.modelHealth) return
    if ((store.modelHealth.consecutive ?? 0) === 0) return
    store.modelHealth = { ...store.modelHealth, consecutive: 0, lastOkAt: Date.now() }
    state.save()
  }

  async function drain() {
    if (disposed || draining) return
    draining = true
    try {
      const data = ensureState()
      const config = settings()?.capture ?? {}
      const concurrency = Math.min(4, Math.max(1, Math.floor(Number(config.concurrency) || 1)))
      const maxPerDrain = Math.min(50, Math.max(1, Math.floor(Number(config.maxPerDrain) || 8)))
      const watchdogMs = drainWatchdogMs(settings())
      let handled = 0
      let needsRetry = false
      while (queue.length > 0 && !disposed && handled < maxPerDrain) {
        const batch = queue.slice(0, Math.min(concurrency, maxPerDrain - handled))
        if (batch.length === 0) break
        const outcomes = await Promise.race([
          Promise.all(batch.map((job) => sendJob(job))),
          new Promise((resolve) => {
            // unref so a dangling watchdog never keeps the process (or a test
            // run) alive; it still fires while the event loop is busy.
            const timer = setTimeout(() => resolve(null), watchdogMs)
            timer.unref?.()
          }),
        ])
        if (outcomes === null) {
          // A request that outlives the watchdog must count as a failed attempt,
          // otherwise the same jobs are retried forever and the backlog never
          // moves.
          for (const job of batch) {
            job.attempts = (job.attempts ?? 0) + 1
            if (job.attempts >= maxAttempts(settings())) {
              const kept = await fallbackToLite(getClient(), job).catch(() => false)
              activity?.record({
                kind: 'error',
                tier: 'session',
                summary: kept ? 'capture write timed out; raw text kept' : 'capture write timed out',
                detail: `watchdog ${watchdogMs}ms`,
                ok: false,
              })
            }
          }
          const limit = maxAttempts(settings())
          const exhausted = new Set(batch.filter((job) => (job.attempts ?? 0) >= limit))
          if (exhausted.size > 0) {
            const remaining = queue.filter((job) => !exhausted.has(job))
            queue.length = 0
            queue.push(...remaining)
          }
          if (state?.data) state.data.lastAddError = { at: Date.now(), code: 'DRAIN_TIMEOUT', scene: batch[0]?.scene ?? 'chat' }
          state.save()
          log('capture drain watchdog: batch marked as failed attempts')
          scheduleRetry(MISSING_CLIENT_RETRY_MS)
          break
        }
        handled += batch.length
        // Remove finished jobs by identity: completions may land out of order.
        const done = new Set()
        batch.forEach((job, index) => {
          if (outcomes[index] !== 'retry') done.add(job)
        })
        if (done.size > 0) {
          const remaining = queue.filter((job) => !done.has(job))
          queue.length = 0
          queue.push(...remaining)
          persistQueue()
        }
        const retried = batch.find((job, index) => outcomes[index] === 'retry')
        if (retried !== undefined) {
          needsRetry = true
          scheduleRetry(nextBackoff(retried.attempts))
          break
        }
      }
      // Leftover backlog continues on the ticker; an immediate retry here would
      // spin when the sidecar is still starting.
      if (!needsRetry && queue.length > 0) scheduleRetry(MISSING_CLIENT_RETRY_MS)
    } catch (error) {
      log('capture queue failed', error)
    } finally {
      draining = false
    }
  }

  /** Reconcile and gateway failures are worth retrying; a bad payload is not. */
  function transientFailure(result) {
    const code = String(result?.agent_error_code ?? result?.error_code ?? '').toUpperCase()
    if (code === '') return false
    // JSON_PARSE failures come from a model answering with malformed JSON, not
    // from a bad payload: retrying once or twice usually lands a usable answer.
    return /RECONCILE|EMPTY_RESPONSE|JSON_PARSE|TIMEOUT|INTERNAL|RATE|OVERLOAD|UNAVAILABLE|502|503|504/.test(code)
  }

  /** Last resort: keep the raw text in the lite layer instead of losing the turn. */
  async function fallbackToLite(client, job) {
    if (typeof client?.bridgeAddLite !== 'function') return false
    const data = Array.isArray(job?.payload?.data) ? job.payload.data : []
    try {
      await client.bridgeAddLite({
        data,
        user_id: job.payload?.user_id,
        agent_id: job.payload?.agent_id,
        session_id: job.payload?.session_id,
      }, { timeoutMs: ADD_TIMEOUT_MS })
      activity?.record({
        kind: 'capture',
        tier: 'session',
        summary: 'kept the turn in the raw layer after reconcile failed',
        detail: 'lite fallback',
        ok: true,
      })
      return true
    } catch (error) {
      log('lite fallback failed', error)
      return false
    }
  }

  /**
   * Optional capacity guard. Off by default because deleting memories is
   * irreversible: when enabled, the oldest rows beyond the cap are appended to a
   * JSONL archive under the integration directory first, then deleted.
   */
  async function enforceCapacity(client, entry) {
    const policy = settings()?.lifecycle ?? {}
    if (policy.archiveOnCap !== true) return
    const cap = Math.max(50, Number(policy.maxPerTier) || 2000)
    try {
      const user = resolveUser(settings())
      const page = await client.bridgeList({ user_ids: [user], scene: 'all', limit: cap + 100, offset: 0 })
      const rows = Array.isArray(page?.memories) ? page.memories : []
      if (rows.length <= cap) return
      const sorted = [...rows].sort((left, right) => Number(left.created_at ?? left.memory_at ?? 0) - Number(right.created_at ?? right.memory_at ?? 0))
      const extras = sorted.slice(0, rows.length - cap)
      if (extras.length === 0) return
      const dir = join(integrationDir(), 'archive')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `capacity-${Date.now()}.jsonl`)
      for (const row of extras) appendFileSync(file, `${JSON.stringify(row)}
`)
      let removed = 0
      for (const row of extras) {
        try {
          const payload = { id: row.memory_id, kind: row.kind ?? 'chat' }
          if (row.scene && row.scene !== 'chat') payload.variant = row.scene
          await client.bridgeDelete(payload)
          removed += 1
        } catch (error) {
          log('capacity delete failed', error)
        }
      }
      activity?.record({ kind: 'delete', tier: 'session', summary: `archived ${extras.length} old memories over the cap`, detail: `removed ${removed}`, ok: true })
    } catch (error) {
      log('capacity guard failed', error)
    }
  }

  /** Drop lines the user explicitly forgot, so promotion cannot resurrect them. */
  function dropForgotten(lines) {
    const store = state?.data
    if (!Array.isArray(store?.forgottenHashes) || store.forgottenHashes.length === 0) return lines
    const known = new Set(store.forgottenHashes)
    return lines.filter((line) => !known.has(contentHash(line)))
  }

  async function ask(model, prompt) {
    // Prefer the sidecar's endpoint: it runs with the thinking channel disabled,
    // while a gateway model reached through the host can answer with reasoning
    // only and therefore an empty text body.
    const client = getClient()
    if (client && typeof client.bridgeComplete === 'function') {
      try {
        const result = await client.bridgeComplete({ prompt }, { timeoutMs: PROMOTE_TIMEOUT_MS })
        const text = typeof result?.text === 'string' ? result.text : ''
        if (text.trim()) return text
      } catch (error) {
        log('promotion completion through the sidecar failed', error)
      }
    }
    const llm = getLlm()
    if (!llm || typeof llm.stream !== 'function') return ''
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('promotion timeout')), PROMOTE_TIMEOUT_MS)
    timer.unref?.()
    let text = ''
    let finish
    try {
      const stream = llm.stream({
        provider: model.provider,
        model: model.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        signal: controller.signal,
        purpose: 'hy-memory-promotion',
      })
      for await (const chunk of stream) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        else if (chunk?.type === 'finish') finish = chunk.reason
      }
    } finally {
      clearTimeout(timer)
    }
    const okKinds = new Set(['stop', 'completed', 'max-tokens'])
    if (finish && !okKinds.has(finish.kind)) {
      throw new Error(`promotion model call ended with ${finish.kind}`)
    }
    return text
  }

  function promotionRecordSessions() {
    return ensureState().promotions.sessions
  }

  async function maybePromote(entry, reason) {
    if (disposed) return
    // Turns arrive faster than a promotion run: keep the latest request instead of
    // dropping it, otherwise frequent turns starve the project and personal tiers.
    if (promoting.has(entry.id)) {
      pendingPromotion.set(entry.id, { entry, reason })
      return
    }
    const config = settings()
    if (!config?.promotion?.enabled) return
    const every = Math.max(1, Number(config.promotion.everyTurns) || 8)
    const wantSession = entry.turnsSincePromotion >= every
    const wantPersonal = entry.turnsSincePersonal >= every * 3
    if (reason === 'session-end' && config.promotion.onSessionEnd !== false) {
      if (entry.turnsSincePromotion > 0) await promoteSession(entry)
      return
    }
    if (wantSession) {
      entry.turnsSincePromotion = 0
      await promoteSession(entry)
    }
    if (wantPersonal) {
      entry.turnsSincePersonal = 0
      await promoteProject(entry)
    }
  }

  async function modelForEntry(entry) {
    try {
      // The session may not have recorded a model selection yet, and the host's
      // route is resolved lazily; ask the host for both before giving up.
      if (typeof resolveModel === 'function') {
        const resolved = await resolveModel(entry.session)
        if (resolved && typeof resolved.provider === 'string' && typeof resolved.model === 'string' && resolved.provider && resolved.model) return resolved
      }
      const model = modelFor(entry.session)
      if (model && typeof model.provider === 'string' && typeof model.model === 'string' && model.provider && model.model) {
        return model
      }
    } catch {}
    return null
  }

  async function promoteSession(entry) {
    const client = getClient()
    if (!client) return
    const records = promotionRecordSessions()
    const record = records[entry.id]
    if (record && record.seq === entry.cursor) return
    const query = entry.lastQuery || entry.title || entry.lastFlushedText || lastBufferedText(entry)
    if (!query) {
      records[entry.id] = { at: Date.now(), seq: entry.cursor, skipped: 'no-query' }
      state.save()
      return
    }
    const model = await modelForEntry(entry)
    if (!model) {
      records[entry.id] = { at: Date.now(), seq: entry.cursor, skipped: 'no-model' }
      state.save()
      return
    }
    promoting.add(entry.id)
    try {
      const config = settings()
      const key = projectKey(entry.cwd)
      const response = await client.search({
        query,
        user_ids: [resolveUser(config)],
        ...key ? { agent_ids: [projectAgentId(key)] } : {},
        limit: 12,
        min_score: 0,
      }, { timeoutMs: SEARCH_TIMEOUT_MS })
      const items = collectSearchItems(response)
        .filter((raw) => !raw?.session_id || String(raw.session_id) === entry.id)
        .map((raw) => truncateChars(String(raw?.content ?? '').trim(), 400))
        .filter(Boolean)
        .slice(0, 8)
      records[entry.id] = { at: Date.now(), seq: entry.cursor, candidates: items.length }
      state.save()
      if (items.length < 2 || !key) return
      const prompt = truncateChars(sessionToProjectPrompt(items), PROMPT_INPUT_CHARS)
      const answer = await ask(model, prompt)
      const lines = dropForgotten(promotionLines(answer))
      if (lines.length === 0) return
      const result = await writePromotedWithRetry(client, {
        data: [{ role: 'user', content: lines.join('\n') }],
        ...writeScope('project', { settings: config, projectKey: key }),
        scene: 'chat',
      }, { timeoutMs: ADD_TIMEOUT_MS })
      if (result?.success === false) throw new Error(String(result?.agent_error_code ?? 'promotion write failed'))
      activity?.record({
        kind: 'promote',
        tier: 'project',
        summary: `promoted ${lines.length} session memories to project`,
        detail: entry.title || key,
        ok: true,
      })
    } catch (error) {
      log('session promotion failed', error)
      activity?.record({ kind: 'error', summary: 'session promotion failed', detail: String(error?.message ?? error), ok: false })
    } finally {
      promoting.delete(entry.id)
      drainPendingPromotion()
    }
  }

  /**
   * A promoted write is a small, already-distilled batch, so a retry is cheap.
   * The gateway intermittently answers the reconcile call with an empty body
   * (502 / RECONCILE_FAILED); retrying once recovers those without dropping the
   * promotion.
   */
  /** Last resort query for promotion: the newest buffered line. */
  function lastBufferedText(entry) {
    const buffer = Array.isArray(entry?.buffer) ? entry.buffer : []
    for (let i = buffer.length - 1; i >= 0; i -= 1) {
      const text = String(buffer[i]?.content ?? '').trim()
      if (text) return text.slice(0, 200)
    }
    return ''
  }

  async function writePromotedWithRetry(client, payload) {
    const first = await client.add(payload)
    if (first?.success !== false) return first
    const code = String(first?.agent_error_code ?? first?.error_code ?? '')
    const retryable = /502|503|LLM_ERROR|RECONCILE_FAILED|EMPTY_RESPONSE/.test(code)
    if (!retryable) return first
    log(`promotion write retrying after ${code}`)
    return client.add(payload)
  }

  function drainPendingPromotion() {
    if (disposed || pendingPromotion.size === 0) return
    for (const [id, next] of pendingPromotion) {
      pendingPromotion.delete(id)
      setTimeout(() => { void maybePromote(next.entry, next.reason) }, 0).unref?.()
    }
  }

  async function promoteProject(entry) {
    const client = getClient()
    if (!client) return
    const config = settings()
    const key = projectKey(entry.cwd)
    if (!key) return
    const records = ensureState().promotions.projects
    const record = records[key]
    if (record && record.seq === entry.cursor) return
    const model = await modelForEntry(entry)
    if (!model) {
      records[key] = { at: Date.now(), seq: entry.cursor, skipped: true }
      state.save()
      return
    }
    promoting.add(`project:${key}`)
    try {
      const response = await client.list({
        user_id: resolveUser(config),
        agent_id: projectAgentId(key),
        limit: 100,
        offset: 0,
        order: 'desc',
      }, { timeoutMs: SEARCH_TIMEOUT_MS })
      const items = (response?.vdb?.memories ?? [])
        .filter((item) => String(item?.session_id ?? '') === 'project')
        .map((item) => truncateChars(String(item?.content ?? '').trim(), 400))
        .filter(Boolean)
        .slice(0, 10)
      records[key] = { at: Date.now(), seq: entry.cursor, candidates: items.length }
      state.save()
      if (items.length < 3) return
      const prompt = truncateChars(projectToPersonalPrompt(items), PROMPT_INPUT_CHARS)
      const answer = await ask(model, prompt)
      const lines = dropForgotten(promotionLines(answer))
      if (lines.length === 0) return
      const result = await writePromotedWithRetry(client, {
        data: [{ role: 'user', content: lines.join('\n') }],
        ...writeScope('personal', { settings: config }),
        scene: 'chat',
      }, { timeoutMs: ADD_TIMEOUT_MS })
      if (result?.success === false) throw new Error(String(result?.agent_error_code ?? 'promotion write failed'))
      activity?.record({
        kind: 'promote',
        tier: 'personal',
        summary: `promoted ${lines.length} project memories to personal`,
        detail: key,
        ok: true,
      })
    } catch (error) {
      log('project promotion failed', error)
      activity?.record({ kind: 'error', summary: 'project promotion failed', detail: String(error?.message ?? error), ok: false })
    } finally {
      promoting.delete(`project:${key}`)
      drainPendingPromotion()
    }
  }

  function handleSessionDisposed(session) {
    try {
      if (!session?.id) return
      const entry = sessions.get(session.id)
      if (!entry) return
      sessions.delete(session.id)
      const finished = flush(entry, 'disposed')
      if (settings()?.promotion?.onSessionEnd !== false) {
        void finished.then(() => maybePromote(entry, 'session-end'))
      }
    } catch (error) {
      log('session dispose handling failed', error)
    }
  }

  async function flushAll(reason = 'shutdown') {
    const entries = [...sessions.values()]
    for (const entry of entries) await flush(entry, reason)
  }

  queue = readCaptureQueue(queuePath)
  {
    // One-time migration: an older host kept the queue inside state.json.
    const legacy = ensureState().capture.queue
    if (queue.length === 0 && Array.isArray(legacy) && legacy.length > 0) {
      queue = legacy.filter((job) => job && typeof job === 'object' && job.payload)
      writeCaptureQueue(queue, queuePath)
    }
    if (Array.isArray(legacy) && legacy.length > 0) legacy.length = 0
    // Keep the mirror accurate even when nothing was enqueued this run.
    state.data.capture.queue = queue.slice()
    state.save()
  }

  function dispose() {
    disposed = true
    if (drainTicker !== null) {
      clearInterval(drainTicker)
      drainTicker = null
    }
    if (queueTimer !== null) {
      clearTimeout(queueTimer)
      queueTimer = null
      writeCaptureQueue(queue, queuePath)
    }
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    for (const entry of sessions.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer)
        entry.timer = null
      }
    }
    sessions.clear()
  }

  function queueDepth() {
    return queue.length
  }

  drainTicker = setInterval(() => {
    const queue = state?.data?.capture?.queue
    if (disposed) return
    if (Array.isArray(queue) && queue.length > 0) void drain()
  }, 15_000)
  drainTicker.unref?.()

  return {
    handleSessionEvent,
    handleSessionDisposed,
    flushAll,
    flushSession: (id) => {
      const entry = sessions.get(id)
      return entry ? flush(entry, 'manual') : Promise.resolve()
    },
    drain,
    maybePromote,
    dispose,
    queueDepth,
    sessionCount: () => sessions.size,
  }
}

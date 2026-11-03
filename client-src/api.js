/**
 * Same-origin HTTP client for the Host's Hy-Memory panel routes.
 *
 * Every route is a POST under `/api/hy-memory/` and answers
 * `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. The client
 * never sends credentials anywhere but the page origin, and it never invents a
 * route name: see docs/CONTRACT.md.
 */

const BASE = '/api/hy-memory'

export class PanelApiError extends Error {
  constructor(verb, message, status = 0, code = '') {
    super(message)
    this.name = 'PanelApiError'
    this.verb = verb
    this.status = status
    /** Machine-readable `error.code` from the host body; '' when the failure had none. */
    this.code = code
  }
}

async function request(verb, payload) {
  const path = `${BASE}/${verb}`
  let response
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    })
  } catch (cause) {
    throw new PanelApiError(verb, `network request failed: ${cause?.message ?? String(cause)}`)
  }
  let text = ''
  try {
    text = await response.text()
  } catch {
    text = ''
  }
  let body = null
  if (text !== '') {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  const errorCode = typeof body?.error?.code === 'string' ? body.error.code : ''
  if (!response.ok) {
    throw new PanelApiError(
      verb,
      body?.error?.message ?? (text !== '' ? text : `HTTP ${response.status}`),
      response.status,
      errorCode,
    )
  }
  if (body !== null && body.ok === false) {
    throw new PanelApiError(verb, body?.error?.message ?? 'request was rejected', response.status, errorCode)
  }
  return body !== null && typeof body === 'object' && 'data' in body ? body.data : body
}

/** One status read, shared by the settings panel and the session pane. */
let statusPromise = null

/**
 * Warm the status read so the panel's first paint has data ready. Failures are
 * kept out of the module: a later load retries.
 * @returns the status payload.
 */
export function loadStatus() {
  if (statusPromise === null) {
    statusPromise = request('status').catch((error) => {
      statusPromise = null
      throw error
    })
  }
  return statusPromise
}

/** Force a fresh status read (retry, refresh, after starting the sidecar). */
export function readStatus() {
  statusPromise = request('status').catch((error) => {
    statusPromise = null
    throw error
  })
  return statusPromise
}

/** The `ui.sessionPanel` flag, read once and cached for the page lifetime. */
let sessionPanelEnabled = null
let sessionPanelPromise = null

/**
 * Whether the optional session-view tab should be contributed. A settings read
 * failure keeps the documented default (on) and caches that decision.
 * @returns the flag.
 */
export function getSessionPanelEnabled() {
  if (sessionPanelEnabled !== null) return Promise.resolve(sessionPanelEnabled)
  if (sessionPanelPromise === null) {
    sessionPanelPromise = request('settings/get')
      .then((data) => {
        const settings = data?.settings ?? data ?? {}
        sessionPanelEnabled = settings?.ui?.sessionPanel !== false
        return sessionPanelEnabled
      })
      .catch(() => {
        sessionPanelEnabled = true
        return true
      })
  }
  return sessionPanelPromise
}

export const api = {
  loadStatus,
  readStatus,
  list: (params) => request('list', params),
  update: (payload) => request('update', payload),
  delete: (payload) => request('delete', payload),
  search: (payload) => request('search', payload),
  activity: (since) => request('activity', since === undefined ? {} : { since }),
  start: () => request('start'),
  getSettings: () => request('settings/get'),
  setSettings: (patch) => request('settings/set', { patch }),
  // Workspace and session pickers: `projects` lists the projects the plugin
  // already knows, `sessions` the sessions that hold session-tier memories in
  // one project. Both are read-only views (docs/CONTRACT.md panel routes).
  projects: () => request('projects'),
  // Update check: the host compares the installed version with GitHub releases.
  // Without force the host answers from its 12 h cache; force always refetches.
  updateCheck: (force) => request('update/check', typeof force === 'boolean' ? { force } : {}),
  sessions: (projectKey) => request('sessions', typeof projectKey === 'string' && projectKey !== '' ? { projectKey } : {}),
  // MemHub link (docs/CONTRACT.md addendum). Import/pull always target the
  // personal tier on the host; the panel only chooses the source.
  memhubExport: () => request('memhub/export'),
  memhubPull: () => request('memhub/pull'),
  memhubImport: (path) => request('memhub/import', typeof path === 'string' && path !== '' ? { path } : {}),
}

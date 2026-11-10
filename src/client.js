/** HTTP client for the hy_memory sidecar (stdlib server, loopback only). */
export class MemoryApiError extends Error {
  constructor(message, { status = 0, path = '', body = null } = {}) {
    super(message)
    this.name = 'MemoryApiError'
    this.status = status
    this.path = path
    this.body = body
  }

  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }
}

export class MemoryClient {
  #base
  #timeoutMs

  constructor({ port, timeoutMs = 120_000 }) {
    this.#base = `http://127.0.0.1:${port}`
    this.#timeoutMs = timeoutMs
  }

  get baseURL() {
    return this.#base
  }

  async #request(method, path, body, { timeoutMs = this.#timeoutMs, signal } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
    const onAbort = () => controller.abort(signal.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetch(`${this.#base}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await response.text()
      const payload = text ? safeJson(text) : null
      if (!response.ok) {
        throw new MemoryApiError(`${method} ${path} failed with ${response.status}`, {
          status: response.status, path, body: payload ?? text,
        })
      }
      return payload
    } catch (error) {
      if (error instanceof MemoryApiError) throw error
      throw new MemoryApiError(`${method} ${path} failed: ${error?.message ?? error}`, { path })
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  healthz(signal) {
    return this.#request('GET', '/healthz', undefined, { timeoutMs: 4000, signal })
  }

  info(signal) {
    return this.#request('GET', '/info', undefined, { timeoutMs: 4000, signal })
  }

  status(signal) {
    return this.#request('GET', '/api/v1/status', undefined, { timeoutMs: 90_000, signal })
  }

  add(payload, options) {
    return this.#request('POST', '/api/v1/add', payload, options)
  }

  search(payload, options) {
    return this.#request('POST', '/api/v1/search', payload, options)
  }

  list(payload, options) {
    return this.#request('POST', '/api/v1/list', payload, options)
  }

  get(memoryId, scope, options) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(scope ?? {})) {
      if (value === undefined || value === null || value === '') continue
      if (Array.isArray(value)) for (const item of value) query.append(key, String(item))
      else query.append(key, String(value))
    }
    const suffix = query.size ? `?${query.toString()}` : ''
    return this.#request('GET', `/api/v1/memories/${encodeURIComponent(memoryId)}${suffix}`, undefined, options)
  }

  update(memoryId, payload, options) {
    return this.#request('PUT', `/api/v1/memories/${encodeURIComponent(memoryId)}`, payload, options)
  }

  remove(memoryId, scope, options) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(scope ?? {})) {
      if (value === undefined || value === null || value === '') continue
      query.append(key, String(value))
    }
    const suffix = query.size ? `?${query.toString()}` : ''
    return this.#request('DELETE', `/api/v1/memories/${encodeURIComponent(memoryId)}${suffix}`, undefined, options)
  }

  /** Scene-aware list added by the sidecar bridge (SDK routes do not forward scene). */
  bridgeList(payload, options) {
    return this.#request('POST', '/bridge/v1/list', payload, options)
  }

  /** Scene-aware search added by the sidecar bridge. */
  bridgeSearch(payload, options) {
    return this.#request('POST', '/bridge/v1/search', payload, options)
  }

  bridgeStats(payload, options) {
    return this.#request('POST', '/bridge/v1/stats', payload, options)
  }

  /** Lite-mode write used for promoted text (no extraction LLM). */
  bridgeAddLite(payload, options) {
    return this.#request('POST', '/bridge/v1/add_lite', payload, options)
  }

  /** Scene-aware add (the SDK's HTTP route drops `scene`). */
  bridgeAddScene(payload, options) {
    return this.#request('POST', '/bridge/v1/add_scene', payload, options)
  }

  /** Edit a memory in place (keeps its id and history). */
  bridgeUpdate(payload, options) {
    return this.#request('POST', '/bridge/v1/update', payload, options)
  }

  /** The change history of one memory. */
  bridgeHistory(payload, options) {
    return this.#request('POST', '/bridge/v1/history', payload, options)
  }

  /** Per-tier counts aggregated by the SDK. */
  bridgeStatsOverview(payload, options) {
    return this.#request('POST', '/bridge/v1/stats_overview', payload, options)
  }

  /** Engine load metrics. */
  bridgeMetrics(payload, options) {
    return this.#request('POST', '/bridge/v1/metrics', payload, options)
  }

  /** What the engine did recently, newest first. */
  bridgeRecentHistory(payload, options) {
    return this.#request('POST', '/bridge/v1/recent_history', payload, options)
  }

  /** Plain completion through the sidecar's configured endpoint. */
  bridgeComplete(payload, options) {
    return this.#request('POST', '/bridge/v1/complete', payload, options)
  }

  bridgeDelete(payload, options) {
    return this.#request('POST', '/bridge/v1/delete', payload, options)
  }

  deleteAll(payload, options) {
    return this.#request('POST', '/api/v1/delete_all', payload, options)
  }

  metrics(minutes = 5, options) {
    return this.#request('GET', `/api/v1/metrics?minutes=${minutes}`, undefined, options)
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

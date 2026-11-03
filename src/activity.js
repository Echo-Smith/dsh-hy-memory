/**
 * In-process ring buffer of host activity for the settings panel.
 *
 * Events are display-only: nothing here is durable, and a missed notification
 * never affects recall, capture or the sidecar.
 */
export const ACTIVITY_LIMIT = 200

function normalize(event) {
  return {
    at: Number.isFinite(event?.at) ? event.at : Date.now(),
    kind: typeof event?.kind === 'string' && event.kind ? event.kind : 'error',
    // Empty strings rather than omission: the panel tests `!== ''` before
    // rendering a tier tag or detail paragraph.
    tier: typeof event?.tier === 'string' ? event.tier : '',
    summary: String(event?.summary ?? ''),
    detail: event?.detail === undefined || event.detail === null ? '' : String(event.detail),
    ok: event?.ok !== false,
  }
}

export class ActivityLog {
  #limit
  #events = []
  #cursor = 0
  #subscribers = new Set()

  constructor({ limit = ACTIVITY_LIMIT } = {}) {
    this.#limit = Math.max(1, limit)
  }

  get cursor() {
    return this.#cursor
  }

  record(event) {
    const entry = normalize(event)
    this.#cursor += 1
    const stored = { ...entry, cursor: this.#cursor }
    this.#events.push(stored)
    if (this.#events.length > this.#limit) this.#events.splice(0, this.#events.length - this.#limit)
    for (const subscriber of this.#subscribers) {
      try {
        subscriber(stored)
      } catch {}
    }
    return stored
  }

  /** Events newer than `since` (a previous cursor value) in arrival order. */
  list({ since = 0, limit = this.#limit } = {}) {
    const threshold = Number.isFinite(since) ? since : 0
    const events = this.#events.filter((event) => event.cursor > threshold)
    const bounded = events.slice(-Math.max(1, limit))
    return { events: bounded, cursor: this.#cursor }
  }

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {}
    this.#subscribers.add(fn)
    return () => {
      this.#subscribers.delete(fn)
    }
  }
}

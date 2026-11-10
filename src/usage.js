/**
 * Daily rollups for the usage card.
 *
 * Both the recall counters and the write-cost counters are shown per day, and
 * "day" means the user's local day — a UTC boundary would put evening work on
 * tomorrow's bar.
 */

/** YYYY-MM-DD in local time. */
export function localDayKey(date) {
  const d = date instanceof Date ? date : new Date(Number(date) || Date.now())
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Add `delta` into `days[key]`, keeping the most recent `keep` days. */
export function addToDay(days, delta, at = Date.now(), keep = 30) {
  const next = days && typeof days === 'object' ? { ...days } : {}
  const key = localDayKey(at)
  const day = next[key] && typeof next[key] === 'object' ? { ...next[key] } : null
  const merged = day ?? Object.fromEntries(Object.keys(delta).map((k) => [k, 0]))
  for (const [k, v] of Object.entries(delta)) merged[k] = (merged[k] ?? 0) + Number(v || 0)
  next[key] = merged
  const keys = Object.keys(next).sort()
  while (keys.length > keep) delete next[keys.shift()]
  return next
}

/** The last `count` days in order, filling gaps with zeros so a chart has bars. */
export function recentDays(days, count = 7, now = Date.now()) {
  const out = []
  const start = new Date(Number(now) || Date.now())
  start.setHours(0, 0, 0, 0)
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(start.getTime() - i * 86_400_000)
    const key = localDayKey(d)
    // A quiet day is a zero, not a missing key: the chart draws one bar per
    // entry, and an absent field would render as an empty slot.
    const row = days?.[key] ?? {}
    const zeroed = {}
    for (const field of Object.keys(days?.[Object.keys(days ?? {})[0]] ?? {})) zeroed[field] = 0
    out.push({ day: key, ...zeroed, ...row })
  }
  return out
}

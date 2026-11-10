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

/**
 * Compact token counts: K / M / B, one decimal place, but never at the cost of
 * small numbers. A memory engine's usage is often four or five digits, and
 * "0.02M" hides exactly the change a user is watching for, so anything below ten
 * thousand is shown in full.
 *
 *   68       -> "68"
 *   9_999    -> "9,999"
 *   19_987   -> "19.9K"
 *   1_234_567 -> "1.2M"
 */
export function formatTokens(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs < 10_000) return Math.round(n).toLocaleString('en-US')
  const units = [
    { limit: 1e9, suffix: 'B' },
    { limit: 1e6, suffix: 'M' },
    { limit: 1e3, suffix: 'K' },
  ]
  const unit = units.find((u) => abs >= u.limit) ?? units.at(-1)
  const scaled = n / unit.limit
  // Truncate rather than round: 19,987 must read "19.9K", not "20K". Rounding
  // upward hides the very change the user is watching for, and a count that
  // only ever rounds up overstates usage.
  const truncated = Math.trunc(scaled * 10) / 10
  const text = truncated.toFixed(1).replace(/\.0$/, '')
  return `${text}${unit.suffix}`
}

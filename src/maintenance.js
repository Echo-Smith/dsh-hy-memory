/**
 * Daily memory maintenance.
 *
 * Deliberately narrower than ZCode's Dream pass: it only merges groups whose
 * content is identical after normalisation (the engine's own duplicate scan),
 * never deletes a unique memory, and never touches the session tier. A Dream-style
 * rewrite needs a model to judge "same fact, different words", and the current
 * store measures zero such duplicates — an automatic model pass would cost tokens
 * to fix a problem the engine already prevents.
 */

export const MAINTENANCE_INTERVAL_HOURS = 24

export function shouldRunMaintenance(state, now = Date.now(), intervalHours = MAINTENANCE_INTERVAL_HOURS) {
  const last = Number(state?.data?.lastMaintenance?.at ?? 0)
  if (!Number.isFinite(last) || last <= 0) return true
  return now - last >= intervalHours * 3_600_000
}

export async function runMaintenance({
  ops,
  state,
  activity,
  log = () => {},
  now = Date.now(),
  intervalHours = MAINTENANCE_INTERVAL_HOURS,
  force = false,
} = {}) {
  if (!ops || typeof ops.duplicates !== 'function' || typeof ops.merge !== 'function') return null
  if (!state?.data) return null
  if (!force && !shouldRunMaintenance(state, now, intervalHours)) return null

  const report = { at: now, groups: 0, merged: 0, tiers: {}, error: '' }
  for (const tier of ['personal', 'project']) {
    let found
    try {
      found = await ops.duplicates({ tier })
    } catch (error) {
      report.error = String(error?.message ?? error).slice(0, 200)
      continue
    }
    const groups = Array.isArray(found?.groups) ? found.groups : []
    report.tiers[tier] = groups.length
    report.groups += groups.length
    for (const group of groups) {
      if (!group?.keep || !Array.isArray(group.drop) || group.drop.length === 0) continue
      try {
        await ops.merge({ tier, keep: group.keep, drop: group.drop })
        report.merged += group.drop.length
      } catch (error) {
        report.error = String(error?.message ?? error).slice(0, 200)
      }
    }
  }

  state.data.lastMaintenance = report
  state.save()
  if (report.merged > 0) {
    activity?.record({
      kind: 'delete',
      summary: `merged ${report.merged} duplicate memories`,
      detail: Object.entries(report.tiers).map(([tier, n]) => `${tier}:${n}`).join(', '),
      ok: true,
    })
  }
  if (report.error !== '') log('memory maintenance finished with an error', report.error)
  return report
}

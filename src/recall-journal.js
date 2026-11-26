/**
 * Cross-process recall journal.
 *
 * Recall runs in the session runtime; the panel is served by a different plugin
 * instance. Both open the same `state.json`, and the capture instance regularly
 * saves its own copy of it — which drops anything the recall instance wrote
 * there. `state.json` is therefore not a safe channel for recall records.
 *
 * This is an append-only JSONL file plus a small stats file, both written only by
 * the recall instance and read by everyone else.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { integrationDir } from './paths.js'
import { addToDay, localDayKey } from './usage.js'

const JOURNAL_LIMIT_LINES = 2000
const JOURNAL_MAX_BYTES = 4 * 1024 * 1024

export function recallJournalPath() {
  return join(integrationDir(), 'recalls.jsonl')
}

export function recallStatsPath() {
  return join(integrationDir(), 'recall-stats.json')
}

/** Record one injection. Never throws: a journal failure must not break recall. */
export function appendRecall(record) {
  const entry = {
    at: Number(record?.at) || Date.now(),
    query: String(record?.query ?? '').slice(0, 200),
    text: String(record?.text ?? '').slice(0, 4000),
    source: String(record?.source ?? 'semantic'),
    items: Array.isArray(record?.items) ? record.items.map((item) => ({
      id: String(item?.id ?? ''),
      tier: String(item?.tier ?? ''),
      score: typeof item?.score === 'number' ? item.score : null,
      rank: Number(item?.rank) || 0,
      preview: String(item?.preview ?? '').slice(0, 200),
    })) : [],
  }
  const tokens = Math.ceil((entry.text.length || 0) / 2.2)
  entry.tokens = tokens
  try {
    mkdirSync(integrationDir(), { recursive: true })
    appendFileSync(recallJournalPath(), `${JSON.stringify(entry)}\n`)
    trimJournal()
  } catch {}
  try {
    updateStats(entry, tokens)
  } catch {}
  return entry
}

/** Newest last, capped. Malformed lines are skipped rather than failing the read. */
export function readRecallJournal(limit = 50) {
  try {
    const text = readFileSync(recallJournalPath(), 'utf8')
    const lines = text.split('\n').filter(Boolean)
    const out = []
    for (const line of lines.slice(-Math.max(1, limit))) {
      try {
        out.push(JSON.parse(line))
      } catch {}
    }
    return out
  } catch {
    return []
  }
}

/** Usage verdict for one injection, keyed by its `at`. */
export function writeRecallUsage(at, usage) {
  const target = join(integrationDir(), 'recall-usage.json')
  const temp = `${target}.tmp`
  try {
    writeFileSync(temp, `${JSON.stringify({ at: Number(at) || 0, ...usage })}\n`)
    renameSync(temp, target)
  } catch {}
}

export function readRecallUsage() {
  try {
    const parsed = JSON.parse(readFileSync(join(integrationDir(), 'recall-usage.json'), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function readRecallStats() {
  try {
    const parsed = JSON.parse(readFileSync(recallStatsPath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function updateStats(entry, tokens) {
  const previous = readRecallStats() ?? { turns: 0, items: 0, tokens: 0, lexical: 0, byDay: {}, last: null }
  const next = {
    turns: (previous.turns ?? 0) + 1,
    items: (previous.items ?? 0) + entry.items.length,
    tokens: (previous.tokens ?? 0) + tokens,
    lexical: (previous.lexical ?? 0) + (entry.source === 'lexical' || entry.source === 'both' ? 1 : 0),
    byDay: addToDay(previous.byDay, {
      turns: 1,
      items: entry.items.length,
      tokens,
      lexical: entry.source === 'lexical' || entry.source === 'both' ? 1 : 0,
    }, entry.at),
    last: { at: entry.at, items: entry.items.length, tokens },
  }
  mkdirSync(integrationDir(), { recursive: true })
  const target = recallStatsPath()
  const temp = `${target}.tmp`
  writeFileSync(temp, `${JSON.stringify(next)}\n`)
  renameSync(temp, target)
}

function trimJournal() {
  const path = recallJournalPath()
  if (!existsSync(path)) return
  let size = 0
  try {
    size = statSync(path).size
  } catch {
    return
  }
  if (size <= JOURNAL_MAX_BYTES) return
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(-JOURNAL_LIMIT_LINES)
    writeFileSync(path, `${lines.join('\n')}\n`)
  } catch {}
}

export { localDayKey }

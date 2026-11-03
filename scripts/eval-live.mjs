#!/usr/bin/env node
/**
 * Live recall evaluation against a running plugin sidecar.
 *
 * Drives the real recall pipeline (semantic search, lexical fallback, selection
 * and budget) instead of a copy of it, so the numbers describe what a user
 * actually gets. Search responses are cached per query, which makes the
 * threshold sweep cost no extra requests.
 *
 *   node scripts/eval-live.mjs --port 19527 [--grid] [--verbose] [--json]
 */

import { readFileSync } from 'node:fs'
import { createRecall } from '../src/recall.js'
import { DEFAULT_SETTINGS } from '../src/settings.js'
import { projectAgentId } from '../src/tiers.js'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const port = arg('port', process.env.HY_MEMORY_EVAL_PORT || '19527')
const fixturesPath = arg('fixtures', new URL('./fixtures/recall-real.json', import.meta.url).pathname)
const projectKey = arg('project', '16f4d16f7ca2')
const user = arg('user', 'dsh')
const projectPath = arg('cwd', '/Users/marshecho/Documents/deepseek-harness/default-workspace')
const base = `http://127.0.0.1:${port}`
const baseline = { maxItems: DEFAULT_SETTINGS.recall.maxItems, maxChars: DEFAULT_SETTINGS.recall.maxChars, minScore: DEFAULT_SETTINGS.recall.minScore }

const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8'))

async function post(path, body) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${path} ${response.status}`)
  return response.json()
}

const cache = new Map()
const client = {
  async bridgeSearch(payload) {
    const key = JSON.stringify(payload)
    if (!cache.has(key)) cache.set(key, post('/bridge/v1/search', { ...payload, min_score: 0, limit: 12 }))
    return cache.get(key)
  },
  async bridgeList(payload) {
    const key = `list:${JSON.stringify(payload)}`
    if (!cache.has(key)) cache.set(key, post('/bridge/v1/list', { ...payload, limit: 100 }))
    return cache.get(key)
  },
}

// The busiest session in the store stands in for "the current session".
const warm = await client.bridgeSearch({ query: '记忆', user_ids: [user], agent_ids: [projectAgentId(projectKey)], scene: 'chat' })
const warmItems = Array.isArray(warm.memories) ? warm.memories : [...(warm.memories?.normal ?? [])]
const counts = new Map()
for (const item of warmItems) {
  if (!item.session_id || item.session_id === 'project') continue
  counts.set(item.session_id, (counts.get(item.session_id) ?? 0) + 1)
}
const sessionId = arg('session', [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '')
if (!sessionId) throw new Error('no session found in the store')

function makeRecall(options) {
  return createRecall({
    settings: () => ({ enabled: true, recall: { enabled: true, ...options } }),
    activity: { record() {} },
    getClient: () => client,
    contextOf: () => ({ user, projectKey, sessionId, projectPath, sessionTitle: '' }),
    log: () => {},
  })
}

async function runCase(recall, fixture, index) {
  const messages = [{ id: 'u1', role: 'user', content: [{ type: 'text', text: fixture.query }], source: { kind: 'user' } }]
  const event = {
    agent: { session: { id: sessionId, header: { cwd: projectPath } } },
    messages,
    turn: index + 1,
    step: 1,
  }
  const started = Date.now()
  const out = await recall.handlePreStep(event, async () => ({ kind: 'proceed', messages }))
  const injected = out.messages.length > messages.length ? String(out.messages.at(-1).content?.[0]?.text ?? '') : ''
  return { fixture, injected, chars: injected.length, latencyMs: Date.now() - started }
}

async function runAll(options) {
  const recall = makeRecall(options)
  const rows = []
  for (const [index, fixture] of fixtures.entries()) rows.push(await runCase(recall, fixture, index))
  return rows
}

function summarize(rows) {
  const hits = rows.filter((row) => row.injected.includes(row.fixture.expect)).length
  const chars = rows.reduce((sum, row) => sum + row.chars, 0)
  const latency = rows.reduce((sum, row) => sum + row.latencyMs, 0) / rows.length
  return { hits, cases: rows.length, avgChars: chars / rows.length, latencyMs: latency }
}

const baselineRows = await runAll(baseline)
const baselineReport = summarize(baselineRows)
console.log(`baseline: hits ${baselineReport.hits}/${baselineReport.cases}, avg injected chars ${baselineReport.avgChars.toFixed(0)}, avg latency ${baselineReport.latencyMs.toFixed(0)}ms, ${JSON.stringify(baseline)}`)

if (args.includes('--verbose')) {
  for (const row of baselineRows) {
    const head = row.injected.split('\n')[1]?.slice(0, 70) ?? '(nothing injected)'
    console.log(`  ${row.injected.includes(row.fixture.expect) ? 'HIT ' : 'MISS'} ${row.fixture.name.padEnd(36)} chars=${row.chars}  ${head}`)
  }
}
if (args.includes('--json')) console.log(JSON.stringify({ baseline: baselineReport }, null, 2))

if (args.includes('--grid')) {
  const rows = []
  for (const minScore of [0.4, 0.48, 0.56, 0.64]) {
    for (const maxItems of [4, 5]) {
      for (const maxChars of [1200, 1600]) {
        const options = { minScore, maxItems, maxChars }
        rows.push({ ...summarize(await runAll(options)), options })
      }
    }
  }
  rows.sort((a, b) => (b.hits - a.hits) || (a.avgChars - b.avgChars))
  console.log('\ntop candidates:')
  for (const row of rows.slice(0, 6)) console.log(`  hits ${row.hits}/${row.cases}  avgChars ${row.avgChars.toFixed(0)}  ${JSON.stringify(row.options)}`)
}

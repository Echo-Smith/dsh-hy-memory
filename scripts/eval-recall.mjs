#!/usr/bin/env node
/**
 * Recall evaluation harness.
 *
 * Runs deterministic fixtures through the same selection pipeline the plugin
 * uses (selectRecall: threshold, dedupe, tier order, budget) and prints hit
 * rate, noise rate and injected size. It needs no sidecar or model, so it runs
 * in CI; point it at real data with a fixture file when tuning thresholds.
 *
 *   node scripts/eval-recall.mjs [fixture.json]
 */

import { readFileSync } from 'node:fs'
import { selectRecall } from '../src/recall.js'

const DEFAULT_CASES = [
  {
    name: 'personal preference beats a weak session hit',
    options: { maxItems: 5, maxChars: 1600, minScore: 0.32 },
    groups: [
      { tier: 'personal', items: [{ id: 'p1', content: 'User prefers short reports with evidence', score: 0.9 }] },
      { tier: 'session', items: [{ id: 's1', content: 'Unrelated debugging noise', score: 0.1 }] },
    ],
    expect: ['User prefers short reports'],
    reject: ['Unrelated debugging noise'],
  },
  {
    name: 'project convention survives the budget',
    options: { maxItems: 5, maxChars: 1600, minScore: 0.32 },
    groups: [
      { tier: 'project', items: [{ id: 'j1', content: 'Run pnpm test before every commit', score: 0.8 }] },
    ],
    expect: ['Run pnpm test'],
  },
  {
    name: 'items below the threshold are dropped',
    options: { maxItems: 5, maxChars: 1600, minScore: 0.5 },
    groups: [{ tier: 'project', items: [{ id: 'j2', content: 'Weak match', score: 0.3 }] }],
    expect: [],
    reject: ['Weak match'],
  },
  {
    name: 'budget caps the number of injected items',
    options: { maxItems: 2, maxChars: 1600, minScore: 0.32 },
    groups: [{
      tier: 'personal',
      items: [1, 2, 3, 4].map((n) => ({ id: `b${n}`, content: `memory number ${n} with some words`, score: 0.9 - n * 0.05 })),
    }],
    expect: ['memory number 1'],
    maxItems: 2,
  },
  {
    name: 'character budget stops before the limit',
    options: { maxItems: 5, maxChars: 120, minScore: 0.32 },
    budgetIsItems: true,
    groups: [{
      tier: 'project',
      items: [1, 2, 3].map((n) => ({ id: `c${n}`, content: `${n} `.padStart(1) + 'x'.repeat(60), score: 0.8 })),
    }],
    maxChars: 120,
  },
  {
    name: 'duplicate content is injected once',
    options: { maxItems: 5, maxChars: 1600, minScore: 0.32 },
    groups: [
      { tier: 'personal', items: [{ id: 'd1', content: 'Same fact', score: 0.9 }] },
      { tier: 'project', items: [{ id: 'd2', content: 'Same fact', score: 0.85 }] },
    ],
    maxItems: 1,
  },
]

function loadCases() {
  const file = process.argv[2]
  if (!file) return DEFAULT_CASES
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('fixture must be an array of cases')
  return parsed
}

let failures = 0
let totalItems = 0
let totalChars = 0
const rows = []

for (const item of loadCases()) {
  const { items, text } = selectRecall(item.groups, item.options ?? {})
  const joined = items.map((entry) => entry.content).join('\n')
  const problems = []
  for (const needle of item.expect ?? []) if (!joined.includes(needle)) problems.push(`missing: ${needle}`)
  for (const needle of item.reject ?? []) if (joined.includes(needle)) problems.push(`unexpected: ${needle}`)
  if (typeof item.maxItems === 'number' && items.length > item.maxItems) problems.push(`items ${items.length} > ${item.maxItems}`)
  const itemChars = items.reduce((sum, entry) => sum + entry.content.length + 16, 0)
  if (typeof item.maxChars === 'number' && itemChars > item.maxChars && items.length > 0) {
    problems.push(`item budget ${itemChars} > ${item.maxChars}`)
  }
  if (problems.length > 0) failures += 1
  totalItems += items.length
  totalChars += items.reduce((sum, entry) => sum + entry.content.length, 0)
  rows.push({ name: item.name, items: items.length, chars: text.length, verdict: problems.length ? `FAIL (${problems.join('; ')})` : 'PASS' })
}

const width = Math.max(...rows.map((row) => row.name.length))
for (const row of rows) {
  console.log(`${row.verdict === 'PASS' ? 'PASS' : 'FAIL'}  ${row.name.padEnd(width)}  items=${row.items}  chars=${row.chars}  ${row.verdict === 'PASS' ? '' : row.verdict}`)
}
const cases = rows.length
console.log(`\ncases=${cases} failures=${failures} avgItems=${(totalItems / cases).toFixed(2)} avgChars=${(totalChars / cases).toFixed(0)}`)
process.exit(failures === 0 ? 0 : 1)

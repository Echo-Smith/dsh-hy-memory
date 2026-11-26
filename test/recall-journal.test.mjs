import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'hy-journal-'))
process.env.DSH_HOME = home
const { appendRecall, readRecallJournal, readRecallStats, recallJournalPath } = await import('../src/recall-journal.js')

test.after(() => { rmSync(home, { recursive: true, force: true }) })

test('journal records the injection and accumulates stats', () => {
  appendRecall({ at: 1_700_000_000_000, query: 'q1', text: 'Recalled memory for this request\n1. [personal] a', source: 'semantic', items: [{ id: 'm1', tier: 'personal', preview: 'a fact' }] })
  appendRecall({ at: 1_700_000_001_000, query: 'q2', text: 'Recalled memory for this request\n1. [project] b', source: 'both', items: [{ id: 'm2', tier: 'project' }, { id: 'm3', tier: 'project' }] })
  const entries = readRecallJournal(5)
  assert.deepEqual(entries.map((entry) => entry.query), ['q1', 'q2'])
  assert.equal(entries[0].items[0].preview, 'a fact')
  const stats = readRecallStats()
  assert.equal(stats.turns, 2)
  assert.equal(stats.items, 3)
  assert.equal(stats.lexical, 1)
  assert.equal(stats.last.items, 2)
})

test('a missing journal reads as empty rather than throwing', () => {
  unlinkSync(recallJournalPath())
  assert.deepEqual(readRecallJournal(5), [])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ActivityLog } from '../src/activity.js'

test('activity records a cursor and keeps the newest events', () => {
  const log = new ActivityLog({ limit: 3 })
  log.record({ kind: 'recall', summary: 'one' })
  log.record({ kind: 'capture', summary: 'two' })
  log.record({ kind: 'promote', summary: 'three' })
  const { events, cursor } = log.list({})
  assert.equal(cursor, 3)
  assert.deepEqual(events.map((event) => event.summary), ['one', 'two', 'three'])
  log.record({ kind: 'error', summary: 'four', ok: false })
  const trimmed = log.list({})
  assert.deepEqual(trimmed.events.map((event) => event.summary), ['two', 'three', 'four'])
  assert.equal(trimmed.events.at(-1).ok, false)
})

test('since filters by cursor and defaults to everything retained', () => {
  const log = new ActivityLog()
  log.record({ kind: 'recall', summary: 'a' })
  const afterA = log.list({}).cursor
  log.record({ kind: 'recall', summary: 'b' })
  const delta = log.list({ since: afterA })
  assert.deepEqual(delta.events.map((event) => event.summary), ['b'])
  assert.equal(log.list({ since: 999 }).events.length, 0)
  assert.equal(log.list({ since: 0 }).events.length, 2)
})

test('events normalize defaults and clamp detail', () => {
  const log = new ActivityLog()
  const event = log.record({ summary: 12 })
  assert.equal(event.summary, '12')
  assert.equal(event.kind, 'error')
  assert.equal(event.ok, true)
  assert.equal(event.tier, '')
  assert.equal(event.detail, '')
  const failure = log.record({ at: 1234, kind: 'delete', tier: 'project', summary: 'gone', detail: 'x', ok: false })
  assert.equal(failure.at, 1234)
  assert.equal(failure.tier, 'project')
  assert.equal(failure.ok, false)
})

test('subscribers observe events and unsubscribe cleanly', () => {
  const log = new ActivityLog()
  const seen = []
  const off = log.subscribe((event) => seen.push(event.summary))
  log.record({ kind: 'recall', summary: 'a' })
  off()
  log.record({ kind: 'recall', summary: 'b' })
  assert.deepEqual(seen, ['a'])
  assert.doesNotThrow(() => log.subscribe((event) => { throw new Error(event.summary) }))
  assert.doesNotThrow(() => log.record({ kind: 'recall', summary: 'c' }))
})

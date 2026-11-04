import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectRecall } from '../src/recall.js'
import { createMemoryOps } from '../src/tools.js'
import { contentHash } from '../src/tiers.js'

test('recency ranks a fresh memory above an equally scored old one', () => {
  const now = Date.now()
  const groups = [{
    tier: 'project',
    projectKey: 'p1',
    items: [
      { id: 'old', content: 'old but relevant', score: 0.8, updatedAt: now - 365 * 86_400_000 },
      { id: 'new', content: 'new and relevant', score: 0.8, updatedAt: now - 86_400_000 },
    ],
  }]
  const { items } = selectRecall(groups, { maxItems: 2, maxChars: 1600, minScore: 0.3, halfLifeDays: 30 })
  assert.equal(items[0].content, 'new and relevant')
  assert.equal(items.length, 2)
})

test('recency weighting can be disabled', () => {
  const now = Date.now()
  const groups = [{
    tier: 'project',
    projectKey: 'p1',
    items: [
      { id: 'old', content: 'old memory', score: 0.8, updatedAt: now - 365 * 86_400_000 },
      { id: 'new', content: 'new memory', score: 0.81, updatedAt: now - 86_400_000 },
    ],
  }]
  const { items } = selectRecall(groups, { maxItems: 2, maxChars: 1600, minScore: 0.3, halfLifeDays: 0 })
  assert.equal(items[0].content, 'new memory')
})

test('forget deletes the memory and records its text hash', async () => {
  const calls = []
  const state = { data: { forgottenHashes: [] }, save() {} }
  const ops = createMemoryOps({
    settings: () => ({ enabled: true }),
    state,
    activity: { record() {} },
    getClient: () => ({
      get: async () => ({ memory_id: 'm1', content: 'forget me  please', agent_id: 'personal', session_id: 'personal' }),
      bridgeDelete: async (payload) => { calls.push(payload); return { success: true } },
    }),
    contextOf: () => ({ user: 'dsh', projectKey: 'p1', sessionId: 's1' }),
    log: () => {},
  })
  const result = await ops.forget({ id: 'm1' })
  assert.equal(result.forgotten, true)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { id: 'm1', kind: 'chat' })
  assert.ok(state.data.forgottenHashes.includes(contentHash('forget me  please')))
})

test('duplicates groups identical text and merge deletes the rest', async () => {
  const deleted = []
  const rows = [
    { memory_id: 'a1', content: 'same fact', agent_id: 'personal', session_id: 'personal', gmt_created: 1000 },
    { memory_id: 'a2', content: 'Same  fact', agent_id: 'personal', session_id: 'personal', gmt_created: 2000 },
    { memory_id: 'a3', content: 'other fact', agent_id: 'personal', session_id: 'personal', gmt_created: 3000 },
  ]
  const client = {
    bridgeList: async () => ({ memories: rows }),
    get: async (id) => rows.find((row) => row.memory_id === id) ?? null,
    bridgeDelete: async (payload) => { deleted.push(payload.id); return { success: true } },
  }
  const ops = createMemoryOps({
    settings: () => ({ enabled: true }),
    state: { data: {}, save() {} },
    activity: { record() {} },
    getClient: () => client,
    contextOf: () => ({ user: 'dsh', projectKey: 'p1', sessionId: 's1' }),
    log: () => {},
  })
  const found = await ops.duplicates({ tier: 'personal' })
  assert.equal(found.groups.length, 1)
  assert.equal(found.groups[0].keep, 'a2')
  assert.deepEqual(found.groups[0].drop, ['a1'])
  const merged = await ops.merge({ tier: 'personal', keep: 'a2', drop: ['a1'] })
  assert.equal(merged.merged, 1)
  assert.deepEqual(deleted, ['a1'])
})

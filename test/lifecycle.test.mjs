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

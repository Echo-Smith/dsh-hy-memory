import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRecall } from '../src/recall.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('eight concurrent recalls each inject and do not serialize on one another', async () => {
  const client = {
    bridgeSearch: async () => {
      await sleep(40)
      return { memories: { schema: [], proactive: [], normal: [{ memory_id: 'm1', content: 'we chose pnpm for this repo', session_id: 's1', score: 0.9 }] } }
    },
    bridgeList: async () => ({ memories: [] }),
  }
  const recall = createRecall({
    settings: () => ({ enabled: true, recall: { enabled: true, maxItems: 3, maxChars: 1200, minScore: 0.5, waitForStartMs: 0 } }),
    activity: { record() {} },
    getClient: () => client,
    contextOf: () => ({ user: 'dsh', projectKey: 'p1', projectPath: '/tmp' }),
    log: () => {},
  })
  const started = Date.now()
  const runs = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const messages = [{ id: `u${index}`, role: 'user', content: [{ type: 'text', text: 'which package manager did we pick?' }], source: { kind: 'user' } }]
    const out = await recall.handlePreStep(
      { agent: { session: { id: `s${index}`, header: { cwd: '/tmp' } } }, messages, turn: 1, step: 1 },
      async () => ({ kind: 'proceed', messages }),
    )
    return out.messages.length > messages.length
  }))
  const elapsed = Date.now() - started
  assert.equal(runs.filter(Boolean).length, 8, 'every concurrent turn receives memory')
  assert.ok(elapsed < 260, `parallel recalls finish together, took ${elapsed} ms`)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRecall } from '../src/recall.js'

function harness(context) {
  const client = {
    bridgeSearch: async (payload) => {
      const agents = payload?.agent_ids ?? []
      const rows = agents.includes('project:p1')
        ? [{ memory_id: 'lead-1', content: 'lead decided to use pnpm', session_id: 'lead-session', agent_id: 'project:p1', score: 0.9 }]
        : []
      return { memories: { schema: [], proactive: [], normal: rows } }
    },
    bridgeList: async () => ({ memories: [] }),
  }
  return createRecall({
    settings: () => ({ enabled: true, recall: { enabled: true, maxItems: 5, maxChars: 1200, minScore: 0.5 } }),
    activity: { record() {} },
    getClient: () => client,
    contextOf: () => context,
    log: () => {},
  })
}

async function run(recall, turn = 1) {
  const messages = [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'what did we decide about the package manager?' }], source: { kind: 'user' } }]
  const out = await recall.handlePreStep({ agent: { session: { id: 'child-session', header: { cwd: '/tmp' } } }, messages, turn, step: 1 }, async () => ({ kind: 'proceed', messages }))
  // Pick the recall message by its tier: the standing personal-write policy is
  // also injected on the first turn and must not be mistaken for a recall.
  const recalled = out.messages.filter((m) => m.source?.tier && m.source.tier !== 'policy')
  return recalled.length > 0 ? String(recalled.at(-1).content[0].text) : ''
}

test('a subagent recall includes the lead session memory', async () => {
  const recall = harness({ user: 'dsh', projectKey: 'p1', sessionId: 'child-session', parentSessionId: 'lead-session', projectPath: '/tmp' })
  const injected = await run(recall)
  assert.match(injected, /lead decided to use pnpm/)
})

test('a lead recall does not absorb unrelated sibling sessions', async () => {
  const recall = harness({ user: 'dsh', projectKey: 'p1', sessionId: 'child-session', parentSessionId: '', projectPath: '/tmp' })
  const injected = await run(recall)
  assert.equal(injected, '')
})

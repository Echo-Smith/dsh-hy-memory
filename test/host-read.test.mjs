import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMemoryOps, kindOf, matchesTier, sceneOf } from '../src/tools.js'
import { ActivityLog } from '../src/activity.js'
import { projectAgentId, projectKey } from '../src/tiers.js'

const CWD = '/Users/me/work/app'
const KEY = projectKey(CWD)
const PROJECT_AGENT = projectAgentId(KEY)
const OTHER_PROJECT_AGENT = projectAgentId(projectKey('/Users/me/work/other'))

const ITEMS = [
  { memory_id: 'p1', content: 'prefers tabs', scene: 'chat', kind: 'chat', agent_id: 'personal', session_id: 'personal', status: 'active', created_at: 1700000000, updated_at: 1700000000 },
  { memory_id: 'j1', content: 'uses pnpm', scene: 'chat', kind: 'chat', agent_id: PROJECT_AGENT, session_id: 'project', status: 'active', created_at: 1700000100, updated_at: 1700000100 },
  { memory_id: 's1c', content: 'current session chat', scene: 'chat', kind: 'chat', agent_id: PROJECT_AGENT, session_id: 's1', status: 'active', created_at: 1700000200, updated_at: 1700000200 },
  { memory_id: 's1e', content: 'fix\npnpm build', scene: 'working', kind: 'experience', agent_id: PROJECT_AGENT, session_id: 's1', status: 'active', created_at: 1700000300, updated_at: 1700000300 },
  { memory_id: 'j2', content: 'other project', scene: 'chat', kind: 'chat', agent_id: OTHER_PROJECT_AGENT, session_id: 'project', status: 'active', created_at: 1700000400, updated_at: 1700000400 },
  { memory_id: 's2e', content: 'older session\nresult', scene: 'coding', kind: 'experience', agent_id: PROJECT_AGENT, session_id: 's2', status: 'active', created_at: 1700000500, updated_at: 1700000500 },
]

function fakeClient({ items = ITEMS, searchResponse, getResult } = {}) {
  const calls = { list: [], search: [], delete: [] }
  return {
    calls,
    async bridgeList(payload) {
      calls.list.push(payload)
      const offset = Number(payload.offset) || 0
      const limit = Number(payload.limit) || 20
      const page = items.slice(offset, offset + limit)
      return { scene: 'all', memories: page, total: items.length, totals: { chat: 3, working: 1, coding: 1 }, limit, offset }
    },
    async bridgeSearch(payload) {
      calls.search.push(payload)
      if (typeof searchResponse === 'function') return searchResponse(payload)
      return { memories: { normal: [{ memory_id: 'p1', content: 'prefers tabs', agent_id: 'personal', session_id: 'personal', score: 0.9 }] } }
    },
    async bridgeDelete(payload) {
      calls.delete.push(payload)
      return { success: true }
    },
    async get(id) {
      if (getResult) return getResult(id)
      throw Object.assign(new Error('not found'), { status: 404 })
    },
    async update() {
      return { success: true }
    },
    async add() {
      return { success: true, memory_id: 'new' }
    },
  }
}

function harness(client) {
  const contextState = { projectKey: KEY, sessionId: 's1' }
  const ops = createMemoryOps({
    settings: () => ({ user: 'dsh' }),
    activity: new ActivityLog(),
    getClient: () => client,
    contextOf: () => contextState,
    state: { data: { projects: { [KEY]: { path: CWD, title: 'app' } } } },
  })
  return { ops, contextState }
}

test('scene and kind are read from unified and productivity shapes', () => {
  assert.equal(sceneOf({ scene: 'chat' }), 'chat')
  assert.equal(sceneOf({ scene: 'working', kind: 'experience' }), 'working')
  assert.equal(sceneOf({ scene: 'productivity', kind: 'experience', variant: 'coding' }), 'coding')
  assert.equal(sceneOf({ kind: 'fact', variant: 'working' }), 'working')
  assert.equal(sceneOf({ agent_id: 'personal' }), 'chat')
  assert.equal(kindOf({ kind: 'experience' }), 'experience')
  assert.equal(kindOf({ kind: 'fact' }), 'fact')
  assert.equal(kindOf({ kind: 'chat' }), 'chat')
  assert.equal(kindOf({}), 'chat')
})

test('tier matching uses scope columns, strictly for stored rows and leniently for search hits', () => {
  const ctx = { user: 'dsh', projectKey: KEY, sessionId: 's1' }
  assert.equal(matchesTier(ITEMS[0], 'personal', ctx), true)
  assert.equal(matchesTier(ITEMS[0], 'project', ctx), false)
  assert.equal(matchesTier(ITEMS[1], 'project', ctx), true)
  assert.equal(matchesTier(ITEMS[2], 'session', ctx), true)
  assert.equal(matchesTier(ITEMS[3], 'session', ctx), true)
  assert.equal(matchesTier(ITEMS[4], 'project', ctx), false, 'another project is never in this tier')
  assert.equal(matchesTier(ITEMS[5], 'session', ctx), false, 'another session is never this session')
  assert.equal(matchesTier(ITEMS[3], 'project', ctx), false)
  assert.equal(matchesTier({ agent_id: PROJECT_AGENT }, 'session', ctx), false, 'strict drops missing session')
  assert.equal(matchesTier({ agent_id: PROJECT_AGENT }, 'session', ctx, { strict: false }), true)
  assert.equal(matchesTier({ agent_id: 'personal' }, 'session', ctx, { strict: false }), false)
})

test('list reads the unified bridge stream and filters productivity items into tiers', async () => {
  const client = fakeClient()
  const { ops } = harness(client)

  const session = await ops.list({ tier: 'session', limit: 20 })
  assert.deepEqual(session.items.map((item) => item.id), ['s1c', 's1e'])
  assert.equal(session.total, 2)
  assert.equal(client.calls.list[0].scene, 'all')
  assert.deepEqual(client.calls.list[0].user_ids, ['dsh'])
  assert.equal(client.calls.list[0].order, 'desc')

  const project = await ops.list({ tier: 'project', limit: 20 })
  assert.deepEqual(project.items.map((item) => item.id), ['j1'])

  const personal = await ops.list({ tier: 'personal', limit: 20 })
  assert.deepEqual(personal.items.map((item) => item.id), ['p1'])
  assert.equal(personal.items[0].tier, 'personal')
  assert.equal(personal.items[0].createdAt, 1_700_000_000_000)
  assert.equal(personal.items[0].updatedAt, 1_700_000_000_000)
})

test('counts tally the unified scan per tier', async () => {
  const client = fakeClient()
  const { ops } = harness(client)
  const counts = await ops.counts()
  assert.deepEqual(counts, { personal: 1, project: 1, session: 2 })
  assert.equal(client.calls.list[0].scene, 'all')
})

test('counts are cached briefly and invalidated by a mutation', async () => {
  const client = fakeClient()
  const { ops } = harness(client)
  await ops.counts()
  await ops.counts()
  assert.equal(client.calls.list.length, 1, 'second status poll reuses the tally')
  await ops.add({ content: 'note', tier: 'personal' })
  await ops.counts()
  assert.equal(client.calls.list.length, 2, 'a write clears the tally')
})

test('search passes scene per tier: chat for personal/project, all for session', async () => {
  const client = fakeClient({
    searchResponse: (payload) => {
      if (payload.scene === 'all') {
        return { memories: [{ memory_id: 's1e', content: 'fix', scene: 'working', kind: 'experience', agent_id: PROJECT_AGENT, score: 0.8 }] }
      }
      return {
        memories: {
          normal: [
            { memory_id: 'p1', content: 'prefers tabs', agent_id: 'personal', session_id: 'personal', score: 0.9 },
            { memory_id: 'foreign', content: 'someone else', agent_id: 'other', session_id: 'x', score: 0.7 },
          ],
        },
      }
    },
  })
  const { ops } = harness(client)
  const groups = await ops.search({ query: 'indentation' })

  const personal = client.calls.search.find((call) => call.scene === 'chat' && call.agent_ids?.[0] === 'personal')
  assert.deepEqual(personal.user_ids, ['dsh'])
  assert.equal(client.calls.search.some((call) => call.scene === 'all' && call.session_ids?.[0] === 's1'), true)
  assert.deepEqual(groups.personal.map((item) => item.id), ['p1'], 'foreign agents are filtered out')
  assert.deepEqual(groups.session.map((item) => item.id), ['s1e'], 'productivity hits survive the lenient session filter')
})

test('update refuses productivity memories and allows chat ones', async () => {
  const productivity = { memory_id: 's1e', content: 'fix', kind: 'experience', variant: 'working', scene: 'productivity', agent_id: PROJECT_AGENT, session_id: 's1' }
  const client = fakeClient({ getResult: () => productivity })
  const { ops } = harness(client)
  await assert.rejects(
    () => ops.update({ id: 's1e', content: 'nope' }),
    (error) => error.code === 'edit_unsupported_for_scene' && /working/.test(error.message),
  )
  assert.equal(client.calls.delete.length, 0)

  const chat = { memory_id: 'p1', content: 'prefers tabs', agent_id: 'personal', session_id: 'personal' }
  const chatClient = fakeClient({ getResult: () => chat })
  const chatHarness = harness(chatClient)
  const result = await chatHarness.ops.update({ id: 'p1', content: 'prefers spaces' })
  assert.equal(result.updated, true)
  assert.equal(chatClient.calls.delete.length, 0)
})

test('delete routes productivity items through the bridge with kind and variant', async () => {
  const experience = { memory_id: 's1e', content: 'fix', kind: 'experience', variant: 'coding', scene: 'productivity', agent_id: PROJECT_AGENT, session_id: 's1' }
  const client = fakeClient({ getResult: () => experience })
  const { ops } = harness(client)
  const result = await ops.remove({ id: 's1e', tier: 'session' })
  assert.equal(result.deleted, true)
  assert.deepEqual(client.calls.delete[0], { id: 's1e', kind: 'experience', variant: 'coding' })
})

test('delete of a chat node sends kind chat without a variant', async () => {
  const chat = { memory_id: 's1c', content: 'chat', agent_id: PROJECT_AGENT, session_id: 's1' }
  const client = fakeClient({ getResult: () => chat })
  const { ops } = harness(client)
  await ops.remove({ id: 's1c', tier: 'session' })
  assert.deepEqual(client.calls.delete[0], { id: 's1c', kind: 'chat' })
})

test('delete enforces the tier and session guards before touching the store', async () => {
  const otherSession = { memory_id: 's2e', content: 'old', kind: 'experience', variant: 'working', agent_id: PROJECT_AGENT, session_id: 's2' }
  const client = fakeClient({ getResult: () => otherSession })
  const { ops } = harness(client)
  await assert.rejects(() => ops.remove({ id: 's2e', tier: 'session' }), (error) => error.code === 'tier_mismatch')
  await assert.rejects(() => ops.remove({ id: 's2e', tier: 'bogus' }), (error) => error.code === 'unknown_tier')
  assert.equal(client.calls.delete.length, 0)

  const personalChat = { memory_id: 'p1', content: 'x', agent_id: 'personal', session_id: 'personal' }
  const personalClient = fakeClient({ getResult: () => personalChat })
  const personalHarness = harness(personalClient)
  await assert.rejects(() => personalHarness.ops.remove({ id: 'p1', tier: 'project' }), (error) => error.code === 'tier_mismatch')
  assert.equal(personalClient.calls.delete.length, 0)
})

test('get locates an item through the SDK lookup and reports its scene and kind', async () => {
  const experience = { memory_id: 's1e', content: 'fix', kind: 'fact', variant: 'working', agent_id: PROJECT_AGENT, session_id: 's1' }
  const client = fakeClient({ getResult: () => experience })
  const { ops } = harness(client)
  const found = await ops.get({ id: 's1e' })
  assert.equal(found.scene, 'working')
  assert.equal(found.kind, 'fact')
  assert.equal(found.item.id, 's1e')
})

test('a client without bridge routes reports bridge_unavailable instead of silently returning nothing', async () => {
  const legacy = { async list() { throw new Error('should not be called') } }
  const { ops } = harness(legacy)
  await assert.rejects(() => ops.list({ tier: 'personal' }), (error) => error.code === 'bridge_unavailable')
})

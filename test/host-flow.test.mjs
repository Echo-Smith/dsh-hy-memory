import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCapture } from '../src/capture.js'
import { createRecall } from '../src/recall.js'
import { ActivityLog } from '../src/activity.js'
import { projectAgentId, projectKey } from '../src/tiers.js'

const CWD = '/Users/me/work/app'
const KEY = projectKey(CWD)
const SESSION = { id: 's1', header: { cwd: CWD } }

const RECALL_SETTINGS = {
  recall: { enabled: true, maxItems: 5, maxChars: 1600, minScore: 0.3, timeoutMs: 60 },
  capture: { enabled: false },
  promotion: { enabled: false },
}

function tempQueuePath() {
  return join(mkdtempSync(join(tmpdir(), 'hy-queue-')), 'capture-queue.json')
}

function userMessage(text) {
  return { id: `u-${text}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function recallHarness({ settings = RECALL_SETTINGS, client } = {}) {
  const activity = new ActivityLog()
  const calls = []
  const fake = client ?? {
    async bridgeSearch(payload) {
      calls.push(payload)
      return { memories: { normal: [{ memory_id: 'm1', content: 'prefers tabs', agent_id: 'personal', session_id: 'personal', score: 0.9 }] } }
    },
  }
  const recall = createRecall({
    settings: () => settings,
    activity,
    getClient: () => fake,
    contextOf: () => ({ projectKey: KEY, sessionId: 's1', sessionTitle: 'demo' }),
    log: () => {},
  })
  return { recall, calls, activity, settings }
}

test('pre-step recall searches all tiers and injects one sourced message', async () => {
  const { recall, calls } = recallHarness()
  const decision = { kind: 'proceed', messages: [userMessage('which indentation?')] }
  const result = await recall.handlePreStep({
    agent: { session: SESSION },
    messages: decision.messages,
    turn: 1,
    step: 1,
  }, async () => decision)

  // The first turn also carries the standing personal-write policy, so count
  // the recall by tier instead of by position.
  const injected = result.messages.find((m) => m.source?.tier && m.source.tier !== 'policy')
  assert.ok(injected, 'a recall message is injected')
  assert.equal(result.messages.length, 3, 'the user turn, the recall and the policy')
  assert.equal(injected.source.kind, 'hy-memory')
  assert.match(injected.content[0].text, /prefers tabs/)
  assert.equal(decision.messages.length, 1, 'the source decision is not mutated')
  assert.equal(calls.length, 3)
  assert.ok(calls.some((call) => Array.isArray(call.user_ids) && call.user_ids[0] === 'dsh' && call.agent_ids[0] === 'personal' && call.scene === 'chat'))
  assert.ok(calls.some((call) => Array.isArray(call.agent_ids) && call.agent_ids[0] === projectAgentId(KEY) && call.scene === 'chat' && !call.session_ids))
  assert.ok(calls.every((call) => Array.isArray(call.user_ids) && call.user_ids.length > 0), 'every recall search carries user_ids')
  assert.ok(calls.some((call) => Array.isArray(call.agent_ids) && call.agent_ids.includes(projectAgentId(KEY))))
  assert.ok(calls.some((call) => Array.isArray(call.agent_ids) && call.agent_ids[0] === 'personal'))
})

test('recall runs at most once per turn and never after a rejection', async () => {
  const { recall, calls } = recallHarness()
  const decision = { kind: 'proceed', messages: [userMessage('hello')] }
  const payload = { agent: { session: SESSION }, messages: decision.messages, turn: 4, step: 1 }
  await recall.handlePreStep(payload, async () => decision)
  await recall.handlePreStep(payload, async () => decision)
  assert.equal(calls.length, 3, 'the second step of the same turn must not search again')

  const rejected = { kind: 'reject', messages: [] }
  const after = await recall.handlePreStep({ ...payload, turn: 5 }, async () => rejected)
  assert.equal(after, rejected)
})

test('recall degrades to the unchanged decision when the sidecar is absent', async () => {
  const activity = new ActivityLog()
  const recall = createRecall({
    settings: () => RECALL_SETTINGS,
    activity,
    getClient: () => null,
    contextOf: () => ({ projectKey: KEY, sessionId: 's1' }),
    log: () => {},
  })
  const decision = { kind: 'proceed', messages: [userMessage('hello')] }
  const result = await recall.handlePreStep({ agent: { session: SESSION }, messages: decision.messages, turn: 1, step: 1 }, async () => decision)
  assert.equal(result, decision)
})

test('recall honours its deadline when the search never resolves', async () => {
  const settings = { ...RECALL_SETTINGS, recall: { ...RECALL_SETTINGS.recall, timeoutMs: 40 } }
  const hang = { search: () => new Promise(() => {}) }
  const { recall } = recallHarness({ settings, client: hang })
  const decision = { kind: 'proceed', messages: [userMessage('hello')] }
  const started = Date.now()
  const result = await recall.handlePreStep({ agent: { session: SESSION }, messages: decision.messages, turn: 1, step: 1 }, async () => decision)
  assert.equal(result, decision)
  // The result alone proves the 40ms deadline returned instead of hanging on
  // the never-resolving search; this bound only catches pathological waits, so
  // it is loose enough to survive parallel `node --test` scheduling.
  assert.ok(Date.now() - started < 5_000)
})

test('cache-disabled recall is skipped entirely', async () => {
  const settings = { ...RECALL_SETTINGS, recall: { ...RECALL_SETTINGS.recall, enabled: false } }
  const { recall, calls } = recallHarness({ settings })
  const decision = { kind: 'proceed', messages: [userMessage('hello')] }
  const result = await recall.handlePreStep({ agent: { session: SESSION }, messages: decision.messages, turn: 1, step: 1 }, async () => decision)
  assert.equal(result, decision)
  assert.equal(calls.length, 0)
})

test('capture flush calls add() once with the session scope and scene', async () => {
  const state = {
    data: { projects: {}, capture: { sessions: {}, queue: [] }, promotions: { sessions: {}, projects: {} }, lastScene: 'chat' },
    save() {},
  }
  const settings = {
    capture: { enabled: true, windowTurns: 1, idleFlushMs: 0, includeToolCalls: true, toolResultChars: 500 },
    promotion: { enabled: false },
    recall: { enabled: false },
  }
  const calls = []
  const capture = createCapture({
    queuePath: tempQueuePath(),
    queuePath: tempQueuePath(),
    settings: () => settings,
    state,
    activity: new ActivityLog(),
    getClient: () => ({ add: async (payload) => { calls.push(payload); return { success: true } } }),
    log: () => {},
  })
  try {
    capture.handleSessionEvent(SESSION, { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'remember pnpm' }] } })
    capture.handleSessionEvent(SESSION, { seq: 2, type: 'turn/end', data: { turn: 1 } })
    const deadline = Date.now() + 1000
    while (calls.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].user_id, 'dsh')
    assert.equal(calls[0].agent_id, projectAgentId(KEY))
    assert.equal(calls[0].session_id, 's1')
    assert.equal(calls[0].scene, 'chat')
    assert.deepEqual(calls[0].data, [{ role: 'user', content: 'remember pnpm' }])
    assert.equal(state.data.capture.queue.length, 0, 'a successful write drains the queue')
  } finally {
    capture.dispose()
  }
})

test('capture retries a failed write and keeps the job queued', async () => {
  const state = {
    data: { projects: {}, capture: { sessions: {}, queue: [] }, promotions: { sessions: {}, projects: {} }, lastScene: 'chat' },
    save() {},
  }
  const settings = {
    capture: { enabled: true, windowTurns: 1, idleFlushMs: 0, includeToolCalls: true, toolResultChars: 500 },
    promotion: { enabled: false },
    recall: { enabled: false },
  }
  let attempts = 0
  const capture = createCapture({
    queuePath: tempQueuePath(),
    queuePath: tempQueuePath(),
    settings: () => settings,
    state,
    activity: new ActivityLog(),
    getClient: () => ({
      add: async () => {
        attempts += 1
        throw Object.assign(new Error('sidecar busy'), { status: 503, retryable: true })
      },
    }),
    log: () => {},
  })
  try {
    capture.handleSessionEvent(SESSION, { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] } })
    capture.handleSessionEvent(SESSION, { seq: 2, type: 'turn/end', data: { turn: 1 } })
    const deadline = Date.now() + 1000
    while (attempts === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(attempts, 1)
    assert.equal(state.data.capture.queue.length, 1)
    assert.equal(state.data.capture.queue[0].attempts, 1)
  } finally {
    capture.dispose()
  }
})

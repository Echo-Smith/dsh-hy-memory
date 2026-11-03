import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_QUEUE_ATTEMPTS,
  buildBatch,
  createCapture,
  isDuplicate,
  nextBackoff,
  promotionLines,
  projectToPersonalPrompt,
  sessionToProjectPrompt,
} from '../src/capture.js'
import { projectAgentId, projectKey } from '../src/tiers.js'

const CWD = '/Users/me/work/app'
const KEY = projectKey(CWD)

function fakeSettings(overrides = {}) {
  return {
    capture: { enabled: true, windowTurns: 1, idleFlushMs: 0, includeToolCalls: true, toolResultChars: 20, ...overrides.capture },
    promotion: { enabled: false, everyTurns: 8, onSessionEnd: false, ...overrides.promotion },
    recall: { enabled: false },
    ...overrides.root,
  }
}

function fakeState() {
  return {
    data: {
      version: 1,
      projects: {},
      capture: { sessions: {}, queue: [] },
      promotions: { sessions: {}, projects: {} },
      lastScene: 'chat',
    },
    saves: 0,
    save() {
      this.saves += 1
    },
  }
}

function fakeSession(id = 's1') {
  return { id, header: { cwd: CWD } }
}

function fakeActivity() {
  return { events: [], record(event) { this.events.push(event) } }
}

function makeCapture({ settings = fakeSettings(), state = fakeState(), session = fakeSession() } = {}) {
  const activity = fakeActivity()
  const capture = createCapture({
    settings: () => settings,
    state,
    activity,
    getClient: () => null,
    modelFor: () => null,
    getLlm: () => null,
    log: () => {},
  })
  return { capture, state, activity, session, settings }
}

function userEvent(seq, text = 'how do I build this?') {
  return { seq, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } }
}

test('replayed sequence numbers are ignored', () => {
  assert.equal(isDuplicate(10, 10), true)
  assert.equal(isDuplicate(10, 9), true)
  assert.equal(isDuplicate(10, 11), false)
  assert.equal(isDuplicate(-1, 0), false)
  assert.equal(isDuplicate(undefined, 3), false)
})

test('backoff grows exponentially and stays bounded', () => {
  assert.equal(nextBackoff(1), 1000)
  assert.equal(nextBackoff(2), 2000)
  assert.equal(nextBackoff(3), 4000)
  assert.equal(nextBackoff(30), 600_000)
  assert.ok(MAX_QUEUE_ATTEMPTS >= 3)
})

test('a window of turns becomes one queued session write', () => {
  const { capture, state, session } = makeCapture()
  try {
    capture.handleSessionEvent(session, userEvent(1))
    capture.handleSessionEvent(session, { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'run pnpm build' }] } } })
    capture.handleSessionEvent(session, { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    const queue = state.data.capture.queue
    assert.equal(queue.length, 1)
    assert.equal(queue[0].payload.user_id, 'dsh')
    assert.equal(queue[0].payload.agent_id, projectAgentId(KEY))
    assert.equal(queue[0].payload.session_id, 's1')
    assert.equal(queue[0].payload.scene, 'chat')
    assert.deepEqual(queue[0].payload.data.map((message) => message.role), ['user', 'assistant'])
    assert.equal(state.data.capture.sessions.s1.cursor, 3)
    assert.equal(state.data.projects[KEY].path, CWD)
  } finally {
    capture.dispose()
  }
})

test('restarting the host does not re-capture already stored events', () => {
  const state = fakeState()
  const session = fakeSession()
  const first = makeCapture({ state, session })
  try {
    first.capture.handleSessionEvent(session, userEvent(1, 'remember this'))
    first.capture.handleSessionEvent(session, { seq: 2, type: 'turn/end', data: { turn: 1 } })
    assert.equal(state.data.capture.queue.length, 1)
    assert.equal(state.data.capture.sessions.s1.cursor, 2)
  } finally {
    first.capture.dispose()
  }

  const second = makeCapture({ state, session })
  try {
    second.capture.handleSessionEvent(session, userEvent(1, 'remember this'))
    second.capture.handleSessionEvent(session, { seq: 2, type: 'turn/end', data: { turn: 1 } })
    assert.equal(state.data.capture.queue.length, 1, 'replayed events must not enqueue a second write')
  } finally {
    second.capture.dispose()
  }

  const third = makeCapture({ state, session })
  try {
    third.capture.handleSessionEvent(session, userEvent(3, 'new work'))
    third.capture.handleSessionEvent(session, { seq: 4, type: 'turn/end', data: { turn: 2 } })
    assert.equal(state.data.capture.queue.length, 2)
    assert.equal(state.data.capture.queue[1].payload.data[0].content, 'new work')
  } finally {
    third.capture.dispose()
  }
})

test('editing tools label the turn coding and route the write to chat', () => {
  const { capture, state, session } = makeCapture()
  try {
    capture.handleSessionEvent(session, userEvent(1, 'fix the bug'))
    capture.handleSessionEvent(session, { seq: 2, type: 'tool/call', data: { callId: 'c1', name: 'edit', arguments: '{"file_path":"a.js"}' } })
    capture.handleSessionEvent(session, {
      seq: 3,
      type: 'tool/result',
      data: { message: { toolCallId: 'c1', content: [{ type: 'text', text: 'patched a.js successfully' }] } },
    })
    capture.handleSessionEvent(session, { seq: 4, type: 'turn/end', data: { turn: 1 } })
    const job = state.data.capture.queue[0]
    assert.equal(job.scene, 'coding')
    // Default routing is the chat store: tool messages would select the
    // productivity pipeline inside the SDK, so they are dropped from the write.
    assert.deepEqual(job.payload.data.map((message) => message.role), ['user'])
    assert.equal(job.payload.scene, 'chat')
  } finally {
    capture.dispose()
  }
})

test('a tool call without a result cannot force a productivity scene', () => {
  const { capture, state, session } = makeCapture()
  try {
    capture.handleSessionEvent(session, userEvent(1, 'look around'))
    capture.handleSessionEvent(session, { seq: 2, type: 'tool/call', data: { callId: 'c1', name: 'edit', arguments: '{}' } })
    capture.handleSessionEvent(session, { seq: 3, type: 'turn/end', data: { turn: 1 } })
    assert.equal(state.data.capture.queue[0].scene, 'chat')
    assert.equal(state.data.capture.queue[0].payload.data.some((message) => message.role === 'tool'), false)
  } finally {
    capture.dispose()
  }
})

test('buildBatch truncates results and refuses an empty batch', () => {
  const batch = buildBatch({
    items: [
      { role: 'user', content: 'question' },
      { role: 'tool', content: 'x'.repeat(100), name: 'bash', callId: 'c9' },
    ],
    tools: [{ name: 'bash', args: { command: 'pnpm test' } }],
  }, fakeSettings())
  assert.equal(batch.scene, 'coding')
  assert.equal(batch.messages[1].content.length, 20)
  assert.equal(batch.messages[1].tool_name, 'bash')

  assert.deepEqual(buildBatch({ items: [], tools: [] }, fakeSettings()), { messages: [], scene: 'chat', writeScene: 'chat' })

  const noTools = buildBatch({
    items: [{ role: 'user', content: 'q' }, { role: 'tool', content: 'r' }],
    tools: [{ name: 'edit', args: {} }],
  }, fakeSettings({ capture: { includeToolCalls: false } }))
  assert.deepEqual(noTools, { messages: [{ role: 'user', content: 'q' }], scene: 'chat', writeScene: 'chat' })
})

test('empty and whitespace-only events do not reach the buffer', () => {
  const { capture, state, session } = makeCapture()
  try {
    capture.handleSessionEvent(session, { seq: 1, type: 'user/message', data: { source: { kind: 'agent-instructions' }, content: [{ type: 'text', text: 'AGENTS' }] } })
    capture.handleSessionEvent(session, { seq: 2, type: 'assistant/message', data: { message: { content: [] } } })
    capture.handleSessionEvent(session, { seq: 3, type: 'turn/end', data: { turn: 1 } })
    assert.equal(state.data.capture.queue.length, 0)
  } finally {
    capture.dispose()
  }
})

test('promotion output is parsed defensively', () => {
  assert.deepEqual(promotionLines('- uses pnpm\n2. tests live in test/\n\nNONE'), ['uses pnpm', 'tests live in test/'])
  assert.deepEqual(promotionLines('NONE'), [])
  assert.deepEqual(promotionLines(''), [])
  assert.deepEqual(promotionLines('```\nignored\n```'), ['ignored'])
  const prompts = sessionToProjectPrompt(['a', 'b'])
  assert.match(prompts, /SESSION MEMORIES:\n1\. a\n2\. b/)
  assert.match(projectToPersonalPrompt(['c']), /PROJECT MEMORIES:\n1\. c/)
})

test('capture is total: a broken session object never throws', () => {
  const { capture } = makeCapture()
  try {
    assert.doesNotThrow(() => capture.handleSessionEvent(null, null))
    assert.doesNotThrow(() => capture.handleSessionEvent({ id: 'x' }, { type: 'user/message' }))
    assert.doesNotThrow(() => capture.handleSessionDisposed(undefined))
  } finally {
    capture.dispose()
  }
})

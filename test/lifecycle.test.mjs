import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectRecall } from '../src/recall.js'
import { createMemoryOps } from '../src/tools.js'
import { createCapture } from '../src/capture.js'
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

test('credentials never reach the capture batch', async () => {
  const { buildBatch, looksSensitive } = await import('../src/capture.js')
  assert.equal(looksSensitive('token is sk-abcdefghijklmnopqrstuvwx'), true)
  assert.equal(looksSensitive('just a normal sentence'), false)
  const batch = buildBatch({
    items: [
      { role: 'user', content: 'here is my key sk-abcdefghijklmnopqrstuvwx' },
      { role: 'assistant', content: 'noted, I will not store it' },
    ],
    tools: [],
  }, { capture: { includeToolCalls: false } })
  assert.equal(batch.messages.length, 1)
  assert.match(batch.messages[0].content, /noted/)
})

test('purge archives before deleting and requires confirmation', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-purge-'))
  process.env.DSH_HOME = home
  const deleted = []
  const rows = [
    { memory_id: 'p1', content: 'one', agent_id: 'personal', session_id: 'personal' },
    { memory_id: 'j1', content: 'two', agent_id: 'project:p1', session_id: 'project' },
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
  await assert.rejects(() => ops.purge({}), (error) => error.code === 'confirm_required')
  const result = await ops.purge({ confirm: 'PURGE' })
  assert.equal(result.purged, 2)
  assert.equal(deleted.length, 2)
  const archives = readdirSync(join(home, 'integrations', 'hy-memory', 'archive'))
  assert.equal(archives.length, 1)
  rmSync(home, { recursive: true, force: true })
})

test('pairing detection reports credentials and a loopback broker without reading them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-pair-'))
  mkdirSync(join(home, 'memhub'), { recursive: true })
  writeFileSync(join(home, 'memhub', 'custom-test.credential'), 'secret\n')
  const brokerFile = join(home, 'broker.json')
  writeFileSync(brokerFile, JSON.stringify({ status: 'running', host: '127.0.0.1', port: 18765 }))
  const { detectPairing } = await import('../src/memhub.js')
  const paired = detectPairing({ home, brokerFile })
  assert.equal(paired.paired, true)
  assert.equal(paired.brokerRunning, true)
  assert.equal(paired.port, 18765)
  const absent = detectPairing({ home: join(home, 'nope'), brokerFile: join(home, 'nope.json') })
  assert.equal(absent.paired, false)
  assert.equal(absent.brokerRunning, false)
  rmSync(home, { recursive: true, force: true })
})

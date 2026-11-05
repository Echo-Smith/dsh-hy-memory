import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCapture } from '../src/capture.js'

function tempQueuePath() {
  return join(mkdtempSync(join(tmpdir(), 'hy-queue-')), 'capture-queue.json')
}

test('capacity guard archives the oldest rows before deleting them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-cap-'))
  process.env.DSH_HOME = home
  const deleted = []
  const rows = Array.from({ length: 60 }, (_, index) => ({
    memory_id: `m${index}`,
    content: `memory ${index}`,
    created_at: index,
    kind: 'chat',
    scene: 'chat',
  }))
  const client = {
    add: async () => ({ success: true, memory_id: 'new' }),
    bridgeList: async () => ({ memories: rows }),
    bridgeDelete: async (payload) => { deleted.push(payload.id); return { success: true } },
  }
  const state = { data: { capture: { sessions: {}, queue: [] } }, save() {}, flush: async () => {} }
  const settings = {
    enabled: true,
    capture: { enabled: true, windowTurns: 1, idleFlushMs: 50, includeToolCalls: true, productivity: false },
    promotion: { enabled: false },
    lifecycle: { maxPerTier: 50, archiveOnCap: true },
  }
  const capture = createCapture({
    queuePath: tempQueuePath(),
    settings: () => settings,
    state,
    activity: { record() {} },
    getClient: () => client,
    getLlm: () => null,
    modelFor: () => null,
    log: () => {},
  })
  const session = { id: 'cap-sess', header: { cwd: '/tmp' } }
  capture.handleSessionEvent(session, { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] } })
  capture.handleSessionEvent(session, { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'hi' }] } } })
  capture.handleSessionEvent(session, { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } })

  await new Promise((resolve) => setTimeout(resolve, 800))
  assert.equal(deleted.length, 10, 'deletes exactly the overflow')
  assert.deepEqual(deleted.sort(), Array.from({ length: 10 }, (_, index) => `m${index}`).sort())
  const archivePath = join(home, 'integrations', 'hy-memory', 'archive')
  // The archive file lives under the integration directory.
  const archives = readdirSync(archivePath)
  assert.equal(archives.length, 1, 'one archive file written')
  const lines = readFileSync(join(archivePath, archives[0]), 'utf8').trim().split('\n')
  assert.equal(lines.length, 10, 'archive holds the removed rows')
  rmSync(home, { recursive: true, force: true })
})

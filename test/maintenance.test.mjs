import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runMaintenance, shouldRunMaintenance } from '../src/maintenance.js'

function stateWith(data = {}) {
  return { data: { ...data }, saves: 0, save() { this.saves += 1 } }
}

test('maintenance runs once a day, not on every session end', () => {
  const now = 1_800_000_000_000
  assert.equal(shouldRunMaintenance(stateWith(), now), true, 'never run before')
  assert.equal(shouldRunMaintenance(stateWith({ lastMaintenance: { at: now - 1000 } }), now), false, 'just ran')
  assert.equal(shouldRunMaintenance(stateWith({ lastMaintenance: { at: now - 25 * 3_600_000 } }), now), true, 'a day later')
})

test('it merges exact duplicate groups into the newest row', async () => {
  const calls = []
  const ops = {
    duplicates: async ({ tier }) => (tier === 'personal'
      ? { groups: [{ tier, keep: 'keep1', drop: ['drop1', 'drop2'] }] }
      : { groups: [] }),
    merge: async (payload) => { calls.push(payload); return { merged: payload.drop.length } },
  }
  const state = stateWith()
  const report = await runMaintenance({ ops, state, activity: { record() {} }, now: 1_800_000_000_000 })
  assert.equal(report.merged, 2)
  assert.deepEqual(calls, [{ tier: 'personal', keep: 'keep1', drop: ['drop1', 'drop2'] }])
  assert.equal(state.data.lastMaintenance.merged, 2)
})

test('it never touches the session tier', async () => {
  const seen = []
  const ops = {
    duplicates: async ({ tier }) => { seen.push(tier); return { groups: [] } },
    merge: async () => ({ merged: 0 }),
  }
  await runMaintenance({ ops, state: stateWith(), activity: { record() {} }, force: true })
  assert.deepEqual(seen, ['personal', 'project'], 'session memories are per-session and not merged')
})

test('a quiet pass records a report and merges nothing', async () => {
  const events = []
  const report = await runMaintenance({
    ops: { duplicates: async () => ({ groups: [] }), merge: async () => ({ merged: 0 }) },
    state: stateWith(),
    activity: { record: (event) => events.push(event) },
    force: true,
  })
  assert.equal(report.merged, 0)
  assert.equal(events.length, 0, 'no activity noise when nothing was merged')
})

test('a failing scan is recorded instead of throwing', async () => {
  const report = await runMaintenance({
    ops: { duplicates: async () => { throw new Error('sidecar busy') }, merge: async () => ({}) },
    state: stateWith(),
    activity: { record() {} },
    force: true,
  })
  assert.match(report.error, /sidecar busy/)
  assert.equal(report.merged, 0)
})

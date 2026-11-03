import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryOps } from '../src/tools.js'

function harness() {
  const calls = []
  const client = {
    bridgeSearch: async (payload) => {
      calls.push(payload)
      const agent = payload.agent_ids?.[0] ?? ''
      return {
        memories: {
          schema: [],
          proactive: [],
          normal: [{ memory_id: `${agent}-1`, content: `hit for ${agent}`, agent_id: agent, session_id: 'project', score: 0.9 }],
        },
      }
    },
  }
  const ops = createMemoryOps({
    settings: () => ({ enabled: true }),
    state: { data: { projects: { aaaaaa: {}, bbbbbb: {} } } },
    activity: { record() {} },
    getClient: () => client,
    contextOf: () => ({ user: 'dsh', projectKey: 'aaaaaa', sessionId: 'sess-1' }),
    projectKeys: () => ['aaaaaa', 'bbbbbb'],
    log: () => {},
  })
  return { ops, calls }
}

test('a normal search only asks for the current project', async () => {
  const { ops, calls } = harness()
  await ops.search({ query: 'build command' })
  const projectCalls = calls.filter((call) => (call.session_ids ?? []).includes('project'))
  assert.equal(projectCalls.length, 1)
  assert.equal(projectCalls[0].agent_ids[0], 'project:aaaaaa')
})

test('allProjects searches every known project and tags each hit', async () => {
  const { ops, calls } = harness()
  const groups = await ops.search({ query: 'build command', allProjects: true })
  const agents = calls
    .filter((call) => (call.session_ids ?? []).includes('project'))
    .map((call) => call.agent_ids[0])
  assert.deepEqual(agents.sort(), ['project:aaaaaa', 'project:bbbbbb'])
  assert.equal(groups.project.length, 2)
  assert.ok(groups.project.some((item) => item.projectKey === 'bbbbbb'))
  assert.equal(calls.some((call) => (call.session_ids ?? []).includes('sess-1')), false)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_USER,
  PERSONAL_AGENT,
  PROJECT_SESSION,
  classifyTool,
  normalizeItem,
  normalizeItems,
  pickScene,
  projectAgentId,
  projectKey,
  projectTitleForPath,
  recallPlan,
  resolveUser,
  tierOfItem,
  tierScope,
  writeScope,
} from '../src/tiers.js'

test('project key is a stable 12-hex sha1 prefix of the cwd', () => {
  const key = projectKey('/Users/me/work/app')
  assert.match(key, /^[0-9a-f]{12}$/)
  assert.equal(key, projectKey('/Users/me/work/app'))
  assert.notEqual(key, projectKey('/Users/me/work/other'))
  assert.equal(projectKey(''), '')
  assert.equal(projectKey(undefined), '')
})

test('project agent id and title derive from the key and path', () => {
  assert.equal(projectAgentId('abc123abc123'), 'project:abc123abc123')
  assert.equal(projectAgentId(''), '')
  assert.equal(projectTitleForPath('/Users/me/work/app'), 'app')
  assert.equal(projectTitleForPath('/'), '/')
  assert.equal(projectTitleForPath(''), '')
})

test('user defaults to dsh and settings can override it', () => {
  assert.equal(resolveUser({}), DEFAULT_USER)
  assert.equal(resolveUser({ user: '  alice  ' }), 'alice')
  assert.equal(resolveUser({ user: '' }), DEFAULT_USER)
  assert.equal(resolveUser(undefined), DEFAULT_USER)
})

test('write scopes match the tier table', () => {
  const scope = { settings: { user: 'alice' }, projectKey: 'p1', sessionId: 's1' }
  assert.deepEqual(writeScope('personal', scope), { user_id: 'alice', agent_id: 'personal', session_id: 'personal' })
  assert.deepEqual(writeScope('project', scope), { user_id: 'alice', agent_id: 'project:p1', session_id: 'project' })
  assert.deepEqual(writeScope('session', scope), { user_id: 'alice', agent_id: 'project:p1', session_id: 's1' })
  assert.throws(() => writeScope('project', { settings: {}, projectKey: '' }), /needs a project key/)
  assert.throws(() => writeScope('nope', scope), /unknown memory tier/)
})

test('tier read scopes keep personal isolated and project/session separable', () => {
  const scope = { settings: {}, projectKey: 'p1', sessionId: 's1' }
  assert.deepEqual(tierScope('personal', scope), { user_ids: [DEFAULT_USER], agent_ids: [PERSONAL_AGENT] })
  assert.deepEqual(tierScope('project', scope), {
    user_ids: [DEFAULT_USER],
    agent_ids: ['project:p1', 'p1'],
    session_ids: [PROJECT_SESSION],
  })
  assert.deepEqual(tierScope('session', scope), {
    user_ids: [DEFAULT_USER],
    agent_ids: ['project:p1'],
    session_ids: ['s1'],
  })
})

test('recall plan orders personal, project, session and honours tier switches', () => {
  const plan = recallPlan({ settings: {}, projectKey: 'p1', sessionId: 's1' })
  assert.deepEqual(plan.map((entry) => entry.tier), ['personal', 'project', 'session'])
  assert.deepEqual(plan[0].params, { user_ids: [DEFAULT_USER], agent_ids: ['personal'] })
  assert.deepEqual(plan[2].params, { user_ids: ['dsh'], agent_ids: ['project:p1'] })

  const personalOnly = recallPlan({ settings: {}, projectKey: 'p1', sessionId: 's1', tiers: { project: false, session: false } })
  assert.deepEqual(personalOnly.map((entry) => entry.tier), ['personal'])

  const noProject = recallPlan({ settings: {}, projectKey: '', sessionId: 's1' })
  assert.deepEqual(noProject.map((entry) => entry.tier), ['personal', 'session'])
})

test('scene selection prefers coding over working over chat', () => {
  assert.equal(pickScene([]), 'chat')
  assert.equal(pickScene([{ name: 'read', args: { file_path: 'x' } }]), 'working')
  assert.equal(pickScene([{ name: 'edit', args: {} }]), 'coding')
  assert.equal(pickScene([{ name: 'read' }, { name: 'write' }]), 'coding')
  assert.equal(classifyTool('bash', { command: 'git status' }), 'coding')
  assert.equal(classifyTool('bash', { command: 'pnpm --filter app test' }), 'coding')
  assert.equal(classifyTool('bash', { command: 'ls -la' }), 'working')
  assert.equal(classifyTool('bash', 'cargo build'), 'coding')
  assert.equal(classifyTool('unknown_tool', {}), 'working')
  assert.equal(classifyTool('', {}), null)
})

test('items normalize SDK field names, units and tier context', () => {
  const item = normalizeItem({
    memory_id: 'm1',
    content: 'prefers TypeScript',
    layer: 'l2',
    status: 'active',
    tags: ['lang'],
    gmt_created: 1_700_000_000,
    gmt_modified: 1_700_000_100,
    score: 0.5,
  }, { tier: 'personal' })
  assert.equal(item.id, 'm1')
  assert.equal(item.tier, 'personal')
  assert.equal(item.createdAt, 1_700_000_000_000)
  assert.equal(item.updatedAt, 1_700_000_100_000)
  assert.equal(item.score, 0.5)
  assert.equal(item.projectKey, undefined)

  const project = normalizeItem({ id: 'm2', text: 'uses pnpm' }, { tier: 'project', projectKey: 'p1' })
  assert.deepEqual(
    { id: project.id, content: project.content, tier: project.tier, projectKey: project.projectKey, createdAt: project.createdAt },
    { id: 'm2', content: 'uses pnpm', tier: 'project', projectKey: 'p1', createdAt: 0 },
  )
  const session = normalizeItem({ memory_id: 'm3', content: 'x' }, { tier: 'session', projectKey: 'p1', sessionId: 's1' })
  assert.equal(session.sessionId, 's1')
  assert.equal(session.projectKey, 'p1')
})

test('normalization deduplicates by id then trimmed content', () => {
  const items = normalizeItems([
    { memory_id: 'a', content: 'one' },
    { memory_id: 'a', content: 'one again' },
    { memory_id: 'b', content: '  Two  ' },
    { content: 'two' },
    null,
    { content: '' },
  ])
  assert.deepEqual(items.map((item) => item.id), ['a', 'b'])
  assert.deepEqual(items.map((item) => item.content), ['one', '  Two  '])
})

test('tier of a persisted memory follows agent and session columns', () => {
  assert.equal(tierOfItem({ agent_id: 'personal', session_id: 'personal' }), 'personal')
  assert.equal(tierOfItem({ agent_id: 'project:p1', session_id: 'project' }, { projectKey: 'p1' }), 'project')
  assert.equal(tierOfItem({ agent_id: 'project:p1', session_id: 's1' }, { projectKey: 'p1' }), 'session')
  assert.equal(tierOfItem({ agent_id: 'project:other', session_id: 'project' }, { projectKey: 'p1' }), null)
  assert.equal(tierOfItem({ agent_id: 'someone', session_id: 'x' }), null)
})

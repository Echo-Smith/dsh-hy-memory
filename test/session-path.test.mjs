import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstExistingSessionPath, sessionDirPathCandidates } from '../src/session-path.js'

test('a plain workspace yields the plain path first', () => {
  assert.equal(sessionDirPathCandidates('--Users-me-code-app--')[0], '/Users/me/code/app')
})

test('hyphens inside names are recovered as an alternative split', () => {
  const candidates = sessionDirPathCandidates('--Users-me-Documents-deepseek-harness-default-workspace--')
  assert.ok(candidates.includes('/Users/me/Documents/deepseek-harness/default-workspace'))
  assert.ok(candidates.includes('/Users/me/Documents/deepseek/harness/default/workspace'))
})

test('unicode escapes decode to their characters', () => {
  const candidates = sessionDirPathCandidates('--Users-me-DeepSeek~0020Harness-~505A~4E00--')
  assert.ok(candidates.some((path) => path.includes('DeepSeek Harness')))
  assert.ok(candidates.some((path) => path.includes('做一')))
})

test('a disk check picks the real path', () => {
  const exists = (path) => path === '/Users/me/Documents/deepseek-harness/default-workspace'
  assert.equal(
    firstExistingSessionPath('--Users-me-Documents-deepseek-harness-default-workspace--', exists),
    '/Users/me/Documents/deepseek-harness/default-workspace',
  )
})

test('names that are not session directories yield nothing', () => {
  assert.deepEqual(sessionDirPathCandidates('session-abc'), [])
  assert.deepEqual(sessionDirPathCandidates('--'), [])
  assert.deepEqual(sessionDirPathCandidates(null), [])
})

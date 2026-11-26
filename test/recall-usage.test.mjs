import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distinctiveGrams, scoreRecallUsage } from '../src/recall-usage.js'

test('a distinctive phrase shared with the reply marks the memory as likely used', () => {
  const memory = 'dsh-hy-memory 的 profile 依赖必须用 npm update 升级，否则锁文件会钉住旧版本。'
  const reply = '我查了一下，dsh-hy-memory 的 profile 依赖必须用 npm update 升级，这条说得对。'
  const result = scoreRecallUsage(memory, reply)
  assert.equal(result.signal, 'likely_used')
  assert.ok(result.matched.length >= 8, 'the matched phrase is reported')
})

test('an unrelated reply does not count as usage', () => {
  const memory = '用户偏好中文回答，并且要求先写测试再改代码。'
  const reply = 'The build succeeded and the panel renders.'
  assert.equal(scoreRecallUsage(memory, reply).signal, 'no_overlap')
})

test('a memory too short to yield a distinctive phrase stays unknown', () => {
  // Six characters cannot yield an eight-character window, and a shorter one
  // would only match by coincidence, so the scorer refuses to guess.
  assert.equal(scoreRecallUsage('用户偏好中文', '好的，我用中文回答。').signal, 'unknown')
  assert.deepEqual(distinctiveGrams('短句'), [])
})

test('empty input never produces a false positive', () => {
  assert.equal(scoreRecallUsage('', 'anything').signal, 'unknown')
  assert.equal(scoreRecallUsage('some memory text here', '').signal, 'unknown')
})

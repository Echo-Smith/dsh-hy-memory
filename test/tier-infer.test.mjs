import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferTier } from '../src/tiers.js'

test('inferTier sends repository facts to the project tier', () => {
  assert.equal(inferTier('这个仓库用 pnpm test 跑测试'), 'project')
  assert.equal(inferTier('接口 /api/hy-memory/list 只接受 POST'), 'project')
  assert.equal(inferTier('端口固定为 19527，配置文件在 config 目录'), 'project')
  assert.equal(inferTier('deploys go through the `pnpm build` step'), 'project')
})

test('inferTier keeps preferences and user facts personal', () => {
  assert.equal(inferTier('用户偏好简洁的报告，先给结论'), 'personal')
  assert.equal(inferTier('我喜欢用 vim'), 'personal')
  assert.equal(inferTier('I prefer short answers with evidence'), 'personal')
  assert.equal(inferTier('今天天气不错'), 'personal')
})

test('inferTier falls back to personal for junk input', () => {
  assert.equal(inferTier(''), 'personal')
  assert.equal(inferTier('   '), 'personal')
  assert.equal(inferTier(undefined), 'personal')
})

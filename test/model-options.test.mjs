import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('the model picker lists every provider, not only openai-completions', () => {
  // The gateway routes all providers through one chat/completions endpoint, so
  // filtering by the provider's declared API hid the user's session provider
  // (anthropic-messages) and their responses models behind "only the first
  // provider's models".
  assert.doesNotMatch(source, /api !== 'openai-completions'/, 'the completions-only filter is gone')
  assert.match(source, /!Array\.isArray\(provider\.models\)/, 'providers are kept when they carry a models list')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildModelEnv, resolveDshRoute } from '../src/model.js'

const PROVIDERS = {
  magpie: {
    api: 'openai-completions',
    baseURL: 'http://127.0.0.1:3425/v1',
    apiKeyEnv: 'MAGPIE_GATEWAY_KEY',
    models: [
      { id: 'aiping/DeepSeek-V4.1-Flash-1017' },
      { id: 'google/models/gemini-3.8-flash' },
      { id: 'workbuddy/deepseek-v4.1-flash' },
    ],
  },
  anthropic: { api: 'anthropic-messages', baseURL: 'http://x/v1', models: [{ id: 'zcode/GLM-5.3-Flash' }] },
}
const DOT_ENV = { MAGPIE_GATEWAY_KEY: 'magpie' }

test('a pinned model that the profile still offers is used verbatim', () => {
  const route = resolveDshRoute(PROVIDERS, {}, { llm: { provider: 'magpie', model: 'aiping/DeepSeek-V4.1-Flash-1017' } }, DOT_ENV)
  assert.equal(route.provider, 'magpie')
  assert.equal(route.model, 'aiping/DeepSeek-V4.1-Flash-1017')
  assert.equal(route.missingModel, undefined)
})

test('a pinned model that no longer exists is reported, not silently swapped', () => {
  // The bug this covers: a stale pin resolved to "the first model matching
  // /flash/", so memory ran through a model nobody had selected and the panel
  // had no way to say so.
  const route = resolveDshRoute(PROVIDERS, {}, { llm: { provider: 'magpie', model: 'gone/model-x' } }, DOT_ENV)
  assert.equal(route.missingModel, 'gone/model-x')
  assert.equal(route.model, '', 'no substitute model is invented')
})

test('with no pin a usable model is picked', () => {
  const route = resolveDshRoute(PROVIDERS, {}, { llm: {} }, DOT_ENV)
  assert.equal(route.provider, 'magpie')
  assert.ok(route.model.length > 0)
  assert.equal(route.missingModel, undefined)
})

test('non OpenAI-compatible providers are skipped', () => {
  const route = resolveDshRoute(PROVIDERS, {}, { llm: { provider: 'anthropic' } }, DOT_ENV)
  assert.equal(route.provider, 'magpie', 'the anthropic route cannot serve memory')
})

test('a provider whose key is missing is skipped', () => {
  const route = resolveDshRoute(PROVIDERS, {}, { llm: {} }, {})
  assert.equal(route, null, 'no key means no usable route')
})

test('the env handed to the sidecar carries the resolved model and budgets', () => {
  const route = resolveDshRoute(PROVIDERS, {}, { llm: { provider: 'magpie', model: 'aiping/DeepSeek-V4.1-Flash-1017' } }, DOT_ENV)
  const env = buildModelEnv(route, { llm: { maxTokens: 4096, agentMaxTokens: 4096, timeoutMs: 60_000, disableReasoning: true } })
  assert.equal(env.MEMORY_LLM_MODEL, 'aiping/DeepSeek-V4.1-Flash-1017')
  assert.equal(env.MEMORY_LLM_BASE_URL, 'http://127.0.0.1:3425/v1')
  assert.equal(env.MEMORY_LLM_TIMEOUT, '60')
  assert.deepEqual(JSON.parse(env.MEMORY_LLM_EXTRA_BODY), { reasoning_effort: 'none' })
})

test('a custom endpoint overrides the profile route', () => {
  const route = resolveDshRoute(PROVIDERS, {}, { llm: { provider: 'magpie', model: 'aiping/DeepSeek-V4.1-Flash-1017' } }, DOT_ENV)
  const env = buildModelEnv(route, {
    llm: { source: 'custom', baseURL: 'http://custom/v1', model: 'my-model', apiKey: 'k' },
  })
  assert.equal(env.MEMORY_LLM_BASE_URL, 'http://custom/v1')
  assert.equal(env.MEMORY_LLM_MODEL, 'my-model')
})

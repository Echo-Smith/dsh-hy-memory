import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHome } from './paths.js'
import { parseYaml } from './yaml.js'

const OPENAI_COMPATIBLE = new Set(['openai-completions'])

/** DSH keeps provider keys in $DSH_HOME/.env; a shell may not have them. */
export async function readDotEnv() {
  const values = {}
  try {
    const raw = await readFile(join(dshHome(), '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      const value = match[2].trim().replace(/^['"]|['"]$/g, '')
      if (value) values[match[1]] = value
    }
  } catch {}
  return values
}

function lookupKey(name, dotEnv) {
  if (!name) return ''
  return process.env[name] || dotEnv[name] || ''
}

export async function readProviders() {
  try {
    const raw = await readFile(join(dshHome(), 'settings.yaml'), 'utf8')
    const parsed = parseYaml(raw)
    const providers = parsed?.['llm-pi-ai']?.providers
    if (!providers || typeof providers !== 'object') return {}
    return providers
  } catch {
    return {}
  }
}

function modelIds(provider) {
  const list = provider?.models
  if (!Array.isArray(list)) return []
  return list.map((entry) => entry?.id).filter((id) => typeof id === 'string' && id)
}

export function resolveDshRoute(providers, state = {}, settings = {}, dotEnv = {}) {
  const names = Object.keys(providers)
  if (names.length === 0) return null
  const configured = settings?.llm ?? {}
  const wantedProvider = configured.provider || state.provider || ''
  const wantedModel = configured.model || state.model || ''
  const ordered = wantedProvider && providers[wantedProvider]
    ? [wantedProvider, ...names.filter((name) => name !== wantedProvider)]
    : names
  for (const name of ordered) {
    const provider = providers[name]
    if (!provider || typeof provider !== 'object') continue
    if (!OPENAI_COMPATIBLE.has(provider.api)) continue
    const baseURL = typeof provider.baseURL === 'string' ? provider.baseURL : ''
    if (!baseURL) continue
    const keyEnv = typeof provider.apiKeyEnv === 'string' ? provider.apiKeyEnv : ''
    const apiKey = lookupKey(keyEnv, dotEnv)
    if (keyEnv && !apiKey) continue
    const ids = modelIds(provider)
    const preferred = ids.find((id) => /flash|mini|small|lite/i.test(id)) ?? ids[0]
    const model = wantedModel && ids.includes(wantedModel) ? wantedModel : preferred
    if (!model) continue
    return { provider: name, model, baseURL, apiKey, keyEnv, source: 'dsh' }
  }
  return null
}

export function buildModelEnv(route, settings) {
  const env = {}
  if (!route) return env
  if (route.baseURL) env.MEMORY_LLM_BASE_URL = route.baseURL
  if (route.apiKey) env.MEMORY_LLM_API_KEY = route.apiKey
  if (route.model) env.MEMORY_LLM_MODEL = route.model
  const configured = settings?.llm ?? {}
  if (configured.source === 'custom') {
    if (configured.baseURL) env.MEMORY_LLM_BASE_URL = configured.baseURL
    if (configured.model) env.MEMORY_LLM_MODEL = configured.model
    if (configured.apiKey) env.MEMORY_LLM_API_KEY = configured.apiKey
  }
  return env
}

export function describeModel(route, settings) {
  if (!route) return { ready: false, reason: 'no-openai-compatible-provider' }
  const configured = settings?.llm ?? {}
  const custom = configured.source === 'custom'
  return {
    ready: true,
    provider: custom ? configured.provider || 'custom' : route.provider,
    model: custom ? configured.model || route.model : route.model,
    baseURL: custom ? configured.baseURL || route.baseURL : route.baseURL,
    keySource: custom ? 'settings' : route.keyEnv || 'env',
    source: custom ? 'custom' : 'dsh',
  }
}

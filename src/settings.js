import { mkdir, readFile, rename, writeFile, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { integrationDir, settingsPath } from './paths.js'

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  enabled: true,
  mode: 'pro',
  language: 'auto',
  tiers: { personal: true, project: true, session: true },
  recall: { enabled: true, maxItems: 5, maxChars: 1200, minScore: 0.45, waitForStartMs: 2500, halfLifeDays: 30 },
  capture: { enabled: true, windowTurns: 3, idleFlushMs: 180000, includeToolCalls: true, toolResultChars: 1200, productivity: false, concurrency: 3, maxPerDrain: 8, maxAttempts: 20 },
  promotion: { enabled: true, everyTurns: 8, onSessionEnd: true },
  llm: { source: 'dsh', provider: '', model: '', baseURL: '', maxTokens: 4096, agentMaxTokens: 4096, timeoutMs: 180000, disableReasoning: true },
  embedding: { mode: 'local' },
  ui: { sessionPanel: true },
  sidecar: { pythonPath: '', port: 0, idleStopMs: 1800000, prewarm: true },
  lifecycle: { maxPerTier: 2000, archiveOnCap: false },
  permissions: { disabledCaptureProjects: [] },
})

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function mergeSettings(base, patch) {
  if (!isObject(patch)) return base
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = isObject(value) && isObject(base[key]) ? mergeSettings(base[key], value) : value
  }
  return out
}

export async function loadSettings() {
  try {
    const raw = await readFile(settingsPath(), 'utf8')
    return mergeSettings(DEFAULT_SETTINGS, JSON.parse(raw))
  } catch (error) {
    if (error?.code === 'ENOENT') return structuredClone(DEFAULT_SETTINGS)
    throw error
  }
}

export async function saveSettings(settings) {
  await mkdir(integrationDir(), { recursive: true })
  const target = settingsPath()
  const temp = `${target}.${process.pid}.tmp`
  const body = `${JSON.stringify(settings, null, 2)}\n`
  await writeFile(temp, body, 'utf8')
  const handle = await open(temp, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temp, target)
  return settings
}

export function ensureDefaults(settings) {
  return mergeSettings(structuredClone(DEFAULT_SETTINGS), settings)
}

export { dirname }

#!/usr/bin/env node
/**
 * Validate market/index.json with DSH's own validator, not a copy of the rules.
 *
 *   node scripts/validate-market-index.mjs [--index market/index.json] [--module <path-to-dsh-plugin-market-index>]
 *
 * The validator ships inside the DSH app, so this skips (exit 0 with SKIP) where
 * DSH is not installed; CI therefore cannot check the schema, a machine with the
 * app can.
 */

import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const indexFile = arg('index', new URL('../market/index.json', import.meta.url).pathname)
const appModule = arg('module', process.env.DSH_MARKET_MODULE ?? '')
const candidates = [
  appModule && join(appModule, 'node_modules', '@deepseek-ai', 'dsh-plugin-market-index', 'lib', 'index.js'),
  appModule && join(appModule, '@deepseek-ai', 'dsh-plugin-market-index', 'lib', 'index.js'),
  '/tmp/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js',
].filter(Boolean)

const found = candidates.find((candidate) => existsSync(candidate))
if (!found) {
  console.log('SKIP: DSH plugin market validator not found; looked in', candidates.join(', '))
  process.exit(0)
}

const { parseMarketIndex, marketInstallTarget } = await import(`file://${found}`)
const document = JSON.parse(readFileSync(indexFile, 'utf8'))
const index = parseMarketIndex(document, `file://${indexFile}`)
console.log(`valid format ${index.format} index: ${index.plugins.length} plugin(s)`)
for (const plugin of index.plugins) {
  const latest = plugin.versions[0]
  const target = marketInstallTarget(plugin.name, latest)
  console.log(`  ${plugin.name} ${latest.version} -> pnpm add ${target.spec}${target.registry ? ` (registry ${target.registry})` : ''}`)
}

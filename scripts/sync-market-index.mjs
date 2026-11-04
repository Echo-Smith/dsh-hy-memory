#!/usr/bin/env node
/**
 * Point market/index.json at the version in package.json.
 *
 * DSH's detail page compares the installed version with this index, so an index
 * left behind by a release makes the page report a version that is not the one
 * that shipped.
 *
 *   node scripts/sync-market-index.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const indexPath = join(ROOT, 'market', 'index.json')
const index = JSON.parse(readFileSync(indexPath, 'utf8'))
const plugin = index.plugins.find((entry) => entry.name === pkg.name.replace(/^@[^/]+\//, '')) ?? index.plugins[0]
if (!plugin) throw new Error('market index lists no plugin to update')

const version = pkg.version
const publishTimestamp = Math.floor(Date.now() / 1000)
const previous = plugin.versions[0]
plugin.versions = [{ version, publishTimestamp, source: { type: 'npm' }, engines: { dsh: '>=0.2.0' } }]
if (process.argv.includes('--dry-run')) {
  console.log(`would set ${plugin.name} to ${version} (was ${previous?.version ?? 'none'})`)
  process.exit(0)
}
writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`)
console.log(`${plugin.name} index -> ${version} (was ${previous?.version ?? 'none'})`)

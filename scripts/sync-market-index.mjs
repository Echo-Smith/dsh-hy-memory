#!/usr/bin/env node
/**
 * Point market/index.json at the version in package.json.
 *
 * DSH's detail page compares the installed version with this index, so an index
 * left behind by a release makes the page report a version that is not the one
 * that shipped. The reverse is just as misleading: advertising a version that is
 * not on the registry shows an update that cannot be installed. With --published
 * the script refuses to publish such an entry, so a release step fails loudly
 * instead of shipping a dead pointer.
 *
 *   node scripts/sync-market-index.mjs [--dry-run] [--published]
 */

import { execFileSync } from 'node:child_process'
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

// Only a version the registry actually serves may be advertised.
if (process.argv.includes('--published')) {
  try {
    const listed = execFileSync('npm', ['view', `${pkg.name}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    if (listed !== version) throw new Error(`registry reported ${listed}`)
  } catch (error) {
    console.error(`refusing to sync: ${pkg.name}@${version} is not on the registry (${String(error?.message ?? error).split('\n')[0]})`)
    process.exit(1)
  }
}
const publishTimestamp = Math.floor(Date.now() / 1000)
const previous = plugin.versions[0]
plugin.versions = [{ version, publishTimestamp, source: { type: 'npm' }, engines: { dsh: '>=0.2.0' } }]
if (process.argv.includes('--dry-run')) {
  console.log(`would set ${plugin.name} to ${version} (was ${previous?.version ?? 'none'})`)
  process.exit(0)
}
writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`)
console.log(`${plugin.name} index -> ${version} (was ${previous?.version ?? 'none'})`)

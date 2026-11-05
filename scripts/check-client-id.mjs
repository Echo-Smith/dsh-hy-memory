#!/usr/bin/env node
/**
 * The client bundle's loader id must equal the package name.
 *
 * DSH's client loader only accepts a bundle that registers exactly the installed
 * package name; a mismatch fails the whole settings-page sync. That mistake is
 * easy to make when a repository name differs from the published name, so it is
 * checked here instead of remembered.
 *
 *   node scripts/check-client-id.mjs [--package <dir>] [--bundle <file>]
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const packageDir = resolve(arg('package', ROOT))
const bundlePath = resolve(arg('bundle', join(packageDir, 'client.js')))
const name = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).name
const bundle = readFileSync(bundlePath, 'utf8')
const match = /window\.__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/.exec(bundle)

if (!match) {
  console.error(`FAIL: ${bundlePath} has no __ModuleLoader__.load({ id }) registration`)
  process.exit(1)
}
if (match[1] !== name) {
  console.error(`FAIL: bundle registers "${match[1]}" but the package is "${name}"`)
  console.error('      Rebuild with HY_MEMORY_CLIENT_ID=<package name>, or run scripts/deploy-local.mjs.')
  process.exit(1)
}
console.log(`ok: ${bundlePath} registers "${name}"`)

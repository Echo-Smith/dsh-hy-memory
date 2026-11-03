#!/usr/bin/env node
/**
 * Install this package into a DSH profile with the supported CLI:
 *   node scripts/install.mjs [--profile desktop] [--dry-run]
 * The CLI adds the dependency AND selects the bundle, which is what
 * `plugin_manager install_bundle` does. Re-running is safe.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(here, '..')
const args = process.argv.slice(2)
const profileIndex = args.indexOf('--profile')
const profile = profileIndex >= 0 ? args[profileIndex + 1] : 'desktop'
const dryRun = args.includes('--dry-run')

const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'))
const cli = process.env.DSH_CLI || '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'

if (!existsSync(cli) && !process.env.DSH_CLI) {
  console.error(`dsh CLI not found at ${cli}. Set DSH_CLI to the dsh launcher path.`)
  process.exit(1)
}

const spec = `link:${packageDir}`
const command = [cli, 'plugin', '--profile', profile, 'add', spec]
console.log(`profile: ${profile}`)
console.log(`package: ${pkg.name}@${pkg.version}`)
console.log(`command: ${command.join(' ')}`)
if (dryRun) process.exit(0)

const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)

console.log(`
Installed.

Next steps:
  1. Reload the DSH page (or restart the app) so the client half joins the plugin graph.
  2. Open Settings > Memory.
  3. The first memory write downloads a one-time local embedding model (~80 MB) and starts the Python sidecar.
`)

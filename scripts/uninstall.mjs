#!/usr/bin/env node
/** Remove this package from a DSH profile: node scripts/uninstall.mjs [--profile desktop] */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(here, '..')
const args = process.argv.slice(2)
const profileIndex = args.indexOf('--profile')
const profile = profileIndex >= 0 ? args[profileIndex + 1] : 'desktop'
const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'))
const cli = process.env.DSH_CLI || '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'

const result = spawnSync(cli, ['plugin', '--profile', profile, 'remove', pkg.name], { stdio: 'inherit' })
console.log(`Removed ${pkg.name} from profile ${profile}. Memory data stays in $DSH_HOME/integrations/hy-memory.`)
process.exit(result.status ?? 1)

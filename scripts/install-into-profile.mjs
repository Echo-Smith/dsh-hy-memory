#!/usr/bin/env node
/**
 * Install this plugin into a DSH profile, from npm or from a local tarball.
 *
 * A profile needs two things for a plugin: the package as a dependency, and the
 * package name in `dsh.profile.bundles`. Doing only the first loads nothing.
 *
 *   node scripts/install-into-profile.mjs --spec ./dist/dsh-hy-memory-0.1.0.tgz        # dry run
 *   node scripts/install-into-profile.mjs --spec dsh-hy-memory --apply
 *   node scripts/install-into-profile.mjs --profile /path/to/profile --spec <spec> --apply
 *
 * It never restarts the app: a reload is the user's decision.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const apply = args.includes('--apply')
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const rawSpec = arg('spec', 'dsh-hy-memory')
const looksPath = rawSpec.startsWith('.') || rawSpec.startsWith('/') || rawSpec.startsWith('~') || existsSync(rawSpec)
const spec = looksPath ? resolve(rawSpec) : rawSpec
const profileArg = arg('profile', 'desktop')
const profileDir = profileArg.includes('/') ? resolve(profileArg) : join(dshHome, 'profiles', profileArg)
const pkgPath = join(profileDir, 'package.json')

if (!existsSync(pkgPath)) {
  console.error(`no profile at ${profileDir}`)
  process.exit(2)
}
const profile = JSON.parse(readFileSync(pkgPath, 'utf8'))
profile.dependencies = profile.dependencies ?? {}
profile.dsh = profile.dsh ?? {}
profile.dsh.profile = profile.dsh.profile ?? {}
const bundles = Array.isArray(profile.dsh.profile.bundles) ? profile.dsh.profile.bundles : (profile.dsh.profile.bundles = [])

const local = existsSync(spec)
let name
if (local) {
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', spec, 'package/package.json'], { encoding: 'utf8' }))
  name = manifest.name
} else {
  // `name@range` (including a scope) or a bare name.
  const match = /^(@[^/]+\/[^@]+|[^@/]+)(?:@.*)?$/.exec(spec)
  name = match ? match[1] : spec
}
if (!name) {
  console.error('cannot determine the package name from the spec')
  process.exit(2)
}

const dependencySpec = local ? `file:${spec}` : spec
const changes = []
changes.push(`install ${dependencySpec}`)
if (!bundles.includes(name)) {
  bundles.push(name)
  changes.push(`bundles += ${name}`)
}

console.log(`profile: ${profileDir}`)
console.log(changes.length ? changes.map((line) => `  ${line}`).join('\n') : '  nothing to change')
if (!apply) {
  console.log('dry run: pass --apply to write package.json and install')
  process.exit(0)
}

const manager = existsSync(join(profileDir, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm'
const managerArgs = manager === 'pnpm'
  ? ['add', dependencySpec]
  : ['install', '--no-audit', '--no-fund', dependencySpec]
try {
  execFileSync(manager, managerArgs, { cwd: profileDir, stdio: 'pipe', encoding: 'utf8' })
} catch (error) {
  console.error(`${manager} failed: ${error.stderr ?? error.message}`)
  process.exit(1)
}
// The package manager owns the dependency entry; add the bundle after it.
const updated = JSON.parse(readFileSync(pkgPath, 'utf8'))
updated.dsh = updated.dsh ?? {}
updated.dsh.profile = updated.dsh.profile ?? {}
const updatedBundles = Array.isArray(updated.dsh.profile.bundles) ? updated.dsh.profile.bundles : (updated.dsh.profile.bundles = [])
if (!updatedBundles.includes(name)) updatedBundles.push(name)
writeFileSync(pkgPath, `${JSON.stringify(updated, null, 2)}\n`)

const installed = join(profileDir, 'node_modules', name)
const entry = await import(`file://${join(installed, 'index.js')}`).catch((error) => {
  console.error(`installed package cannot be imported: ${error.message}`)
  process.exit(1)
})
const plugin = entry.default ?? entry
if (typeof plugin.apply !== 'function') {
  console.error('installed package does not export apply()')
  process.exit(1)
}
console.log(`installed ${name} into ${profileDir}; restart or reload DSH for it to load`)

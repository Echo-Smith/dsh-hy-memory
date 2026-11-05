#!/usr/bin/env node
/**
 * Deploy this working copy into an installed profile plugin, safely.
 *
 * The installed package name is the authority: the client bundle is rebuilt with
 * that exact loader id and verified before anything is copied. This replaces the
 * ad-hoc "cp client.js into the profile" step that once shipped a bundle whose
 * id did not match the package.
 *
 *   node scripts/deploy-local.mjs [--profile desktop] [--dry-run]
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profile = arg('profile', 'desktop')
const dryRun = args.includes('--dry-run')
const profileDir = resolve(profile)
  ? (profile.includes('/') ? resolve(profile) : join(dshHome, 'profiles', profile))
  : join(dshHome, 'profiles', profile)

const installedManifest = join(profileDir, 'node_modules', 'dsh-hy-memory', 'package.json')
const installedName = JSON.parse(readFileSync(installedManifest, 'utf8')).name
const target = join(profileDir, 'node_modules', installedName)
console.log(`installed package: ${installedName} at ${target}`)
if (dryRun) {
  console.log('dry run: would build with that loader id and copy the runtime files')
  process.exit(0)
}

// Build in a scratch copy of this tree so the working client.js is untouched.
const staging = join(ROOT, '.deploy-staging')
rmSync(staging, { recursive: true, force: true })
execFileSync('rsync', ['-a', '--exclude', 'node_modules', '--exclude', '.git', `${ROOT}/`, `${staging}/`])
execFileSync(process.execPath, ['build.mjs'], {
  cwd: staging,
  env: { ...process.env, HY_MEMORY_CLIENT_ID: installedName },
  stdio: 'inherit',
})
execFileSync(process.execPath, ['scripts/check-client-id.mjs', '--package', staging], { cwd: ROOT, stdio: 'inherit' })

const FILES = ['index.js', 'client.js', 'cordis.patch.yml', 'src', 'bridge', 'locale', 'icon.svg']
for (const relative of FILES) {
  mkdirSync(dirname(join(target, relative)), { recursive: true })
  execFileSync('rsync', ['-a', '--delete', join(staging, relative), join(target, relative)], { stdio: 'pipe' })
}
rmSync(staging, { recursive: true, force: true })
console.log(`deployed into ${target}; reload DSH to pick it up`)

#!/usr/bin/env node
/**
 * Build a publishable tarball without renaming the working copy.
 *
 * The live profile installs this package as `@local/dsh-hy-memory` through a
 * link, and the client bundle's loader id must match the package name. Renaming
 * in place would break the running app, so publication is staged: copy the
 * tree, rewrite the name there, build the bundle with that id, then pack.
 *
 *   node scripts/prepare-publish.mjs [--name dsh-hy-memory] [--version 0.1.0]
 *
 * Prints the tarball path and verifies it by installing into a scratch prefix
 * and loading the entry point. Publishing is left to a human with npm
 * credentials; this script never publishes.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const name = arg('name', 'dsh-hy-memory')
const version = arg('version', pkg.version)
const staging = join(tmpdir(), `hy-memory-publish-${Date.now()}`)
const dist = join(ROOT, 'dist')

const ENTRY = ['index.js', 'build.mjs', 'cordis.patch.yml', 'client.js', 'client-src', 'src', 'bridge', 'locale', 'icon.svg', 'docs/screenshots', 'package.json', 'README.md', 'README.zh.md', 'LICENSE']

function exec(command, commandArgs, { cwd = staging, env = process.env } = {}) {
  return execFileSync(command, commandArgs, { cwd, env, encoding: 'utf8' })
}

rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
for (const entry of ENTRY) {
  if (!existsSync(join(ROOT, entry))) continue
  cpSync(join(ROOT, entry), join(staging, entry), { recursive: true })
}

const stagedPkg = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8'))
stagedPkg.name = name
stagedPkg.version = version
delete stagedPkg.private
stagedPkg.publishConfig = { access: 'public' }
stagedPkg.homepage = `https://www.npmjs.com/package/${name}`
stagedPkg.scripts = {
  ...stagedPkg.scripts,
  prepublishOnly: 'node build.mjs && node --check client.js',
}
writeFileSync(join(staging, 'package.json'), `${JSON.stringify(stagedPkg, null, 2)}\n`)

// The client loader id and the host patch both carry the package name.
const rewrite = (relative) => {
  const path = join(staging, relative)
  writeFileSync(path, readFileSync(path, 'utf8').replaceAll('@local/dsh-hy-memory', name))
}
rewrite('cordis.patch.yml')
rewrite('src/recall.js')
rewrite('client-src/index.js')

exec(process.execPath, ['build.mjs'], { env: { ...process.env, HY_MEMORY_CLIENT_ID: name } })
exec(process.execPath, ['--check', 'client.js'])

const bundle = readFileSync(join(staging, 'client.js'), 'utf8')
if (!bundle.includes(`"${name}"`)) throw new Error(`client bundle does not carry the loader id ${name}`)
if (!readFileSync(join(staging, 'cordis.patch.yml'), 'utf8').includes(name)) throw new Error('host patch does not name the package')

mkdirSync(dist, { recursive: true })
const packed = exec('npm', ['pack', '--pack-destination', dist, '--json'])
const [{ filename, files }] = JSON.parse(packed)
const tarball = join(dist, filename)
const names = files.map((file) => file.path)
for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'locale/zh.json', 'bridge/hy_bridge.py']) {
  if (!names.includes(required)) throw new Error(`tarball is missing ${required}`)
}
if (names.some((file) => file.startsWith('node_modules/') || file.startsWith('venv/'))) throw new Error('tarball contains local state')

const scratch = join(tmpdir(), `hy-memory-install-${Date.now()}`)
mkdirSync(scratch, { recursive: true })
exec('npm', ['install', '--prefix', scratch, '--no-audit', '--no-fund', '--silent', `file:${tarball}`], { cwd: scratch })
const installed = join(scratch, 'node_modules', name)
const entry = await import(`file://${join(installed, 'index.js')}`)
const plugin = entry.default ?? entry
if (typeof plugin.apply !== 'function') throw new Error('installed entry does not export apply()')
if (!readFileSync(join(installed, 'client.js'), 'utf8').includes(`"${name}"`)) throw new Error('installed bundle lost the loader id')
if (!existsSync(join(installed, 'bridge', 'hy_bridge.py'))) throw new Error('installed bridge missing')

rmSync(staging, { recursive: true, force: true })
rmSync(scratch, { recursive: true, force: true })
console.log(`packed ${filename} (${files.length} files, ${(files.reduce((sum, file) => sum + file.size, 0) / 1024).toFixed(0)} KiB)`)
console.log(`verified install: ${name} exports apply(), loader id and bridge intact`)
console.log(`tarball: ${tarball}`)
console.log('publish with: npm publish ' + tarball)

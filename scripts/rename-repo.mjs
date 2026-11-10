#!/usr/bin/env node
/**
 * Point every repository reference at the current repo name.
 *
 * GitHub keeps redirects after a rename, but a redirect is a network hop: the
 * release tarball URL, the market index and the update check all get slower and
 * eventually break if the old name is ever reused. Rewriting them is one step,
 * so it should not depend on remembering every file.
 *
 *   node scripts/rename-repo.mjs --to dsh-hy-memory [--apply]
 *
 * The package name is deliberately not touched: it is the plugin's loader id,
 * and changing it breaks every existing install.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const toIndex = args.indexOf('--to')
const target = toIndex >= 0 ? String(args[toIndex + 1] ?? '').trim() : ''
const apply = args.includes('--apply')
if (!/^[A-Za-z0-9._-]+$/.test(target)) {
  console.error('usage: node scripts/rename-repo.mjs --to <new-repo-name> [--apply]')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const repoUrl = String(pkg.repository?.url ?? '')
const current = /github\.com[/:][^/]+\/([^/.]+)/.exec(repoUrl)?.[1] ?? ''
if (!current) {
  console.error('package.json names no GitHub repository; nothing to rename')
  process.exit(1)
}
if (current === target) {
  console.log(`already ${target}`)
  process.exit(0)
}

// Only these files carry the repository name; the package name must not change.
const FILES = ['package.json', 'market/index.json', 'README.md', 'README.en.md', 'src/panel-api.js', 'test/panel-smoke.mjs']
let changed = 0
for (const relative of FILES) {
  const path = join(ROOT, relative)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  const next = text.replaceAll(current, target)
  if (next === text) continue
  const hits = text.split(current).length - 1
  console.log(`${apply ? 'rewrote' : 'would rewrite'} ${relative} (${hits})`)
  if (apply) writeFileSync(path, next)
  changed += 1
}
console.log(`${changed} file(s) ${apply ? 'updated' : 'affected'} for ${current} -> ${target}`)
if (!apply) console.log('re-run with --apply, then: gh repo rename <new-name>')

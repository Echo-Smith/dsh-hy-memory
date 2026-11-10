/**
 * Install a published release of this plugin into the running profile.
 *
 * Scope: download a release tarball, verify it, and swap it into the profile's
 * `node_modules`. It deliberately does **not** restart DSH — a plugin runs inside
 * the app's main process, cannot call `app.relaunch()`, and restarting would kill
 * every live session. The caller is told which version is on disk and that a
 * restart is what makes it take effect.
 *
 * The profile may be managed by pnpm (it has a lockfile) with pnpm itself only
 * available inside the DSH app, so the manager is resolved the same way the
 * repository's install script does it.
 */

import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

const INSTALL_TIMEOUT_MS = 180_000
const BUNDLED_PNPM = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs'

function run(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    execFile(command, args, { timeout: INSTALL_TIMEOUT_MS, ...options }, (error, stdout, stderr) => {
      resolvePromise({ ok: error === null, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error })
    })
  })
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Numeric compare of dotted versions; a prerelease suffix sorts before its release. */
export function compareVersions(left, right) {
  const parse = (value) => String(value).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

/** The profile that owns this plugin, resolved from the installed package path. */
export function resolveProfileDir(packageDir) {
  // <profile>/node_modules/dsh-hy-memory -> <profile>
  const parent = dirname(resolve(packageDir))
  return dirname(parent)
}

/**
 * Pick the package manager the profile expects.
 * @returns {{ command: string, prefix: string[], kind: 'pnpm' | 'npm' | 'copy' } | null}
 */
export async function resolveManager(profileDir) {
  const hasLock = await exists(join(profileDir, 'pnpm-lock.yaml'))
  if (!hasLock) {
    const ok = await run('npm', ['--version'])
    return ok.ok ? { command: 'npm', prefix: [], kind: 'npm' } : null
  }
  const direct = await run('pnpm', ['--version'])
  if (direct.ok) return { command: 'pnpm', prefix: [], kind: 'pnpm' }
  const bundled = process.env.DSH_APP_PNPM ?? BUNDLED_PNPM
  if (await exists(bundled)) return { command: process.execPath, prefix: [bundled], kind: 'pnpm' }
  return null
}

/** Download a URL to a temp file; returns the path. */
async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)
  if (!response.body) throw new Error('download failed: empty body')
  await pipeline(response.body, createWriteStream(destination))
  return destination
}

/** Version declared inside a packed tarball. */
async function tarballVersion(tarballPath) {
  const out = await run('tar', ['-xOf', tarballPath, 'package/package.json'])
  if (!out.ok) throw new Error(`cannot read tarball manifest: ${out.stderr.trim()}`)
  const parsed = JSON.parse(out.stdout)
  return { name: String(parsed.name ?? ''), version: String(parsed.version ?? '') }
}

/**
 * Install a release into the profile.
 *
 * @param options.packageDir - directory of the currently loaded package.
 * @param options.url - release tarball URL.
 * @param options.version - expected version; refuses to install anything else.
 * @param options.log - optional logger.
 * @returns {installed, previous, version, needsRestart, manager}
 */
export async function installRelease(options) {
  const { packageDir, url, version } = options
  const log = typeof options.log === 'function' ? options.log : () => {}
  if (!packageDir || !url || !version) throw new Error('packageDir, url and version are required')

  const profileDir = resolveProfileDir(packageDir)
  if (!(await exists(join(profileDir, 'package.json')))) {
    throw new Error(`no profile package.json at ${profileDir}`)
  }
  const pkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  const previous = String(pkg.version ?? 'unknown')

  const manager = await resolveManager(profileDir)
  if (!manager) throw new Error('no package manager available for this profile')

  // Refuse to move backwards. A drill showed a local build ahead of the latest
  // release (0.1.7 vs 0.1.6) being silently downgraded by this same path.
  if (compareVersions(version, previous) < 0) {
    throw new Error(`refusing to downgrade ${previous} to ${version}`)
  }

  // Keep a copy next to the tarball so a failed swap can be undone.
  const work = await mkdtemp(join(tmpdir(), 'hy-install-'))
  const tarball = join(work, 'release.tgz')
  try {
    const staged = url.startsWith('file:') || url.startsWith('/')
      ? url.replace(/^file:\/\//, '')
      : await download(url, tarball)
    const meta = await tarballVersion(staged)
    if (meta.name !== pkg.name) throw new Error(`tarball is ${meta.name}, expected ${pkg.name}`)
    if (meta.version !== version) throw new Error(`tarball is ${meta.version}, expected ${version}`)
    log(`installing ${meta.name}@${meta.version} over ${previous} via ${manager.kind}`)

    // A relative path keeps the profile's dependency portable enough to reinstall.
    const spec = url.startsWith('/') || url.startsWith('file:') ? staged : url
    const args = manager.kind === 'pnpm'
      ? [...manager.prefix, 'add', spec]
      : ['install', '--no-audit', '--no-fund', spec]
    const result = await run(manager.command, args, { cwd: profileDir })
    if (!result.ok) {
      throw new Error(`${manager.kind} failed: ${(result.stderr || result.stdout || '').trim().split('\n').slice(-3).join(' ')}`)
    }

    const installedPkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
    const installed = String(installedPkg.version ?? '')
    if (installed !== version) throw new Error(`after install the profile holds ${installed}, expected ${version}`)

    return { installed: true, previous, version: installed, needsRestart: true, manager: manager.kind }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

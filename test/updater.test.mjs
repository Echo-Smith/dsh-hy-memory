import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installRelease, resolveProfileDir } from '../src/updater.js'

const NAME = 'dsh-hy-memory-test'

/** A profile directory with the plugin installed at `version`. */
function makeProfile(version = '0.1.0') {
  const root = mkdtempSync(join(tmpdir(), 'hy-updater-'))
  const profile = join(root, 'profile')
  const packageDir = join(profile, 'node_modules', NAME)
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'profile', dependencies: {} }, null, 2))
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: NAME, version }, null, 2))
  return { root, profile, packageDir }
}

/** A tarball whose package.json declares the given name and version. */
function makeTarball(root, version, name = NAME) {
  const src = join(root, `src-${version}`)
  mkdirSync(join(src, 'package'), { recursive: true })
  writeFileSync(join(src, 'package', 'package.json'), JSON.stringify({ name, version }, null, 2))
  const tarball = join(root, `pkg-${version}.tgz`)
  execFileSync('tar', ['-czf', tarball, '-C', src, 'package'])
  return tarball
}

test('the profile directory is derived from the installed package path', () => {
  const { profile, packageDir } = makeProfile()
  try {
    assert.equal(resolveProfileDir(packageDir), profile)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

test('a version mismatch is refused before anything is installed', async () => {
  const { root, packageDir } = makeProfile()
  try {
    const tarball = makeTarball(root, '9.9.9')
    await assert.rejects(
      installRelease({ packageDir, url: `file://${tarball}`, version: '1.0.0' }),
      /tarball is 9\.9\.9, expected 1\.0\.0/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a tarball for another package is refused', async () => {
  const { root, packageDir } = makeProfile()
  try {
    const tarball = makeTarball(root, '1.0.0', 'some-other-plugin')
    await assert.rejects(
      installRelease({ packageDir, url: `file://${tarball}`, version: '1.0.0' }),
      /tarball is some-other-plugin/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a missing profile is refused rather than guessed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hy-updater-bad-'))
  try {
    const packageDir = join(root, 'nowhere', 'node_modules', NAME)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: NAME, version: '0.1.0' }))
    await assert.rejects(
      installRelease({ packageDir, url: 'file:///tmp/nope.tgz', version: '0.1.0' }),
      /no profile package.json/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('installing reports the previous version and that a restart is required', async (t) => {
  const { root, profile, packageDir } = makeProfile('0.1.0')
  try {
    const tarball = makeTarball(root, '0.2.0')
    // Simulate the package manager: drop the new manifest in place.
    const fakeBin = join(root, 'bin')
    mkdirSync(fakeBin, { recursive: true })
    const fake = join(fakeBin, 'npm')
    writeFileSync(fake, [
      '#!/bin/sh',
      `cp "${join(root, 'src-0.2.0', 'package', 'package.json')}" "${join(packageDir, 'package.json')}"`,
      'exit 0',
    ].join('\n'), { mode: 0o755 })
    const originalPath = process.env.PATH
    process.env.PATH = `${fakeBin}:/usr/bin:/bin`
    try {
      const result = await installRelease({ packageDir, url: `file://${tarball}`, version: '0.2.0' })
      assert.equal(result.previous, '0.1.0')
      assert.equal(result.version, '0.2.0')
      assert.equal(result.needsRestart, true, 'the caller is told a restart is what applies it')
      const onDisk = JSON.parse(readFileSync(join(profile, 'node_modules', NAME, 'package.json'), 'utf8'))
      assert.equal(onDisk.version, '0.2.0')
    } finally {
      process.env.PATH = originalPath
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a downgrade is refused, so a local build ahead of the latest release is safe', async () => {
  const { root, packageDir } = makeProfile('0.1.7')
  try {
    const tarball = makeTarball(root, '0.1.6')
    await assert.rejects(
      installRelease({ packageDir, url: `file://${tarball}`, version: '0.1.6' }),
      /refusing to downgrade 0\.1\.7 to 0\.1\.6/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

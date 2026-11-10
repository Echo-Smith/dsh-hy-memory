import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../scripts/install-into-profile.mjs', import.meta.url), 'utf8')

test('the installer checks the version that actually landed', () => {
  // A bare name can resolve through an older pinned tarball left in the profile,
  // which installed 0.1.6 and still reported success.
  assert.match(source, /landedVersion/, 'the installed version is re-read after the install')
  assert.match(source, /'view', `\$\{name\}@latest`, 'version'/, 'latest is looked up from the registry')
  assert.match(source, /installed \$\{landedVersion \?\? 'nothing'\}, but/, 'a mismatch fails loudly')
})

test('a mismatch exits non-zero instead of reporting success', () => {
  const guard = source.slice(source.indexOf('const landedVersion'))
  const mismatch = guard.slice(0, guard.indexOf('const installed = join'))
  assert.match(mismatch, /process\.exit\(1\)/, 'the installer must fail, not warn')
})

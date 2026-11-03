import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEFAULT_SETTINGS, ensureDefaults, loadSettings, mergeSettings, saveSettings } from '../src/settings.js'

test('mergeSettings merges nested objects and replaces scalars and arrays', () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, {
    recall: { maxItems: 9 },
    tiers: { session: false },
    mode: 'lite',
    enabled: undefined,
  })
  assert.equal(merged.recall.maxItems, 9)
  assert.equal(merged.recall.maxChars, DEFAULT_SETTINGS.recall.maxChars)
  assert.equal(merged.recall.minScore, DEFAULT_SETTINGS.recall.minScore)
  assert.deepEqual(merged.tiers, { personal: true, project: true, session: false })
  assert.equal(merged.mode, 'lite')
  assert.equal(merged.enabled, DEFAULT_SETTINGS.enabled)
  assert.equal(DEFAULT_SETTINGS.recall.maxItems, 5, 'merge must not mutate the defaults')
})

test('mergeSettings ignores non-object patches and keeps arrays by replacement', () => {
  assert.equal(mergeSettings(DEFAULT_SETTINGS, null), DEFAULT_SETTINGS)
  assert.equal(mergeSettings(DEFAULT_SETTINGS, 'nope'), DEFAULT_SETTINGS)
  const merged = mergeSettings({ list: [1, 2, 3], nested: { a: 1 } }, { list: [9], nested: { b: 2 } })
  assert.deepEqual(merged.list, [9])
  assert.deepEqual(merged.nested, { a: 1, b: 2 })
})

test('ensureDefaults repairs a partial settings object', () => {
  const repaired = ensureDefaults({ mode: 'lite' })
  assert.equal(repaired.mode, 'lite')
  assert.deepEqual(repaired.recall, DEFAULT_SETTINGS.recall)
  assert.deepEqual(repaired.embedding, DEFAULT_SETTINGS.embedding)
})

test('settings round-trip through the atomic writer under $DSH_HOME', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hy-memory-settings-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    assert.deepEqual(await loadSettings(), DEFAULT_SETTINGS, 'missing file yields defaults')
    const written = mergeSettings(DEFAULT_SETTINGS, { user: 'alice', recall: { maxItems: 3 } })
    await saveSettings(written)
    const loaded = await loadSettings()
    assert.equal(loaded.user, 'alice')
    assert.equal(loaded.recall.maxItems, 3)
    const files = await readdir(join(home, 'integrations', 'hy-memory'))
    assert.deepEqual(files, ['settings.json'], 'no temp file survives the rename')
    const onDisk = JSON.parse(await readFile(join(home, 'integrations', 'hy-memory', 'settings.json'), 'utf8'))
    assert.equal(onDisk.recall.maxItems, 3)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

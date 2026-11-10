import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/sidecar.js', import.meta.url), 'utf8')

test('the missing-interpreter message states the real requirement', () => {
  // It used to say "needs Python 3.12", but findSystemPython() accepts 3.11+ and
  // 3.11 was verified to install and import the engine. The message now matches
  // the check instead of contradicting it.
  const match = /needs Python ([\d.]+) or newer/i.exec(source)
  assert.ok(match, 'the message names a minimum version')
  assert.equal(match[1], '3.11', 'the message states 3.11, the version the code accepts')
  assert.doesNotMatch(source, /needs Python 3\.12 and no usable/, 'the old 3.12 wording is gone')
})

test('a missing interpreter is reported without a redundant prefix', () => {
  // "could not prepare its Python environment: needs Python 3.11..." buries the
  // actionable sentence, so that case passes the message through unchanged.
  assert.match(source, /missingPython/, 'the branch is recognised')
  assert.match(source, /needs Python 3\\\.11 or newer\/i/, 'the recogniser matches the message')
})

test('the fallback still accepts every version the message promises', () => {
  const candidates = /for \(const candidate of \[([^\]]+)\]/.exec(source)
  assert.ok(candidates?.[1].includes('python3.11'), 'python3.11 is tried')
  assert.match(source, /minor >= 11/, 'the version floor is 3.11')
})

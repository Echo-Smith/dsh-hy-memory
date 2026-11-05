import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hideForeignNavIcons } from '../client-src/nav.js'

function svg(className = '') {
  const node = { className, attrs: {}, style: {}, closest(selector) { return selector === '.hm-navGlyph' && className.includes('hm-navGlyph') ? this : null } }
  node.setAttribute = (key, value) => { node.attrs[key] = value }
  node.getAttribute = (key) => node.attrs[key] ?? null
  return node
}

function fakeDoc(row, label) {
  return { querySelectorAll: (selector) => (selector === '.hm-navLabel' ? [label] : []) }
}

test('the row keeps our brain and hides the shell icon wherever it sits', () => {
  const gear = svg('shell-gear')
  const brain = svg('hm-navGlyph')
  const label = { closest: (selector) => (selector.includes('button') ? row : null) }
  function row() {}
  const rowNode = { querySelectorAll: (selector) => (selector === 'svg' ? [gear, brain] : []) }
  const boundLabel = { closest: () => rowNode }
  const doc = fakeDoc(rowNode, boundLabel)
  const hidden = hideForeignNavIcons(doc, 'data-hm-nav-hidden')
  assert.deepEqual(hidden, [gear], 'only the foreign icon is hidden')
  assert.equal(gear.style.display, 'none')
  assert.equal(brain.style.display, undefined, 'our brain stays visible')
  assert.equal(gear.attrs['data-hm-nav-hidden'], '1', 'the marker keeps a second pass idempotent')
})

test('a second pass hides nothing more', () => {
  const gear = svg('shell-gear')
  const brain = svg('hm-navGlyph')
  const rowNode = { querySelectorAll: (selector) => (selector === 'svg' ? [gear, brain] : []) }
  const label = { closest: () => rowNode }
  const doc = fakeDoc(rowNode, label)
  hideForeignNavIcons(doc, 'data-hm-nav-hidden')
  assert.deepEqual(hideForeignNavIcons(doc, 'data-hm-nav-hidden'), [], 'already-hidden icons are skipped')
})

test('a document without the label is left alone', () => {
  assert.deepEqual(hideForeignNavIcons({ querySelectorAll: () => [] }, 'x'), [])
  assert.deepEqual(hideForeignNavIcons(null, 'x'), [])
})

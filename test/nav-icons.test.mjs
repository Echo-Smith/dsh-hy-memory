import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hideForeignNavIcons } from '../client-src/nav.js'

function node(className = '') {
  const element = {
    className,
    attrs: {},
    style: {},
    parentElement: null,
    children: [],
    closest(selector) {
      if (selector === '.hm-navGlyph') return className.includes('hm-navGlyph') ? this : null
      return null
    },
    querySelector(selector) {
      if (selector !== '.hm-navGlyph') return null
      const walk = (current) => {
        if (String(current.className).includes('hm-navGlyph')) return current
        for (const child of current.children ?? []) {
          const found = walk(child)
          if (found !== null) return found
        }
        return null
      }
      return walk(this)
    },
  }
  element.setAttribute = (key, value) => { element.attrs[key] = value }
  element.getAttribute = (key) => element.attrs[key] ?? null
  return element
}

/** A row: [iconSlot > svg] and our [label > glyph], matching the shell shape. */
function rowWithForeignIcon() {
  const row = node('row')
  row.closest = () => row
  const iconSlot = node('iconSlot')
  iconSlot.parentElement = row
  const gear = node('gear')
  gear.parentElement = iconSlot
  iconSlot.children = [gear]
  const label = node('hm-navLabel')
  label.parentElement = row
  label.closest = (selector) => (selector.includes('button') ? row : null)
  const glyph = node('hm-navGlyph')
  glyph.parentElement = label
  label.children = [glyph]
  row.children = [iconSlot, label]
  const svgs = [gear]
  row.querySelectorAll = (selector) => (selector === 'svg' ? svgs : [])
  return { row, iconSlot, gear, label, glyph }
}

test('the foreign icon slot is hidden, not just its glyph', () => {
  const { row, iconSlot, gear } = rowWithForeignIcon()
  const doc = { querySelectorAll: (selector) => (selector === '.hm-navLabel' ? [row.children[1]] : []) }
  const hidden = hideForeignNavIcons(doc, 'data-hm-nav-hidden')
  assert.deepEqual(hidden, [iconSlot], 'the whole slot goes away so the layout does not reserve its width')
  assert.equal(iconSlot.style.display, 'none')
  assert.equal(iconSlot.attrs['data-hm-nav-hidden'], '1')
  assert.equal(gear.style.display, undefined, 'the glyph inside is left as it was')
})

test('a second pass hides nothing more', () => {
  const { row, iconSlot } = rowWithForeignIcon()
  const doc = { querySelectorAll: () => [row.children[1]] }
  hideForeignNavIcons(doc, 'data-hm-nav-hidden')
  assert.deepEqual(hideForeignNavIcons(doc, 'data-hm-nav-hidden'), [], 'already-hidden slots are skipped')
  assert.equal(iconSlot.style.display, 'none')
})

test('a document without the label is left alone', () => {
  assert.deepEqual(hideForeignNavIcons({ querySelectorAll: () => [] }, 'x'), [])
  assert.deepEqual(hideForeignNavIcons(null, 'x'), [])
})

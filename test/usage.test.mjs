import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addToDay, localDayKey, recentDays } from '../src/usage.js'

test('the day key follows local time, not UTC', () => {
  const evening = new Date(2026, 10, 10, 23, 30) // local
  assert.equal(localDayKey(evening), '2026-11-10')
})

test('samples accumulate into the same day', () => {
  const t = new Date(2026, 10, 10, 12, 0).getTime()
  let days = addToDay({}, { turns: 1, tokens: 100 }, t)
  days = addToDay(days, { turns: 1, tokens: 250 }, t)
  const key = localDayKey(t)
  assert.equal(days[key].turns, 2)
  assert.equal(days[key].tokens, 350)
})

test('only the newest 30 days are kept', () => {
  let days = {}
  for (let i = 0; i < 40; i += 1) {
    days = addToDay(days, { turns: 1 }, new Date(2026, 8, 1 + i, 12, 0).getTime())
  }
  assert.equal(Object.keys(days).length, 30)
})

test('a week view fills quiet days with zeros so every bar exists', () => {
  const now = new Date(2026, 10, 10, 9, 0).getTime()
  const days = { [localDayKey(now)]: { turns: 3, tokens: 900 } }
  const week = recentDays(days, 7, now)
  assert.equal(week.length, 7)
  assert.equal(week.at(-1).day, '2026-11-10')
  assert.equal(week.at(-1).tokens, 900)
  assert.equal(week[0].turns, 0, 'an empty day reads as zero, not as missing')
})

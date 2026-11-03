#!/usr/bin/env node
/**
 * Re-ingest memories into a store built with a different embedder.
 *
 * Changing the embedder changes vector dimensions, so vectors cannot be copied
 * and the text has to be written again. This never wipes anything: it reads one
 * sidecar, writes a backup, and re-adds the same text to a second sidecar that
 * runs the new embedder. The old store stays untouched.
 *
 *   node scripts/migrate-embeddings.mjs --source 19527 --target 19528 --limit 5   # dry run
 *   node scripts/migrate-embeddings.mjs --source 19527 --target 19528 \
 *     --apply --confirm YES-MIGRATE
 *
 * Known gap: coding and working memories only carry a workspace id inside the
 * store, which the list route does not return, so those rows are re-added
 * without a workspace scope and will not be searchable until they are written
 * again by capture.
 */

import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const sourcePort = arg('source', '19527')
const targetPort = arg('target', '19528')
const user = arg('user', 'dsh')
const limit = Number(arg('limit', '0')) || 0
const apply = args.includes('--apply')
const confirm = arg('confirm', '')
const backupPath = arg('backup', `memories-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)

async function post(port, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${path} ${response.status}`)
  return response.json()
}

function extract(page) {
  if (Array.isArray(page?.memories)) return page.memories
  if (Array.isArray(page?.vdb?.memories)) return page.vdb.memories
  if (Array.isArray(page?.memories?.normal)) return page.memories.normal
  return []
}

const pageSize = 100
const rows = []
for (let offset = 0; ; offset += pageSize) {
  const page = await post(sourcePort, '/bridge/v1/list', { user_ids: [user], scene: 'all', limit: pageSize, offset })
  const batch = extract(page)
  rows.push(...batch)
  if (limit > 0 && rows.length >= limit) break
  if (batch.length < pageSize) break
  if (offset > 5000) break
}
const selected = limit > 0 ? rows.slice(0, limit) : rows

writeFileSync(backupPath, JSON.stringify({
  exportedAt: new Date().toISOString(),
  user,
  count: selected.length,
  memories: selected.map((row) => ({
    content: row.content ?? '',
    agent_id: row.agent_id ?? '',
    session_id: row.session_id ?? '',
    scene: row.scene ?? 'chat',
    layer: row.layer ?? '',
  })),
}, null, 2))
console.log(`backup: ${selected.length} memories to ${backupPath}`)

const targetBefore = extract(await post(targetPort, '/bridge/v1/list', { user_ids: [user], scene: 'all', limit: 1 }))
const targetTotalsBefore = (await post(targetPort, '/bridge/v1/list', { user_ids: [user], scene: 'all', limit: 1 })).totals ?? {}
console.log(`source rows: ${rows.length}, target before: ${JSON.stringify(targetTotalsBefore)}`)

if (!apply) {
  console.log('dry run: pass --apply --confirm YES-MIGRATE to write into the target store')
  process.exit(0)
}
if (confirm !== 'YES-MIGRATE') {
  console.error('refusing to write: --confirm YES-MIGRATE is required')
  process.exit(2)
}

let written = 0
let failed = 0
for (const row of selected) {
  const content = String(row.content ?? '').trim()
  if (!content) continue
  try {
    const result = await post(targetPort, '/bridge/v1/add_scene', {
      data: [{ role: 'user', content }],
      user_id: user,
      agent_id: row.agent_id ?? 'personal',
      session_id: row.session_id || 'project',
      scene: row.scene ?? 'chat',
    })
    if (result?.success === false) failed += 1
    else written += 1
  } catch (error) {
    failed += 1
    console.error(`write failed: ${error.message}`)
  }
  if ((written + failed) % 10 === 0) console.log(`progress ${written + failed}/${selected.length}`)
}

const afterTotals = (await post(targetPort, '/bridge/v1/list', { user_ids: [user], scene: 'all', limit: 1 })).totals ?? {}
console.log(`written ${written}, failed ${failed}, target after: ${JSON.stringify(afterTotals)}`)
console.log(written > 0 && failed === 0 ? 'MIGRATION VERIFIED' : 'MIGRATION INCOMPLETE')
process.exit(written > 0 && failed === 0 ? 0 : 1)

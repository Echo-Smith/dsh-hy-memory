#!/usr/bin/env node
/**
 * Deterministic OpenAI-compatible embeddings endpoint for testing remote mode
 * without a network or an API key.
 *
 *   node scripts/mock-embeddings.mjs [port]   # defaults to 19700
 *
 * Start a sidecar with MEMORY_EMBEDDER_BASE_URL=http://127.0.0.1:<port>/v1,
 * MEMORY_EMBEDDER_MODEL=mock-embed, MEMORY_EMBEDDER_API_KEY=test,
 * MEMORY_EMBEDDING_DIMS=1024 and HY_MEMORY_LOCAL_EMBED=0.
 */

import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

const DIMS = 1024
const port = Number(process.argv[2] ?? 19700)

function vector(text) {
  const hash = createHash('sha256').update(String(text)).digest()
  const out = new Array(DIMS)
  let sum = 0
  for (let i = 0; i < DIMS; i += 1) {
    out[i] = (hash[i % hash.length] / 255) * 2 - 1
    sum += out[i] * out[i]
  }
  const norm = Math.sqrt(sum) || 1
  return out.map((value) => value / norm)
}

createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    if (req.method === 'POST' && req.url?.includes('/embeddings')) {
      const parsed = body ? JSON.parse(body) : {}
      const input = Array.isArray(parsed.input) ? parsed.input : [parsed.input ?? '']
      const data = input.map((text, index) => ({ object: 'embedding', index, embedding: vector(text) }))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', model: parsed.model ?? 'mock-embed', data, usage: { prompt_tokens: 1, total_tokens: 1 } }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [] }))
  })
}).listen(port, '127.0.0.1', () => console.log(`mock embeddings on ${port}`))

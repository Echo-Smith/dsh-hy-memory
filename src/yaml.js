/**
 * Minimal indentation-based YAML subset reader for machine-written config files
 * (DSH settings.yaml). Supports nested mappings, scalar lists, inline arrays and
 * quoted scalars. Comments, block scalars, anchors and multi-line strings are
 * ignored or kept as raw text; that is sufficient for provider discovery.
 */

function stripComment(line) {
  let quote = ''
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '#' && (i === 0 || line[i - 1] === ' ')) return line.slice(0, i)
  }
  return line
}

function scalar(text) {
  const value = text.trim()
  if (value === '') return null
  if (value === 'null' || value === '~') return null
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (value.startsWith("'") && value.endsWith("'") && value.length > 1) return value.slice(1, -1).replaceAll("''", "'")
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) return value.slice(1, -1).replace(/\\"/g, '"')
  if (value.startsWith('[') && value.endsWith(']')) {
    const body = value.slice(1, -1).trim()
    if (!body) return []
    return body.split(',').map((item) => scalar(item))
  }
  return value
}

function splitKey(text) {
  const index = text.indexOf(':')
  if (index === -1) return null
  return { key: text.slice(0, index).trim(), rest: text.slice(index + 1) }
}

export function parseYaml(source) {
  const lines = []
  for (const rawLine of source.split(/\r?\n/)) {
    const withoutComment = stripComment(rawLine)
    if (!withoutComment.trim()) continue
    const indent = withoutComment.length - withoutComment.trimStart().length
    lines.push({ indent, text: withoutComment.trim() })
  }

  let cursor = 0

  function parseBlock(indent) {
    const first = lines[cursor]
    if (!first) return null
    if (first.text.startsWith('- ')) return parseList(indent)
    return parseMap(indent)
  }

  function parseList(indent) {
    const out = []
    while (cursor < lines.length) {
      const line = lines[cursor]
      if (line.indent < indent) break
      if (line.indent > indent) { cursor += 1; continue }
      if (!line.text.startsWith('- ')) break
      const item = line.text.slice(2)
      cursor += 1
      const pair = splitKey(item)
      if (!pair) {
        out.push(scalar(item))
        continue
      }
      if (pair.rest.trim() === '') {
        const child = cursor < lines.length && lines[cursor].indent > indent ? parseBlock(lines[cursor].indent) : null
        out.push({ [pair.key]: child })
      } else {
        const entry = { [pair.key]: scalar(pair.rest) }
        while (cursor < lines.length && lines[cursor].indent > indent && !lines[cursor].text.startsWith('- ')) {
          const nested = parseMap(lines[cursor].indent)
          Object.assign(entry, nested ?? {})
        }
        out.push(entry)
      }
    }
    return out
  }

  function parseMap(indent) {
    const out = {}
    while (cursor < lines.length) {
      const line = lines[cursor]
      if (line.indent < indent) break
      if (line.indent > indent) { cursor += 1; continue }
      if (line.text.startsWith('- ')) break
      const pair = splitKey(line.text)
      cursor += 1
      if (!pair) continue
      if (pair.rest.trim() === '') {
        const next = lines[cursor]
        out[pair.key] = next && next.indent > indent ? parseBlock(next.indent) : null
      } else {
        out[pair.key] = scalar(pair.rest)
      }
    }
    return out
  }

  const root = parseBlock(lines[0]?.indent ?? 0) ?? {}
  return root
}

/**
 * Decode a DSH session directory name into candidate workspace paths.
 *
 * One directory per cwd, with `/` written as `-`, the name wrapped in `--`, and
 * other characters escaped as `~XXXX`. The encoding is ambiguous: a literal `-`
 * in a directory name is indistinguishable from a separator, so a single decode
 * can produce a path that does not exist. Callers pick the candidate that exists
 * on disk (and, when they have one, whose project key matches).
 *
 * @param name - a session directory name, e.g. `--Users-me-code-app--`.
 * @param options.limit - maximum candidates to emit (default 512).
 * @returns candidate absolute paths, most plausible first; empty when not a session dir.
 */
export function sessionDirPathCandidates(name, options = {}) {
  const value = String(name ?? '')
  if (!value.startsWith('--') || !value.endsWith('--') || value.length <= 4) return []
  const body = value.slice(2, -2)
  const unescape = (text) => text.replace(/~([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
  const parts = body.split('-')
  const limit = Number.isFinite(options.limit) ? Number(options.limit) : 512
  const out = []
  const walk = (index, current) => {
    if (out.length >= limit) return
    if (index === parts.length) {
      out.push(`/${current}`)
      return
    }
    // Prefer separators: a directory name more often means a path than a file
    // with a very long hyphenated name.
    if (current !== '' && parts[index] !== '') walk(index + 1, `${current}/${parts[index]}`)
    walk(index + 1, current === '' ? parts[index] : `${current}-${parts[index]}`)
  }
  walk(0, '')
  return [...new Set(out.map(unescape))]
}

/** The first candidate that exists on disk, for callers without a key to match. */
export function firstExistingSessionPath(name, exists) {
  for (const candidate of sessionDirPathCandidates(name)) {
    try {
      if (typeof exists !== 'function' || exists(candidate)) return candidate
    } catch {}
  }
  return null
}

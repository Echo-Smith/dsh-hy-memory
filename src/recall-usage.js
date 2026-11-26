/**
 * Did the assistant's reply actually use a recalled memory?
 *
 * There is no ground truth for this without asking the model to cite, which
 * would change its output. This is a deliberately conservative signal: it looks
 * for a distinctive phrase shared between the memory and the reply, so a common
 * word or a shared topic cannot trigger it.
 *
 *   likely_used  a distinctive phrase from the memory appears in the reply
 *   no_overlap   the reply was read and shares no distinctive phrase
 *   unknown      nothing to compare (empty text, or the memory is too short to
 *                yield a phrase that would not also appear by coincidence)
 */

const CJK_GRAM = 8
const LATIN_GRAM = 3
const MAX_GRAMS = 160

export function scoreRecallUsage(content, reply) {
  const memory = String(content ?? '').trim()
  const answer = String(reply ?? '').trim()
  if (!memory || !answer) return { signal: 'unknown', matched: '' }
  const grams = distinctiveGrams(memory)
  if (grams.length === 0) return { signal: 'unknown', matched: '' }
  const haystack = answer.toLowerCase()
  for (const gram of grams) {
    if (haystack.includes(gram.toLowerCase())) return { signal: 'likely_used', matched: gram }
  }
  return { signal: 'no_overlap', matched: '' }
}

/**
 * Character windows for phrases that contain CJK (so mixed text like
 * "依赖必须用 npm update 升级" is covered), plus word trigrams for pure-Latin
 * memories. Short inputs yield nothing rather than a guess.
 */
export function distinctiveGrams(text) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim()
  const out = []
  for (let index = 0; index + CJK_GRAM <= source.length; index += 1) {
    const window = source.slice(index, index + CJK_GRAM)
    const cjk = (window.match(/[\u4e00-\u9fff]/g) ?? []).length
    if (cjk >= 3) out.push(window)
  }
  const words = source.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []
  for (let index = 0; index + LATIN_GRAM <= words.length; index += 1) {
    out.push(`${words[index]} ${words[index + 1]} ${words[index + 2]}`)
  }
  return out.slice(0, MAX_GRAMS)
}

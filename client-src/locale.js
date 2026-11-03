/**
 * Dictionaries for the Hy-Memory client namespace.
 *
 * The same files are the bundle catalog (`locale/*.json`, read by the plugin
 * catalog) and the runtime dictionary source, so a panel string has one home.
 * Non-string entries (`meta`) stay in the file for the catalog reader and are
 * dropped from the locale registration.
 */
import zhCatalog from '../locale/zh.json'
import enCatalog from '../locale/en.json'

export const NS = 'hy-memory'

function strings(catalog) {
  const out = {}
  for (const [key, value] of Object.entries(catalog ?? {})) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

export const dictionaries = {
  zh: strings(zhCatalog),
  en: strings(enCatalog),
}

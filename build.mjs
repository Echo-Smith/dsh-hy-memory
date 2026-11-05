/**
 * Bundle client-src/index.js into client.js.
 *
 * The output is the lazy-CJS contract the Web shell's module table expects:
 * `window.__ModuleLoader__.load({ id, factory(require) {...} })`, with React and
 * the host's seed modules left as runtime requires (they are platform words in
 * the browser module table, not bundled copies).
 *
 * esbuild is not a runtime dependency of this package and is not listed in
 * package.json. The script resolves it from, preferring the highest version:
 *   - $DSH_ESBUILD (an esbuild package directory)
 *   - a local or ancestor node_modules/esbuild
 *   - every DSH profile's node_modules/esbuild
 *   - the npm npx cache (~/.npm/_npx/<hash>/node_modules/esbuild)
 *   - a bare `esbuild` resolution
 * The highest version found is used, so the output stays identical to the
 * committed artifact (esbuild 0.25+ emit the same bytes for this input). When no
 * esbuild exists the script stops with an explanatory error; the committed
 * client.js is already the built artifact.
 */
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outputPath = resolve(here, 'client.js')
// The loader id must equal the installed package name; read it from the
// manifest so the working copy and a published build cannot drift apart.
const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const loaderId = process.env.HY_MEMORY_CLIENT_ID ?? manifest.name
const esbuildExternal = ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives']

const require = createRequire(import.meta.url)
const home = homedir()

function listDirectories(parent) {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function candidateDirectories() {
  const candidates = [
    process.env.DSH_ESBUILD,
    join(here, 'node_modules', 'esbuild'),
    join(here, '..', 'node_modules', 'esbuild'),
    join(here, '..', '..', 'node_modules', 'esbuild'),
    join(here, '..', '..', '..', 'node_modules', 'esbuild'),
  ]
  for (const profile of listDirectories(join(home, '.dsh', 'profiles'))) {
    candidates.push(join(home, '.dsh', 'profiles', profile, 'node_modules', 'esbuild'))
  }
  for (const cache of listDirectories(join(home, '.npm', '_npx'))) {
    candidates.push(join(home, '.npm', '_npx', cache, 'node_modules', 'esbuild'))
  }
  return candidates.filter((candidate) => typeof candidate === 'string' && candidate !== '')
}

function versionParts(version) {
  return String(version)
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
}

/** Compare two semver-ish strings; a numeric release comparison is enough here. */
function compareVersions(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function loadFromDirectory(directory) {
  if (!existsSync(directory)) return null
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    return { module: require(directory), version: String(manifest.version ?? '0.0.0'), where: directory }
  } catch {
    return null
  }
}

function resolveEsbuild() {
  const found = []
  for (const directory of candidateDirectories()) {
    const loaded = loadFromDirectory(directory)
    if (loaded !== null) found.push(loaded)
  }
  try {
    const module = require('esbuild')
    const manifest = JSON.parse(readFileSync(require.resolve('esbuild/package.json'), 'utf8'))
    found.push({ module, version: String(manifest.version ?? '0.0.0'), where: 'esbuild (resolved)' })
  } catch {
    // No bare resolution; the directory scan above may still have found one.
  }
  if (found.length === 0) return null
  found.sort((left, right) => compareVersions(right.version, left.version))
  return found[0]
}

const esbuild = resolveEsbuild()
if (esbuild === null) {
  console.error([
    'build.mjs: esbuild was not found, so client.js was not rebuilt.',
    'Install esbuild or point $DSH_ESBUILD at an esbuild package directory, then rerun:',
    '  DSH_ESBUILD=/path/to/node_modules/esbuild node build.mjs',
    'The committed client.js is the artifact produced by this same script.',
  ].join('\n'))
  process.exitCode = 1
} else {
  const result = await esbuild.module.build({
    entryPoints: [resolve(here, 'client-src', 'index.js')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: ['chrome100'],
    external: esbuildExternal,
    write: false,
    minify: false,
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'silent',
  })
  const bundled = result.outputFiles?.[0]?.text
  if (!bundled) throw new Error('esbuild did not produce a client bundle')

  const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(loaderId)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${bundled}
    return module.exports;
  }
});
`
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, wrapped, 'utf8')
  console.log(`Wrote ${outputPath} (${Buffer.byteLength(wrapped)} bytes) with esbuild ${esbuild.version} from ${esbuild.where}`)
}

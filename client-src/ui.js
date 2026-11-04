/**
 * Shared rendering atoms for the Hy-Memory client panel.
 *
 * Host primitives are seed modules of the browser module table. They are looked
 * up through the factory's `require` at load time and every component falls back
 * to a token-styled local implementation, so a host that renames or drops a
 * primitive degrades the panel instead of blanking the slot. All colours come
 * from `--dsw-alias-*` tokens; the panel owns only layout.
 */
import * as React from 'react'

export const h = React.createElement

/** Seed-module lookup; absent outside the Web shell (unit tests) and on older hosts. */
const seed = (() => {
  try {
    return typeof require === 'function' ? require('@deepseek-ai/dsh-client-ui-primitives') : null
  } catch {
    return null
  }
})()

function pick(name, fallback) {
  const candidate = seed?.[name]
  return typeof candidate === 'function' ? candidate : fallback
}

function FallbackButton({ variant = 'ghost', size = 'md', icon, children, className, type, ...rest }) {
  return h('button', {
    ...rest,
    type: type ?? 'button',
    className: `hm-btn hm-btn-${variant} hm-btn-${size}${className ? ` ${className}` : ''}`,
  }, icon != null ? h('span', { className: 'hm-btnIcon', 'aria-hidden': 'true' }, icon) : null, children)
}

function FallbackInput({ icon, className, ...rest }) {
  return h('span', { className: `hm-inputWrap${className ? ` ${className}` : ''}` },
    icon != null ? h('span', { className: 'hm-inputIcon', 'aria-hidden': 'true' }, icon) : null,
    h('input', { ...rest, className: 'hm-input' }))
}

function FallbackTag({ tone = 'outline', className, children }) {
  return h('span', { className: `hm-tag${className ? ` ${className}` : ''}`, 'data-tone': tone }, children)
}

function FallbackStateDot({ state, className }) {
  return h('span', { className: `hm-dot${className ? ` ${className}` : ''}`, 'data-state': state, 'aria-hidden': 'true' })
}

function FallbackSegmentedTabs({ items = [], value, onChange, label, className }) {
  return h('div', { role: 'tablist', 'aria-label': label, className: `hm-tabs${className ? ` ${className}` : ''}` },
    items.map((item) => h('button', {
      key: item.value,
      type: 'button',
      role: 'tab',
      id: item.id,
      'aria-selected': item.value === value ? 'true' : 'false',
      'aria-controls': item.panelId,
      tabIndex: item.value === value ? 0 : -1,
      className: 'hm-tab',
      onClick: () => { onChange(item.value) },
    }, item.label)))
}

function FallbackDisclosureRow({ icon, title, open, expandable, onToggle, headerAccessory, children }) {
  return h('div', { className: 'hm-disclosure' },
    h('div', { className: 'hm-disclosureHead' },
      h('button', {
        type: 'button',
        className: 'hm-disclosureToggle',
        'aria-expanded': open ? 'true' : 'false',
        disabled: !expandable,
        onClick: () => { onToggle() },
      },
      icon != null ? h('span', { className: 'hm-disclosureIcon', 'aria-hidden': 'true' }, icon) : null,
      h('span', { className: 'hm-disclosureTitle' }, title),
      h('span', { className: 'hm-disclosureChevron', 'aria-hidden': 'true' }, open ? '▾' : '▸')),
      headerAccessory),
    open ? h('div', { className: 'hm-disclosureBody' }, children) : null)
}

function FallbackModal({ open, onClose, title, closeLabel, description, children, footer }) {
  React.useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown)
    return () => {
      if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])
  if (!open) return null
  return h('div', { className: 'hm-modalRoot', role: 'presentation' },
    h('div', { className: 'hm-modalMask', 'aria-hidden': 'true', onClick: onClose }),
    h('div', { className: 'hm-modalDialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { className: 'hm-modalHeader' },
        h('h2', { className: 'hm-modalTitle' }, title),
        h('button', { type: 'button', className: 'hm-modalClose', 'aria-label': closeLabel, onClick: onClose }, '×')),
      description != null ? h('p', { className: 'hm-modalDescription' }, description) : null,
      h('div', { className: 'hm-modalBody' }, children),
      footer != null ? h('div', { className: 'hm-modalFooter' }, footer) : null))
}

function FallbackTooltip({ label, children }) {
  if (typeof label !== 'string' || label === '') return children
  return h('span', { className: 'hm-tip', title: label }, children)
}

/**
 * 24 px stroke icons on one grid, path data only: no fill, `currentColor`
 * stroke. Written out here because the host's icon set is not a seed module and
 * a plugin must not import one.
 */
const ICON_PATHS = {
  brain: [
    'M12 4.6C11.2 3.2 9.5 2.5 8 3.1 6.5 3.7 5.7 5.3 6.1 6.8 4.7 7.3 3.8 8.7 4 10.2c.1.8.5 1.5 1.1 2-1 .8-1.3 2.3-.6 3.4.5.8 1.4 1.3 2.3 1.3.4 1.7 2 2.9 3.7 2.7 1.1-.1 2-.7 2.5-1.6',
    'M12 4.6c.8-1.4 2.5-2.1 4-1.5 1.5.6 2.3 2.2 1.9 3.7 1.4.5 2.3 1.9 2.1 3.4-.1.8-.5 1.5-1.1 2 1 .8 1.3 2.3.6 3.4-.5.8-1.4 1.3-2.3 1.3-.4 1.7-2 2.9-3.7 2.7-1.1-.1-2-.7-2.5-1.6',
    'M12 4.6v15.2',
    'M9.6 7.4c.9.2 1.6.9 1.8 1.8M7.9 11.1c.8.1 1.5.6 1.9 1.3M9.3 15.2c.8 0 1.5.4 2 1',
    'M14.4 7.4c-.9.2-1.6.9-1.8 1.8M16.1 11.1c-.8.1-1.5.6-1.9 1.3M14.7 15.2c-.8 0-1.5.4-2 1',
  ],
  folder: ['M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8M16 17H8M10 9H8'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronLeft: ['m15 18-6-6 6-6'],
  chevronRight: ['m9 18 6-6-6-6'],
  check: ['M20 6 9 17l-5-5'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M21 21l-4.35-4.35'],
  refresh: ['M23 4v6h-6', 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10'],
  hash: ['M4 9h16M4 15h16M10 3 8 21M16 3l-2 18'],
}

/**
 * The GitHub mark: a filled 16 px glyph, so it does not fit the stroked Icon
 * grid. Path data is the Octicons `mark-github` mark (MIT).
 */
export function GitHubMark(props) {
  const size = typeof props.size === 'number' ? props.size : 16
  return h('svg', {
    className: props.className,
    viewBox: '0 0 16 16',
    width: size,
    height: size,
    fill: 'currentColor',
    'aria-hidden': 'true',
    focusable: 'false',
  }, h('path', {
    d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z',
  }))
}

/** One inline stroked icon; `size` scales the 24 px grid. */
export function Icon(props) {
  const name = props.name
  const size = typeof props.size === 'number' ? props.size : 16
  const strokeWidth = typeof props.strokeWidth === 'number' ? props.strokeWidth : 1.6
  const paths = ICON_PATHS[name] ?? []
  return h('svg', {
    className: props.className,
    style: props.style,
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, paths.map((d, index) => h('path', { key: index, d })))
}

/**
 * A switch matching the host control: `role="switch"` + `aria-checked`, the
 * track filled with the business token when on and the thumb on its own token.
 */
function FallbackSwitch(props) {
  const checked = props.checked === true
  return h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': props.label,
    title: props.title,
    disabled: props.disabled === true,
    className: 'hm-switch',
    onClick: () => {
      if (props.disabled === true) return
      if (typeof props.onChange === 'function') props.onChange(!checked)
    },
  }, h('span', { className: 'hm-switchTrack', 'data-on': checked ? 'true' : 'false' },
    h('span', { className: 'hm-switchThumb' })))
}

function fallbackRelativeTime(at, now) {
  const MINUTE = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const diff = Math.max(0, now - at)
  if (diff < MINUTE) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MINUTE) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}

/** Host primitive when the seed module provides it, otherwise the local fallback. */
export const ui = {
  Button: pick('Button', FallbackButton),
  Input: pick('Input', FallbackInput),
  Tag: pick('Tag', FallbackTag),
  StateDot: pick('StateDot', FallbackStateDot),
  SegmentedTabs: pick('SegmentedTabs', FallbackSegmentedTabs),
  DisclosureRow: pick('DisclosureRow', FallbackDisclosureRow),
  Modal: pick('Modal', FallbackModal),
  Tooltip: pick('Tooltip', FallbackTooltip),
  Switch: pick('Switch', FallbackSwitch),
  relativeTime: pick('relativeTime', fallbackRelativeTime),
  primitives: seed !== null,
}

/** Subscribe a slot component to locale changes when the host exposes the event. */
export function useLocaleSubscription(props) {
  const subscribe = typeof props?.subscribeLocale === 'function' ? props.subscribeLocale : emptySubscribe
  const snapshot = typeof props?.localeSnapshot === 'function' ? props.localeSnapshot : emptySnapshot
  React.useSyncExternalStore(subscribe, snapshot, snapshot)
}

function emptySubscribe() {
  return () => {}
}

function emptySnapshot() {
  return ''
}

/** Contain a rendering throw so the host slot keeps the rest of Settings alive. */
export class PanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
    this.reset = this.reset.bind(this)
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    // The host's slot supervision also reports this; keep a console trail for
    // users gathering a bug report.
    console.error('hy-memory: panel render failed', error)
  }

  reset() {
    this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    const t = typeof this.props.t === 'function' ? this.props.t : null
    const text = (key, fallback) => {
      try {
        const value = t?.(key)
        return typeof value === 'string' && value !== key ? value : fallback
      } catch {
        return fallback
      }
    }
    return h('section', { className: 'hm-panel', role: 'alert' },
      panelStyles(),
      h('h2', { className: 'hm-h2' }, text('errorBoundary.title', 'The memory panel hit an error')),
      h('p', { className: 'hm-muted' }, text('errorBoundary.body', 'The error is contained; the rest of Settings keeps working.')),
      h('div', { className: 'hm-row' },
        h('button', {
          type: 'button', className: 'hm-btn hm-btn-outline hm-btn-sm', onClick: this.reset,
        }, text('errorBoundary.retry', 'Retry'))))
  }
}

/** Panel stylesheet; rendered as an element so unmounting the view removes it. */
export function panelStyles() {
  return h('style', { key: 'hy-memory-styles' }, PANEL_CSS)
}

export function errorMessage(error) {
  if (error == null) return 'unknown error'
  if (typeof error === 'string') return error
  if (typeof error.message === 'string' && error.message !== '') return error.message
  return String(error)
}

export function asArray(value) {
  return Array.isArray(value) ? value : []
}

export function asNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function normalizeItem(item) {
  const source = item !== null && typeof item === 'object' ? item : {}
  return {
    id: typeof source.id === 'string' ? source.id : String(source.id ?? ''),
    content: typeof source.content === 'string' ? source.content : '',
    tier: typeof source.tier === 'string' ? source.tier : '',
    layer: typeof source.layer === 'string' ? source.layer : '',
    status: typeof source.status === 'string' ? source.status : '',
    tags: Array.isArray(source.tags) ? source.tags.filter(tag => typeof tag === 'string') : [],
    createdAt: source.createdAt ?? null,
    updatedAt: source.updatedAt ?? null,
    score: typeof source.score === 'number' ? source.score : undefined,
    projectKey: typeof source.projectKey === 'string' ? source.projectKey : '',
    sessionId: typeof source.sessionId === 'string' ? source.sessionId : '',
  }
}

export function filterItems(items, query) {
  const needle = query.trim().toLowerCase()
  if (needle === '') return items
  return items.filter((item) => {
    if (item.content.toLowerCase().includes(needle)) return true
    if (item.tags.some(tag => tag.toLowerCase().includes(needle))) return true
    return [item.layer, item.status, item.projectKey, item.sessionId]
      .some(value => typeof value === 'string' && value.toLowerCase().includes(needle))
  })
}

export function shortId(value, length = 8) {
  const text = typeof value === 'string' ? value : ''
  if (text.length <= length) return text
  return text.slice(0, length)
}

export function stateLabel(t, state) {
  if (typeof state !== 'string' || state === '') return t('state.unknown')
  const key = `state.${state}`
  const value = t(key)
  return value === key ? state : value
}

export function dotState(state) {
  switch (state) {
    case 'ready':
    case 'done':
    case 'ok':
    case 'success':
      return 'done'
    case 'starting':
    case 'running':
    case 'pending':
      return 'ongoing'
    case 'error':
    case 'failed':
      return 'error'
    case 'warning':
      return 'warning'
    default:
      return 'idle'
  }
}

/**
 * A row title derived from the memory body: its first sentence, capped at 40
 * characters, never blank. Memories have no title field in the contract, so the
 * first line is the closest thing to a file name a memory card can show.
 */
export function memoryTitle(content, fallback) {
  const text = typeof content === 'string' ? content.replace(/\s+/g, ' ').trim() : ''
  if (text === '') return fallback
  const sentence = text.match(/^[^。！？.!?]*[。！？.!?]?/)?.[0]?.trim() ?? text
  const base = sentence === '' ? text : sentence
  return base.length > 40 ? base.slice(0, 40) : base
}

/**
 * Copy a memory to the clipboard. Returns false when the page has no clipboard
 * API (older hosts, permission denied, unit tests) so the caller can say so.
 */
export async function copyToClipboard(content) {
  const text = typeof content === 'string' ? content : ''
  try {
    if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    return false
  }
  return false
}

export function timeText(t, at, now = Date.now()) {
  const value = typeof at === 'number' ? at : Date.parse(typeof at === 'string' ? at : '')
  if (!Number.isFinite(value)) return ''
  const relative = ui.relativeTime(value, now)
  return t(`time.${relative.unit}`, { n: relative.n })
}

export function formatBytes(size) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return ''
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`
}

/** Data-directory size, when a host release reports one; the contract allows omission. */
export function dataDirSize(status) {
  const candidates = [
    status?.dataDirSize,
    status?.dataDir?.size,
    status?.storage?.dataDirSize,
    status?.storage?.size,
    status?.dataDirBytes,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) return formatBytes(candidate)
    if (typeof candidate === 'string' && candidate !== '') return candidate
  }
  return ''
}

export function dataDirPath(status) {
  const candidates = [status?.dataDir, status?.dataDirPath, status?.storage?.dataDir, status?.storage?.dir]
  for (const candidate of candidates) if (typeof candidate === 'string' && candidate !== '') return candidate
  return ''
}

const PANEL_CSS = `
.hm-panel { display:flex; flex-direction:column; gap:16px; color:var(--dsw-alias-label-primary); font-size:13px; line-height:1.5; }
.hm-panel * { box-sizing:border-box; }
.hm-header { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.hm-headerSwitch { display:flex; align-items:center; gap:8px; flex:none; }
.hm-title { margin:0; font-size:17px; font-weight:600; color:var(--dsw-alias-label-primary); }
.hm-h2 { margin:0; font-size:14px; font-weight:600; color:var(--dsw-alias-label-primary); }
.hm-header { container-type:inline-size; }
.hm-subtitle {
  margin:4px 0 0;
  font-size:12px;
  color:var(--dsw-alias-label-secondary);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
/* Narrow settings panels fold the description onto two lines instead of clipping. */
@container (max-width: 480px) {
  .hm-subtitle { white-space:normal; overflow:visible; text-overflow:clip; }
}
.hm-headerActions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.hm-counts { display:flex; align-items:center; gap:6px; flex-wrap:wrap; color:var(--dsw-alias-label-secondary); font-size:12px; }
.hm-card { border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1)); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
.hm-cardMissing { border-style:dashed; border-color:var(--dsw-alias-border-l2); }
.hm-cardHead { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.hm-memhubActions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.hm-memhubImport { display:flex; align-items:flex-end; gap:8px; flex-wrap:wrap; }
.hm-memhubImportField { display:flex; flex-direction:column; gap:4px; flex:1 1 260px; min-width:200px; }
.hm-memhubResult { display:flex; flex-direction:column; gap:4px; border-top:1px dashed var(--dsw-alias-border-l1); padding-top:8px; }
.hm-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:10px 18px; margin:0; }
.hm-field { display:flex; flex-direction:column; gap:2px; min-width:0; }
.hm-fieldLabel { font-size:11px; color:var(--dsw-alias-label-tertiary); }
.hm-fieldValue { display:flex; align-items:center; gap:6px; color:var(--dsw-alias-label-primary); font-size:12px; overflow-wrap:anywhere; }
.hm-mono { font-family:var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size:11px; color:var(--dsw-alias-label-secondary); }
.hm-pre { margin:0; padding:10px; border-radius:8px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-layer-2)); color:var(--dsw-alias-label-secondary); font-family:var(--dsw-font-mono, ui-monospace, monospace); font-size:11px; max-height:260px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; }
.hm-banner { border:1px solid var(--dsw-alias-state-warn-primary); background:var(--dsw-alias-bg-layer-1); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:8px; }
.hm-bannerText { display:flex; flex-direction:column; gap:2px; }
.hm-bannerText strong { font-size:13px; }
.hm-bannerText p { margin:0; font-size:12px; color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; }
.hm-bannerActions { display:flex; gap:8px; flex-wrap:wrap; }
.hm-headerMain { display:flex; align-items:flex-start; gap:10px; min-width:0; }
.hm-switch { appearance:none; border:0; background:transparent; padding:0; cursor:pointer; display:inline-flex; align-items:center; }
.hm-switchTrack { position:relative; display:inline-block; width:34px; height:20px; border-radius:999px; background:var(--dsw-alias-border-l2); transition:background-color .12s ease; }
.hm-switchTrack[data-on="true"] { background:var(--dsw-alias-state-business-primary); }
.hm-switchThumb { position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:var(--dsw-alias-switch-thumb); transition:transform .12s ease; }
.hm-switchTrack[data-on="true"] .hm-switchThumb { transform:translateX(14px); }
.hm-switch:focus-visible .hm-switchTrack { outline:1px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset:2px; }
.hm-switch:disabled { opacity:.5; cursor:default; }
.hm-projectBar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.hm-picker { position:relative; display:inline-flex; }
.hm-pill { appearance:none; display:inline-flex; align-items:center; gap:6px; max-width:260px; height:28px; padding:0 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; cursor:pointer; }
.hm-pill:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-pillLabel { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hm-pillChevron { display:inline-flex; flex:none; color:var(--dsw-alias-label-tertiary); }
.hm-tabsRow { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.hm-projectBar .hm-searchField { min-width:160px; }
.hm-pager { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; padding-top:2px; color:var(--dsw-alias-label-tertiary); font-size:11px; }
.hm-pagerNav { display:flex; align-items:center; gap:6px; }
.hm-pageButton { appearance:none; width:24px; height:24px; padding:0; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
.hm-pageButton:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.hm-pageButton:disabled { opacity:.45; cursor:default; }
.hm-pagerStatus { min-width:56px; text-align:center; font-size:11px; color:var(--dsw-alias-label-secondary); }
.hm-pagerSize { display:inline-flex; align-items:center; gap:6px; font-size:11px; color:var(--dsw-alias-label-tertiary); }
.hm-footer { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; padding-top:2px; }
.hm-footerLink { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; flex:none; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); text-decoration:none; }
.hm-footerLink:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.hm-footerLeft { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; }
.hm-updateNotice { display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap; min-width:0; }
.hm-updatePill { display:inline-flex; align-items:center; padding:2px 8px; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-link); font-size:11px; text-decoration:none; }
.hm-updatePill:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-updateHint { font-size:11px; color:var(--dsw-alias-label-tertiary); }
.hm-footerRight { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-left:auto; }
.hm-footerResult { font-size:11px; color:var(--dsw-alias-label-secondary); }
.hm-footerResult a { color:var(--dsw-alias-link); text-decoration:none; }
.hm-footerResult a:hover { text-decoration:underline; }
.hm-contextLine { margin:0; font-size:11px; color:var(--dsw-alias-label-tertiary); }
.hm-countLine { margin:0; font-size:11px; color:var(--dsw-alias-label-secondary); }
.hm-fileMain { display:flex; align-items:center; gap:10px; flex:1 1 auto; min-width:0; cursor:pointer; }
.hm-fileActions { flex:none; align-self:flex-start; }
.hm-fileMain:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; border-radius:8px; }
.hm-fileBody { flex:1 1 100%; order:3; margin:2px 0 0 34px; font-size:12px; line-height:1.55; color:var(--dsw-alias-label-secondary); white-space:pre-wrap; overflow-wrap:anywhere; }
.hm-file-open { align-items:flex-start; flex-wrap:wrap; }
.hm-dupeRow { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding-top:2px; }
.hm-dangerAction,
.hm-dangerAction:hover { color:var(--dsw-alias-state-error-primary) !important; border-color:var(--dsw-alias-state-error-primary) !important; }
.hm-dupeHint { font-size:11px; color:var(--dsw-alias-label-secondary); }
.hm-captureToggle { display:inline-flex; align-items:center; gap:6px; font-size:11px; color:var(--dsw-alias-label-secondary); cursor:pointer; }
.hm-captureCheck { width:13px; height:13px; margin:0; accent-color:var(--dsw-alias-brand-primary); cursor:pointer; }
.hm-captureCheck:disabled { cursor:not-allowed; opacity:0.5; }
.hm-purgeField { align-items:center; }
.hm-purgeField .hm-inputWrap { flex:1 1 auto; }
.hm-select { appearance:none; border:1px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-sm, 7px); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:11px; padding:2px 6px; cursor:pointer; }
.hm-select:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }
.hm-pillIcon { display:inline-flex; flex:none; color:var(--dsw-alias-label-tertiary); }
.hm-divider { width:1px; height:16px; flex:none; background:var(--dsw-alias-border-l2); }
.hm-projectCount { font-size:12px; color:var(--dsw-alias-label-secondary); white-space:nowrap; }
.hm-menuCard { position:absolute; z-index:20; top:calc(100% + 6px); left:0; min-width:210px; max-height:280px; overflow:auto; padding:6px; border:1px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md, 10px); background:var(--dsw-alias-bg-layer-3); box-shadow:0 12px 32px var(--dsw-alias-bg-mask-drop); display:flex; flex-direction:column; gap:2px; }
.hm-menuTitle { padding:4px 8px 6px; font-size:11px; color:var(--dsw-alias-label-tertiary); }
.hm-menuItem { appearance:none; width:100%; border:0; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; text-align:left; display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:var(--dsw-radius-sm, 7px); cursor:pointer; }
.hm-menuItem:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-menuItemIcon { display:inline-flex; flex:none; color:var(--dsw-alias-label-tertiary); }
.hm-menuItemLabel { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hm-menuItemCheck { display:inline-flex; flex:none; color:var(--dsw-alias-label-primary); }
.hm-menuEmpty { padding:10px 8px; font-size:12px; color:var(--dsw-alias-label-secondary); }
.hm-searchField { margin-left:auto; display:flex; align-items:center; gap:6px; min-width:180px; max-width:280px; height:28px; padding:0 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-tertiary); }
.hm-searchField:focus-within { border-color:var(--dsw-alias-brand-primary); }
.hm-searchInput { flex:1 1 auto; min-width:0; appearance:none; border:0; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; padding:0; }
.hm-searchInput::placeholder { color:var(--dsw-alias-label-tertiary); }
.hm-searchInput:focus { outline:none; }
.hm-filesHead { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.hm-filesTitle { margin:0; font-size:12px; font-weight:600; letter-spacing:.02em; color:var(--dsw-alias-label-secondary); }
.hm-iconButton { appearance:none; width:26px; height:26px; padding:0; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
.hm-iconButton:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.hm-iconButton:focus-visible { outline:1px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset:2px; }
.hm-files { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.hm-file { position:relative; display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dsw-radius-lg, 14px); background:var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2)); }
.hm-file:hover { border-color:var(--dsw-alias-border-l2); }
.hm-fileIcon { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; flex:none; border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dsw-radius-md, 9px); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-tertiary); }
.hm-fileText { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1 1 auto; }
.hm-fileTitle { margin:0; font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hm-fileDate { margin:0; font-size:11px; color:var(--dsw-alias-label-tertiary); display:flex; align-items:center; gap:6px; }
.hm-fileStatus { color:var(--dsw-alias-state-success-primary); }
.hm-fileActions { position:relative; flex:none; }
.hm-fileAction { appearance:none; width:26px; height:26px; padding:0; border:0; border-radius:999px; background:transparent; color:var(--dsw-alias-label-tertiary); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
.hm-fileAction:hover, .hm-fileAction[aria-expanded="true"] { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.hm-fileActions .hm-menuCard { left:auto; right:0; min-width:160px; }
.hm-actionItem { appearance:none; width:100%; border:0; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; text-align:left; padding:6px 10px; border-radius:var(--dsw-radius-sm, 7px); cursor:pointer; }
.hm-actionItem:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-actionItem-danger { color:var(--dsw-alias-state-error-primary); }
.hm-sessionBar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.hm-groupHead { display:flex; align-items:center; gap:8px; margin:2px 0 6px; }
.hm-groupLabel { display:inline-flex; align-items:center; gap:6px; margin:0; font-size:12px; font-weight:600; color:var(--dsw-alias-label-secondary); }
.hm-fileEditor { display:flex; flex-direction:column; gap:8px; }
.hm-fileEditorActions { display:flex; align-items:center; gap:6px; }
.hm-tabs { display:flex; gap:4px; background:var(--dsw-alias-bg-layer-2); border-radius:9px; padding:3px; width:max-content; max-width:100%; }
.hm-tab { appearance:none; border:0; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px; padding:5px 14px; border-radius:7px; cursor:pointer; }
.hm-tab[aria-selected="true"] { background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); box-shadow:0 1px 2px var(--dsw-alias-bg-mask-1); }
.hm-panelBody { display:flex; flex-direction:column; gap:12px; }
.hm-rows { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.hm-rowCard { border:1px solid var(--dsw-alias-border-l1); border-radius:9px; background:var(--dsw-alias-bg-layer-1); padding:10px 12px; display:flex; flex-direction:column; gap:6px; }
.hm-content { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
.hm-meta { display:flex; align-items:center; gap:6px; flex-wrap:wrap; color:var(--dsw-alias-label-tertiary); font-size:11px; }
.hm-rowActions { display:flex; align-items:center; gap:6px; }
.hm-group { display:flex; flex-direction:column; gap:8px; }
.hm-block { display:flex; flex-direction:column; gap:8px; }
.hm-blockHead { display:flex; align-items:center; justify-content:space-between; gap:8px; padding-top:2px; }
.hm-blockTitle { margin:0; font-size:12px; font-weight:600; letter-spacing:.02em; color:var(--dsw-alias-label-secondary); }
.hm-groupTitle { margin:4px 0 0; font-size:12px; font-weight:600; color:var(--dsw-alias-label-secondary); display:flex; align-items:center; gap:6px; }
.hm-textarea { width:100%; min-height:76px; resize:vertical; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; padding:8px 10px; }
.hm-textarea:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }
.hm-state { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary); font-size:12px; padding:14px 4px; }
.hm-empty { display:flex; flex-direction:column; gap:4px; border:1px dashed var(--dsw-alias-border-l2); border-radius:9px; padding:18px 14px; color:var(--dsw-alias-label-secondary); font-size:12px; text-align:center; }
.hm-emptyHint { color:var(--dsw-alias-label-tertiary); font-size:11px; }
.hm-error { margin:0; color:var(--dsw-alias-state-error-primary); font-size:12px; overflow-wrap:anywhere; }
.hm-errorRow { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.hm-muted { margin:0; color:var(--dsw-alias-label-secondary); font-size:12px; }
.hm-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.hm-disclosure { border:1px solid var(--dsw-alias-border-l1); border-radius:9px; background:var(--dsw-alias-bg-layer-1); }
.hm-disclosureHead { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 12px; }
.hm-disclosureToggle { appearance:none; background:transparent; border:0; color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px; display:flex; align-items:center; gap:8px; cursor:pointer; padding:0; }
.hm-disclosureTitle { color:var(--dsw-alias-label-primary); font-weight:600; }
.hm-disclosureBody { display:flex; flex-direction:column; gap:8px; padding:0 12px 12px; }
.hm-activity { display:flex; flex-direction:column; gap:6px; max-height:260px; overflow:auto; }
.hm-activityRow { display:flex; align-items:flex-start; gap:8px; font-size:12px; }
.hm-activityRowButton { appearance:none; width:100%; border:0; background:transparent; color:inherit; font:inherit; text-align:left; padding:4px 6px; border-radius:6px; cursor:pointer; }
.hm-activityRowButton:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-activityBody { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1 1 auto; }
.hm-activitySummary { color:var(--dsw-alias-label-primary); overflow-wrap:anywhere; }
.hm-activityTime { margin-left:auto; color:var(--dsw-alias-label-tertiary); font-size:11px; white-space:nowrap; }
.hm-activityDetail { display:block; margin:0; color:var(--dsw-alias-label-tertiary); font-size:11px; overflow-wrap:anywhere; }
.hm-injectedText { margin:0; }
.hm-tag { display:inline-flex; align-items:center; padding:1px 7px; border-radius:999px; border:1px solid var(--dsw-alias-border-l2); color:var(--dsw-alias-label-secondary); font-size:11px; }
.hm-tag[data-tone="neutral"] { background:var(--dsw-alias-bg-layer-2); }
.hm-tag[data-tone="info"] { border-color:var(--dsw-alias-link); color:var(--dsw-alias-link); }
.hm-tag[data-tone="danger"] { border-color:var(--dsw-alias-state-error-primary); color:var(--dsw-alias-state-error-primary); }
.hm-tag[data-tone="success"] { border-color:var(--dsw-alias-state-success-primary); color:var(--dsw-alias-state-success-primary); }
.hm-dot { display:inline-block; width:8px; height:8px; border-radius:999px; background:var(--dsw-alias-state-idle-primary); flex:none; }
.hm-dot[data-state="done"] { background:var(--dsw-alias-state-done-primary); }
.hm-dot[data-state="ongoing"] { background:var(--dsw-alias-state-warn-primary); }
.hm-dot[data-state="warning"] { background:var(--dsw-alias-state-warn-primary); }
.hm-dot[data-state="error"] { background:var(--dsw-alias-state-error-primary); }
.hm-btn { appearance:none; border:1px solid transparent; border-radius:8px; font:inherit; font-size:12px; padding:5px 12px; cursor:pointer; background:transparent; color:var(--dsw-alias-label-primary); display:inline-flex; align-items:center; gap:6px; }
.hm-btn-sm { padding:3px 9px; font-size:11px; border-radius:7px; }
.hm-btn-ghost:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-btn-outline { border-color:var(--dsw-alias-border-l2); }
.hm-btn-outline:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-btn-primary { background:var(--dsw-alias-button-primary-fill); color:var(--dsw-alias-label-primary-foreground); }
.hm-btn-primary:hover { background:var(--dsw-alias-button-primary-hover); }
.hm-btn:disabled { opacity:.5; cursor:default; }
.hm-inputWrap { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); padding:0 8px; min-height:28px; }
.hm-input { appearance:none; border:0; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; padding:4px 0; width:100%; min-width:120px; }
.hm-input:focus { outline:none; }
.hm-modalRoot { position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:24px; }
.hm-modalMask { position:absolute; inset:0; background:var(--dsw-alias-bg-mask-2); }
.hm-modalDialog { position:relative; width:min(420px, 100%); background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:12px; box-shadow:0 18px 48px var(--dsw-alias-bg-mask-drop); padding:14px 16px; display:flex; flex-direction:column; gap:10px; }
.hm-modalHeader { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.hm-modalTitle { margin:0; font-size:14px; font-weight:600; }
.hm-modalClose { appearance:none; border:0; background:transparent; color:var(--dsw-alias-label-secondary); font-size:18px; line-height:1; cursor:pointer; padding:2px 6px; border-radius:6px; }
.hm-modalClose:hover { background:var(--dsw-alias-interactive-bg-hover); }
.hm-modalDescription { margin:0; font-size:12px; color:var(--dsw-alias-label-secondary); }
.hm-modalBody { font-size:12px; color:var(--dsw-alias-label-secondary); }
.hm-modalFooter { display:flex; justify-content:flex-end; gap:8px; }
.hm-tip { display:inline-flex; min-width:0; }
.hm-sessionPanel { gap:14px; }
.hm-sectionTitle { margin:0; font-size:13px; font-weight:600; }
`

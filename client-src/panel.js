/**
 * Settings > Memory: the three-tier memory manager.
 *
 * The view is mounted by the Host's `settings.section` slot, so it may assume
 * the settings shell around it. Shape: one header (brain mark, title, master
 * switch), the paused/sidecar banners, a workspace bar (project pill, count,
 * file search), the tier tabs and one file list with rounded memory cards. Each
 * card opens a small action menu (copy / edit / delete); the whole surface is
 * read-only while the master switch is off.
 *
 * Every list has a loading, empty and error face; the sidecar's state is
 * surfaced as a banner with a start action instead of leaving the panel blank
 * when memory is not running.
 */
import * as React from 'react'
import { api } from './api.js'
import {
  h, ui, Icon, GitHubMark, useLocaleSubscription, errorMessage, asArray, asNumber, normalizeItem,
  shortId, stateLabel, dotState, timeText, memoryTitle, copyToClipboard, dataDirPath, dataDirSize,
  formatBytes, panelStyles,
} from './ui.js'

const TIERS = ['personal', 'project', 'session']
const ACTIVITY_LIMIT = 60
const ACTIVITY_INTERVAL_MS = 3000
const PAGE_SIZES = [10, 20, 50]
const DEFAULT_PAGE_SIZE = 20
const PAGED_LISTS = ['personal', 'project', 'session']

/**
 * One automatic update check per page load. The host caches the answer for 12 h,
 * and the manual 检查更新 button is the force-refresh path; this guard keeps tab
 * switches and re-mounts from asking again.
 */
let autoUpdateChecked = false
const COPY_FEEDBACK_MS = 2000

function emptyList() {
  return { loading: true, error: '', items: [], total: 0, fallback: false }
}

function emptyLists() {
  return { personal: emptyList(), project: emptyList(), session: emptyList() }
}

function emptyPicker() {
  return { loading: true, error: '', items: [] }
}

/** One row of `POST /api/hy-memory/projects`: the key and the label it shows. */
function normalizeProject(item) {
  const source = item !== null && typeof item === 'object' ? item : {}
  return {
    key: typeof source.key === 'string' ? source.key : String(source.key ?? ''),
    title: typeof source.title === 'string' ? source.title : '',
  }
}

/** One row of `POST /api/hy-memory/sessions`: the id the tier is keyed by. */
function normalizeSession(item) {
  const source = item !== null && typeof item === 'object' ? item : {}
  return {
    sessionId: typeof source.sessionId === 'string' ? source.sessionId : String(source.sessionId ?? ''),
  }
}

function normalizeEvent(event) {
  const source = event !== null && typeof event === 'object' ? event : {}
  return {
    at: source.at ?? null,
    kind: typeof source.kind === 'string' ? source.kind : 'error',
    tier: typeof source.tier === 'string' ? source.tier : '',
    summary: typeof source.summary === 'string' ? source.summary : '',
    detail: typeof source.detail === 'string' ? source.detail : '',
    ok: source.ok !== false,
  }
}

function kindLabel(t, kind) {
  const key = `activity.kind.${kind}`
  const value = t(key)
  return value === key ? kind : value
}

function tierLabel(t, tier) {
  if (!TIERS.includes(tier)) return tier
  return t(`tabs.${tier}`)
}

function activityTierLabel(t, tier) {
  if (tier !== 'personal' && tier !== 'project' && tier !== 'session') return ''
  return t(`activity.tier.${tier}`)
}

function mergeNewEvents(current, incoming) {
  if (incoming.length === 0) return current
  const seen = new Set(current.map((event) => `${String(event.at)}|${event.kind}|${event.summary}`))
  const fresh = incoming.filter((event) => !seen.has(`${String(event.at)}|${event.kind}|${event.summary}`))
  return [...fresh, ...current].slice(0, ACTIVITY_LIMIT)
}

/**
 * The write-activity disclosure.
 *
 * It owns both its data and its 3 s poll. Keeping the poll here (instead of in
 * the section) means a tick re-renders this subtree only: the tier lists, the
 * search box, an open inline editor and the section's scroll position are never
 * touched by polling, so an in-progress edit cannot be lost to a tick.
 */
function ActivityPanel(props) {
  const t = props.t
  const [events, setEvents] = React.useState([])
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [open, setOpen] = React.useState(false)
  const [tick, setTick] = React.useState(0)
  // The poll refreshes this clock too, so relative times in this list stay live
  // without re-rendering the rest of the section.
  const [now, setNow] = React.useState(() => Date.now())
  const [injected, setInjected] = React.useState(null)
  const [injectedLoading, setInjectedLoading] = React.useState(false)
  const [injectedError, setInjectedError] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    let timer = null
    let cursor
    const poll = async () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      try {
        const data = await api.activity(cursor)
        if (cancelled) return
        cursor = typeof data?.cursor === 'string' || typeof data?.cursor === 'number' ? data.cursor : cursor
        const incoming = asArray(data?.events).map(normalizeEvent)
        setEvents((prev) => mergeNewEvents(prev, incoming))
        setError('')
        setLoading(false)
        setNow(Date.now())
      } catch (pollError) {
        if (cancelled) return
        setError(errorMessage(pollError))
        setLoading(false)
      }
    }
    void poll()
    timer = setInterval(() => { void poll() }, ACTIVITY_INTERVAL_MS)
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void poll()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      if (timer !== null) clearInterval(timer)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [tick])

  /** The text the host injected for one recall entry (or "not in the log"). */
  const openInjected = async (event) => {
    setInjected({ at: event.at })
    setInjectedLoading(true)
    setInjectedError('')
    try {
      const data = await api.injected(event.at)
      setInjected((prev) => (prev !== null && prev.at === event.at
        ? { ...prev, result: data !== null && typeof data === 'object' ? data : { found: false } }
        : prev))
    } catch (injectedFailure) {
      setInjectedError(errorMessage(injectedFailure))
    } finally {
      setInjectedLoading(false)
    }
  }

  const closeInjected = () => {
    setInjected(null)
    setInjectedError('')
  }

  const renderInjectedModal = () => {
    const result = injected?.result ?? null
    const found = result !== null && result.found === true
    let body
    if (injectedLoading) {
      body = h('p', { className: 'hm-muted', role: 'status' }, t('common.loading'))
    } else if (injectedError !== '') {
      body = h('p', { className: 'hm-error', role: 'alert' }, t('why.failed', { message: injectedError }))
    } else if (!found) {
      body = h('p', { className: 'hm-muted' }, t('injected.missing'))
    } else {
      const sourceKey = `why.source.${String(result.source ?? '')}`
      const sourceText = t(sourceKey)
      body = h(React.Fragment, null,
        h('div', { className: 'hm-field' },
          h('span', { className: 'hm-fieldLabel' }, t('why.query')),
          h('span', { className: 'hm-fieldValue hm-mono' }, String(result.query ?? ''))),
        h('div', { className: 'hm-field' },
          h('span', { className: 'hm-fieldLabel' }, t('why.source')),
          h('span', { className: 'hm-fieldValue' }, sourceText === sourceKey ? String(result.source ?? '') : sourceText)),
        h('pre', { className: 'hm-pre hm-injectedText' }, String(result.text ?? '')))
    }
    return h(ui.Modal, {
      open: injected !== null,
      onClose: closeInjected,
      title: t('injected.title'),
      closeLabel: t('common.close'),
      footer: h('div', { className: 'hm-row' },
        h(ui.Button, {
          size: 'sm', variant: 'ghost', 'data-modal-autofocus': '',
          onClick: closeInjected,
        }, t('common.close'))),
    }, body)
  }

  const rows = events.map((event, index) => {
    const key = `${String(event.at)}|${event.kind}|${index}`
    const content = [
      h(ui.StateDot, {
        key: 'dot',
        state: event.ok ? dotState(event.kind === 'error' ? 'error' : 'done') : 'error',
      }),
      h('span', { key: 'body', className: 'hm-activityBody' },
        h('span', { className: 'hm-activitySummary' },
          h(ui.Tag, { tone: event.kind === 'error' || !event.ok ? 'danger' : 'outline' }, kindLabel(t, event.kind)),
          ' ',
          event.tier !== '' ? h(ui.Tag, { tone: 'quiet' }, activityTierLabel(t, event.tier)) : null,
          ' ',
          event.summary),
        event.detail !== '' ? h('span', { className: 'hm-activityDetail' }, event.detail) : null),
      h('span', { key: 'time', className: 'hm-activityTime' }, timeText(t, event.at, now)),
    ]
    // Recall entries open the text the host injected for that turn.
    if (event.kind === 'recall') {
      return h('button', {
        key,
        type: 'button',
        className: 'hm-activityRow hm-activityRowButton',
        'aria-label': t('injected.open'),
        onClick: () => { void openInjected(event) },
      }, content)
    }
    return h('div', { key, className: 'hm-activityRow' }, content)
  })

  let body
  if (loading) {
    body = h('div', { className: 'hm-state' }, h(ui.StateDot, { state: 'ongoing' }), t('common.loading'))
  } else if (error !== '') {
    body = h('div', { className: 'hm-empty', role: 'alert' },
      h('p', { className: 'hm-error' }, t('activity.error', { message: error })),
      h('div', { className: 'hm-row' },
        h(ui.Button, { size: 'sm', variant: 'outline', onClick: () => { setTick((value) => value + 1) } }, t('common.retry'))))
  } else if (rows.length === 0) {
    body = h('div', { className: 'hm-empty' }, t('activity.empty'))
  } else {
    body = h('div', { className: 'hm-activity' }, rows)
  }
  return h(React.Fragment, null,
    h(ui.DisclosureRow, {
      icon: h(ui.StateDot, { state: error !== '' ? 'error' : events.length > 0 ? 'done' : 'idle' }),
      title: events.length > 0 ? `${t('activity.title')} (${events.length})` : t('activity.title'),
      open,
      expandable: true,
      onToggle: () => { setOpen((value) => !value) },
      headerAccessory: h('span', { className: 'hm-meta' }, t('activity.hint')),
    }, body),
    renderInjectedModal())
}

/** `error.code` values the MemHub routes use for a user-facing explanation. */
const MEMHUB_ERROR_KEYS = Object.freeze({
  memhub_locked: 'memhub.error.memhub_locked',
  embedding_mismatch: 'memhub.error.embedding_mismatch',
  not_found: 'memhub.error.not_found',
  // The host's import/pull routes use these codes for the same two situations.
  import_missing: 'memhub.error.import_missing',
  memhub_not_detected: 'memhub.error.memhub_not_detected',
})

function isAbsolutePath(value) {
  if (typeof value !== 'string' || value === '') return false
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
}

/** A known MemHub failure gets its own sentence; anything else keeps the host message. */
function memhubErrorText(t, error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  const key = MEMHUB_ERROR_KEYS[code]
  if (key !== undefined) {
    const text = t(key)
    if (typeof text === 'string' && text !== key) return text
  }
  return t('memhub.error.generic', { message: errorMessage(error) })
}

/**
 * The MemHub link card.
 *
 * MemHub is a separate product: this card reads its detection state from the
 * status payload, exports our store to JSON, and imports (or pulls) MemHub's
 * memories into the personal tier. Nothing here writes into MemHub's directory.
 */
function MemhubCard(props) {
  const t = props.t
  const memhub = props.memhub ?? null
  const onImported = props.onImported
  const [busy, setBusy] = React.useState('')
  const [result, setResult] = React.useState(null)
  const [importOpen, setImportOpen] = React.useState(false)
  const [importPath, setImportPath] = React.useState('')
  const [pathError, setPathError] = React.useState(false)
  const [detailsOpen, setDetailsOpen] = React.useState(false)

  const detected = memhub !== null && memhub.detected === true
  const detectedPath = typeof memhub?.path === 'string' ? memhub.path : ''
  const detectedSize = formatBytes(memhub?.sizeBytes)

  // While status is still unknown, say nothing rather than claim "not installed".
  if (memhub === null) return null

  // MemHub is not installed: a dashed card with one short line and no controls.
  if (detected !== true) {
    return h('section', { className: 'hm-card hm-cardMissing' },
      h('div', { className: 'hm-cardHead' },
        h('h2', { className: 'hm-h2' }, t('memhub.title'))),
      h('p', { className: 'hm-muted' }, t('memhub.missing')))
  }

  const run = async (kind) => {
    if (busy !== '') return
    if (kind === 'import') {
      const target = importPath.trim()
      if (isAbsolutePath(target) === false) {
        setPathError(true)
        return
      }
      setPathError(false)
      setBusy(kind)
      setResult(null)
      try {
        const data = await api.memhubImport(target)
        setResult({ kind, data: data ?? {} })
        setImportOpen(false)
        setImportPath('')
        if (typeof onImported === 'function') onImported()
      } catch (error) {
        setResult({ kind, error })
      } finally {
        setBusy('')
      }
      return
    }
    setBusy(kind)
    setResult(null)
    try {
      const data = kind === 'export' ? await api.memhubExport() : await api.memhubPull()
      setResult({ kind, data: data ?? {} })
      if (kind === 'pull' && typeof onImported === 'function') onImported()
    } catch (error) {
      setResult({ kind, error })
    } finally {
      setBusy('')
    }
  }

  const renderResult = () => {
    if (result === null) return null
    if (result.error !== undefined) {
      return h('p', { className: 'hm-error', role: 'alert' }, memhubErrorText(t, result.error))
    }
    const data = result.data ?? {}
    if (result.kind === 'export') {
      const bytes = formatBytes(data.bytes)
      return h('div', { className: 'hm-memhubResult' },
        h('p', { className: 'hm-muted', role: 'status' }, t('memhub.result.export', {
          count: asNumber(data.count),
          path: typeof data.path === 'string' ? data.path : '',
        })),
        bytes !== '' ? h('span', { className: 'hm-meta' }, bytes) : null)
    }
    return h('div', { className: 'hm-memhubResult' },
      h('p', { className: 'hm-muted', role: 'status' }, t(
        result.kind === 'pull' ? 'memhub.result.pull' : 'memhub.result.import',
        {
          imported: asNumber(data.imported),
          skipped: asNumber(data.skipped),
          failed: asNumber(data.failed),
        },
      )),
      typeof data.path === 'string' && data.path !== ''
        ? h('span', { className: 'hm-meta hm-mono' }, t('memhub.result.path', { path: data.path }))
        : null)
  }

  const actionButton = (kind, label, busyLabel, onClick, variant) => h(ui.Button, {
    key: kind,
    size: 'sm',
    variant,
    disabled: busy !== '',
    onClick,
  }, busy === kind ? busyLabel : label)

  const actions = h('div', { className: 'hm-memhubActions' },
    actionButton('export', t('memhub.export'), t('memhub.exporting'), () => { void run('export') }, 'outline'),
    actionButton('pull', t('memhub.pull'), t('memhub.pulling'), () => { void run('pull') }, 'outline'),
    h(ui.Button, {
      key: 'import',
      size: 'sm',
      variant: importOpen ? 'ghost' : 'outline',
      disabled: busy !== '',
      onClick: () => {
        setPathError(false)
        setImportOpen((value) => !value)
      },
    }, t('memhub.import')))

  const importForm = importOpen
    ? h('div', { className: 'hm-memhubImport' },
      h('div', { className: 'hm-memhubImportField' },
        h('span', { className: 'hm-fieldLabel' }, t('memhub.importPath')),
        h(ui.Input, {
          type: 'text',
          value: importPath,
          placeholder: t('memhub.importPathPlaceholder'),
          'aria-label': t('memhub.importPath'),
          onChange: (event) => {
            setImportPath(event.target.value)
            setPathError(false)
          },
        })),
      h(ui.Button, {
        size: 'sm',
        variant: 'primary',
        disabled: busy !== '',
        onClick: () => { void run('import') },
      }, busy === 'import' ? t('memhub.importing') : t('memhub.importConfirm')),
      h(ui.Button, {
        size: 'sm',
        variant: 'ghost',
        onClick: () => {
          setImportOpen(false)
          setPathError(false)
        },
      }, t('memhub.importCancel')))
    : null

  // Status and the three controls stay visible; the store path, its size and
  // the explanatory prose are one disclosure away.
  const fields = [
    h('div', { key: 'state', className: 'hm-field' },
      h('span', { className: 'hm-fieldLabel' }, t('memhub.state')),
      h('span', { className: 'hm-fieldValue' },
        h(ui.StateDot, { state: 'done' }),
        t('memhub.detected'))),
  ]
  const details = []
  if (detectedPath !== '') {
    details.push(h('div', { key: 'path', className: 'hm-field' },
      h('span', { className: 'hm-fieldLabel' }, t('memhub.path')),
      h('span', { className: 'hm-fieldValue hm-mono' }, detectedPath)))
  }
  if (detectedSize !== '' && asNumber(memhub?.sizeBytes) > 0) {
    details.push(h('div', { key: 'size', className: 'hm-field' },
      h('span', { className: 'hm-fieldLabel' }, t('memhub.size')),
      h('span', { className: 'hm-fieldValue' }, detectedSize)))
  }

  return h('section', { className: 'hm-card' },
    h('div', { className: 'hm-cardHead' },
      h('h2', { className: 'hm-h2' }, t('memhub.title')),
      h(ui.Button, {
        size: 'sm',
        variant: 'ghost',
        onClick: () => { setDetailsOpen((value) => !value) },
      }, detailsOpen ? t('common.hideDetails') : t('common.details'))),
    memhub?.pairing?.paired === true
      ? h('p', { className: 'hm-muted' }, memhub?.pairing?.brokerRunning === true ? t('memhub.pairedBroker') : t('memhub.paired'))
      : null,
    h('dl', { className: 'hm-grid' }, fields),
    actions,
    importForm,
    pathError ? h('p', { className: 'hm-error', role: 'alert' }, t('memhub.pathRequired')) : null,
    renderResult(),
    detailsOpen
      ? h(React.Fragment, null,
        h('p', { className: 'hm-muted' }, t('memhub.explain')),
        details.length > 0 ? h('dl', { className: 'hm-grid' }, details) : null)
      : null)
}

/** Close an open popover on Escape; the guard keeps unit tests without a DOM safe. */
function useEscapeToClose(open, close) {
  React.useEffect(() => {
    if (open !== true) return undefined
    if (typeof document === 'undefined') return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, close])
}

/**
 * A pill that opens the one popover card used by both pickers (workspaces and
 * sessions): a title line, one row per item with a trailing check on the
 * selected one, and nothing else.
 */
function PickerPill(props) {
  const [open, setOpen] = React.useState(false)
  const close = React.useCallback(() => { setOpen(false) }, [])
  useEscapeToClose(open, close)

  const rows = props.items.map((item) => {
    const selected = item.key === props.selected
    return h('button', {
      key: item.key,
      type: 'button',
      role: 'menuitemradio',
      'aria-checked': selected ? 'true' : 'false',
      className: 'hm-menuItem',
      onClick: () => {
        setOpen(false)
        props.onSelect(item.key)
      },
    },
    h('span', { className: 'hm-menuItemIcon' }, h(Icon, { name: props.icon, size: 15 })),
    h('span', { className: 'hm-menuItemLabel' }, item.title),
    selected ? h('span', { className: 'hm-menuItemCheck' }, h(Icon, { name: 'check', size: 14 })) : null)
  })

  return h('div', { className: 'hm-picker' },
    h('button', {
      type: 'button',
      className: 'hm-pill',
      'aria-haspopup': 'menu',
      'aria-expanded': open ? 'true' : 'false',
      'aria-label': props.ariaLabel,
      onClick: () => { setOpen((value) => !value) },
    },
    h('span', { className: 'hm-pillIcon' }, h(Icon, { name: props.icon, size: 15 })),
    h('span', { className: 'hm-pillLabel' }, props.label),
    h('span', { className: 'hm-pillChevron' }, h(Icon, { name: 'chevronDown', size: 14 }))),
    open
      ? h('div', { className: 'hm-menuCard', role: 'menu', 'aria-label': props.title },
        h('div', { className: 'hm-menuTitle' }, props.title),
        rows.length > 0 ? rows : h('div', { className: 'hm-menuEmpty' }, props.emptyText))
      : null)
}

/**
 * One memory as a rounded file card: derived title, muted date line and the
 * action menu button. The menu owns its open state, so a re-render of the
 * section (a poll tick, a search keystroke) never reopens or loses it.
 */
function FileRow(props) {
  const t = props.t
  const [open, setOpen] = React.useState(false)
  const close = React.useCallback(() => { setOpen(false) }, [])
  useEscapeToClose(open, close)

  const meta = []
  if (props.date !== '') meta.push(h('span', { key: 'date' }, props.date))
  if (props.status !== '') meta.push(h('span', { key: 'status', className: 'hm-fileStatus', role: 'status' }, props.status))

  const expanded = props.expanded === true
  return h('li', { className: `hm-file${expanded ? ' hm-file-open' : ''}` },
    h('div', { className: 'hm-fileHead' },
    h('div', {
      className: 'hm-fileMain',
      role: 'button',
      tabIndex: 0,
      'aria-expanded': expanded ? 'true' : 'false',
      'aria-label': t('row.expand'),
      onClick: () => { if (typeof props.onToggle === 'function') props.onToggle() },
      onKeyDown: (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        if (typeof props.onToggle === 'function') props.onToggle()
      },
    },
    h('span', { className: 'hm-fileIcon', 'aria-hidden': 'true' }, h(Icon, { name: 'file', size: 17 })),
    h('div', { className: 'hm-fileText' },
      h('p', { className: 'hm-fileTitle', title: props.title }, props.title),
      meta.length > 0 ? h('p', { className: 'hm-fileDate' }, meta) : null)),
    h('div', { className: 'hm-fileActions' },
      h('button', {
        type: 'button',
        className: 'hm-fileAction',
        'aria-label': t('row.actions'),
        'aria-haspopup': 'menu',
        'aria-expanded': open ? 'true' : 'false',
        onClick: () => { setOpen((value) => !value) },
      }, h(Icon, { name: 'chevronDown', size: 16 })),
      open
        ? h('div', { className: 'hm-menuCard', role: 'menu' },
          props.actions.map((action) => h('button', {
            key: action.key,
            type: 'button',
            role: 'menuitem',
            className: `hm-actionItem${action.danger === true ? ' hm-actionItem-danger' : ''}`,
            onClick: () => {
              setOpen(false)
              action.onSelect()
            },
          }, action.label)))
        : null)),
    expanded && typeof props.content === 'string' && props.content !== ''
      ? h('p', { className: 'hm-fileBody' }, props.content)
      : null)
}

/** The settings section body. Stable module-level component: never recreate the type. */
export function SettingsSection(props) {
  const t = typeof props.t === 'function' ? props.t : typeof props.translate === 'function' ? props.translate : (key) => key
  useLocaleSubscription(props)

  const [tab, setTab] = React.useState('personal')
  const [status, setStatus] = React.useState(null)
  const [statusLoading, setStatusLoading] = React.useState(true)
  const [statusError, setStatusError] = React.useState('')
  const [starting, setStarting] = React.useState(false)
  const [startError, setStartError] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [searchQuery, setSearchQuery] = React.useState('')
  const [lists, setLists] = React.useState(emptyLists)
  const [refreshTick, setRefreshTick] = React.useState(0)
  // Every list carries its own page window: changing one never moves another.
  const [paging, setPaging] = React.useState(() => ({
    personal: { page: 1, size: DEFAULT_PAGE_SIZE },
    project: { page: 1, size: DEFAULT_PAGE_SIZE },
    session: { page: 1, size: DEFAULT_PAGE_SIZE },
  }))
  const [editing, setEditing] = React.useState(null)
  // One expanded row at a time: opening another closes the previous one.
  const [expandedRow, setExpandedRow] = React.useState(null)
  const [savingId, setSavingId] = React.useState('')
  const [savedId, setSavedId] = React.useState('')
  const [rowError, setRowError] = React.useState(null)
  const [deleteTarget, setDeleteTarget] = React.useState(null)
  const [forgetTarget, setForgetTarget] = React.useState(null)
  const [forgetting, setForgetting] = React.useState(false)
  const [forgetError, setForgetError] = React.useState('')
  const [dupeBusy, setDupeBusy] = React.useState('')
  const [dupeScan, setDupeScan] = React.useState(null)
  const [dupeNotice, setDupeNotice] = React.useState(false)
  const dupeNoticeTimer = React.useRef(null)
  const [dupeOpen, setDupeOpen] = React.useState(false)
  const [dupeDone, setDupeDone] = React.useState(null)
  const [dupeError, setDupeError] = React.useState('')
  const [permissions, setPermissions] = React.useState(null)
  const [captureBusy, setCaptureBusy] = React.useState(false)
  const [captureError, setCaptureError] = React.useState('')
  const [purgeOpen, setPurgeOpen] = React.useState(false)
  const [purgeText, setPurgeText] = React.useState('')
  const [purgeBusy, setPurgeBusy] = React.useState('')
  const [purgeDone, setPurgeDone] = React.useState(null)
  const [purgeError, setPurgeError] = React.useState('')
  const [explainedIds, setExplainedIds] = React.useState(() => new Set())
  const [why, setWhy] = React.useState(null)
  const [whyLoading, setWhyLoading] = React.useState(false)
  const [whyError, setWhyError] = React.useState('')
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState('')
  const [diagOpen, setDiagOpen] = React.useState(false)
  const [engine, setEngine] = React.useState(null)
  const [engineBusy, setEngineBusy] = React.useState(false)
  const [engineError, setEngineError] = React.useState('')
  const [engineSaved, setEngineSaved] = React.useState(false)
  // Collapsed like the diagnostics card: the panel stays compact until asked.
  const [engineOpen, setEngineOpen] = React.useState(false)
  const [projects, setProjects] = React.useState(emptyPicker)
  const [projectChoice, setProjectChoice] = React.useState(null)
  const [sessions, setSessions] = React.useState(emptyPicker)
  const [sessionChoice, setSessionChoice] = React.useState(null)
  const [checking, setChecking] = React.useState(false)
  const [updateResult, setUpdateResult] = React.useState(null)
  const [autoUpdate, setAutoUpdate] = React.useState(null)
  const [masterBusy, setMasterBusy] = React.useState(false)
  const [masterError, setMasterError] = React.useState('')
  const [copiedId, setCopiedId] = React.useState('')
  const [copyFailedId, setCopyFailedId] = React.useState('')
  const savedTimer = React.useRef(null)
  const copyTimer = React.useRef(null)
  const now = Date.now()

  const refresh = React.useCallback(() => { setRefreshTick((value) => value + 1) }, [])

  // Seed the engine form from the host once: later polls must not overwrite what
  // the user is typing.
  React.useEffect(() => {
    if (engine !== null) return
    const model = status?.model
    if (!model) return
    setEngine({
      provider: model.provider ?? '',
      model: model.model ?? '',
      maxTokens: model.maxTokens ?? 4096,
      timeoutMs: model.timeoutMs ?? 180000,
      halfLifeDays: status?.recall?.halfLifeDays ?? 30,
      concurrency: status?.captureSettings?.concurrency ?? 2,
      maxPerDrain: status?.captureSettings?.maxPerDrain ?? 8,
      maxAttempts: status?.captureSettings?.maxAttempts ?? 20,
      disableReasoning: model.disableReasoning !== false,
    })
  }, [engine, status])

  const saveEngine = async () => {
    if (engine === null || engineBusy) return
    setEngineBusy(true)
    setEngineError('')
    setEngineSaved(false)
    try {
      await api.setSettings({
        llm: {
          source: 'dsh',
          provider: engine.provider,
          model: engine.model,
          maxTokens: Number(engine.maxTokens) || 4096,
          timeoutMs: Number(engine.timeoutMs) || 180000,
          disableReasoning: engine.disableReasoning !== false,
        },
        recall: { halfLifeDays: Number(engine.halfLifeDays) || 30 },
        capture: {
          concurrency: Number(engine.concurrency) || 1,
          maxPerDrain: Number(engine.maxPerDrain) || 8,
          maxAttempts: Number(engine.maxAttempts) || 20,
        },
      })
      setEngineSaved(true)
      refresh()
    } catch (error) {
      setEngineError(String(error?.message ?? error))
    } finally {
      setEngineBusy(false)
    }
  }

  React.useEffect(() => () => {
    if (dupeNoticeTimer.current !== null) clearTimeout(dupeNoticeTimer.current)
    if (savedTimer.current !== null) clearTimeout(savedTimer.current)
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    setStatusLoading(true)
    setStatusError('')
    const read = refreshTick === 0 ? api.loadStatus() : api.readStatus()
    read.then((data) => {
      if (cancelled) return
      setStatus(data ?? null)
      setStatusLoading(false)
    }).catch((error) => {
      if (cancelled) return
      setStatusError(errorMessage(error))
      setStatusLoading(false)
    })
    return () => { cancelled = true }
  }, [refreshTick])

  const statusProjectKey = typeof status?.project?.key === 'string' ? status.project.key : ''
  const statusProjectTitle = typeof status?.project?.title === 'string' ? status.project.title : ''
  const currentSessionId = typeof status?.session?.id === 'string' ? status.session.id : ''
  const projectKey = typeof projectChoice === 'string' && projectChoice !== '' ? projectChoice : statusProjectKey
  // '' means every session of the workspace; any other value filters the list.
  const sessionFilter = typeof sessionChoice === 'string' ? sessionChoice : ''
  const masterOff = status?.enabled === false

  // The one automatic check: no force, so the host may answer from its cache.
  React.useEffect(() => {
    if (masterOff || autoUpdateChecked) return undefined
    autoUpdateChecked = true
    let cancelled = false
    void api.updateCheck(false).then((data) => {
      if (cancelled || data === null || typeof data !== 'object') return
      setAutoUpdate({
        latest: typeof data.latest === 'string' ? data.latest : '',
        behind: data.behind === true,
        url: typeof data.url === 'string' ? data.url : '',
        error: typeof data.error === 'string' ? data.error : '',
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [masterOff])

  React.useEffect(() => {
    const timer = setTimeout(() => { setSearchQuery(query.trim()) }, 300)
    return () => { clearTimeout(timer) }
  }, [query])

  // Workspaces: read once per refresh, then keep the selection unless the user
  // already chose one. A failed read leaves the pill on the status project.
  React.useEffect(() => {
    if (masterOff) return undefined
    let cancelled = false
    setProjects((prev) => ({ ...prev, loading: true, error: '' }))
    api.projects().then((data) => {
      if (cancelled) return
      const items = asArray(data?.items).map(normalizeProject).filter((item) => item.key !== '')
      const current = typeof data?.current === 'string' ? data.current : ''
      setProjects({ loading: false, error: '', items })
      setProjectChoice((prev) => (typeof prev === 'string' && prev !== '' ? prev : current))
    }).catch((error) => {
      if (cancelled) return
      setProjects({ loading: false, error: errorMessage(error), items: [] })
    })
    return () => { cancelled = true }
  }, [refreshTick, masterOff])

  // Sessions of the selected workspace, read while the workspace tab is open:
  // they feed the picker and the group headers of the session list.
  React.useEffect(() => {
    if (masterOff || tab !== 'project') return undefined
    if (projectKey === '') {
      setSessions({ loading: false, error: '', items: [] })
      return undefined
    }
    let cancelled = false
    setSessions((prev) => ({ ...prev, loading: true, error: '' }))
    api.sessions(projectKey).then((data) => {
      if (cancelled) return
      const items = asArray(data?.items).map(normalizeSession).filter((item) => item.sessionId !== '')
      setSessions({ loading: false, error: '', items })
    }).catch((error) => {
      if (cancelled) return
      setSessions({ loading: false, error: errorMessage(error), items: [] })
    })
    return () => { cancelled = true }
  }, [tab, projectKey, refreshTick, masterOff])

  /** One page of one list: the page window plus the shared search query. */
  const listRequest = (key, extra) => {
    const { page, size } = paging[key]
    const request = { limit: size, offset: (page - 1) * size, ...extra }
    return searchQuery === '' ? api.list(request) : api.list({ ...request, query: searchQuery })
  }

  React.useEffect(() => {
    if (masterOff || tab !== 'personal') return undefined
    let cancelled = false
    setLists((prev) => ({ ...prev, personal: { ...prev.personal, loading: true, error: '', fallback: false } }))
    void (async () => {
      try {
        const data = await listRequest('personal', { tier: 'personal' })
        if (cancelled) return
        const items = asArray(data?.items).map(normalizeItem)
        setLists((prev) => ({
          ...prev,
          personal: { loading: false, error: '', items, total: asNumber(data?.total, items.length), fallback: false },
        }))
      } catch (error) {
        if (cancelled) return
        setLists((prev) => ({
          ...prev,
          personal: { loading: false, error: errorMessage(error), items: [], total: 0, fallback: false },
        }))
      }
    })()
    return () => { cancelled = true }
  }, [tab, masterOff, searchQuery, refreshTick, paging.personal])

  React.useEffect(() => {
    if (masterOff || tab !== 'project') return undefined
    let cancelled = false
    const scope = projectKey === '' ? {} : { projectKey }
    setLists((prev) => ({ ...prev, project: { ...prev.project, loading: true, error: '', fallback: false } }))
    void (async () => {
      try {
        const data = await listRequest('project', { tier: 'project', ...scope })
        if (cancelled) return
        const items = asArray(data?.items).map(normalizeItem)
        setLists((prev) => ({
          ...prev,
          project: { loading: false, error: '', items, total: asNumber(data?.total, items.length), fallback: false },
        }))
      } catch (error) {
        if (cancelled) return
        setLists((prev) => ({
          ...prev,
          project: { loading: false, error: errorMessage(error), items: [], total: 0, fallback: false },
        }))
      }
    })()
    return () => { cancelled = true }
  }, [tab, masterOff, searchQuery, refreshTick, projectKey, paging.project])

  React.useEffect(() => {
    if (masterOff || tab !== 'project') return undefined
    let cancelled = false
    const scope = projectKey === '' ? {} : { projectKey }
    setLists((prev) => ({ ...prev, session: { ...prev.session, loading: true, error: '', fallback: false } }))
    void (async () => {
      try {
        // sessionFilter '' spans the workspace; any other value scopes the read
        // to that session, so its pagination stays exact.
        const data = await listRequest('session', { tier: 'session', sessionId: sessionFilter, ...scope })
        if (cancelled) return
        const items = asArray(data?.items).map(normalizeItem)
        setLists((prev) => ({
          ...prev,
          session: { loading: false, error: '', items, total: asNumber(data?.total, items.length), fallback: false },
        }))
      } catch (error) {
        if (cancelled) return
        setLists((prev) => ({
          ...prev,
          session: { loading: false, error: errorMessage(error), items: [], total: 0, fallback: false },
        }))
      }
    })()
    return () => { cancelled = true }
  }, [tab, masterOff, searchQuery, refreshTick, projectKey, sessionFilter, paging.session])

  // Which memories have ever been recalled: 为什么召回 is only offered for those.
  // Re-read whenever the lists are refreshed or the tab changes.
  React.useEffect(() => {
    if (masterOff) return undefined
    let cancelled = false
    api.explained().then((data) => {
      if (cancelled) return
      setExplainedIds(new Set(asArray(data?.ids).filter((id) => typeof id === 'string' && id !== '')))
    }).catch(() => {
      if (cancelled) return
      setExplainedIds(new Set())
    })
    return () => { cancelled = true }
  }, [tab, refreshTick, masterOff])

  // A shrinking page (delete, search, picker) falls back to the last real page.
  React.useEffect(() => {
    for (const key of PAGED_LISTS) {
      const pages = Math.max(1, Math.ceil(asNumber(lists[key].total) / paging[key].size))
      if (paging[key].page > pages) {
        setPaging((prev) => ({ ...prev, [key]: { ...prev[key], page: pages } }))
        return
      }
    }
  }, [lists, paging])

  // Switching the master switch off is documented as read-only: drop an open
  // editor so it cannot be saved behind the banner's back.
  React.useEffect(() => {
    if (masterOff) setEditing(null)
  }, [masterOff])

  const startSidecar = React.useCallback(async () => {
    if (starting) return
    setStarting(true)
    setStartError('')
    try {
      const data = await api.start()
      if (data !== null && typeof data === 'object') {
        setStatus(data)
        setStatusError('')
        setStatusLoading(false)
      }
      setRefreshTick((value) => value + 1)
    } catch (error) {
      setStartError(errorMessage(error))
    } finally {
      setStarting(false)
    }
  }, [starting])

  /**
   * Flip the master switch. The host merges `enabled` into the persisted
   * settings and recall/capture/tools read it on their next event, so no
   * restart is involved; the panel mirrors the returned value.
   */
  const setMaster = async (next) => {
    if (masterBusy) return
    const value = typeof next === 'boolean' ? next : !masterOff
    setMasterBusy(true)
    setMasterError('')
    try {
      const data = await api.setSettings({ enabled: value })
      const applied = data?.settings?.enabled
      setStatus((prev) => ({ ...(prev ?? {}), enabled: typeof applied === 'boolean' ? applied : value }))
    } catch (error) {
      setMasterError(errorMessage(error))
    } finally {
      setMasterBusy(false)
    }
  }

  const onMasterChange = (next) => { void setMaster(next) }
  const closeEditor = React.useCallback(() => {
    setEditing(null)
    setRowError(null)
  }, [])

  const startEditing = (item) => {
    if (masterOff) return
    setRowError(null)
    setEditing({ id: item.id, draft: item.content })
  }

  const saveEditing = async () => {
    if (editing === null || masterOff) return
    const content = editing.draft.trim()
    if (content === '') {
      setRowError({ id: editing.id, message: t('row.emptyContent') })
      return
    }
    const id = editing.id
    setSavingId(id)
    setRowError(null)
    try {
      const data = await api.update({ tier: 'personal', id, content })
      const updated = normalizeItem(data?.item ?? {})
      setLists((prev) => ({
        ...prev,
        personal: {
          ...prev.personal,
          items: prev.personal.items.map((item) => (
            item.id === id ? { ...item, ...updated, id, content } : item
          )),
        },
      }))
      setEditing(null)
      setSavedId(id)
      if (savedTimer.current !== null) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => {
        savedTimer.current = null
        setSavedId('')
      }, 2000)
    } catch (error) {
      setRowError({ id, message: errorMessage(error) })
    } finally {
      setSavingId('')
    }
  }

  const confirmDelete = async () => {
    if (deleteTarget === null || deleting || masterOff) return
    setDeleting(true)
    setDeleteError('')
    try {
      await api.delete({ tier: deleteTarget.tier, id: deleteTarget.id })
      setLists((prev) => {
        const list = prev[deleteTarget.tier]
        const items = list.items.filter((item) => item.id !== deleteTarget.id)
        return {
          ...prev,
          [deleteTarget.tier]: { ...list, items, total: Math.max(0, list.total - 1) },
        }
      })
      setDeleteTarget(null)
      setRefreshTick((value) => value + 1)
    } catch (error) {
      setDeleteError(errorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  const confirmForget = async () => {
    if (forgetTarget === null || forgetting || masterOff) return
    setForgetting(true)
    setForgetError('')
    try {
      await api.forget(forgetTarget.id)
      setLists((prev) => {
        const list = prev[forgetTarget.tier]
        const items = list.items.filter((item) => item.id !== forgetTarget.id)
        return {
          ...prev,
          [forgetTarget.tier]: { ...list, items, total: Math.max(0, list.total - 1) },
        }
      })
      setForgetTarget(null)
      setRefreshTick((value) => value + 1)
    } catch (error) {
      setForgetError(errorMessage(error))
    } finally {
      setForgetting(false)
    }
  }

  // The persisted settings carry the per-project capture switches; the session
  // pane flag shares this one read (see api.loadSettings).
  React.useEffect(() => {
    let cancelled = false
    api.loadSettings().then((settings) => {
      if (cancelled) return
      setPermissions({
        disabledCaptureProjects: asArray(settings?.permissions?.disabledCaptureProjects)
          .filter((key) => typeof key === 'string' && key !== ''),
      })
    }).catch(() => {
      if (cancelled) return
      setPermissions({ disabledCaptureProjects: [] })
    })
    return () => { cancelled = true }
  }, [])

  const captureKeys = permissions?.disabledCaptureProjects ?? []
  const captureDisabled = projectKey !== '' && captureKeys.includes(projectKey)

  /** Flip 不捕获此项目 for the active project and persist the whole array. */
  const toggleCapture = async (next) => {
    if (captureBusy || projectKey === '') return
    const updated = next
      ? (captureKeys.includes(projectKey) ? captureKeys : [...captureKeys, projectKey])
      : captureKeys.filter((key) => key !== projectKey)
    setCaptureBusy(true)
    setCaptureError('')
    try {
      const data = await api.setSettings({ permissions: { disabledCaptureProjects: updated } })
      const saved = data?.settings?.permissions?.disabledCaptureProjects
      setPermissions({
        disabledCaptureProjects: Array.isArray(saved)
          ? saved.filter((key) => typeof key === 'string' && key !== '')
          : updated,
      })
    } catch (error) {
      setCaptureError(errorMessage(error))
    } finally {
      setCaptureBusy(false)
    }
  }

  /** Total memories the host reports, for the purge warning. */
  const memoryTotal = () => {
    const counts = status?.counts ?? null
    if (counts === null) return null
    return asNumber(counts.personal) + asNumber(counts.project) + asNumber(counts.session)
  }

  const confirmPurge = async () => {
    if (purgeBusy !== '' || purgeText.trim() !== 'PURGE') return
    setPurgeBusy('purge')
    setPurgeError('')
    try {
      const data = await api.purge('PURGE')
      setPurgeOpen(false)
      setPurgeText('')
      setPurgeDone(asNumber(data?.purged))
      refresh()
    } catch (error) {
      setPurgeError(errorMessage(error))
    } finally {
      setPurgeBusy('')
    }
  }

  const purgeHint = () => {
    if (purgeError !== '') return t('purge.failed', { message: purgeError })
    if (purgeDone !== null) return t('purge.done', { n: purgeDone })
    return ''
  }

  /** Open the recall explanation for one row: the host answers from its log. */
  const openWhy = async (item) => {
    setWhy({ id: item.id, title: memoryTitle(item.content, t('row.untitled')), result: null })
    setWhyLoading(true)
    setWhyError('')
    try {
      const data = await api.explain(item.id)
      setWhy((prev) => (prev !== null && prev.id === item.id
        ? { ...prev, result: data !== null && typeof data === 'object' ? data : { found: false } }
        : prev))
    } catch (error) {
      setWhyError(errorMessage(error))
    } finally {
      setWhyLoading(false)
    }
  }

  /** Scan for duplicate groups, then either report "none" or ask to merge. */
  const scanDuplicates = async () => {
    if (dupeBusy !== '') return
    setDupeBusy('scan')
    setDupeError('')
    setDupeDone(null)
    try {
      const data = await api.duplicates()
      const groups = asArray(data?.groups).filter((group) => (
        group !== null && typeof group === 'object' && typeof group.tier === 'string' && Array.isArray(group.drop) && group.drop.length > 0
      ))
      const total = asNumber(data?.total, groups.reduce((sum, group) => sum + asNumber(group.count, group.drop.length), 0))
      setDupeScan({ groups, total })
      setDupeOpen(total > 0)
      if (total === 0) {
        setDupeNotice(true)
        if (dupeNoticeTimer.current !== null) clearTimeout(dupeNoticeTimer.current)
        dupeNoticeTimer.current = setTimeout(() => {
          dupeNoticeTimer.current = null
          setDupeNotice(false)
        }, 2000)
      } else {
        setDupeNotice(false)
      }
    } catch (error) {
      setDupeScan(null)
      setDupeError(errorMessage(error))
    } finally {
      setDupeBusy('')
    }
  }

  /** One merge call per duplicate group, then refresh every list. */
  const applyMerge = async () => {
    if (dupeScan === null || dupeBusy !== '' || dupeOpen !== true) return
    setDupeBusy('merge')
    setDupeError('')
    let removed = 0
    try {
      for (const group of dupeScan.groups) {
        await api.merge({ tier: group.tier, keep: group.keep, drop: group.drop })
        removed += asNumber(group.count, group.drop.length)
      }
      setDupeOpen(false)
      setDupeScan(null)
      setDupeDone(removed)
      refresh()
    } catch (error) {
      setDupeError(errorMessage(error))
    } finally {
      setDupeBusy('')
    }
  }

  const copyItem = async (item) => {
    const ok = await copyToClipboard(item.content)
    if (copyTimer.current !== null) {
      clearTimeout(copyTimer.current)
      copyTimer.current = null
    }
    setCopiedId(ok ? item.id : '')
    setCopyFailedId(ok ? '' : item.id)
    copyTimer.current = setTimeout(() => {
      copyTimer.current = null
      setCopiedId('')
      setCopyFailedId('')
    }, COPY_FEEDBACK_MS)
  }

  /**
   * Ask the host to compare the installed version with the published one. The
   * request is raised by the button only: no effect re-checks on a re-render.
   */
  const checkUpdate = async () => {
    if (checking) return
    setChecking(true)
    try {
      const data = await api.updateCheck(true)
      // The manual result line takes over from the quiet auto notice.
      setAutoUpdate(null)
      setUpdateResult({
        current: typeof data?.current === 'string' ? data.current : '',
        latest: typeof data?.latest === 'string' ? data.latest : '',
        behind: data?.behind === true,
        url: typeof data?.url === 'string' ? data.url : '',
        error: typeof data?.error === 'string' ? data.error : '',
      })
    } catch (error) {
      setUpdateResult({ current: '', latest: '', behind: false, url: '', error: errorMessage(error) })
    } finally {
      setChecking(false)
    }
  }

  const sidecar = status?.sidecar ?? null
  const sidecarReady = sidecar?.state === 'ready'
  const workspaceCount = asNumber(lists.project.total) + asNumber(lists.session.total)

  const memoryDate = (item) => {
    const at = item.updatedAt ?? item.createdAt
    const text = timeText(t, at, now)
    return text === '' ? '' : t('row.updatedAt', { time: text })
  }

  const rowActions = (tier, item) => {
    const actions = [{ key: 'copy', label: t('row.copy'), onSelect: () => { void copyItem(item) } }]
    // Edit is personal-only; every tier can be deleted once the host allows it.
    if (!masterOff && tier === 'personal') {
      actions.push({ key: 'edit', label: t('row.edit'), onSelect: () => { startEditing(item) } })
    }
    // Only rows the host has actually injected can explain a recall.
    if (!masterOff && item.id !== '' && explainedIds.has(item.id)) {
      actions.push({ key: 'why', label: t('row.why'), onSelect: () => { void openWhy(item) } })
    }
    if (!masterOff) {
      actions.push({
        key: 'delete',
        label: t('row.delete'),
        danger: true,
        onSelect: () => {
          setDeleteError('')
          setDeleteTarget({ tier, id: item.id })
        },
      })
      // Forget is the stronger option: the text is blocked from promotion, so it
      // needs its own confirmation rather than sharing the delete dialog.
      actions.push({
        key: 'forget',
        label: t('row.forget'),
        danger: true,
        onSelect: () => {
          setForgetError('')
          setForgetTarget({ tier, id: item.id })
        },
      })
    }
    return actions
  }

  // Title + description on the left, the master switch on the right edge of the
  // same block, vertically centred (the 通用 settings row layout).
  // One short line under the cleanup button: result, "none", or the failure.
  const dupeHint = () => {
    if (dupeError !== '') return t('dupes.failed', { message: dupeError })
    if (dupeDone !== null) return t('dupes.done', { n: dupeDone })
    if (dupeNotice && dupeScan !== null && dupeScan.total === 0) return t('dupes.none')
    return ''
  }

  const renderHeader = () => h('header', { className: 'hm-header' },
    h('div', { className: 'hm-headerMain' },
      h('div', null,
        h('h1', { className: 'hm-title' }, t('section.title')),
        h('p', { className: 'hm-subtitle' }, t('section.subtitle')))),
    h('div', { className: 'hm-headerSwitch' },
      h(ui.Switch, {
        checked: !masterOff,
        label: t('master.label'),
        disabled: masterBusy,
        onChange: onMasterChange,
      }),
      masterError !== ''
        ? h('p', { className: 'hm-error', role: 'alert' }, t('master.error', { message: masterError }))
        : null))

  const renderSidecarBanner = () => {
    if (masterOff) return null
    // Keep the last known banner visible across a refresh instead of flickering
    // away while the status read is in flight.
    if (statusLoading && status === null) return null
    if (sidecarReady && statusError === '') return null
    const title = t('banner.notReady.title')
    const body = statusError !== ''
      ? t('banner.error', { message: statusError })
      : t('banner.notReady.body', { state: stateLabel(t, sidecar?.state) })
    const children = [
      h('div', { key: 'text', className: 'hm-bannerText' },
        h('strong', null, title),
        h('p', null, body),
        sidecar?.lastError ? h('p', { className: 'hm-error' }, t('banner.lastError', { message: sidecar.lastError })) : null,
        startError !== '' ? h('p', { className: 'hm-error' }, startError) : null),
    ]
    const actions = [h(ui.Button, {
      key: 'start',
      size: 'sm',
      variant: 'primary',
      disabled: starting,
      onClick: startSidecar,
    }, starting ? t('banner.starting') : t('banner.start'))]
    if (statusError !== '') {
      actions.push(h(ui.Button, { key: 'retry', size: 'sm', variant: 'outline', onClick: refresh }, t('common.retry')))
    }
    children.push(h('div', { key: 'actions', className: 'hm-bannerActions' }, actions))
    return h('section', { className: 'hm-banner', role: 'status' }, children)
  }

  const workspaceLabel = () => {
    const active = projects.items.find((item) => item.key === projectKey) ?? null
    return active?.title || statusProjectTitle || (projectKey !== '' ? shortId(projectKey) : t('project.none'))
  }

  // The workspace row selects the project and nothing else; the two memory
  // stores render as separate blocks underneath.
  const renderWorkspaceBar = () => h('div', { className: 'hm-projectBar' },
    h(PickerPill, {
      t,
      icon: 'folder',
      label: workspaceLabel(),
      title: t('project.workspace'),
      ariaLabel: t('project.select'),
      emptyText: t('project.empty'),
      items: projects.items.map((project) => ({
        key: project.key,
        title: project.title !== '' ? project.title : shortId(project.key),
      })),
      selected: projectKey,
      onSelect: (key) => {
        setProjectChoice(key)
        setSessionChoice(null)
        setLists(emptyLists())
        setPaging((prev) => ({
          ...prev,
          project: { ...prev.project, page: 1 },
          session: { ...prev.session, page: 1 },
        }))
      },
    }),
    h('span', { className: 'hm-divider', 'aria-hidden': 'true' }),
    h('span', { className: 'hm-projectCount' }, t('count.memories', { n: workspaceCount })),
    renderSearchField(),
    renderRefreshButton(),
    h('label', { className: 'hm-captureToggle', title: t('capture.disabledHint') },
      h('input', {
        type: 'checkbox',
        className: 'hm-captureCheck',
        checked: captureDisabled,
        disabled: captureBusy || projectKey === '' || permissions === null,
        'aria-label': t('capture.disabled'),
        onChange: (event) => { void toggleCapture(event.target.checked) },
      }),
      h('span', { className: 'hm-captureLabel' }, t('capture.disabled'))),
    captureError !== '' ? h('span', { className: 'hm-error' }, t('capture.failed', { message: captureError })) : null)

  const renderBlockHead = (title, count) => h('div', { className: 'hm-blockHead' },
    h('h3', { className: 'hm-blockTitle' }, title),
    h('span', { className: 'hm-meta' }, t('count.items', { n: count })))

  /** One list's footer: total, page navigation and the page-size selector. */
  const renderPager = (key, list) => {
    const { page, size } = paging[key]
    const total = asNumber(list.total)
    if (total <= 0) return null
    const pages = Math.max(1, Math.ceil(total / size))
    const changePage = (next) => {
      setPaging((prev) => ({ ...prev, [key]: { ...prev[key], page: next } }))
    }
    return h('div', { className: 'hm-pager' },
      h('span', { className: 'hm-pagerTotal' }, t('pager.total', { n: total })),
      h('div', { className: 'hm-pagerNav' },
        h('button', {
          type: 'button',
          className: 'hm-pageButton',
          'aria-label': t('pager.prev'),
          title: t('pager.prev'),
          disabled: page <= 1,
          onClick: () => { changePage(page - 1) },
        }, h(Icon, { name: 'chevronLeft', size: 14 })),
        h('span', { className: 'hm-pagerStatus' }, t('pager.page', { page, pages })),
        h('button', {
          type: 'button',
          className: 'hm-pageButton',
          'aria-label': t('pager.next'),
          title: t('pager.next'),
          disabled: page >= pages,
          onClick: () => { changePage(page + 1) },
        }, h(Icon, { name: 'chevronRight', size: 14 }))),
      h('label', { className: 'hm-pagerSize' },
        h('span', null, t('pager.size')),
        h('select', {
          className: 'hm-select',
          value: String(size),
          'aria-label': t('pager.size'),
          onChange: (event) => {
            const next = Number(event.target.value)
            setPaging((prev) => ({
              ...prev,
              [key]: { page: 1, size: PAGE_SIZES.includes(next) ? next : DEFAULT_PAGE_SIZE },
            }))
          },
        }, PAGE_SIZES.map((value) => h('option', { key: value, value: String(value) }, String(value))))))
  }

  // 项目记忆: the project tier on its own, no merge, no badge.
  const renderProjectBlock = () => h('section', { className: 'hm-block' },
    renderBlockHead(t('project.memories'), lists.project.total),
    renderListFace('project', (list) => h(React.Fragment, null,
      renderRows('project', list.items),
      renderPager('project', list)), 'empty.project'))

  // 会话记忆: the session tier grouped by session, with its own picker.
  const renderSessionBlock = () => h('section', { className: 'hm-block' },
    renderBlockHead(t('session.memories'), lists.session.total),
    renderSessionPicker(),
    renderSessionArea())

  // The tab row carries only the tabs; the switch lives in the header.
  const renderTabsRow = () => h('div', { className: 'hm-tabsRow' }, renderTabs())

  const renderTabs = () => h(ui.SegmentedTabs, {
    items: [
      { value: 'personal', label: t('tabs.personal'), id: 'hy-memory-tab-personal', panelId: 'hy-memory-panel-personal' },
      { value: 'project', label: t('tabs.workspace'), id: 'hy-memory-tab-project', panelId: 'hy-memory-panel-project' },
    ],
    value: tab,
    onChange: (value) => { setTab(value) },
    label: t('tabs.label'),
    size: 'sm',
  })

  const renderSearchField = () => h('label', { className: 'hm-searchField' },
    h(Icon, { name: 'search', size: 14 }),
    h('input', {
      type: 'search',
      className: 'hm-searchInput',
      value: query,
      placeholder: t('search.placeholder'),
      'aria-label': t('search.placeholder'),
      onChange: (event) => { setQuery(event.target.value) },
    }))

  const renderRefreshButton = () => h('button', {
    type: 'button',
    className: 'hm-iconButton',
    'aria-label': t('files.refresh'),
    title: t('files.refresh'),
    onClick: refresh,
  }, h(Icon, { name: 'refresh', size: 14 }))

  // 个人 keeps the 文件 header (label + search + refresh); the workspace tab has
  // no such header, but keeps the same search + refresh pair in its workspace row.
  const renderFilesHead = () => h('div', { className: 'hm-filesHead' },
    h('h2', { className: 'hm-filesTitle' }, t('files.title')),
    renderSearchField(),
    renderRefreshButton())

  const renderListFace = (tier, body, emptyKey) => {
    const list = lists[tier]
    if (list.loading && list.items.length === 0) {
      return h('div', { className: 'hm-state', role: 'status' },
        h(ui.StateDot, { state: 'ongoing' }),
        h('span', null, t('common.loading')))
    }
    if (list.error !== '') {
      return h('div', { className: 'hm-empty', role: 'alert' },
        h('p', { className: 'hm-error' }, t('list.error', { message: list.error })),
        h('div', { className: 'hm-row' },
          h(ui.Button, { size: 'sm', variant: 'outline', onClick: refresh }, t('common.retry'))))
    }
    if (list.items.length === 0) {
      return h('div', { className: 'hm-empty' },
        h('span', null, searchQuery !== ''
          ? t('empty.search', { query: searchQuery })
          : t(emptyKey ?? `empty.${tier}`)),
        searchQuery === '' ? h('span', { className: 'hm-emptyHint' }, t('empty.hint')) : null)
    }
    return h(React.Fragment, null,
      list.fallback ? h('p', { className: 'hm-muted' }, t('list.fallback')) : null,
      body(list))
  }

  const renderFileRow = (tier, item) => {
    const statusText = savedId === item.id
      ? t('row.saved')
      : copiedId === item.id
        ? t('row.copied')
        : copyFailedId === item.id ? t('row.copyFailed') : ''
    return h(FileRow, {
      key: item.id,
      t,
      title: memoryTitle(item.content, t('row.untitled')),
      date: memoryDate(item),
      status: statusText,
      content: item.content,
      expanded: expandedRow === item.id,
      onToggle: () => { setExpandedRow((current) => (current === item.id ? null : item.id)) },
      actions: rowActions(tier, item),
    })
  }

  const renderEditorRow = (item) => h('li', { key: item.id, className: 'hm-file hm-fileEditor' },
    h('textarea', {
      className: 'hm-textarea',
      rows: 3,
      value: editing.draft,
      'aria-label': t('row.edit'),
      onChange: (event) => { setEditing({ id: item.id, draft: event.target.value }) },
    }),
    rowError !== null && rowError.id === item.id
      ? h('p', { className: 'hm-error' }, t('row.saveFailed', { message: rowError.message }))
      : null,
    h('div', { className: 'hm-fileEditorActions' },
      h(ui.Button, {
        size: 'sm', variant: 'primary', disabled: savingId === item.id, onClick: saveEditing,
      }, savingId === item.id ? t('row.saving') : t('row.save')),
      h(ui.Button, { size: 'sm', variant: 'ghost', onClick: closeEditor }, t('row.cancel'))))

  const renderRows = (tier, items) => h('ul', { className: 'hm-files' },
    items.map((item) => (
      editing !== null && editing.id === item.id && tier === 'personal'
        ? renderEditorRow(item)
        : renderFileRow(tier, item)
    )))

  const renderPersonal = () => renderListFace('personal', (list) => h(React.Fragment, null,
    renderRows('personal', list.items),
    renderPager('personal', list)))

  // The session picker doubles as a filter: '' keeps every session group.
  const renderSessionPicker = () => {
    const items = [
      { key: '', title: t('session.all') },
      ...sessions.items.map((entry) => ({ key: entry.sessionId, title: shortId(entry.sessionId) })),
    ]
    return h('div', { className: 'hm-sessionBar' },
      h(PickerPill, {
        t,
        icon: 'hash',
        label: sessionFilter === '' ? t('session.all') : shortId(sessionFilter),
        title: t('session.picker'),
        ariaLabel: t('session.select'),
        emptyText: t('session.emptyPicker'),
        items,
        selected: sessionFilter,
        onSelect: (key) => {
          setSessionChoice(key)
          setPaging((prev) => ({ ...prev, session: { ...prev.session, page: 1 } }))
        },
      }))
  }

  /** Session rows grouped by session id, current session first. */
  const sessionGroups = () => {
    const groups = new Map()
    for (const item of lists.session.items) {
      if (!groups.has(item.sessionId)) groups.set(item.sessionId, [])
      groups.get(item.sessionId).push(item)
    }
    return [...groups.entries()]
      .map(([key, rows]) => ({
        key,
        rows,
        updatedAt: rows.reduce((max, row) => Math.max(max, asNumber(row.updatedAt)), 0),
      }))
      .sort((left, right) => {
        if (left.key === currentSessionId) return -1
        if (right.key === currentSessionId) return 1
        return right.updatedAt - left.updatedAt
      })
  }

  const renderSessionArea = () => {
    const list = lists.session
    if (list.loading && list.items.length === 0) {
      return h('div', { className: 'hm-state', role: 'status' },
        h(ui.StateDot, { state: 'ongoing' }),
        h('span', null, t('common.loading')))
    }
    if (list.error !== '') {
      return h('div', { className: 'hm-empty', role: 'alert' },
        h('p', { className: 'hm-error' }, t('list.error', { message: list.error })),
        h('div', { className: 'hm-row' },
          h(ui.Button, { size: 'sm', variant: 'outline', onClick: refresh }, t('common.retry'))))
    }
    const groups = sessionGroups()
    if (groups.length === 0) {
      return h('div', { className: 'hm-empty' },
        h('span', null, searchQuery !== ''
          ? t('empty.search', { query: searchQuery })
          : sessionFilter !== '' ? t('empty.session') : t('empty.sessions')))
    }
    return h(React.Fragment, null,
      groups.map((group) => h('section', {
        key: group.key === '' ? '__ungrouped__' : group.key,
        className: 'hm-group',
      },
      h('div', { className: 'hm-groupHead' },
        h('h4', { className: 'hm-groupLabel' },
          h(Icon, { name: 'hash', size: 13 }),
          group.key === '' ? t('row.ungrouped') : shortId(group.key)),
        h('span', { className: 'hm-meta' }, t('count.items', { n: group.rows.length }))),
      renderRows('session', group.rows))),
      renderPager('session', list))
  }

  // 个人 has no workspace scope at all: the file header (with search) starts the
  // panel. 项目与会话 scopes to a workspace, then shows 项目记忆 and 会话记忆 as
  // two independent blocks.
  const renderPersonalBody = () => h(React.Fragment, null, renderFilesHead(), renderPersonal())

  const renderWorkspaceBody = () => h(React.Fragment, null,
    renderWorkspaceBar(),
    renderProjectBlock(),
    renderSessionBlock())

  const renderTabBody = () => (tab === 'personal' ? renderPersonalBody() : renderWorkspaceBody())

  const renderDeleteModal = () => h(ui.Modal, {
    open: deleteTarget !== null,
    onClose: () => {
      if (deleting) return
      setDeleteTarget(null)
      setDeleteError('')
    },
    title: t('row.confirmDelete.title'),
    closeLabel: t('common.close'),
    footer: h('div', { className: 'hm-row' },
      h(ui.Button, {
        size: 'sm', variant: 'ghost', 'data-modal-autofocus': '',
        onClick: () => { setDeleteTarget(null); setDeleteError('') },
      }, t('row.confirmDelete.cancel')),
      h(ui.Button, { size: 'sm', variant: 'primary', disabled: deleting, onClick: confirmDelete },
        deleting ? t('common.loading') : t('row.confirmDelete.confirm'))),
  },
  deleteTarget !== null
    ? h('p', { className: 'hm-muted' }, t('row.confirmDelete.body', { tier: tierLabel(t, deleteTarget.tier) }))
    : null,
  deleteError !== '' ? h('p', { className: 'hm-error' }, t('row.deleteFailed', { message: deleteError })) : null)

  const renderWhyModal = () => {
    const result = why?.result ?? null
    const found = result !== null && result.found === true
    const fields = []
    if (found) {
      fields.push(h('div', { key: 'query', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('why.query')),
        h('span', { className: 'hm-fieldValue hm-mono' }, String(result.query ?? ''))))
      fields.push(h('div', { key: 'tier', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('why.tier')),
        h('span', { className: 'hm-fieldValue' }, tierLabel(t, String(result.tier ?? '')))))
      const score = asNumber(result.score)
      fields.push(h('div', { key: 'score', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('why.score')),
        h('span', { className: 'hm-fieldValue' }, Number.isFinite(score) ? score.toFixed(3) : String(result.score ?? ''))))
      fields.push(h('div', { key: 'rank', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('why.rank')),
        h('span', { className: 'hm-fieldValue' }, `#${asNumber(result.rank)}`)))
      fields.push(h('div', { key: 'at', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('why.at')),
        h('span', { className: 'hm-fieldValue' }, timeText(t, result.at, now))))
      const sourceKey = `why.source.${String(result.source ?? '')}`
      const sourceText = t(sourceKey)
      fields.push(h('div', { key: 'source', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('why.source')),
        h('span', { className: 'hm-fieldValue' }, sourceText === sourceKey ? String(result.source ?? '') : sourceText)))
    }
    let body
    if (whyLoading) {
      body = h('p', { className: 'hm-muted', role: 'status' }, t('common.loading'))
    } else if (whyError !== '') {
      body = h('p', { className: 'hm-error', role: 'alert' }, t('why.failed', { message: whyError }))
    } else if (found) {
      body = h('dl', { className: 'hm-grid' }, fields)
    } else {
      body = h('p', { className: 'hm-muted' }, t('why.never'))
    }
    return h(ui.Modal, {
      open: why !== null,
      onClose: () => { setWhy(null); setWhyError('') },
      title: t('why.title'),
      closeLabel: t('common.close'),
      footer: h('div', { className: 'hm-row' },
        h(ui.Button, {
          size: 'sm', variant: 'ghost', 'data-modal-autofocus': '',
          onClick: () => { setWhy(null); setWhyError('') },
        }, t('common.close'))),
    },
    why !== null ? h('p', { className: 'hm-muted' }, why.title) : null,
    body)
  }

  const renderPurgeModal = () => h(ui.Modal, {
    open: purgeOpen,
    onClose: () => {
      if (purgeBusy !== '') return
      setPurgeOpen(false)
      setPurgeText('')
      setPurgeError('')
    },
    title: t('purge.title'),
    closeLabel: t('common.close'),
    footer: h('div', { className: 'hm-row' },
      h(ui.Button, {
        size: 'sm', variant: 'ghost', 'data-modal-autofocus': '',
        onClick: () => { setPurgeOpen(false); setPurgeText(''); setPurgeError('') },
      }, t('row.confirmDelete.cancel')),
      h(ui.Button, {
        size: 'sm',
        variant: 'outline',
        className: 'hm-dangerAction',
        disabled: purgeBusy !== '' || purgeText.trim() !== 'PURGE',
        onClick: () => { void confirmPurge() },
      }, purgeBusy !== '' ? t('purge.busy') : t('purge.confirm'))),
  },
  h('p', { className: 'hm-muted' }, t('purge.body', { n: memoryTotal() ?? 0 })),
  h('label', { className: 'hm-field hm-purgeField' },
    h('span', { className: 'hm-fieldLabel' }, t('purge.hint')),
    h('span', { className: 'hm-inputWrap' },
      h('input', {
        type: 'text',
        className: 'hm-input',
        value: purgeText,
        placeholder: 'PURGE',
        'aria-label': t('purge.hint'),
        onChange: (event) => { setPurgeText(event.target.value) },
      }))),
  purgeError !== '' ? h('p', { className: 'hm-error', role: 'alert' }, t('purge.failed', { message: purgeError })) : null)

  const renderDupeModal = () => h(ui.Modal, {
    open: dupeOpen && dupeScan !== null,
    onClose: () => {
      if (dupeBusy === 'merge') return
      setDupeOpen(false)
      setDupeScan(null)
      setDupeError('')
    },
    title: t('dupes.confirm.title'),
    closeLabel: t('common.close'),
    footer: h('div', { className: 'hm-row' },
      h(ui.Button, {
        size: 'sm', variant: 'ghost', 'data-modal-autofocus': '',
        onClick: () => { setDupeOpen(false); setDupeScan(null); setDupeError('') },
      }, t('row.confirmDelete.cancel')),
      h(ui.Button, { size: 'sm', variant: 'primary', disabled: dupeBusy === 'merge', onClick: () => { void applyMerge() } },
        dupeBusy === 'merge' ? t('dupes.merging') : t('dupes.confirm.confirm'))),
  },
  dupeScan !== null
    ? h('p', { className: 'hm-muted' }, t('dupes.confirm.body', {
      rows: dupeScan.total,
      groups: dupeScan.groups.length,
    }))
    : null,
  dupeError !== '' ? h('p', { className: 'hm-error' }, t('dupes.failed', { message: dupeError })) : null)

  const renderForgetModal = () => h(ui.Modal, {
    open: forgetTarget !== null,
    onClose: () => {
      if (forgetting) return
      setForgetTarget(null)
      setForgetError('')
    },
    title: t('row.confirmForget.title'),
    closeLabel: t('common.close'),
    footer: h('div', { className: 'hm-row' },
      h(ui.Button, {
        size: 'sm', variant: 'ghost', 'data-modal-autofocus': '',
        onClick: () => { setForgetTarget(null); setForgetError('') },
      }, t('row.confirmDelete.cancel')),
      h(ui.Button, { size: 'sm', variant: 'primary', disabled: forgetting, onClick: confirmForget },
        forgetting ? t('common.loading') : t('row.confirmForget.confirm'))),
  },
  forgetTarget !== null
    ? h('p', { className: 'hm-muted' }, t('row.confirmForget.body'))
    : null,
  forgetError !== '' ? h('p', { className: 'hm-error' }, t('row.forgetFailed', { message: forgetError })) : null)

  // The activity poll lives in ActivityPanel; the section only seats it, so a
  // tick never re-renders the lists, the search box or an open inline editor.
  const renderActivity = () => h(ActivityPanel, { t })

  // Diagnostics keeps the one field that must be visible — the sidecar state —
  // plus its toggle; model, embedder, mode, scene and paths are one disclosure
  // away.
  const renderDiagnostics = () => {
    const model = status?.model ?? null
    const embedding = status?.embedding ?? null
    const dir = dataDirPath(status)
    const size = dataDirSize(status)
    const modelText = model?.ready
      ? [model.provider, model.model].filter(Boolean).join(' / ') || t('diag.ready')
      : t('diag.notReady')
    const embeddingText = `${embedding?.mode === 'remote' ? t('diag.remote') : embedding?.mode === 'local' ? t('diag.local') : embedding?.mode ?? t('diag.unknown')} · ${embedding?.ready ? t('diag.ready') : t('diag.notReady')}`
    const details = [
      h('div', { key: 'model', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('diag.model')),
        h('span', { className: 'hm-fieldValue' }, modelText)),
      h('div', { key: 'embedding', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('diag.embedding')),
        h('span', { className: 'hm-fieldValue' }, embeddingText)),
      h('div', { key: 'mode', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('diag.mode')),
        h('span', { className: 'hm-fieldValue' }, status?.mode ?? t('diag.unknown'))),
      h('div', { key: 'scene', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('diag.scene')),
        h('span', { className: 'hm-fieldValue' }, status?.scene ?? t('diag.unknown'))),
      h('div', { key: 'project', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('diag.project')),
        h('span', { className: 'hm-fieldValue' },
          status?.project?.title || (projectKey !== '' ? shortId(projectKey) : t('diag.unknown')))),
      h('div', { key: 'session', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('diag.session')),
        h('span', { className: 'hm-fieldValue' }, status?.session?.title || (currentSessionId !== '' ? shortId(currentSessionId) : t('diag.unknown')))),
    ]
    if (dir !== '') {
      details.push(h('div', { key: 'dir', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('diag.dataDir')),
        h('span', { className: 'hm-fieldValue hm-mono' }, dir)))
    }
    if (size !== '') {
      details.push(h('div', { key: 'size', className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('diag.dataSize')),
        h('span', { className: 'hm-fieldValue' }, size)))
    }
    const totalCount = memoryTotal()
    const context = status?.context ?? null
    const pending = Number.isFinite(Number(status?.capture?.pending)) ? Number(status.capture.pending) : null
    const memoryTokens = asNumber(context?.memoryTokens)
    const totalTokens = asNumber(context?.totalTokens)
    return h('section', { className: 'hm-card' },
      h('div', { className: 'hm-cardHead' },
        h('h2', { className: 'hm-h2' }, t('diag.title')),
        h(ui.Button, {
          size: 'sm', variant: 'ghost',
          onClick: () => { setDiagOpen((value) => !value) },
        }, diagOpen ? t('common.hideDetails') : t('common.details'))),
      h('div', { className: 'hm-field' },
        h('span', { className: 'hm-fieldLabel' }, t('diag.sidecar')),
        h('span', { className: 'hm-fieldValue' },
          h(ui.StateDot, { state: dotState(sidecar?.state) }),
          stateLabel(t, sidecar?.state),
          sidecar?.port ? h('span', { className: 'hm-mono' }, `:${sidecar.port}`) : null)),
      totalCount !== null
        ? h('p', { className: 'hm-countLine' }, t('counts.total', { n: totalCount }))
        : null,
      context !== null && (memoryTokens > 0 || totalTokens > 0)
        ? h('p', { className: 'hm-contextLine' }, t('diag.memoryTokens', { round: memoryTokens, total: totalTokens }))
        : null,
      pending !== null && pending > 0
        ? h('p', { className: 'hm-contextLine hm-pending' }, `${t('diag.pending', { n: pending })} · ${t('diag.pendingHint')}`)
        : null,

      h('div', { className: 'hm-dupeRow' },
        h(ui.Button, {
          size: 'sm',
          variant: 'outline',
          disabled: dupeBusy !== '',
          onClick: () => { void scanDuplicates() },
        }, dupeBusy === 'scan' ? t('dupes.scanning') : t('dupes.action')),
        dupeHint() !== ''
          ? h('span', {
            className: `hm-dupeHint${dupeError !== '' ? ' hm-error' : ''}`,
            role: 'status',
          }, dupeHint())
          : null,
        h(ui.Button, {
          size: 'sm',
          variant: 'outline',
          className: 'hm-dangerAction',
          disabled: purgeBusy !== '',
          onClick: () => {
            setPurgeText('')
            setPurgeError('')
            setPurgeDone(null)
            setPurgeOpen(true)
          },
        }, purgeBusy !== '' ? t('purge.busy') : t('purge.action')),
        purgeHint() !== ''
          ? h('span', {
            className: `hm-dupeHint${purgeError !== '' ? ' hm-error' : ''}`,
            role: 'status',
          }, purgeHint())
          : null),
      diagOpen ? h('dl', { className: 'hm-grid' }, details) : null,
      diagOpen ? h('pre', { className: 'hm-pre' }, JSON.stringify(status, null, 2)) : null)
  }

  // The engine is its own card: model choice and budget knobs are configuration,
  // not diagnostics, and the model field states explicitly whether it follows
  // the DSH default or pins a model.
  const renderEngine = () => {
    if (engine === null) return null
    const options = (status?.model?.options ?? [])
    const pinned = `${engine.provider}\u0000${engine.model}`
    const defaultModel = status?.model?.dshDefault ?? null
    const defaultLabel = defaultModel?.model || t('diag.unknown')
    const activeLabel = engine.provider === '' && engine.model === ''
      ? t('engine.summaryFollow', { model: defaultLabel })
      : t('engine.summaryPinned', { model: engine.model })
    const listed = options.some((option) => option.provider === engine.provider && option.model === engine.model)
    return h('section', { className: 'hm-card' },
      h('div', { className: 'hm-cardHead' },
        h('h2', { className: 'hm-h2' }, t('engine.title')),
        h(ui.Button, {
          size: 'sm', variant: 'ghost',
          onClick: () => { setEngineOpen((value) => !value) },
        }, engineOpen ? t('common.hideDetails') : t('common.details'))),
      h('p', { className: 'hm-muted' }, activeLabel),
      engineOpen ? h('div', null,
      h('p', { className: 'hm-muted' }, t('engine.modelHint')),
      h('div', { className: 'hm-engineGrid' },
        h('label', { className: 'hm-field' },
          h('span', { className: 'hm-fieldLabel' }, t('engine.model')),
          h('select', {
            className: 'hm-input',
            value: engine.provider === '' && engine.model === '' ? '' : pinned,
            onChange: (event) => {
              const value = String(event.target.value)
              if (value === '') {
                setEngine({ ...engine, provider: '', model: '' })
                return
              }
              const [provider, model] = value.split('\u0000')
              setEngine({ ...engine, provider, model })
            },
          },
          h('option', { value: '' }, t('engine.modelAuto', { model: defaultLabel })),
          engine.provider !== '' && engine.model !== '' && !listed
            ? h('option', { value: pinned }, t('engine.currentOption', { provider: engine.provider, model: engine.model }))
            : null,
          options.map((option) => h('option', {
            key: `${option.provider}:${option.model}`,
            value: `${option.provider}\u0000${option.model}`,
          }, option.label)))),
        h('label', { className: 'hm-field' },
          h('span', { className: 'hm-fieldLabel' }, t('engine.maxTokens')),
          h('input', {
            className: 'hm-input', type: 'number', min: '256', step: '256',
            value: engine.maxTokens,
            onChange: (event) => setEngine({ ...engine, maxTokens: event.target.value }),
          })),
        h('label', { className: 'hm-field' },
          h('span', { className: 'hm-fieldLabel' }, t('engine.timeoutMs')),
          h('input', {
            className: 'hm-input', type: 'number', min: '1000', step: '1000',
            value: engine.timeoutMs,
            onChange: (event) => setEngine({ ...engine, timeoutMs: event.target.value }),
          })),
        h('label', { className: 'hm-field' },
          h('span', { className: 'hm-fieldLabel' }, t('engine.halfLife')),
          h('input', {
            className: 'hm-input', type: 'number', min: '0', step: '1',
            value: engine.halfLifeDays,
            onChange: (event) => setEngine({ ...engine, halfLifeDays: event.target.value }),
          })),
        h('label', { className: 'hm-field' },
          h('span', { className: 'hm-fieldLabel' }, t('engine.concurrency')),
          h('input', {
            className: 'hm-input', type: 'number', min: '1', max: '4', step: '1',
            value: engine.concurrency,
            onChange: (event) => setEngine({ ...engine, concurrency: event.target.value }),
          })),
        h('label', { className: 'hm-field' },
          h('span', { className: 'hm-fieldLabel' }, t('engine.maxPerDrain')),
          h('input', {
            className: 'hm-input', type: 'number', min: '1', max: '50', step: '1',
            value: engine.maxPerDrain,
            onChange: (event) => setEngine({ ...engine, maxPerDrain: event.target.value }),
          })),
        h('label', { className: 'hm-field' },
          h('span', { className: 'hm-fieldLabel' }, t('engine.maxAttempts')),
          h('input', {
            className: 'hm-input', type: 'number', min: '1', max: '50', step: '1',
            value: engine.maxAttempts,
            onChange: (event) => setEngine({ ...engine, maxAttempts: event.target.value }),
          })),
        h('label', { className: 'hm-captureToggle' },
          h('input', {
            className: 'hm-captureCheck', type: 'checkbox',
            checked: engine.disableReasoning !== false,
            onChange: (event) => setEngine({ ...engine, disableReasoning: event.target.checked }),
          }),
          t('engine.disableReasoning'))),
      h('p', { className: 'hm-muted' }, t('engine.hint')),
      h('div', { className: 'hm-row' },
        h(ui.Button, { size: 'sm', variant: 'primary', disabled: engineBusy, onClick: () => { void saveEngine() } },
          engineBusy ? t('engine.saving') : t('engine.save'))),
      engineError !== '' ? h('p', { className: 'hm-error', role: 'alert' }, t('engine.failed', { message: engineError })) : null) : null)
  }

  // MemHub is a separate product; its card reads the detection folded into
  // status and keeps all import state local to the card.
  const renderMemhub = () => h(MemhubCard, {
    t,
    memhub: status?.memhub ?? null,
    onImported: refresh,
  })

  /** The repository link the host reports (a trailing .git is not a web URL). */
  const repoUrl = (() => {
    const raw = typeof status?.package?.repoUrl === 'string' ? status.package.repoUrl : ''
    return raw.replace(/\.git$/, '')
  })()

  // Quiet notice from the automatic check: only when a newer release exists.
  const renderAutoNotice = () => {
    if (autoUpdate === null || autoUpdate.behind !== true || autoUpdate.latest === '') return null
    const version = t('update.newVersion', { version: autoUpdate.latest })
    return h('div', { className: 'hm-updateNotice', role: 'status' },
      autoUpdate.url !== ''
        ? h('a', {
          className: 'hm-updatePill',
          href: autoUpdate.url,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, version)
        : h('span', { className: 'hm-updatePill' }, version),
      h('span', { className: 'hm-updateHint' }, t('update.manualHint')))
  }

  const renderUpdateResult = () => {
    if (checking || updateResult === null) return null
    if (updateResult.error !== '') {
      return h('span', { className: 'hm-footerResult hm-error', title: updateResult.error }, t('update.failed'))
    }
    if (updateResult.behind) {
      return h('span', { className: 'hm-footerResult' },
        t('update.behind', { version: updateResult.latest }),
        ' ',
        updateResult.url !== ''
          ? h('a', { href: updateResult.url, target: '_blank', rel: 'noopener noreferrer' }, t('update.open'))
          : null)
    }
    return h('span', { className: 'hm-footerResult' },
      t('update.latest', { version: updateResult.latest || updateResult.current }))
  }

  const renderFooter = () => h('footer', { className: 'hm-footer' },
    h('div', { className: 'hm-footerLeft' },
      repoUrl !== ''
        ? h('a', {
          className: 'hm-footerLink',
          href: repoUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          'aria-label': t('update.repo'),
          title: repoUrl,
        }, h(GitHubMark, { size: 16 }))
        : null,
      renderAutoNotice()),
    h('div', { className: 'hm-footerRight' },
      renderUpdateResult(),
      h(ui.Button, {
        size: 'sm',
        variant: 'outline',
        disabled: checking,
        onClick: () => { void checkUpdate() },
      }, checking ? t('update.checking') : t('update.check'))))

  // With the master switch off the whole body disappears; the header and its
  // switch stay, so the panel can always be turned back on.
  if (masterOff) {
    return h('section', { className: 'hm-panel', 'aria-label': t('section.title') },
      panelStyles(),
      renderHeader())
  }

  return h('section', { className: 'hm-panel', 'aria-label': t('section.title') },
    panelStyles(),
    renderHeader(),
    renderSidecarBanner(),
    renderTabsRow(),
    h('div', {
      role: 'tabpanel',
      id: `hy-memory-panel-${tab}`,
      'aria-labelledby': `hy-memory-tab-${tab}`,
      className: 'hm-panelBody',
    },
    renderTabBody()),
    renderActivity(),
    renderDiagnostics(),
    renderEngine(),
    renderMemhub(),
    renderFooter(),
    renderDeleteModal(),
    renderForgetModal(),
    renderDupeModal(),
    renderWhyModal(),
    renderPurgeModal())
}

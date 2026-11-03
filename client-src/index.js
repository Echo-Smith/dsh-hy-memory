/**
 * Client half of @local/dsh-hy-memory.
 *
 * One settings section (`settings.section`, id `hy-memory`) hosts the memory
 * manager. An optional keyed tab type (`sidebarRightTabs` + the
 * `sidebar.right.pane.tab` seat, key `hy-memory`) shows the active session's
 * memory when the `ui.sessionPanel` setting is on. No sidebar navigation row is
 * contributed: management lives under Settings.
 */
import * as React from 'react'
import { api, getSessionPanelEnabled, loadStatus } from './api.js'
import { NS, dictionaries } from './locale.js'
import { SettingsSection } from './panel.js'
import { SessionMemoryView } from './session-panel.js'
import { Icon, PanelErrorBoundary, useLocaleSubscription } from './ui.js'

const SECTION_ID = 'hy-memory'
const TAB_ID = 'hy-memory'
const TAB_KIND = 'hy-memory'
const NAV_STYLE_ID = 'hy-memory-nav-glyph'

/**
 * The settings nav row glyph.
 *
 * `settings.section` has no icon field, but the shipped shell renders the
 * section label as React children (`resolveSlotLabel` returns the thunk value
 * untouched, and settings-general does `jsx("span", {children: row.label})`), so
 * the thunk may return a node. The shell still paints its own generic gear
 * before the label for any id it does not recognise, so one scoped rule in
 * `NAV_CSS` hides that svg; the label node itself needs no global styles.
 */
const NAV_CSS = [
  '.hm-navLabel{display:inline-flex;align-items:center;gap:8px;min-width:0}',
  '.hm-navBrain{flex:none;color:currentColor}',
  'button:has(> span > .hm-navLabel) > svg:first-child{display:none}',
].join('')

/** The nav label node: an outlined brain plus the translated name. */
function navLabelNode(t) {
  return React.createElement('span', { className: 'hm-navLabel' },
    React.createElement(Icon, {
      name: 'brain',
      size: 16,
      strokeWidth: 1.5,
      className: 'hm-navBrain',
      style: { flex: 'none' },
    }),
    React.createElement('span', { className: 'hm-navText' }, t('nav.label')))
}

/** Install the one scoped stylesheet for the nav row; safe to call on every boot. */
function installNavGlyph() {
  if (typeof document === 'undefined' || document.head === undefined || document.head === null) {
    return () => {}
  }
  if (document.getElementById(NAV_STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = NAV_STYLE_ID
  style.textContent = NAV_CSS
  document.head.appendChild(style)
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style)
  }
}

export const inject = ['slots', 'locale']

/** The host synthesizes `t` from the declared locale namespace; keep a fallback seat. */
function translatorOf(props) {
  if (typeof props.t === 'function') return props.t
  if (typeof props.translate === 'function') return props.translate
  return (key) => key
}

function HyMemorySection(props) {
  useLocaleSubscription(props)
  const t = translatorOf(props)
  return React.createElement(PanelErrorBoundary, { t },
    React.createElement(SettingsSection, { ...props, t }))
}

function HyMemorySessionPane(props) {
  useLocaleSubscription(props)
  const t = translatorOf(props)
  return React.createElement(PanelErrorBoundary, { t },
    React.createElement(SessionMemoryView, { ...props, t }))
}

/**
 * Register the optional session tab type and its body.
 * @param ctx - context carrying `sidebarRightTabs` and `slots`.
 * @param deps - locale binding and API handles for the pane.
 * @returns disposer removing everything installed here.
 */
function installSessionPanel(ctx, deps) {
  const stops = []
  if (ctx.sidebarRightTabs !== undefined && typeof ctx.sidebarRightTabs.register === 'function') {
    try {
      stops.push(ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        title: () => deps.t('session.tabTitle'),
        guide: [{
          id: TAB_ID,
          order: 40,
          title: () => deps.t('session.tabTitle'),
          description: () => deps.t('session.tabDesc'),
        }],
      }))
    } catch (error) {
      // A stale registration from a hot reload must not take the settings panel
      // down with it; the seat below is independent.
      console.error('hy-memory: session tab type could not be registered', error)
    }
  }
  try {
    stops.push(ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: TAB_ID,
      locale: NS,
      inject: (sessionId) => ({
        sessionId,
        translate: deps.t,
        api,
        subscribeLocale: deps.subscribeLocale,
        localeSnapshot: deps.localeSnapshot,
      }),
    }, HyMemorySessionPane)))
  } catch (error) {
    console.error('hy-memory: session pane seat could not be registered', error)
  }
  return () => {
    for (const stop of stops.reverse()) {
      try {
        stop()
      } catch {
        // Disposal is best-effort: one failed stop must not strand the rest.
      }
    }
  }
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(NS, dictionaries),
    'hy-memory: bilingual dictionaries',
  )
  const t = ctx.locale.bind(NS)
  const subscribeLocale = (listener) => (typeof ctx.on === 'function' ? ctx.on('locale/change', listener) : () => {})
  const localeSnapshot = () => {
    try {
      return ctx.locale.getLocale?.()?.active ?? ''
    } catch {
      return ''
    }
  }

  // Warm the shared status read: the settings panel and the optional pane both
  // consume it, and a failed read is retried when a view opens.
  void loadStatus().catch(() => {})

  ctx.effect(installNavGlyph, 'hy-memory: settings nav glyph')

  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: 30,
    label: () => navLabelNode(t),
    locale: NS,
    inject: () => ({ translate: t, api, subscribeLocale, localeSnapshot }),
  }, HyMemorySection)), 'hy-memory: settings section')

  // The session pane is optional: read `ui.sessionPanel` once, then contribute
  // the tab type and its body. A false flag contributes neither, so the sidebar
  // offers no Memory tab at all.
  ctx.effect(() => {
    let disposed = false
    let release = null
    void getSessionPanelEnabled().then((enabled) => {
      if (disposed || !enabled) return
      if (typeof ctx.inject !== 'function') return
      release = ctx.inject(['sidebarRightTabs', 'slots'], (paneCtx) => {
        if (disposed) return () => {}
        return installSessionPanel(paneCtx, { t, subscribeLocale, localeSnapshot })
      })
    }).catch(() => {})
    return () => {
      disposed = true
      if (typeof release === 'function') {
        try {
          release()
        } catch {
          // The owning fiber already tore down its registrations.
        }
      }
    }
  }, 'hy-memory: optional session panel')
}

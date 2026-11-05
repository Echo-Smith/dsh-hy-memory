/**
 * Client half of dsh-hy-memory.
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

/**
 * Register the dictionaries without assuming the namespace is empty.
 *
 * A page sync can apply this bundle again before the previous effect disposes.
 * The locale service keeps one owner per (namespace, locale) and throws on a
 * second registration, which used to fail the whole plugin sync. Register what
 * is free, retry the rest once the old owner has had a chance to dispose, and
 * let a still-occupied locale keep the identical dictionaries it already has.
 */
function installDictionaries(ctx) {
  const stops = []
  try {
    const stop = ctx.locale.register(NS, dictionaries)
    if (typeof stop === 'function') stops.push(stop)
    return () => disposeAll(stops)
  } catch (error) {
    if (!String(error?.message ?? '').includes('already has locale')) throw error
  }
  // The namespace is occupied by an earlier application of this bundle. Register
  // only the locales it does not own yet, then retry the rest once it disposes.
  const occupied = []
  for (const [locale, dict] of Object.entries(dictionaries)) {
    try {
      const stop = ctx.locale.register(NS, locale, dict)
      if (typeof stop === 'function') stops.push(stop)
    } catch (error) {
      if (!String(error?.message ?? '').includes('already has locale')) throw error
      occupied.push([locale, dict])
    }
  }
  let timer = null
  if (occupied.length > 0) {
    timer = setTimeout(() => {
      timer = null
      for (const [locale, dict] of occupied.splice(0)) {
        try {
          const stop = ctx.locale.register(NS, locale, dict)
          if (typeof stop === 'function') stops.push(stop)
        } catch {
          // The previous owner still holds it; its dictionaries are identical.
        }
      }
    }, 50)
    timer.unref?.()
  }
  return () => {
    if (timer !== null) clearTimeout(timer)
    disposeAll(stops)
  }
}

function disposeAll(stops) {
  for (const stop of stops.reverse()) {
    try {
      stop()
    } catch {
      // Disposal is best-effort.
    }
  }
}

export function apply(ctx) {
  ctx.effect(() => installDictionaries(ctx), 'hy-memory: bilingual dictionaries')
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

  // A page sync can register this section while the previous instance still
  // holds the seat. Shadowing it produced two identical nav rows, so wait for
  // the old owner to dispose instead of adding a second seat: the old instance
  // already renders the same panel, and a retry picks the seat up afterwards.
  const registerSection = () => {
    let seat = null
    const timers = []
    const attempt = () => {
      if (seat !== null) return
      try {
        seat = ctx.slots.register({
          name: 'settings.section',
          id: SECTION_ID,
          order: 30,
          label: () => navLabelNode(t),
          locale: NS,
          inject: () => ({ translate: t, api, subscribeLocale, localeSnapshot }),
        }, HyMemorySection)
      } catch (error) {
        const message = String(error?.message ?? '')
        if (!message.includes('already has an entry with id') && !message.includes('already has a registration')) throw error
      }
    }
    attempt()
    if (seat === null) {
      for (const delay of [250, 1000, 2500]) {
        timers.push(setTimeout(attempt, delay))
      }
      for (const timer of timers) timer.unref?.()
    }
    return () => {
      for (const timer of timers) clearTimeout(timer)
      if (seat !== null) {
        try {
          seat()
        } catch {
          // Disposal is best-effort.
        }
      }
    }
  }
  ctx.effect(() => ctx.slots.inject('settings.section', registerSection), 'hy-memory: settings section')

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

/**
 * Optional session-view pane: the current session's memories and the memories
 * of its project, rendered in the right sidebar's `sidebar.right.pane.tab`
 * keyed seat. Read-only; management lives under Settings > Memory.
 */
import * as React from 'react'
import { api } from './api.js'
import {
  h, ui, useLocaleSubscription, errorMessage, asArray, asNumber, normalizeItem,
  timeText, stateLabel, dotState, panelStyles,
} from './ui.js'

function settledList(result) {
  if (result.status === 'fulfilled') {
    const data = result.value
    const items = asArray(data?.items).map(normalizeItem)
    return { loading: false, error: '', items, total: asNumber(data?.total, items.length) }
  }
  return { loading: false, error: errorMessage(result.reason), items: [], total: 0 }
}

function headList() {
  return { loading: true, error: '', items: [], total: 0 }
}

/** The sidebar pane body. Stable module-level component: never recreate the type. */
export function SessionMemoryView(props) {
  const t = typeof props.t === 'function' ? props.t : typeof props.translate === 'function' ? props.translate : (key) => key
  const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
  useLocaleSubscription(props)

  const [status, setStatus] = React.useState(null)
  const [statusError, setStatusError] = React.useState('')
  const [sessionList, setSessionList] = React.useState(headList)
  const [projectList, setProjectList] = React.useState(headList)
  const [tick, setTick] = React.useState(0)
  const now = Date.now()

  React.useEffect(() => {
    let cancelled = false
    setStatusError('')
    setSessionList(headList)
    setProjectList(headList)
    const run = async () => {
      let current = null
      try {
        current = tick === 0 ? await api.loadStatus() : await api.readStatus()
      } catch (error) {
        if (cancelled) return
        setStatusError(errorMessage(error))
        setSessionList((prev) => ({ ...prev, loading: false, error: errorMessage(error) }))
        setProjectList((prev) => ({ ...prev, loading: false, error: errorMessage(error) }))
        return
      }
      if (cancelled) return
      setStatus(current ?? null)
      const projectKey = current?.project?.key ?? ''
      const results = await Promise.allSettled([
        sessionId === ''
          ? Promise.reject(new Error(t('session.noSession')))
          : api.list({ tier: 'session', sessionId, limit: 100 }),
        api.list({ tier: 'project', ...(projectKey === '' ? {} : { projectKey }), limit: 100 }),
      ])
      if (cancelled) return
      setSessionList(settledList(results[0]))
      setProjectList(settledList(results[1]))
    }
    void run()
    return () => { cancelled = true }
  }, [sessionId, tick])

  const renderRows = (list, emptyKey) => {
    if (list.loading) {
      return h('div', { className: 'hm-state', role: 'status' },
        h(ui.StateDot, { state: 'ongoing' }),
        h('span', null, t('common.loading')))
    }
    if (list.error !== '') {
      return h('div', { className: 'hm-empty', role: 'alert' },
        h('p', { className: 'hm-error' }, t('session.error', { message: list.error })))
    }
    if (list.items.length === 0) {
      return h('div', { className: 'hm-empty' }, t(emptyKey))
    }
    return h('ul', { className: 'hm-rows' }, list.items.map((item) => h('li', {
      key: item.id,
      className: 'hm-rowCard',
    },
    h('p', { className: 'hm-content' }, item.content === '' ? t('row.noContent') : item.content),
    h('div', { className: 'hm-meta' },
      item.layer !== '' ? h(ui.Tag, { key: 'layer', tone: 'neutral' }, `${t('row.layer')}: ${item.layer}`) : null,
      item.updatedAt ? h('span', { key: 'time' }, t('row.updatedAt', { time: timeText(t, item.updatedAt, now) })) : null))))
  }

  const renderSection = (title, list, emptyKey) => h('section', { className: 'hm-card' },
    h('div', { className: 'hm-cardHead' },
      h('h2', { className: 'hm-h2' }, title),
      h('span', { className: 'hm-meta' }, t('counts.total', { n: list.items.length }))),
    renderRows(list, emptyKey))

  return h('section', { className: 'hm-panel hm-sessionPanel', 'aria-label': t('session.tabTitle') },
    panelStyles(),
    h('header', { className: 'hm-header' },
      h('div', null,
        h('h2', { className: 'hm-h2' }, t('session.tabTitle')),
        h('p', { className: 'hm-subtitle' }, t('session.tabDesc'))),
      h('div', { className: 'hm-headerActions' },
        h(ui.Button, { size: 'sm', variant: 'outline', onClick: () => { setTick((value) => value + 1) } }, t('common.refresh')))),
    statusError !== ''
      ? h('div', { className: 'hm-empty', role: 'alert' },
        h('p', { className: 'hm-error' }, t('session.error', { message: statusError })))
      : null,
    status?.sidecar !== undefined
      ? h('div', { className: 'hm-counts' },
        h(ui.StateDot, { state: dotState(status?.sidecar?.state) }),
        h('span', null, stateLabel(t, status?.sidecar?.state)))
      : null,
    sessionId === ''
      ? h('div', { className: 'hm-empty' }, t('session.noSession'))
      : renderSection(t('session.title'), sessionList, 'session.empty'),
    renderSection(t('session.projectTitle'), projectList, 'session.emptyProject'))
}

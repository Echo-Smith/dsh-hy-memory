# Interface contract (host half <-> client half)

Package: `@local/dsh-hy-memory` in this directory. Host entry `index.js`, client entry `client.js`
(hand-written lazy-CJS or esbuild output), data under `$DSH_HOME/integrations/hy-memory/`.

## Three tiers (hy_memory namespaces)

One hy_memory client, three namespaces. `user` is the local DSH user (`dsh` by default; settings can override).

| Tier | user_id | agent_id | session_id |
|---|---|---|---|
| personal | `<user>` | `personal` | `personal` |
| project  | `<user>` | `project:<key>` | `project` |
| session  | `<user>` | `project:<key>` | `<dsh session id>` |

`project:<key>`: `key = sha1(workspace cwd).slice(0,12)`, stored in `state.json` as `projects[<key>] = { path, title }`.

Recall runs three searches and merges:
1. personal `{ user_ids:[user], agent_ids:['personal'] }`
2. project `{ user_ids:[user], agent_ids:[projectKey], session_ids:['project'] }`
3. session `{ session_ids:[sessionId] }`

Delete rules: personal is editable (`PUT /api/v1/memories/:id`), never deletable from the panel.
Project and session tiers are deletable (`DELETE /api/v1/memories/:id`). No `delete_all` from the panel.

## Scenes

`scene` is chosen per captured batch and passed to `add()`:
- `coding` when the batch contains file-editing tools (`edit`, `write`, `str_replace`, `apply_patch`, shell with git/cargo/pnpm/test...)
- `working` when it contains other tools (todo, plan, jobs, subagents, read-only shells)
- `chat` otherwise

`working`/`coding` require tool messages inside the payload or the SDK falls back to chat.

## Panel HTTP routes

Host registers exact Fetch routes on `ctx.connection` (path is below `/api`, owner-only).
Client calls plain same-origin `fetch('/api/hy-memory/<verb>', { method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body })`.
Every response is JSON. Errors: `{ ok:false, error:{ code, message } }` with HTTP 4xx/5xx.

| Route | Request | Response |
|---|---|---|
| `POST /api/hy-memory/status` | `{}` | `{ ok:true, data:{ enabled, sidecar:{state,port,pid,startedAt,lastError,venvReady}, model:{ready,provider,model,source}, counts:{personal,project,session}, scene, mode, embedding:{mode,ready}, project:{key,path,title}, session:{id,title} } }` |
| `POST /api/hy-memory/list` | `{ tier, projectKey?, sessionId?, query?, limit?, offset? }` | `{ ok:true, data:{ items:[MemoryItem], total, offset, limit } }` |
| `POST /api/hy-memory/update` | `{ tier:'personal', id, content }` | `{ ok:true, data:{ item } }` |
| `POST /api/hy-memory/delete` | `{ tier:'project'\|'session', id }` | `{ ok:true, data:{ deleted:true } }` |
| `POST /api/hy-memory/search` | `{ query, tiers?, limit? }` | `{ ok:true, data:{ groups:{personal:[], project:[], session:[]} } }` |
| `POST /api/hy-memory/settings/get` | `{}` | `{ ok:true, data:{ settings } }` |
| `POST /api/hy-memory/settings/set` | `{ patch }` | `{ ok:true, data:{ settings } }` |
| `POST /api/hy-memory/activity` | `{ since? }` | `{ ok:true, data:{ events:[ActivityEvent], cursor } }` |
| `POST /api/hy-memory/start` | `{}` | start/restart the sidecar, same shape as status |

`MemoryItem`: `{ id, content, tier, layer, status, tags, createdAt, updatedAt, score?, projectKey?, sessionId? }`.
`ActivityEvent`: `{ at, kind:'recall'|'capture'|'promote'|'delete'|'update'|'error'|'sidecar', tier?, summary, detail?, ok }`.

## Settings (JSON at `$DSH_HOME/integrations/hy-memory/settings.json`)

Defaults live in `src/settings.js`. Panel writes patches through `settings/set`; the host merges and persists.
`llm.source` is `dsh` by default (resolved from `$DSH_HOME/settings.yaml` providers plus `$DSH_HOME/.env` keys).
`embedding.mode` is `local` by default (ONNX MiniLM, 384 dims, injected by `bridge/hy_bridge.py`); `remote` uses
`embedding.baseURL/model/apiKey/dims`. Never require the user to configure anything for the default path.

## Client surfaces

- `settings.section` (id `hy-memory`): the memory manager. Tabs: personal / project / session, plus a
  "write activity" list and a diagnostics card (sidecar, model, embedding, counts). Search box filters all
  tiers. Personal rows expose edit + save; project and session rows expose delete with confirmation.
  Empty states, loading states and a startup hint when the sidecar is not ready are required.
- Session view: `ctx.sidebarRightTabs.register` + keyed slot `sidebar.right.pane.tab`, showing the current
  session memory and the project memory; a settings toggle `ui.sessionPanel` (default on) hides it.
- No sidebar navigation row (`sidebar.panellist`) by default. All management lives under Settings > Memory.

## Host seams to use

- injection: `ctx.on('agent/pre-step', async (payload, next) => {...}, { prepend: true })`, append a sourced
  `UserMessage` to `decision.messages` (copy the message construction in
  `packages/context/agent-instructions/src/index.ts`).
- capture: `ctx.on('session/event', (session, event) => ...)` switching on `event.type`
  (`turn/end`, `user/message`, `assistant/message`, `tool/call`, `tool/result`).
- tools: `ctx.tools.register({ name, description, parameters, output:{ schema, render }, execute })`.
- model for promotion: `ctx.llm.stream({ provider, model, messages, signal })` from the session's selection.

## MemHub link (addendum)

The user requirement is "DSH memory stands alone, and can connect to MemHub". Concretely:

| Need | Route | Behaviour |
|---|---|---|
| detect | folded into `POST /api/hy-memory/status` | `memhub: { detected, path, sizeBytes, stores: {...} }` from `~/.one-memory` (env `ONE_MEMORY_HOME` overrides) |
| export ours | `POST /api/hy-memory/memhub/export` | page our own store (`bridgeList`, `scene:'all'`) and write `$DSH_HOME/integrations/hy-memory/exports/hy-memory-<ISO>.json`; return `{ path, count, bytes }` |
| import theirs | `POST /api/hy-memory/memhub/import` | body `{ path? }`. Reads a JSON file (our export shape, or an array of `{content, tags?, createdAt?}`), writes every entry into the **personal** tier through the sidecar with dedupe by content hash kept in `state.json`; returns `{ imported, skipped, failed, path }` |
| pull from MemHub | `POST /api/hy-memory/memhub/pull` | uses `$DSH_HOME/integrations/hy-memory/venv/bin/python` with `bridge/memhub_pull.py` to read MemHub's own hy-memory store (`~/.one-memory/hy-memory`) **read-only**, printing a JSON array; the host then imports it like `memhub/import`. If the store is locked by a running MemHub runtime, report `memhub_locked` and do nothing. |

Guards: never write into `~/.one-memory`; never import into project or session tiers; cap imports at 500 entries per call;
record an activity event per import; keep the original file untouched. The panel shows a MemHub card with detection state,
the two buttons and the last result.

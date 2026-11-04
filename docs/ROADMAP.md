# Roadmap

Sequenced from the audit that followed the first public release. Each phase is independently shippable and ends in a check that runs without a browser.

## Done in this pass

| Unit | Check |
|---|---|
| Recall evaluation harness (`scripts/eval-recall.mjs`) | `npm run eval:recall` prints per-case verdicts and aggregate size; it caught the budget bug where one oversize memory ignored `maxChars` |
| Recall budget fix (truncate an oversize first item instead of injecting it whole) | same harness, plus `npm test` 85/85 |
| CI on GitHub Actions (syntax, host tests, panel smoke, recall eval) | workflow file, all four steps run locally |

## Phase 1: recall quality (done)

`scripts/eval-live.mjs` drives the real pipeline against a running sidecar. Fixtures hold queries and expected keywords only, never memory text.

- Baseline with the shipped defaults (minScore 0.32, maxChars 1600, maxItems 5): 6/10 hits, 805 average injected characters, 94 ms average latency.
- Two real defects surfaced. Search results carried no `session_id`, so the session tier could never match; the bridge now enriches rows from one cached listing. The lexical fallback only ran when every tier came back empty, so a single wrong low-score hit suppressed keyword recall; it now tops up whenever selection lands under the item budget.
- Tuned defaults (minScore 0.56, maxChars 1200, maxItems 5): 9/10 hits, 941 average characters, 149 ms latency.
- Caveat: ten fixtures from one store. The threshold is tuned for a Chinese user on an English embedder, where most recalls now resolve through the keyword path. Re-measure after changing the embedder.

Remaining Phase 1 work: fixtures from other projects, an English-only fixture set, and a separate measurement of wrong-but-plausible items.

## Phase 2: embeddings (partly done)

- Verified `embedding.mode: remote` end to end with `scripts/mock-embeddings.mjs`: a 1024-dimension OpenAI-compatible endpoint, a sidecar indexing against it, and a query of the stored text returning score 1.0. No multilingual provider was available to test against, so the quality claim is still open.
- Lexical fallback rate is now measured: the host counts how many recall turns resolved through the keyword path, exposed as `status.context.lexicalTurns / turns`, and the live harness prints the percentage.
- Migration tool shipped: `scripts/migrate-embeddings.mjs` reads a source sidecar, writes a timestamped backup, and re-adds text to a second sidecar. Dry run by default; writing needs `--apply --confirm YES-MIGRATE`. Verified with three memories across two pro stores (3 written, 0 failed; target search returned the migrated text; source totals unchanged).
- Still open: a real multilingual provider to measure quality, and workspace-scope preservation for coding and working rows (the list route does not return it).

## Phase 3: memory lifecycle (started)

- Done: time decay in recall ranking. `recall.halfLifeDays` defaults to 30, thresholding still uses the raw score, and items without timestamps skip the weighting. Three tests cover ordering and the off switch.
- Done: `memory_forget` deletes a memory and records its text hash; promotion filters lines whose hash was forgotten. Ordinary delete stays non-blocking.
- Done: opt-in capacity guard. `lifecycle.archiveOnCap` appends the oldest overflow rows to a JSONL archive under the integration directory, then deletes them; off by default. Covered by a test that archives and removes exactly the overflow.
- Done: `/api/hy-memory/duplicates` groups identical text keeping the newest, `/api/hy-memory/merge` deletes the listed rows, and the panel exposes one 整理重复项 button with a confirmation that names rows and groups. Tests cover the host grouping and delete, plus the panel scan, empty state, confirmation copy and merge bodies.
- Measured headroom: the live store holds 106 rows (86 chat, 17 coding, 3 working) against a 2000 cap, so the cap is not the next bottleneck; a real-store cap run is deferred until it matters.

## Phase 4: explainable recall (started)

- Done (host): each injection appends `{at, query, source, items:[{id, tier, score, rank}]}` to `state.json` `recallLog`, capped at 50. `POST /api/hy-memory/explain {id}` returns the newest entry containing that id; test covers newest-wins and the not-found case.
- In flight: the panel row action that shows the explanation (query, tier, score, rank, time).
- Still open: linking an activity-feed recall to the exact injected text.

## Phase 5: privacy and permission (started)

- Done: credential filtering at the capture boundary. `looksSensitive` drops any message matching API keys, GitHub/AWS/Slack tokens, bearer headers, private-key blocks or `password=` patterns; tested against a key-bearing turn.
- Done: `permissions.disabledCaptureProjects` skips capture for listed project keys.
- Done: `POST /api/hy-memory/purge {confirm:'PURGE'}` archives every memory to JSONL then deletes it; test covers the refusal without confirmation and the archive-then-delete path.
- Done: panel surface. 彻底清除 requires typing PURGE, states the live total, archives then deletes, and surfaces host refusals; 不捕获此项目 sits in the workspace row and writes `permissions.disabledCaptureProjects`. Smoke covers the gate, the refusal path and the settings payload.
- Cut: the per-session switch, after review. One global pause plus the per-project switch cover the real cases; a session-scoped key added surface without a UI. Concept is now one sentence: 这个项目不记忆.
- Open: per-row purge targeting (purge is all-or-nothing).

## Agent teams (cross-cutting)

- Done: subagent sessions inherit the lead's session-tier memory through `header.parentSession`; lead sessions keep only their own. Tests cover the inheriting and non-inheriting cases.
- Open: panel labelling of lead versus subagent sessions, and promoting a subagent's findings to the lead session explicitly.

## Phase 6: MemHub (started)

- Done: paired this Harness with MemHub through its one-time code, credential stored 0600 under `$DSH_HOME/memhub`, `mcp-one-memory` added to the profile as a stdio MCP client, host reloaded, and an authenticated `MemHub_recall` call succeeded (empty result, no auth error).
- Done: status exposes `memhub.pairing` (credential count plus loopback broker state) and the MemHub card points at MemHub's own sync switch instead of duplicating it.
- Open: verified end-to-end sync (enable it in MemHub, confirm imported conversations appear), and deciding whether the local export/pull/import actions stay once sync is on.

## Phase 7: concurrency and cold start (done)

- Measured with `scripts/bench-startup.mjs`: 0.9 to 2.8 s from spawn to health on this machine, then 5 to 8 ms for the first bridge call against a scratch store.
- `sidecar.prewarm` (default true) starts the sidecar at plugin load; recall waits up to `recall.waitForStartMs` (2500 ms) for a starting sidecar, then proceeds without injection.
- Eight concurrent recalls each inject and finish in 52 ms total, so nothing serializes on the state file or the sidecar.
- `scripts/bench-wake.mjs` measured cold 1586 ms, idle stop at 61167 ms, wake 1561 ms. The first wake failed because a stopped child's exit handler cleared the newer child; exit handlers now ignore stale children and `test/sidecar-wake.test.mjs` covers it.

## Phase 8: packaging and distribution (started)

- npmjs: `dsh-hy-memory@0.1.1` is `latest` (0.1.0 was the first publish; 0.1.1 dropped a stray `__pycache__`). The temporary `0.0.0-stage` placeholder was removed.
- GitHub Releases: `v0.1.1` carries `dsh-hy-memory-0.1.1.tgz`; the live profile's dependency now points at that asset and its lockfile was reconciled with `pnpm install --lockfile-only` after testing the same command on a profile copy.
- GitHub Packages: `.github/workflows/publish-github-packages.yml` publishes the scoped `@echo-smith/dsh-hy-memory` with `GITHUB_TOKEN` (`packages: write`); run 41767325307 reported `+ @echo-smith/dsh-hy-memory@0.1.1`.
- Plugin market: `market/index.json` (format 1) is validated with DSH's own `parseMarketIndex`, so DSH's detail page can compare versions and show updates on its own.
- Done: the installer prints `installed: <name> <old> -> <new>` before changing anything; `scripts/sync-market-index.mjs` rewrites the index from `package.json`; `.github/workflows/publish-npm.yml` publishes on `v*` tags and skips with a warning when `NPM_TOKEN` is absent or rejected.
- Done: 0.1.3 fixes the second page-sync failure (`settings.section` seat occupied) by shadowing at a higher priority instead of aborting the sync; smoke covers the occupied-seat case.
- Open: a release job that also bumps the market index itself (today that commit is manual).

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
- Still open: a capacity cap per tier with archival, panel merge of duplicates, and exposing forget in the panel (today it is a tool, not a button).

## Phase 4: explainable recall

- Panel row shows why it was recalled: tier, score, source session, and the query that matched.
- Activity feed links a recall to the injected text.

## Phase 5: privacy and permission

- Per-project and per-session switch to disable capture.
- Secret filtering at the capture boundary (API keys, tokens, private paths) before anything leaves the process.
- Export and purge all memories for one user, with a confirmation that names the count.

## Phase 6: MemHub

MemHub already owns a sync path; the plugin should call it instead of reimplementing transport.

- Read MemHub's own sync entry point (its runtime API, not the on-disk store).
- Wire `memhub/sync` to that entry point behind the existing card, and keep the current pull/import as the fallback for older MemHub builds.
- Prove it with the locked-store case (`memhub_locked`) and one successful round trip.

## Phase 7: scenes and other plugins

- Capture a real working-scene write in the running app, not only in the harness.
- Verify a turn driven by another client plugin still recalls and captures (needs that plugin installed).
- Stable workspace id when a project has no git remote.

## Phase 8: operations

- Concurrency: two windows, one `DSH_HOME`; verify the sidecar lock and queue.
- Cold start: prewarm the sidecar at plugin load instead of the first turn.
- Packaging for a plugin store: manifest, pinned `hy-memory` version, release notes.

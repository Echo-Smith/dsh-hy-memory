# Roadmap

Sequenced from the audit that followed the first public release. Each phase is independently shippable and ends in a check that runs without a browser.

## Done in this pass

| Unit | Check |
|---|---|
| Recall evaluation harness (`scripts/eval-recall.mjs`) | `npm run eval:recall` prints per-case verdicts and aggregate size; it caught the budget bug where one oversize memory ignored `maxChars` |
| Recall budget fix (truncate an oversize first item instead of injecting it whole) | same harness, plus `npm test` 85/85 |
| CI on GitHub Actions (syntax, host tests, panel smoke, recall eval) | workflow file, all four steps run locally |

## Phase 1: recall quality

1. Extend the eval harness with real fixtures exported from a working store (`bridge/v1/export` style dump) so the numbers describe real recall, not synthetic groups.
2. Record a baseline: hit rate, noise rate, injected characters per turn, latency.
3. Tune `recall.minScore` / `maxChars` against the baseline, one change per commit.
4. Only then decide whether the embedder needs replacing.

## Phase 2: embeddings

- Verify `embedding.mode: remote` end to end against a multilingual endpoint.
- Ship a re-embedding command (`scripts/reembed.mjs`) that walks the store, recomputes vectors with the new model and reports dimension mismatch before writing.
- Keep the lexical fallback as the safety net; measure how often it fires.

## Phase 3: memory lifecycle

- Time decay in recall ranking instead of a hard cutoff.
- Capacity cap per tier with archival instead of silent growth.
- Panel: merge duplicates, and an explicit "forget this" that also blocks future promotion of the same content.

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

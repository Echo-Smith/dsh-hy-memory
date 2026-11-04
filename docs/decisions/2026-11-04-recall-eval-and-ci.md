# Decision trail: recall evaluation, budget fix, CI

Run of 2026-11-04 under poteto-mode (figure-it-out). Scope: pick the highest-leverage unit from an eleven-direction audit that could be delivered and verified in one sitting; the remaining directions are sequenced in `docs/ROADMAP.md`.

## Predicate

A single command, runnable without a browser or model, fails when recall selection violates its own budget or drops a should-hit item; the repository runs that command plus the existing suites in CI.

## Units

1. **Harness.** `scripts/eval-recall.mjs` drives `selectRecall` with fixture groups and prints per-case verdicts, average item count and average injected characters.
   Hypothesis: the pipeline enforces `maxItems`, `maxChars`, `minScore`, dedupe and tier order.
   Result: VERIFIED for maxItems, minScore, dedupe; NOT VERIFIED for maxChars. A single 75-character memory was injected even with `maxChars: 120`, because the first item bypassed the budget check.
2. **Budget fix.** The first item is truncated to the remaining budget (with an ellipsis) when it does not fit, and the loop stops when fewer than 24 characters remain.
   Result: VERIFIED by the same harness (`character budget stops before the limit`) and by `npm test` 85/85.
3. **CI.** `.github/workflows/ci.yml` runs `npm run check`, `npm test`, `npm run test:smoke`, `npm run eval:recall` on push and pull request.
   Result: all four run locally; workflow unverified on GitHub until the next push.

## What this does not claim

- The harness runs synthetic groups, not real store data; Phase 1 of the roadmap replaces the fixtures with a real dump.
- CI has not executed on GitHub yet.
- The other eight directions are designed, not implemented; each phase in the roadmap names its own check.

## Phase 1 addendum (live fixtures and thresholds)

Predicate: on ten real questions from the store, the pipeline injects the memory that answers each one, measured by `scripts/eval-live.mjs` against a running sidecar.

- Baseline: 6/10, 805 characters, 94 ms.
- Fix 1: the chat search result omitted `session_id`, so the session tier never matched. The bridge now enriches each row from a 60-second cached listing of the same user.
- Fix 2: the keyword fallback ran only when every tier returned zero rows. One wrong low-score hit was enough to block it. The fallback now tops up whenever selection is under the item budget, and re-runs outright when nothing survives.
- Fix 3: thresholds. minScore 0.32 to 0.56, maxChars 1600 to 1200, maxItems unchanged.
- Result: 9/10, 941 characters, 149 ms. `npm test` 85/85.

Open risks: ten fixtures from one store; a higher minScore pushes most Chinese recalls onto the keyword path, which suits the bundled English embedder but should be re-measured after Phase 2. The remaining miss is the loader-id question, which the keyword path ranks behind a longer unrelated memory.

## Phase 2 addendum (remote embeddings)

Predicate: remote mode indexes and searches through an OpenAI-compatible endpoint without a network dependency in the test.

- `scripts/mock-embeddings.mjs` serves deterministic 1024-dimension vectors.
- A sidecar started with `HY_MEMORY_LOCAL_EMBED=0`, `MEMORY_EMBEDDER_BASE_URL=http://127.0.0.1:19700/v1`, `MEMORY_EMBEDDING_DIMS=1024` accepted a write (`success: true`) and returned the exact stored text from search with score 1.0. VERIFIED for the wiring.
- NOT VERIFIED: recall quality against a real multilingual model, and any dimension migration. A 1024-dimension store and the existing 384-dimension store cannot be queried together.

Also added: the host now counts recall turns that resolved through the keyword path and the live harness prints that rate, so the fallback is a measured number rather than a claim.

## Phase 2 addendum: migration tool

Predicate: move memories from a store built for one embedder into a store built for another without touching the source and without unaudited writes.

- `scripts/migrate-embeddings.mjs` exports the source, writes a timestamped backup, prints source and target totals, and only writes with `--apply --confirm YES-MIGRATE`.
- Verified across two pro stores on the same machine: dry run reported 102 source rows and an empty target; applying three memories wrote 3 and failed 0, the target grew to 6 rows (pro reconcile splits), a search for the first memory returned it, and the source totals stayed at 84 chat, 3 working, 15 coding. VERIFIED for the mechanics.
- Not verified: a real embedder change (both stores used the bundled 384-dimension model), workspace scope for productivity rows, and any run at full store size.

## Phase 3 addendum: recency and forget

- Recency weighting added to `selectRecall`: rank score is `score * 0.5^(ageDays/halfLifeDays)`, default half-life 30 days, `halfLifeDays: 0` disables it. Thresholding still uses the raw score so an old-but-relevant memory is not dropped outright. Tests cover fresh-before-old and the off switch.
- `memory_forget` deletes by id and records `contentHash(text)` in `state.json`; both promotion sites filter forgotten lines. Test covers the delete call and the recorded hash.
- Live evaluation after the change: still 9/10 hits at 941 average characters. Latency read 385 ms on this run against a cold sidecar, which is not comparable to the earlier 149 ms.

## Phase 3 addendum: capacity guard and panel route

- Added `/api/hy-memory/forget` so the panel can call the same forget semantics as the tool; route count moved to 16 and the contract test follows.
- Capacity guard: `lifecycle.maxPerTier` (default 2000) with `archiveOnCap` off. Enabling it writes a JSONL archive of the overflow first, then deletes. Test: 60 rows, cap 50, ten archived lines, ten deletes, one archive file. VERIFIED.
- Not done: panel merge of duplicates, a forget button, and any run against a real store at the cap.

## Phase 3 addendum: duplicates and headroom

- `ops.duplicates` groups by `contentHash` after case and whitespace folding, excludes singletons, keeps the newest via `createdAt`. Test: three rows, one group, keep `a2`, drop `a1`.
- `ops.merge` deletes the drop ids through the same locate and delete path as `remove`, refusing when `keep` is inside `drop`. Test asserts the delete call.
- Real store size measured: 106 rows against a 2000 cap. The cap is not exercised in production, and the guard stays off by default.

## Diagnostics polish addendum

- Both diagnostics actions (整理重复项, 彻底清除) now share one row; smoke asserts a single `hm-dupeRow` host and that destructive controls carry `hm-dangerAction`.
- The clean-store result (没有重复项) is transient: it renders only while a 2-second flag is set, then disappears. NOT VERIFIED by the smoke harness, whose mini renderer does not repaint from a bare timer callback; the behaviour needs a browser check after the next page reload.

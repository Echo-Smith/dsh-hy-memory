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

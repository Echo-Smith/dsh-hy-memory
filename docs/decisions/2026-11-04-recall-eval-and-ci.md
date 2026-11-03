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

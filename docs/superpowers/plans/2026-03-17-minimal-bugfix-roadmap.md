# Minimal Bugfix Roadmap Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six currently identified runtime bugs with the smallest safe change set, preferring AI/prompt-driven and existing workflow hooks over broad refactors.

**Architecture:** Treat the bugs in three classes. First, fix prompt/context delivery issues that can be solved at the God layer with minimal plumbing. Second, repair worker failure propagation by reusing the existing observation pipeline instead of inventing a second recovery path. Third, apply direct point fixes for resource cleanup and session restore. Do not implement full dynamic adapter switching in this pass unless the product explicitly requires it.

**Tech Stack:** TypeScript, React/Ink, XState, Vitest, Zod, CLI adapter streams

**Spec:** Based on runtime audit and bug review from 2026-03-17

---

## File Map

- `src/god/god-decision-service.ts`
  Purpose: God prompt construction, decision context shape, unified God call path.
- `src/ui/components/App.tsx`
  Purpose: Session runner orchestration, worker execution, God invocation, safe shutdown.
- `src/ui/session-runner-state.ts`
  Purpose: stream aggregation, session restore event mapping/types.
- `src/engine/workflow-machine.ts`
  Purpose: clarification observation accumulation and restore targets.
- `src/god/observation-integration.ts`
  Purpose: reusable observation constructors for runtime incidents.
- `src/adapters/codex/adapter.ts`
  Purpose: Codex worker process bridging from process/stderr to chunks.
- `src/types/god-actions.ts`
  Purpose: Hand action schema exposure.
- `src/__tests__/...`
  Purpose: regression coverage for prompt building, incident propagation, shutdown, and restore.

---

## Chunk 1: AI-Driven Fixes First

### Task 1: Fix Bug 5 with prompt-only schema reinforcement

**Intent:** Solve the autonomousResolutions field-name drift with prompt examples, not schema auto-rewrite.

**Files:**
- Modify: `src/god/god-decision-service.ts`
- Test: `src/__tests__/god/god-decision-service.test.ts` or nearest existing prompt test file

- [ ] **Step 1: Add failing prompt assertion**

Add a test that builds the God system prompt and asserts:
- it includes a correct `autonomousResolutions` example with `question`, `choice`, `reflection`, `finalChoice`
- it explicitly names wrong fields: `issue`, `resolution`, `confidence`

- [ ] **Step 2: Run targeted test**

Run: `npx vitest run src/__tests__/god/god-decision-service.test.ts`

Expected: FAIL because the prompt does not yet include the anti-example guidance.

- [ ] **Step 3: Update SYSTEM_PROMPT**

In `src/god/god-decision-service.ts`:
- add one short correct JSON example under the envelope format section
- add one short "wrong field names" warning
- do not add schema-side field remapping in Watchdog or Zod

- [ ] **Step 4: Re-run targeted test**

Run: `npx vitest run src/__tests__/god/god-decision-service.test.ts`

Expected: PASS

- [ ] **Step 5: Verify no prompt regressions**

Run: `npx vitest run src/__tests__/god`

Expected: PASS

---

### Task 2: Fix Bug 2 with clarification history injection into God prompts

**Intent:** Keep multi-round clarification context visible to God with minimal new plumbing.

**Files:**
- Modify: `src/god/god-decision-service.ts`
- Modify: `src/ui/components/App.tsx`
- Test: `src/__tests__/engine/workflow-machine-e2-clarifying.test.ts`
- Test: add/update `src/__tests__/god/god-decision-service.test.ts`

- [ ] **Step 1: Add failing prompt tests**

Add tests that verify:
- full prompts include a `Clarification History` section when provided
- resume prompts also include the same section
- the section is omitted when history is empty

- [ ] **Step 2: Add failing orchestration test**

Add a regression test that simulates:
1. clarification round 1 answer
2. clarification round 2 answer
3. God decision call

Assert that the decision call receives prior clarification history, not just the latest answer.

- [ ] **Step 3: Extend GodDecisionContext**

In `src/god/god-decision-service.ts`, add:
- `clarificationHistory?: Observation[]`

Add a helper like `buildClarificationHistorySection(history)` that:
- deduplicates against the current observation batch
- renders concise numbered lines

- [ ] **Step 4: Wire history from SessionRunner**

In `src/ui/components/App.tsx`, when building `decisionContext`, pass:
- `clarificationHistory: ctx.clarificationObservations`

Do not concatenate `clarificationObservations` directly into the main `observations` array, because the newest clarification answer already exists in `currentObservations`.

- [ ] **Step 5: Render history in both prompt modes**

In `src/god/god-decision-service.ts`:
- append `Clarification History` to `buildUserPrompt()`
- append the same section to `buildResumePrompt()`

- [ ] **Step 6: Run focused tests**

Run:
- `npx vitest run src/__tests__/god/god-decision-service.test.ts`
- `npx vitest run src/__tests__/engine/workflow-machine-e2-clarifying.test.ts`

Expected: PASS

---

## Chunk 2: Replace Complex Error Recovery with Existing Observation Flow

### Task 3: Fix Bug 0 by routing worker failures into INCIDENT_DETECTED

**Intent:** Do not invent a second recovery pipeline through `ERROR -> GOD_DECIDING`. Reuse the existing observation path already used by catch/timeout branches.

**Files:**
- Modify: `src/ui/components/App.tsx`
- Modify: `src/adapters/codex/adapter.ts`
- Test: add/update `src/__tests__/ui/session-runner-state.test.ts`
- Test: add/update `src/__tests__/adapters/codex/adapter.test.ts`
- Optional test: add/update integration runtime test covering reviewer failure

- [ ] **Step 1: Add failing runtime regression test**

Create a test that simulates worker completion with:
- `finalizeStreamAggregation(...).kind === 'no_output'`
- `finalizeStreamAggregation(...).kind === 'error'`

Assert that the app emits `INCIDENT_DETECTED` with a structured runtime observation, not `PROCESS_ERROR`.

- [ ] **Step 2: Add failing Codex adapter regression test**

Simulate:
- `process-error` emitted with message `Process exited with code 1`
- empty stdout
- process completion

Assert that `execute()` yields at least one fatal `error` chunk instead of silently collapsing to `no_output`.

- [ ] **Step 3: Patch coder/reviewer aggregation branches**

In `src/ui/components/App.tsx`:
- coder `no_output` branch: replace `PROCESS_ERROR` send with `INCIDENT_DETECTED` using `createProcessErrorObservation(...)`
- coder `error` branch: same
- reviewer `no_output` branch: same
- reviewer `error` branch: same

Message copy may still mention “no output”, but the machine transition should go through observations.

- [ ] **Step 4: Bridge ProcessManager error into Codex chunks**

In `src/adapters/codex/adapter.ts`:
- subscribe to `process-error`
- enqueue a JSON error line or equivalent fatal chunk before close
- clean up the listener with the existing process-complete listener

Do not move parser semantics into `ProcessManager`.
Do not change all parsers to turn unknown events into fake text/status in this pass.

- [ ] **Step 5: Re-run focused tests**

Run:
- `npx vitest run src/__tests__/adapters/codex/adapter.test.ts`
- `npx vitest run src/__tests__/ui/session-runner-state.test.ts`

Expected: PASS

- [ ] **Step 6: Run affected integration tests**

Run: `npx vitest run src/__tests__/integration`

Expected: PASS

**Decision note:** Skip cc's proposed parser-wide “unknown event → status” rewrite unless a real regression demonstrates it is needed. That is defensive scope expansion, not the minimal fix for the observed bug.

---

## Chunk 3: Minimize Scope on switch_adapter

### Task 4: Choose one path for Bug 1 before coding anything else

**Intent:** Prevent wasted effort. Full dynamic adapter switching is not a small patch.

**Decision options:**

Option A, recommended for this roadmap:
- remove `switch_adapter` from the exposed God action catalog
- reject or ignore it at schema level
- document that adapter switching is unsupported in the current runtime

Option B, only if product explicitly requires it now:
- implement real runtime switching end-to-end
- this requires new runtime adapter-name state, service re-binding, persistence updates, and resume behavior review

**Files if choosing Option A:**
- Modify: `src/god/god-decision-service.ts`
- Modify: `src/types/god-actions.ts`
- Modify: `src/god/hand-executor.ts`
- Test: add/update message-dispatcher / schema tests

**Files if choosing Option B:**
- Modify: `src/ui/components/App.tsx`
- Modify: `src/session/session-manager.ts`
- Modify: `src/cli.ts` resume flow only if metadata changes
- Modify: `src/god/god-decision-service.ts`
- Modify: `src/god/watchdog.ts`
- Add tests across runtime + resume

- [ ] **Step 1: Write the product decision into the branch notes**

Record: “Bug 1 will be solved by disabling unsupported switching” unless the user explicitly asks for runtime switching.

- [ ] **Step 2: If Option A, add failing tests**

Assert:
- `switch_adapter` is not listed in `buildHandCatalog()`
- schema rejects or executor never receives it

- [ ] **Step 3: Implement Option A**

In `src/god/god-decision-service.ts`:
- remove the action from the hand catalog text

In `src/types/god-actions.ts`:
- remove `SwitchAdapterSchema` from the action union, or mark it internal-only and keep it unexposed

In `src/god/hand-executor.ts`:
- remove dead handler if schema removal makes it unreachable

- [ ] **Step 4: If product instead chooses Option B, stop this roadmap and write a separate plan**

Do not mix full adapter switching into this minimal-fix branch.

---

## Chunk 4: Small Direct Code Fixes

### Task 5: Fix Bug 3 by including watchdog in safe shutdown

**Intent:** Clean up the orphanable watchdog process with the smallest possible patch.

**Files:**
- Modify: `src/ui/components/App.tsx`
- Test: add/update `src/__tests__/ui/safe-shutdown.test.ts` or nearest equivalent

- [ ] **Step 1: Add failing shutdown test**

Assert that `performSafeShutdown()` is called with:
- coder adapter
- reviewer adapter
- main God adapter
- watchdog adapter

- [ ] **Step 2: Apply one-line runtime fix**

In `src/ui/components/App.tsx`, add `watchdogAdapterRef.current` to the `adapters` array passed to `performSafeShutdown`.

- [ ] **Step 3: Run focused tests**

Run: `npx vitest run src/__tests__/ui`

Expected: PASS

**Decision note:** Do not change `SafeShutdownOptions.adapters` typing. It already uses structural typing via `kill(): Promise<void>`, which `GodAdapter` satisfies.

---

### Task 6: Fix Bug 4 by restoring clarifying sessions into CLARIFYING

**Intent:** Restore semantic correctness with the smallest code path, not an overloaded workaround in `INTERRUPTED`.

**Files:**
- Modify: `src/ui/session-runner-state.ts`
- Test: `src/__tests__/engine/bug-15-16-17-18-regression.test.ts`
- Test: `src/__tests__/session/clarification-persistence.test.ts`

- [ ] **Step 1: Add failing type-level and runtime tests**

Assert:
- `RestoreEventType` includes `RESTORED_TO_CLARIFYING`
- `mapRestoreEvent()` maps persisted `clarifying` to `RESTORED_TO_CLARIFYING`
- restored clarification input goes through the `CLARIFYING` path semantics

- [ ] **Step 2: Update restore event type**

In `src/ui/session-runner-state.ts`, add `RESTORED_TO_CLARIFYING` to `RestoreEventType`.

- [ ] **Step 3: Update status mapping**

In `mapRestoreEvent()`, map:
- `clarifying` -> `RESTORED_TO_CLARIFYING`

- [ ] **Step 4: Update regression tests**

Replace any tests that currently lock in the workaround behavior.
Keep backward compatibility for persisted `interrupted` as `RESTORED_TO_INTERRUPTED`.

- [ ] **Step 5: Run focused tests**

Run:
- `npx vitest run src/__tests__/engine/bug-15-16-17-18-regression.test.ts`
- `npx vitest run src/__tests__/session/clarification-persistence.test.ts`

Expected: PASS

**Decision note:** Only keep the current `clarifying -> interrupted` workaround if a reproducer shows a real unresolved regression. If such a reproducer exists, stop and write a dedicated workaround plan instead of burying special logic inside `INTERRUPTED`.

---

## Chunk 5: Verification Sweep

### Task 7: Run the smallest complete confidence set

**Files:**
- No code changes

- [ ] **Step 1: Run targeted suites**

Run:
- `npx vitest run src/__tests__/god`
- `npx vitest run src/__tests__/engine`
- `npx vitest run src/__tests__/session`
- `npx vitest run src/__tests__/adapters`
- `npx vitest run src/__tests__/integration`

Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit --pretty false`

Expected: no output

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: success

---

## Recommended Execution Order

1. Bug 5 prompt reinforcement
2. Bug 2 clarification history
3. Bug 0 incident propagation
4. Bug 1 capability decision, default to remove/disable
5. Bug 3 shutdown patch
6. Bug 4 restore semantics
7. Final verification sweep

## What This Plan Explicitly Avoids

- No parser-wide remapping of all unknown events
- No full dynamic adapter switching implementation in the same branch
- No schema auto-healing for semantically wrong God outputs
- No second error recovery framework parallel to `INCIDENT_DETECTED`

## Success Criteria

- God sees clarification history across multiple clarification rounds.
- God produces fewer autonomousResolutions schema failures because the prompt is more explicit.
- Worker `no_output` and aggregation failures reach God as runtime observations instead of disappearing into `ERROR`.
- Safe exit kills watchdog.
- Resumed clarification sessions behave like clarification sessions.
- The runtime no longer advertises `switch_adapter` unless the feature is truly implemented.

## Follow-Up Branch, Only If Requested

If real runtime adapter switching is a product requirement, create a second dedicated plan covering:
- runtime adapter-name state separate from immutable `config`
- safe re-binding of `GodDecisionService` and `WatchdogService`
- session metadata persistence updates
- resume compatibility rules
- UI/status bar reflection of current adapters

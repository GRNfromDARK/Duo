# Round Removal & Dead Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all round/轮次 logic and orphaned dead code from the Duo codebase.

**Architecture:** Pure deletion — no new features. Three phases: (1) delete orphaned files, (2) remove round fields from all production code bottom-up, (3) update tests. Each phase leaves the codebase in a compilable, test-passing state.

**Tech Stack:** TypeScript, Vitest, xstate v5, Ink (React for CLI)

**Spec:** `docs/2026-03-18-round-removal-and-dead-code-cleanup-design.md`

---

## Chunk 1: Dead Code Deletion + Schema Cleanup

### Task 1: Delete orphaned production files

These files contain functions that are never called from production code.

**Files:**
- Delete: `src/god/god-convergence.ts` (407 lines — `evaluateConvergence()` not called)
- Delete: `src/god/phase-transition.ts` (109 lines — `evaluatePhaseTransition()` not called)
- Delete: `src/god/consistency-checker.ts` (204 lines — `checkConsistency()` only called from god-convergence)
- Delete: `src/ui/round-summary.ts` (~40 lines — entirely round-based)
- Delete: `src/ui/components/ConvergenceCard.tsx` (~80 lines — not imported anywhere)

- [ ] **Step 1: Delete the 5 production files**

```bash
rm src/god/god-convergence.ts
rm src/god/phase-transition.ts
rm src/god/consistency-checker.ts
rm src/ui/round-summary.ts
rm src/ui/components/ConvergenceCard.tsx
```

- [ ] **Step 2: Delete corresponding test files**

```bash
rm src/__tests__/god/god-convergence.test.ts
rm src/__tests__/ui/god-convergence-evaluating.test.ts
rm src/__tests__/god/phase-transition.test.ts
rm src/__tests__/god/consistency-checker.test.ts
rm src/__tests__/ui/round-summary.test.ts
rm src/__tests__/ui/convergence-card.test.tsx
```

Note: some of these test files may not exist — skip any that are missing.

- [ ] **Step 3: Fix broken imports**

Run `npx tsc --noEmit 2>&1 | head -50` to find all broken imports.

Fix each by removing the import line. Expected files with broken imports:
- `src/god/god-prompt-generator.ts` — remove `import type { ConvergenceLogEntry } from './god-convergence.js'`
- `src/ui/components/App.tsx` — remove `import type { ConvergenceLogEntry } from '../../god/god-convergence.js'` and `import { createRoundSummaryMessage } from '../round-summary.js'`
- `src/ui/session-runner-state.ts` — remove `import type { ConvergenceLogEntry } from '../god/god-convergence.js'`
- `src/session/session-manager.ts` — remove `import type { ConvergenceLogEntry } from '../god/god-convergence.js'`
- `src/god/phase-transition.ts` references from other files (if any)

For **any reference to `ConvergenceLogEntry` as a type** in interfaces/fields (not just imports), comment it out or delete the field. These will be cleaned up properly in Task 3.

- [ ] **Step 4: Run tsc and fix any remaining errors**

```bash
npx tsc --noEmit
```

Iterate until zero errors. Each error will be a missing import or reference to a deleted type — fix by removing the reference.

- [ ] **Step 5: Run tests**

```bash
npx vitest run 2>&1 | tail -20
```

All tests should pass (deleted test files won't run).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete orphaned convergence pipeline and round-summary

Delete 5 production files (god-convergence, phase-transition,
consistency-checker, round-summary, ConvergenceCard) and 6 test files.
These modules were orphaned after the AI-driven simplification —
no production code called their exported functions."
```

### Task 2: Clean up god-schemas.ts

Remove deprecated schemas and simplify GodTaskAnalysis.

**Files:**
- Modify: `src/types/god-schemas.ts`
- Modify: `src/god/god-system-prompt.ts`
- Modify: `src/god/task-init.ts`

- [ ] **Step 1: Simplify god-schemas.ts**

Delete the three deprecated schemas and their type exports. Delete `suggestedMaxRounds` and `terminationCriteria` from `GodTaskAnalysisSchema`.

The file should become approximately:

```typescript
/**
 * God LLM output Zod schemas.
 */

import { z } from 'zod';

// 6 种任务类型
export const TaskTypeSchema = z.enum(['explore', 'code', 'discuss', 'review', 'debug', 'compound']);

// GodTaskAnalysis — FR-001 意图解析输出
export const GodTaskAnalysisSchema = z.object({
  taskType: TaskTypeSchema,
  reasoning: z.string(),
  phases: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: TaskTypeSchema,
    description: z.string(),
  })).nullable().optional(),
  confidence: z.number().min(0).max(1),
}).refine(
  (data) => data.taskType !== 'compound' || (data.phases && data.phases.length > 0),
  { message: 'phases must be non-empty when taskType is compound' },
);

export type GodTaskAnalysis = z.infer<typeof GodTaskAnalysisSchema>;
```

- [ ] **Step 2: Update god-system-prompt.ts**

Remove `suggestedMaxRounds` and `terminationCriteria` from the example JSON in the system prompt. Find the lines with these fields and delete them. Also remove any documentation lines referencing suggestedMaxRounds ranges.

- [ ] **Step 3: Update task-init.ts**

Delete `ROUND_RANGES` constant, `validateRoundsForType()` function, and `applyDynamicRounds()` function. Remove any references to `suggestedMaxRounds` in the task init flow. If the file imports these deleted types, fix the imports.

- [ ] **Step 4: Fix broken references**

Run `npx tsc --noEmit` and fix any remaining references to deleted schemas (`GodPostCoderDecision`, `GodPostReviewerDecision`, `GodConvergenceJudgment`, `suggestedMaxRounds`, `terminationCriteria`). Search all `.ts` and `.tsx` files. These may appear in test files too — fix or delete the references.

- [ ] **Step 5: Run tests**

```bash
npx vitest run 2>&1 | tail -20
```

Fix any test failures caused by removed schema types or fields.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: clean deprecated schemas and remove suggestedMaxRounds

Remove GodPostCoderDecision, GodPostReviewerDecision,
GodConvergenceJudgment schemas from god-schemas.ts. Remove
suggestedMaxRounds and terminationCriteria from GodTaskAnalysis.
Delete ROUND_RANGES and round validation functions from task-init."
```

## Chunk 2: Remove Round from Core + God Layer

### Task 3: Remove round from type interfaces and all God modules

Remove `round` from every type interface and fix all call sites. This is the largest task — work file by file, checking compilation after each group.

**Files to modify (types):**
- `src/types/observation.ts` — delete `round` from Observation
- `src/types/session.ts` — delete `RoundRecord` interface
- `src/types/ui.ts` — delete `isRoundSummary` from MessageMetadata

**Files to modify (God infrastructure):**
- `src/god/god-audit.ts` — make `round` optional in `GodAuditEntry`, remove from helper function params
- `src/god/god-call.ts` — remove `round` from `GodCallLoggingOptions`
- `src/session/prompt-log.ts` — remove `round` from `PromptLogEntry` and `PromptLogEntryInput`

**Files to modify (God action/observation modules):**
- `src/god/observation-integration.ts` — remove `round` param from all 5 exported functions
- `src/god/observation-classifier.ts` — remove `round` from observation creation
- `src/god/hand-executor.ts` — remove `round` from `HandExecutionContext`, remove from all observation/audit creation
- `src/god/interrupt-clarifier.ts` — remove `round` from `InterruptContext`, audit entries, prompt text
- `src/god/message-dispatcher.ts` — remove `round` from `DispatchContext` and observation creation

**Files to modify (God decision modules):**
- `src/god/god-decision-service.ts` — remove `round`/`maxRounds` from `GodDecisionContext`, remove from prompts
- `src/god/god-prompt-generator.ts` — remove `round`/`maxRounds`/`convergenceLog` from `PromptContext`, delete "Round Info" and "Convergence Trend" sections

**Files to modify (Engine + Session):**
- `src/engine/workflow-machine.ts` — remove `round`/`maxRounds` from `WorkflowContext`, delete round increment
- `src/session/session-manager.ts` — remove `round` from `SessionState`, `HistoryEntry`, `SessionSummary`

- [ ] **Step 1: Remove round from Observation type**

In `src/types/observation.ts`, delete the `round` field from the Observation Zod schema. The exact line is:
```
round: z.number().int().min(0),
```

- [ ] **Step 2: Remove round from session types**

In `src/types/session.ts`, delete the entire `RoundRecord` interface.

In `src/types/ui.ts`, delete `isRoundSummary?: boolean` and its comment from `MessageMetadata`.

- [ ] **Step 3: Remove round from God audit**

In `src/god/god-audit.ts`:
- Change `round: number;` to `round?: number;` in `GodAuditEntry` interface (backward compat)
- Remove `round: number;` parameter from `logReviewerOverrideAudit`, `logIncidentAudit`, and `EnvelopeDecisionParams`
- Remove `round,` from all destructuring and `logger.append()` calls in these functions

- [ ] **Step 4: Remove round from God call + prompt log**

In `src/god/god-call.ts`:
- Remove `round: number;` from `GodCallLoggingOptions` interface
- Remove `round: logging.round,` from the prompt log call

In `src/session/prompt-log.ts`:
- Remove `round: number;` from both `PromptLogEntry` and `PromptLogEntryInput`
- Remove `round: entry.round,` from the JSONL write

- [ ] **Step 5: Remove round from observation-integration.ts**

Remove `round: number` parameter from all 5 exported functions:
- `processWorkerOutput` — remove from `meta` parameter object
- `createInterruptObservation` — remove `round` parameter
- `createTextInterruptObservation` — remove `round` parameter
- `createProcessErrorObservation` — remove `round` parameter
- `createTimeoutObservation` — remove `round` parameter

Remove `round,` from all internal `createObservation()` calls (which build Observation objects).

- [ ] **Step 6: Remove round from observation-classifier.ts**

Remove `round` from any observation creation calls. The classifier creates Observation objects — remove `round` field from those objects.

- [ ] **Step 7: Remove round from hand-executor.ts**

- Remove `round: number;` from `HandExecutionContext` interface
- Remove `round: context.round,` from ALL observation/audit creation (~8 locations)

- [ ] **Step 8: Remove round from interrupt-clarifier.ts**

- Remove `round: number;` from `InterruptContext` interface
- Remove `round: context.round,` from audit entry creation
- Remove `Round: ${context.round}` line from prompt building
- Remove `round:` from logging options

- [ ] **Step 9: Remove round from message-dispatcher.ts**

- Remove `round: number;` from `DispatchContext` interface
- Remove `round: context.round,` from any observation creation

- [ ] **Step 10: Remove round from god-decision-service.ts**

- Remove `round: number;` and `maxRounds: number;` from `GodDecisionContext` interface
- Change "## Phase & Round" section to "## Phase" — remove the Round line
- Remove round from resume prompt similarly
- Update SYSTEM_PROMPT text: change "after 2 rounds of disagreement" to "after sustained disagreement"
- Remove round from any audit entry creation

- [ ] **Step 11: Remove round from god-prompt-generator.ts**

- Remove `round: number;`, `maxRounds: number;`, `convergenceLog?: ConvergenceLogEntry[];` from `PromptContext`
- Delete the entire "## Round Info" section from `generateCoderPrompt()` (the line `sections.push(\`## Round Info\nRound ${ctx.round} of ${ctx.maxRounds}\`);`)
- Delete the entire "## Round Info" section from `generateReviewerPrompt()`
- Delete the entire "## Convergence Trend" section from `generateCoderPrompt()` (the block that reads `ctx.convergenceLog`)
- Remove `round` from the `generateReviewerPrompt` parameter type
- Remove `round` from audit input summary string

- [ ] **Step 12: Remove round from workflow-machine.ts**

- Remove `round: number;` and `maxRounds: number;` from `WorkflowContext` interface
- Remove `round: input?.round ?? 0` and `maxRounds: input?.maxRounds ?? 10` from context initialization
- Remove `maxRounds` from `TaskInitCompleteEvent` type
- Delete the round increment action (the line assigning `round: ({ context }) => context.round + 1`)

- [ ] **Step 13: Remove round from session-manager.ts**

- Remove `round: number;` from `SessionState` interface
- Remove `round: number;` from `HistoryEntry` interface
- Remove `round: number;` from `SessionSummary` interface
- Remove `godConvergenceLog` from any persisted session data interface

- [ ] **Step 14: Run tsc and fix all remaining errors**

```bash
npx tsc --noEmit 2>&1 | head -100
```

This is critical. The above steps touch ~15 files. There will be cascading errors in:
- App.tsx (uses ctx.round, passes round to many functions)
- Test files (use round in fixtures)

For **App.tsx**: fix ALL compilation errors caused by removed round fields. This means:
- Remove `round:` from all observation creation calls
- Remove `round:` from all audit entry calls
- Remove `round:` / `maxRounds:` from all prompt context objects
- Remove `round:` / `maxRounds:` from all GodDecisionContext objects
- Remove `convergenceLogRef` usage
- Remove `roundsRef` and RoundRecord tracking
- Remove `createRoundSummaryMessage` calls
- Remove `suggestedMaxRounds` usage in TASK_INIT handling
- Remove `maxRounds` assignment from TASK_INIT_COMPLETE handling
- Remove round/maxRounds from session persistence calls

Keep iterating `npx tsc --noEmit` until zero errors from production code. (Test file errors will be fixed in Task 4.)

- [ ] **Step 15: Run tests**

```bash
npx vitest run 2>&1 | tail -30
```

Some tests will fail due to round fields in test fixtures. Note which tests fail but do NOT fix them yet — Task 4 handles test updates.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "refactor: remove round from all type interfaces and God modules

Remove round/maxRounds fields from: Observation, GodAuditEntry,
GodDecisionContext, PromptContext, WorkflowContext, SessionState,
HistoryEntry, HandExecutionContext, InterruptContext, DispatchContext,
GodCallLoggingOptions, PromptLogEntry. Delete RoundRecord, isRoundSummary.
Remove 'Round Info' and 'Convergence Trend' from God/worker prompts.
Remove round increment from workflow state machine."
```

## Chunk 3: UI Cleanup + Tests

### Task 4: Remove round from UI components

**Files:**
- Modify: `src/ui/components/StatusBar.tsx` — remove round/maxRounds props and progress bar
- Modify: `src/ui/components/MainLayout.tsx` — remove round from StatusBarProps
- Modify: `src/ui/components/ContextOverlay.tsx` — remove roundNumber prop
- Modify: `src/ui/components/ReclassifyOverlay.tsx` — remove currentRound prop
- Modify: `src/ui/components/TaskAnalysisCard.tsx` — remove suggestedMaxRounds display
- Modify: `src/ui/session-runner-state.ts` — remove buildRounds(), rounds, godConvergenceLog
- Modify: `src/ui/reclassify-overlay.ts` — remove round from audit
- Modify: `src/ui/display-mode.ts` — update comment
- Modify: `src/cli-commands.ts` — remove round from session display

- [ ] **Step 1: Simplify StatusBar**

In `src/ui/components/StatusBar.tsx`:
- Remove `round: number;` and `maxRounds: number;` from props interface
- Remove `round,` and `maxRounds,` from destructuring
- Delete `buildProgressBar` call and `roundStr` variable
- Delete the segment that displays `roundStr`

- [ ] **Step 2: Update MainLayout**

In `src/ui/components/MainLayout.tsx`:
- Remove `round: number;` and `maxRounds: number;` from `StatusBarProps` (or wherever the round props are defined)
- Remove `round:` and `maxRounds:` from the object passed to StatusBar
- Remove `round={...}` and `maxRounds={...}` JSX props

- [ ] **Step 3: Update ContextOverlay**

In `src/ui/components/ContextOverlay.tsx`:
- Remove `roundNumber: number;` from props
- Remove `roundNumber,` from destructuring
- Delete the entire Box that displays "Round:" label and value

- [ ] **Step 4: Update ReclassifyOverlay**

In `src/ui/components/ReclassifyOverlay.tsx`:
- Remove `currentRound: number;` from props
- Remove `currentRound` from function destructuring
- Remove `currentRound` from `createReclassifyState()` call
- Delete the Box displaying "Round {currentRound}"

In `src/ui/reclassify-overlay.ts`:
- Remove `round` from `createReclassifyState` parameters
- Remove `round` from any audit entry creation

- [ ] **Step 5: Update TaskAnalysisCard**

In `src/ui/components/TaskAnalysisCard.tsx`:
- Delete `rounds: 'Rounds'` and `rounds: '轮次'` from i18n objects
- Delete the Text element showing `analysis.suggestedMaxRounds`

- [ ] **Step 6: Simplify session-runner-state.ts**

In `src/ui/session-runner-state.ts`:
- Remove `rounds: RoundRecord[];` from `RestoredSessionRuntime`
- Remove `godConvergenceLog?: ConvergenceLogEntry[];` from `RestoredSessionRuntime`
- Delete the entire `buildRounds()` function
- Remove round-related fields from workflow input restoration
- Fix any remaining imports of deleted types

- [ ] **Step 7: Update display-mode.ts and cli-commands.ts**

In `src/ui/display-mode.ts`:
- Change comment "All other messages (user, LLM, system non-routing, round summaries) are kept." to "All other messages (user, LLM, system non-routing) are kept."

In `src/cli-commands.ts`:
- Remove `Round ${s.round}` from session listing format string
- Remove `Round ${loaded.state.round}, ` from session info display

- [ ] **Step 8: Fix App.tsx UI-related round references**

In `src/ui/components/App.tsx`, remove ALL remaining round-related UI code:
- Remove round/maxRounds props passed to StatusBar, MainLayout, ContextOverlay, ReclassifyOverlay
- Remove `convergenceLogRef` declaration and all reads
- Remove `roundsRef` declaration and all reads/writes
- Remove round summary message creation (`createRoundSummaryMessage`)
- Remove `suggestedMaxRounds` from task init handling (where maxRounds is set from task analysis)

Use `npx tsc --noEmit` to find all remaining issues.

- [ ] **Step 9: Update comment references**

Search for "round" in comments across the codebase:
```bash
grep -rn "round" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v __tests__ | grep -v "Math.round\|borderStyle.*round\|border.*round"
```

Update any remaining comments that reference "round" in the iteration/轮次 sense:
- `claude-code-god-adapter.ts`: update "so next round falls back to..."
- `ThinkingIndicator.tsx`: update "new round starting" comments
- Any other occurrences

- [ ] **Step 10: Run tsc**

```bash
npx tsc --noEmit
```

Must be zero errors.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: remove round from UI components and session runner

Remove round/maxRounds from StatusBar, MainLayout, ContextOverlay,
ReclassifyOverlay, TaskAnalysisCard. Delete buildRounds() from
session-runner-state. Clean up App.tsx round-related UI code.
Remove round from CLI session display."
```

### Task 5: Update all test files

Fix all test files that reference round fields or deleted modules.

**Strategy:** Run `npx vitest run` and fix each failing test file. The failures will be:
1. Tests that pass `round` to functions/constructors that no longer accept it
2. Tests that check for `round` in output objects
3. Tests that create mock objects with `round` field
4. Tests that import deleted types

- [ ] **Step 1: Run tests and collect failures**

```bash
npx vitest run 2>&1 | grep "FAIL" | head -30
```

- [ ] **Step 2: Fix test files one by one**

For each failing test file:
- Remove `round: N` from all test fixture objects (Observation, GodAuditEntry, etc.)
- Remove `round` from mock objects and function call arguments
- Remove `expect(...round...)` assertions
- Remove imports of deleted types
- Delete test cases that test round-specific behavior (e.g., "increments round on transition")

Key test files likely to need updates:
- `src/__tests__/god/god-decision-service.test.ts`
- `src/__tests__/god/god-prompt-generator.test.ts` (including god-prompt-integration.test.ts)
- `src/__tests__/engine/workflow-machine.test.ts`
- `src/__tests__/god/hand-executor.test.ts`
- `src/__tests__/god/observation-classifier.test.ts`
- `src/__tests__/ui/status-bar.test.ts` (or StatusBar.test.tsx)
- `src/__tests__/session/session-manager.test.ts`
- `src/__tests__/god/god-audit.test.ts` (or audit-bug-regressions.test.ts)
- Any other test file that fails

- [ ] **Step 3: Verify all tests pass**

```bash
npx vitest run
```

Must show all tests passing with zero failures.

- [ ] **Step 4: Run tsc one final time**

```bash
npx tsc --noEmit
```

Must show zero errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: update all tests for round removal

Remove round fields from test fixtures, mock objects, and assertions.
Delete test cases for round-specific behavior. All tests pass."
```

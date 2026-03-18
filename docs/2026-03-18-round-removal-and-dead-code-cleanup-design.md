# Round Removal & Dead Code Cleanup Design

## Background

Duo 在 AI-driven 简化（2026-03-18）后，收敛管道 (`god-convergence.ts`) 已成为死代码 — 生产代码中无任何调用。同时，轮次（round）概念作为一个人为控制机制，与 AI-driven 原则冲突：God 应根据观察自行决定何时终止任务，而不是受 `maxRounds` 硬限制。

本次变更有两个目标：
1. **删除死代码**：清理已孤立的收敛管道和遗留 schema
2. **删除轮次概念**：从类型、状态机、UI、prompt、持久化中彻底移除 round

## Core Principle

God 是唯一的终止决策者。它通过 `accept_task` action 终止任务，通过 `send_to_coder` / `send_to_reviewer` 继续迭代。不需要外部轮次计数器来限制或引导这个决策。

## Scope

### 1. Dead Code Deletion

#### Files to delete entirely

| File | Lines | Reason |
|------|-------|--------|
| `src/god/god-convergence.ts` | 407 | Orphaned — `evaluateConvergence()` not called in production |
| `src/ui/round-summary.ts` | ~40 | Entirely round-based concept |
| `src/__tests__/god/god-convergence.test.ts` | — | Tests for deleted module |
| `src/__tests__/ui/god-convergence-evaluating.test.ts` | — | Tests for deleted module |
| `src/__tests__/ui/round-summary.test.ts` | — | Tests for deleted module |

#### Types/schemas to delete

| Type | File | Reason |
|------|------|--------|
| `ConvergenceLogEntry` | god-convergence.ts | File deleted |
| `ConvergenceContext` | god-convergence.ts | File deleted |
| `ConvergenceResult` | god-convergence.ts | File deleted |
| `GodConvergenceJudgment` + Schema | god-schemas.ts | Dead — only used by deleted convergence module |
| `GodPostCoderDecision` + Schema | god-schemas.ts | Dead — no production usage |
| `GodPostReviewerDecision` + Schema | god-schemas.ts | Legacy — phase-transition.ts migrates to GodDecisionEnvelope |
| `RoundRecord` | src/types/session.ts | Round concept removed |

#### god-schemas.ts outcome

After deleting the three deprecated schemas, only `GodTaskAnalysis` + `TaskTypeSchema` remain. `GodTaskAnalysis` is also modified (see section 2).

### 2. Round Field Removal — Type Layer

#### State machine (`src/engine/workflow-machine.ts`)

- Delete `round: number` and `maxRounds: number` from `WorkflowContext`
- Delete round initialization (`round: input?.round ?? 0`, `maxRounds: input?.maxRounds ?? 10`)
- Delete `maxRounds` from `TaskInitCompleteEvent`
- Delete round increment action (line ~398: `round: ({ context }) => context.round + 1`)

#### God decision context (`src/god/god-decision-service.ts`)

- Delete `round: number` and `maxRounds: number` from `GodDecisionContext`
- Change "## Phase & Round" prompt section to "## Phase" — remove round line
- Remove round from resume prompt
- Remove round from audit entries

#### God prompt generator (`src/god/god-prompt-generator.ts`)

- Delete `round: number` and `maxRounds: number` from `PromptContext`
- Delete `convergenceLog` from `PromptContext`
- Delete entire "## Round Info" section from coder prompt
- Delete entire "## Round Info" section from reviewer prompt
- Delete "## Convergence Trend" section from coder prompt
- Delete import of `ConvergenceLogEntry` from god-convergence
- Remove round from audit input summary

#### God audit (`src/god/god-audit.ts`)

- Make `round` optional in `GodAuditEntry` (backward compat with existing logs) or delete entirely
- All audit call sites stop passing round

#### Observation system (`src/types/observation.ts`)

- Delete `round: number` from `Observation` interface
- Update `src/god/observation-classifier.ts` — remove round from observation creation
- Update `src/god/message-dispatcher.ts` — remove round from observation creation

#### God task analysis (`src/types/god-schemas.ts`)

- Delete `suggestedMaxRounds` from `GodTaskAnalysisSchema`
- Delete `terminationCriteria` from `GodTaskAnalysisSchema`
- Resulting schema: `{ taskType, reasoning, phases, confidence }`

#### Session persistence (`src/session/session-manager.ts`)

- Delete `round` from `SessionState`
- Delete `round` from `HistoryEntry`
- Delete `round` from `SessionSummary`
- Delete `godConvergenceLog` from `SessionStateFull` (if exists)

#### Session types (`src/types/session.ts`)

- Delete `RoundRecord` interface entirely

#### Phase transition (`src/god/phase-transition.ts`)

- Change parameter type from `GodPostReviewerDecision` to accept `GodDecisionEnvelope`'s `set_phase` action
- Remove convergenceLog parameter and phase summary that references `lastEntry.round`
- Simplify: function takes a `set_phase` action + phases array → returns next phase

#### Consistency checker (`src/god/consistency-checker.ts`)

- Remove `GodConvergenceJudgment` validation rules
- Remove `GodPostReviewerDecision` validation rules
- Either repurpose for `GodDecisionEnvelope` validation or delete if no remaining checks needed

#### God call (`src/god/god-call.ts`)

- Remove round from logging metadata

#### God system prompt (`src/god/god-system-prompt.ts`)

- Remove `suggestedMaxRounds` and `terminationCriteria` from example JSON

#### Task init (`src/god/task-init.ts`)

- Remove `suggestedMaxRounds` validation/handling

### 3. Round Removal — UI Layer

#### App.tsx (`src/ui/components/App.tsx`)

- Remove `convergenceLogRef` (never written to, dead)
- Remove `roundsRef` and all `RoundRecord` tracking
- Remove all 72+ `ctx.round` references — these fall into categories:
  - Prompt building params → delete round/maxRounds params
  - Observation creation → delete round field
  - Timeline events → delete round from labels
  - Audit entries → delete round
  - Session persistence → delete round from saved state
  - Round summary messages → delete (`createRoundSummaryMessage` calls)
- Remove `suggestedMaxRounds` usage in task init handling
- Remove `maxRounds` assignment from `TASK_INIT_COMPLETE` handling
- Remove round/maxRounds props passed to StatusBar, MainLayout, ContextOverlay

#### StatusBar (`src/ui/components/StatusBar.tsx`)

- Delete `round` and `maxRounds` props
- Delete progress bar display (`buildProgressBar`, round string)
- StatusBar shows: state, god latency, adapter info (no round progress)

#### MainLayout (`src/ui/components/MainLayout.tsx`)

- Delete `round`/`maxRounds` from `StatusBarProps`
- Remove passing round to StatusBar

#### TaskAnalysisCard (`src/ui/components/TaskAnalysisCard.tsx`)

- Delete `suggestedMaxRounds` display (English and Chinese labels)

#### ContextOverlay (`src/ui/components/ContextOverlay.tsx`)

- Delete `roundNumber` prop and its display

#### Session runner state (`src/ui/session-runner-state.ts`)

- Delete `RestoredSessionRuntime.rounds`
- Delete `RestoredSessionRuntime.godConvergenceLog`
- Delete `buildRounds()` function
- Remove round from workflow input restoration

#### Reclassify overlay (`src/ui/reclassify-overlay.ts`)

- Remove round from audit entry creation

#### CLI commands (`src/cli-commands.ts`)

- Remove round display from session listing/info

### 4. What We Keep

| Kept | Why |
|------|-----|
| `GodAuditEntry.seq` + `timestamp` | Audit ordering — replaces round |
| `Observation.timestamp` | Observation ordering |
| Workflow state machine states | CODING/REVIEWING/GOD_DECIDING already indicates position |
| `GodTaskAnalysis.taskType/phases/confidence/reasoning` | Still needed for task init |
| `accept_task` action | God's termination mechanism |
| WatchdogService retry + pause | God call failure protection |
| `GodDecisionEnvelope` and its schema | The unified decision type |

### 5. Backward Compatibility

- **Old sessions**: Sessions persisted with `round` fields in `SessionState` and `HistoryEntry` will have those fields silently ignored on restoration (TypeScript will not read undefined fields)
- **Old audit logs**: Existing `.jsonl` audit files with `round` fields remain readable — we just stop writing the field
- **god-schemas.ts**: After cleanup, only `TaskTypeSchema` and simplified `GodTaskAnalysisSchema` remain. Old session data referencing removed schemas will be ignored on restore.

### 6. Testing Strategy

- Delete test files for deleted modules (god-convergence, round-summary)
- Update remaining tests that reference round fields — remove round from test fixtures
- `npx tsc --noEmit` must pass with zero errors
- All remaining tests must pass
- Key test areas to verify:
  - workflow-machine tests (round removed from context)
  - god-decision-service tests (round removed from context)
  - god-prompt-generator tests (round removed from prompts)
  - session-manager tests (round removed from persistence)
  - App component tests (round removed from props/state)
  - StatusBar tests (round props removed)

## Estimated Impact

- **Files deleted**: 5 (2 production + 3 test)
- **Files modified**: ~25
- **Lines removed**: ~800-1000
- **Lines added**: ~0 (pure deletion)
- **New features**: None — this is a cleanup/simplification

## Non-Goals

- No new convergence features
- No iteration counter replacement
- No observation injection for loop protection
- No changes to God's SYSTEM_PROMPT decision logic (already handles accept_task)

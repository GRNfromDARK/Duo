# Status Indicators Gap Analysis — v2 (Revised)

> Phase: explore | Date: 2026-03-15 | Author: Executor

---

## 1. Current Indicator Inventory

### A. Functioning & Wired

| Component | File:Line | Trigger Condition | What User Sees |
|-----------|-----------|-------------------|----------------|
| **ThinkingIndicator** | ThinkingIndicator.tsx:63 → MainLayout.tsx:324 | `isLLMRunning=true` AND no streaming content yet | `⣾ Thinking...` (cyan, animated) |
| **StatusBar** | StatusBar.tsx:69 → MainLayout.tsx:277 | Always visible (top row) | Progress bar, agent label, status icon, phase, degradation |
| **InputArea prompt** | InputArea.tsx:218-220 | Always visible (bottom row) | `◆`(yellow) when LLM running, `▸`(cyan) when idle |
| **ScrollIndicator** | ScrollIndicator.tsx → MainLayout.tsx:327 | Scrolled up + new messages | `↓ New output (N new) (press G)` |
| **TaskBanner** | TaskBanner.tsx → MainLayout.tsx:300 | `contextData.taskSummary` present | `▸ Task: <summary>` |
| **TaskAnalysisCard** | TaskAnalysisCard.tsx → App.tsx:1884 | `showTaskAnalysisCard=true` in TASK_INIT state | Full-screen overlay: task type selection + countdown |
| **CompletionScreen** | CompletionScreen.tsx → App.tsx:1923 | `stateValue === 'DONE'` | Footer replaces InputArea with 3-option menu |
| **Degradation notification** | App.tsx:552-555 | `withGodFallback` returns a notification | System message: `'◈ God retrying...'` etc. |

### B. Components Exist But NEVER Triggered (Dead UI)

| Component | File:Line | Why It's Dead |
|-----------|-----------|---------------|
| **GodDecisionBanner** | GodDecisionBanner.tsx → App.tsx:1870 | `showGodBanner` is initialized `false` (L360) and only ever set to `false` (L1156, L1657, L1681, L1722). **No code path sets it to `true`.** The component renders but the guard condition never passes. |
| **PhaseTransitionBanner** | PhaseTransitionBanner.tsx → App.tsx:1853 | `showPhaseTransition` is initialized `false` (L366) and only ever set to `false` (L1510, L1791, L1810). **No code path sets it to `true`.** Same dead pattern. |
| **StreamRenderer inline spinner** | StreamRenderer.tsx → MessageView.tsx:27 | `StreamRenderer` is rendered inside `MessageView`, but `MessageView` has **no call site** in the live render path. `MainLayout.tsx` (L143, L320) renders `RenderedLineView` from `buildRenderedMessageLines`, not `MessageView`. The component is valid code but unreachable at runtime. |

### C. Completely Missing (No Component or Wiring)

| Gap | Duration | Current Feedback | User Impact |
|-----|----------|-----------------|-------------|
| GOD_DECIDING thinking phase (before decision) | 10-30s | StatusBar shows `◈ Routing`; message area silent | High — looks frozen |
| OBSERVING classification | <5ms | Nothing (timeline event in verbose only) | Low — too fast to notice |
| EXECUTING hand actions | <100ms typical, can be seconds | Nothing | Medium — usually fast but opaque |
| INTERRUPTED intent classification | Up to 15s | Nothing until result arrives | **Critical** — user just pressed interrupt, silence |
| Startup CLI detection | Up to 3s | Blank terminal (before Ink renders) | Medium — cold start confusion |
| Safe shutdown | Variable | Nothing (process exits) | Low-Medium — unclear if state was saved |
| CLARIFYING vs INTERRUPTED distinction | N/A | Both show `⏸ Interrupted` in StatusBar | Medium — user doesn't know if input needed |
| Routing state agent label | N/A | `getActiveAgentLabel()` returns `null` for GOD_DECIDING/OBSERVING/EXECUTING/TASK_INIT | Low — StatusBar shows no agent name |
| RESTORED_TO_CLARIFYING resume path | N/A | Dead code: `workflow-machine.ts:568` defines handler but `session-runner-state.ts:519` maps `clarifying` → `RESTORED_TO_INTERRUPTED` | Medium — resume loses clarifying context |

---

## 2. Gap Details (Prioritized)

### P0-1: INTERRUPTED Intent Classification — 15s Silent Wait (CRITICAL)

**What happens**: User presses Ctrl+C → state becomes `INTERRUPTED` → user types input → `handleInputSubmit` fires → `classifyInterruptIntent()` called with 15-second timeout (App.tsx:1488-1530, interrupt-clarifier.ts:24).

**Why it's the worst gap**: The user has taken the strongest possible action (interrupt), then typed a message, then... silence. For up to 15 seconds. No spinner, no "classifying your intent...", nothing. The `isLLMRunning` flag is `false` because the state is `INTERRUPTED` not `CODING/REVIEWING`. The InputArea shows `▸ Type a message...` as if idle.

**References**:
- App.tsx L1488: `if (degradationManagerRef.current.isGodAvailable())`
- App.tsx L1491: `classifyInterruptIntent(godAdapterRef.current, interruptContext)`
- interrupt-clarifier.ts L24: `const GOD_TIMEOUT_MS = 15_000`
- interrupt-clarifier.ts L36: function signature

**Fix approach**: Add a system message immediately before the async IIFE at L1489: `"◈ Classifying interrupt intent..."`. Add a state-aware indicator (spinner + elapsed time) visible during the wait. Clear it when the classification resolves.

---

### P0-2: GOD_DECIDING Phase — 10-30s Silent Decision Making

**What happens**: After OBSERVING completes → GOD_DECIDING state → `GodDecisionService` calls God LLM → up to 120s timeout (GOD_DECIDING_TIMEOUT_MS). StatusBar shows `◈ Routing` but message area is completely silent.

**Why it matters**: 10-30 seconds of apparent freeze after every coder/reviewer output. The `GodDecisionBanner` component exists and looks great but is **never shown** because `showGodBanner` is never set to `true`.

**Additionally**: No elapsed-time counter. The 120s timeout (App.tsx:1173-1186) fires with an error message but the user has no countdown or progress.

**References**:
- App.tsx L360: `useState(false)` — never set true
- App.tsx L1156, L1657, L1681, L1722: only `setShowGodBanner(false)`

**Fix approach**: Show a thinking indicator with elapsed time in the message area during GOD_DECIDING. The existing `GodDecisionBanner` wiring should eventually be fixed but this is a separate task.

---

### P0-3: TASK_INIT God Analysis — Silent Before Card Appears

**What happens**: In TASK_INIT state, `initializeTask()` calls God LLM. `isLLMRunning` is `false` because state is `TASK_INIT`, not `CODING`/`REVIEWING`. A system message "Analyzing task with God orchestrator..." is added (App.tsx:515), but **no animated indicator appears**. ThinkingIndicator does not show because `shouldShowThinking()` requires `isLLMRunning=true`.

**Duration**: 5-30 seconds depending on God adapter latency.

**What partially works**: After God responds, `TaskAnalysisCard` renders as a full-screen overlay — this part works correctly (App.tsx:1884).

**Fix approach**: Show a thinking indicator with custom message `"◈ Analyzing task..."` during the gap between TASK_INIT start and TaskAnalysisCard appearance.

---

### P1-1: CLARIFYING vs INTERRUPTED vs MANUAL_FALLBACK — Indistinguishable

**What happens**: Three different states all map to `status: 'interrupted'` (App.tsx:119-124):
- `MANUAL_FALLBACK` → user must choose routing action
- `INTERRUPTED` → user has interrupted, system may classify intent
- `CLARIFYING` → God has asked a clarification question, waiting for answer

**User impact**: StatusBar shows `⏸ Interrupted` for all three. InputArea shows `▸ Type a message...` for all three. User doesn't know if system needs specific input or is just paused.

**Resume bug**: `session-runner-state.ts:519` maps `clarifying` → `RESTORED_TO_INTERRUPTED`. The `RESTORED_TO_CLARIFYING` event exists in workflow-machine.ts:568 but is dead code — never dispatched. This means if a session is interrupted during CLARIFYING and resumed, the clarifying question context is lost and the user sees generic INTERRUPTED behavior.

**References**:
- App.tsx L119-124: all three → `'interrupted'`
- session-runner-state.ts L518-519: `case 'clarifying': return 'RESTORED_TO_INTERRUPTED'`
- workflow-machine.ts L65-66: `RESTORED_TO_CLARIFYING` type defined
- workflow-machine.ts L568-570: handler exists but unreachable
- InputArea.tsx L218-220: only `isLLMRunning` binary

**Fix approach**:
1. Map CLARIFYING → new status `'awaiting_input'` in `mapStateToStatus`
2. InputArea: show `❓` prompt with `"Answer God's question..."` placeholder for CLARIFYING
3. InputArea: show `⏸` with `"Choose action: (c)ontinue / (r)estart / (s)kip"` for MANUAL_FALLBACK
4. Fix resume mapping: `clarifying` → `RESTORED_TO_CLARIFYING` in session-runner-state.ts

---

### P1-2: EXECUTING Hand Actions — Silent Execution

**What happens**: `executeActions()` in hand-executor.ts processes God's actions sequentially. Returns `Observation[]`. The results are sent to state machine via `EXECUTION_COMPLETE` but no system messages are emitted during or after execution.

**Important constraint**: `switch_adapter` modifies `adapterConfig` map internally (hand-executor.ts:251-261) but App.tsx never reads this change back — the config `coder`/`reviewer` fields remain unchanged. So showing "Adapter switched" would be misleading.

**Fix approach**: After `executeActions` returns in App.tsx, consume the `Observation[]` results and emit system messages for user-visible actions only (send_to_coder, send_to_reviewer, set_phase, stop_role, accept_task). Do NOT show switch_adapter until the wiring is complete. Add these as routing event messages visible in verbose mode, with key ones (accept_task, set_phase) visible in minimal mode too.

---

### P1-3: `getActiveAgentLabel` Returns Null for Routing States

**What happens**: `getActiveAgentLabel()` (App.tsx:134-144) only handles CODING and REVIEWING. For GOD_DECIDING, OBSERVING, EXECUTING, TASK_INIT it returns `null`. The StatusBar shows `◈ Routing` with no agent name.

**Fix approach**: Return contextual labels:
- `TASK_INIT` → `"God:Init"`
- `GOD_DECIDING` → `"God:Deciding"`
- `OBSERVING` → `"God:Observing"`
- `EXECUTING` → `"God:Executing"`
- `CLARIFYING` → `"God:Clarifying"`

---

### P1-4: God Timeout No Countdown

**What happens**: `GOD_DECIDING_TIMEOUT_MS = 120_000` (2 minutes). During this period, the only feedback is StatusBar `◈ Routing`. If timeout fires, an error message appears. No progress or elapsed time shown.

**Fix approach**: Incorporate elapsed time into the routing state indicator: `"◈ God deciding... (15s)"`. After 30s, change color to yellow. After 60s, change to red.

---

### P2-1: CLI Bootstrap Silence (3s)

**What happens**: `cli.ts:25` calls `detectInstalledCLIs()` before `render()` at line 50. Detection runs all adapters in parallel with 3s timeout (detect.ts:20). The terminal is blank during this period.

**Fix approach (deferred)**: Print a plain `console.log('Detecting installed adapters...')` before detection, or move detection into the Ink render tree.

---

### P2-2: Safe Shutdown Silence

**What happens**: `performSafeShutdown()` (safe-shutdown.ts:16-34) interrupts streams, kills all adapters (`Promise.allSettled`), runs `beforeExit` for session persistence, then exits. No UI message at any point.

**Fix approach (deferred)**: Add a system message `"Saving session and shutting down..."` before starting shutdown sequence. Requires passing `addMessage` into the shutdown path.

---

### P2-3: GodDecisionBanner / PhaseTransitionBanner Wiring

**What happens**: Both components are fully implemented with beautiful UIs (countdown, keyboard interaction) but never rendered due to `setShowGodBanner(true)` and `setShowPhaseTransition(true)` never being called.

**Fix approach (deferred)**: This requires understanding the original design intent. The GOD_DECIDING effect at App.tsx:1156 sets them to `false` but was likely intended to set them to `true` under certain conditions. Needs investigation of original spec.

---

### P2-4: Loop Detection / Token Budget / Reviewer Heartbeat

These are polish items for verbose/power-user feedback:
- Convergence/loop detection notifications
- Context truncation notices from ContextManager
- Long-running reviewer heartbeat ("still reviewing... 45s")

---

## 3. Architecture Constraints

### DO: Consume existing outputs at App.tsx layer
- `DegradationManager` already returns `DegradationNotification` objects (degradation-manager.ts:45-54) — App.tsx consumes them at L552-555
- `executeActions()` already returns `Observation[]` — App.tsx can inspect these for user-visible system messages
- `classifyInterruptIntent()` returns classification — App.tsx can emit pre/post messages around the call

### DO NOT: Add UI callbacks to core layers
- Don't modify `hand-executor.ts` to accept UI callbacks
- Don't modify `degradation-manager.ts` to emit UI events
- Don't add React concerns to `god-decision-service.ts`

### DO NOT: Show misleading status
- `switch_adapter` in hand-executor modifies internal `adapterConfig` map but App.tsx never reads this back to `config.coder`/`config.reviewer`. Showing "adapter switched" would be misleading because subsequent CODING states still use the original config values.

---

## 4. Execution Plan

### Phase-2 First Batch (4 items)

#### Item 1: State-Aware Thinking/Status Indicator

**Scope**: Extend ThinkingIndicator (or create a sibling) to show context-aware messages with elapsed time for non-CODING/REVIEWING states.

**States covered**:
| State | Message | Color |
|-------|---------|-------|
| TASK_INIT (before card) | `◈ Analyzing task...` | yellow |
| GOD_DECIDING | `◈ God deciding... (Xs)` | yellow |
| INTERRUPTED (classifying) | `◈ Classifying intent... (Xs)` | yellow |
| EXECUTING | `◈ Executing actions...` | yellow |

**Note**: The EXECUTING indicator should be thresholded to avoid flicker on fast actions (<100ms). Consider only showing the indicator for `wait` actions or after a short delay (e.g., 200ms debounce).

**Files to modify**:
- `ThinkingIndicator.tsx` — add `message`, `color` props
- `MainLayout.tsx` — accept workflow state, pass to ThinkingIndicator
- `App.tsx` — pass `stateValue` and custom flags to MainLayout

**Key detail**: For INTERRUPTED intent classification, the indicator needs to be triggered by a new `isClassifyingIntent` state flag set before the async call at App.tsx:1489 and cleared in the `.then`/`.catch`.

#### Item 2: Distinguish CLARIFYING / INTERRUPTED / MANUAL_FALLBACK

**Scope**: Give each state unique StatusBar status, InputArea prompt, and resume behavior.

**Changes**:
| State | StatusBar | InputArea Icon | InputArea Placeholder |
|-------|-----------|---------------|----------------------|
| CLARIFYING | `❓ Awaiting Input` (cyan) | `❓` cyan | `"Answer God's question..."` |
| INTERRUPTED | `⏸ Interrupted` (white) | `⏸` white | `"Type to redirect, or wait..."` |
| MANUAL_FALLBACK | `⚡ Manual Route` (yellow) | `⚡` yellow | `"Choose: (c)ontinue / (r)estart..."` |

**Files to modify**:
- `StatusBar.tsx` — add `'awaiting_input'` and `'manual_fallback'` to `WorkflowStatus`
- `App.tsx` L108-132 — update `mapStateToStatus` for new mappings
- `InputArea.tsx` L218-220 — accept `workflowState` prop for prompt context
- `MainLayout.tsx` — pass `workflowState` through to InputArea
- `session-runner-state.ts` L519 — change `clarifying` → `RESTORED_TO_CLARIFYING`

#### Item 3: Consume Existing Outputs for System Messages

**Scope**: After `executeActions` returns in App.tsx, inspect `Observation[]` and emit system messages for user-visible actions.

**Actions to surface** (minimal mode):
- `accept_task` → `"✓ Task accepted by God"`
- `set_phase` → `"→ Phase transition: {phaseId}"`

**Actions to surface** (verbose mode only, `isRoutingEvent: true`):
- `send_to_coder` → `"▸ Instruction sent to Coder"`
- `send_to_reviewer` → `"▸ Instruction sent to Reviewer"`
- `stop_role` → `"⏹ Stopping {role}"`

**NOT surfaced** (misleading until wiring complete):
- `switch_adapter` — App.tsx doesn't apply the change

**Files to modify**:
- `App.tsx` L1329-1414 — add message generation after executeActions returns

#### Item 4: Routing State Agent Labels

**Scope**: Return meaningful labels from `getActiveAgentLabel` for routing states.

**Files to modify**:
- `App.tsx` L134-144 — add cases for TASK_INIT, GOD_DECIDING, OBSERVING, EXECUTING, CLARIFYING

---

### Deferred (NOT in Phase-2)

| Item | Reason for Deferral |
|------|-------------------|
| Wire GodDecisionBanner (set `showGodBanner=true`) | Needs spec review — original design intent unclear |
| Wire PhaseTransitionBanner (set `showPhaseTransition=true`) | Same as above |
| New RoutingIndicator component | Overkill — existing ThinkingIndicator extension covers the need |
| CLI bootstrap spinner | Requires pre-Ink rendering changes |
| Safe shutdown feedback | Requires threading UI callback into shutdown path |
| Loop/convergence detection notifications | P2 polish |
| Token budget pressure notifications | P2 polish |
| Reviewer heartbeat (long-running) | P2 polish |

---

## 5. File Coverage

### Phase-2 First Batch Files

| File | Change Type |
|------|------------|
| `src/ui/components/ThinkingIndicator.tsx` | Extend props: `message`, `color`, elapsed time |
| `src/ui/components/MainLayout.tsx` | Accept `workflowState`, pass to ThinkingIndicator + InputArea |
| `src/ui/components/App.tsx` | State mapping, `isClassifyingIntent` flag, execution messages, agent labels, pass workflowState |
| `src/ui/components/StatusBar.tsx` | Add `'awaiting_input'`, `'manual_fallback'` statuses |
| `src/ui/components/InputArea.tsx` | Accept `workflowState` for contextual prompt/icon |
| `src/ui/session-runner-state.ts` | Fix resume mapping: `clarifying` → `RESTORED_TO_CLARIFYING` |

### Deferred Files

| File | When |
|------|------|
| `src/ui/safe-shutdown.ts` | Batch 2 (shutdown feedback) |
| `src/cli.ts` | Batch 2 (bootstrap spinner) |
| `src/adapters/detect.ts` | Batch 2 (bootstrap spinner) |
| `GodDecisionBanner.tsx` / `PhaseTransitionBanner.tsx` | Batch 2 (wiring fix) |

---

## 6. Test Impact

All phase-2 changes should update or add tests in:
- `src/__tests__/ui/thinking-indicator.test.tsx` — new props
- `src/__tests__/ui/main-layout.test.tsx` — workflowState passthrough
- `src/__tests__/ui/status-bar.test.tsx` — new status types
- `src/__tests__/ui/input-area.test.tsx` — contextual prompts
- `src/__tests__/ui/session-runner-state.test.ts` — resume mapping fix

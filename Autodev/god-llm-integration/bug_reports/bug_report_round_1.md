审计完成。以下是 Bug 报告：

---

### BUG-1 [P1] PhaseTransitionBanner 取消后 pendingPhaseId 未从 XState context 清除

- 文件: `src/ui/components/App.tsx:1684-1695`
- 问题: 当用户按 Esc 取消 PhaseTransitionBanner 时，`handlePhaseTransitionCancel` 仅清除了 React state (`setPendingPhaseTransition(null)`, `setShowPhaseTransition(false)`)，但 **未向 XState 发送任何事件来清除** `context.pendingPhaseId` 和 `context.pendingPhaseSummary`。

  触发路径：
  1. God routing 返回 `phase_transition` → 发送 `PHASE_TRANSITION` event → XState 设置 `pendingPhaseId` + 转换到 `WAITING_USER`
  2. 用户按 Esc → `handlePhaseTransitionCancel` → 仅清 React state
  3. 用户输入 `c` (continue) → `send({ type: 'USER_CONFIRM', action: 'continue' })`
  4. XState guard `confirmContinueWithPhase` 检查 `context.pendingPhaseId !== null` → **TRUE**（从未清除）
  5. 结果：XState 执行被取消的阶段转换，更新 `taskPrompt` 为 `[Phase: ...]`，round +1

- 预期: 取消后，用户输入 `c` 应该走普通的 `confirmContinue` 路径（无阶段切换），而不是被幽灵 `pendingPhaseId` 误导
- 建议修复: 在 `handlePhaseTransitionCancel` 中发送一个清除 pendingPhaseId 的 XState event（如新增 `CLEAR_PENDING_PHASE` event），或在 state machine 的 `WAITING_USER` 状态添加一个 self-transition event 来重置 pending fields

---

### BUG-2 [P1] WAITING_USER 自动决策与 PhaseTransitionBanner 的竞争

- 文件: `src/ui/components/App.tsx:1321-1399` + `1728-1739`
- 问题: 当 God routing 返回 `phase_transition` 时，`send(godResult.event)` 使状态转到 `WAITING_USER`（line 1084）。此时两件事同时发生：
  1. PhaseTransitionBanner 显示（通过 React state）
  2. WAITING_USER useEffect 启动，执行 God auto-decision 异步 IIFE

  auto-decision 异步调用 `makeAutoDecision` 可能返回 `accept` 或 `continue_with_instruction`，然后设置 `showGodBanner(true)`。虽然渲染优先级上 PhaseTransitionBanner 先检查（line 1728 vs 1743），但如果用户确认了阶段转换（触发状态变到 CODING），而此时 auto-decision 的异步回调仍在执行（`cancelled` 在 cleanup 中设为 true，但存在微妙的时序窗口），可能导致在下次进入 WAITING_USER 时残留过期的 `godDecision` state。

  更关键的是：**不应该在 phase_transition 等待期间启动 auto-decision**。这浪费了一次 God 调用且可能产生与 phase transition 冲突的决策。

- 预期: 当有 pending phase transition 时，WAITING_USER useEffect 应跳过 God auto-decision
- 建议修复: 在 WAITING_USER useEffect 开头添加 `if (showPhaseTransition) return;` 或检查 `ctx.pendingPhaseId !== null`

---

### BUG-3 [P2] WAITING_USER 消息去重使用 stale closure 中的 messages

- 文件: `src/ui/components/App.tsx:1332-1336`
- 问题: 
  ```typescript
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.content !== manualWaitingMsg) {
    addMessage({ role: 'system', content: manualWaitingMsg, ... });
  }
  ```
  useEffect 的依赖是 `[stateValue]`，但使用了 `messages` 状态变量。`messages` 在 effect 创建时被捕获（stale closure），不会反映中间的 state 更新。如果 God 被禁用且状态多次进入 WAITING_USER（例如通过 cancel → reclassify → return），去重判断可能失效，导致重复的 "Waiting for your decision" 消息。

- 预期: 去重检查应使用最新的 messages 或采用其他机制（如 flag）
- 建议修复: 使用 `setMessages(prev => ...)` 回调形式在内部检查，或将 `messages` 加入依赖数组

---

### BUG-4 [P2] Ctrl+R 中断 LLM 后 ReclassifyOverlay 取消，用户停留在 INTERRUPTED 无明确提示

- 文件: `src/ui/components/App.tsx:1596-1612` + `1656-1663`
- 问题: 在 CODING/REVIEWING 状态下按 Ctrl+R 时：
  1. `handleReclassify` 先发送 `USER_INTERRUPT`（状态 → INTERRUPTED）
  2. 显示 ReclassifyOverlay
  
  如果用户按 Esc 取消重分类：
  - `handleReclassifyCancel` 仅隐藏 overlay 并显示 "Task reclassification cancelled."
  - **不发送任何 XState event**
  - 状态停留在 **INTERRUPTED**
  - 用户看到 "cancelled" 消息但不知道需要手动输入才能恢复
  
  对比：`handleReclassifySelect` 在 INTERRUPTED 状态下会发送 `USER_INPUT` 来恢复。

- 预期: 取消后应自动恢复（发送 USER_INPUT 回到之前的 role），或至少明确提示用户 "Enter new instructions to continue"
- 建议修复: 在 `handleReclassifyCancel` 中检测 `stateValue === 'INTERRUPTED'`，自动发送 `USER_INPUT` 恢复到之前的 role，或添加明确的恢复提示消息

---

VERDICT: BUGS_FOUND | P0:0 P1:2 P2:2

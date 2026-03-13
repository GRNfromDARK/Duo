Now I have enough code to conduct a thorough audit. Let me analyze the key findings.

---

Based on thorough reading of all changed files, here are the new bugs found (not previously reported):

### BUG-19 [P2] `handleInterrupt` 和 state-save useEffect 中 `taskAnalysis` 的 stale closure 导致重分类后会话保存错误
- 文件: src/ui/components/App.tsx:1489 和 src/ui/components/App.tsx:503
- 问题: `handleInterrupt` useCallback 的依赖数组为 `[stateValue, ctx, send, exit, addMessage, addTimelineEvent]`，不包含 `taskAnalysis`。同样，状态保存 useEffect 的依赖数组为 `[stateValue, ctx.round]`，也不包含 `taskAnalysis`。在 WAITING_USER 状态下通过 Ctrl+R 重分类任务类型时（`handleReclassifySelect` 调用 `setTaskAnalysis(updatedAnalysis)` 但不发送 XState 事件），`stateValue` 不变，因此这两个闭包中捕获的 `taskAnalysis` 仍是旧值。若用户重分类后立即双击 Ctrl+C 退出，`sessionManager.saveState` 保存的 `godTaskAnalysis` 包含旧的 `taskType`（如 'code' 而非用户选择的 'debug'）。`duo resume` 恢复后 God prompt 使用错误的任务策略。
- 预期: 双击 Ctrl+C 保存应始终写入最新的 `taskAnalysis` 值
- 建议修复: 将 `taskAnalysis` 添加到 `handleInterrupt` 的依赖数组和 state-save useEffect 的依赖数组中；或将 `taskAnalysis` 改为 ref（`taskAnalysisRef`）以避免 stale closure

### BUG-20 [P2] XState `confirmContinueWithPhase` guard 使用严格不等（`!== null`）未排除 `undefined`，可能误触发阶段转换
- 文件: src/engine/workflow-machine.ts:100-101
- 问题: Guard 定义为 `(event as UserConfirmEvent).action === 'continue' && context.pendingPhaseId !== null`。当 God 决策的 `nextPhaseId` 为 `undefined`（Zod schema 允许 `z.string().optional()`）时，PHASE_TRANSITION 事件的 assign 将 `pendingPhaseId` 设为 `undefined`。由于 JavaScript 中 `undefined !== null` 为 `true`，guard 会错误通过，导致 `taskPrompt` 被更新为 `[Phase: undefined] ...`。虽然当前 CODING/REVIEWING useEffect 不直接消费 `ctx.taskPrompt`（使用 `config.task` + React 的 `currentPhaseId`），但 XState context 中的数据不一致，且如果未来有代码读取 `taskPrompt`，会产生错误行为。
- 预期: `pendingPhaseId` 为 `null` 或 `undefined` 时，guard 应返回 false
- 建议修复: 将 guard 改为 `context.pendingPhaseId != null`（宽松比较）或 `context.pendingPhaseId !== null && context.pendingPhaseId !== undefined`

### BUG-21 [P2] WAITING_USER 状态下重分类后 God auto-decision 不会重新触发，用户停留在手动模式
- 文件: src/ui/components/App.tsx:1333-1419
- 问题: WAITING_USER auto-decision useEffect 的依赖数组为 `[stateValue, showPhaseTransition]`。在 WAITING_USER 状态下通过 Ctrl+R 重分类任务后（`handleReclassifySelect` 中 `setShowReclassify(false)` + `setGodDecision(null)` + `setShowGodBanner(false)`），`stateValue` 仍为 WAITING_USER，`showPhaseTransition` 未变，因此 auto-decision effect 不会重新运行。之前的 auto-decision 已被 BUG-7 fix 清除（`setGodDecision(null); setShowGodBanner(false)`），但新的 auto-decision 不会启动。用户在重分类后只能手动输入 `[c]`/`[a]`，而消息提示 "Continuing with new type" 暗示系统会自动继续。
- 预期: 重分类后应重新触发 God auto-decision（如果 God 可用），或在消息中明确告知用户需手动操作
- 建议修复: 在 `handleReclassifySelect` 中添加一个专用的 state flag（如 `reclassifyTrigger`）作为 WAITING_USER useEffect 的依赖，或在 WAITING_USER 且 God 可用时重分类后显式发送 `USER_CONFIRM continue` 自动继续

VERDICT: BUGS_FOUND | P0:0 P1:0 P2:3

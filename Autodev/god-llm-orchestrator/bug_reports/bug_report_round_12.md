## Bug 审计报告（第 12 轮）

### 前几轮修复状态确认

经逐一验证源代码，前 11 轮报告的关键 bug 均已修复：
- Round 11 BUG-1 (ROUTING_POST_REVIEW maxRounds guard): **已修复**，`workflow-machine.ts:234-246` 使用 `canContinueRounds` guard 数组
- Round 11 BUG-3 (needs_discussion + shouldTerminate 矛盾): **已修复**，`consistency-checker.ts:106-113` 添加 Rule 4 检查
- Round 10 全部修复确认通过
- Round 9 全部修复确认通过
- Round 8 全部修复确认通过
- Round 7, 6, 5, 4, 3, 2, 1 全部已修复

---

### BUG-1 [P1] task-init.ts 的 collectAdapterOutput 仍然丢弃 error 类型 chunk（Round 9 修复遗漏）

- **文件**: `src/god/task-init.ts:63`
- **问题**: Round 9 BUG-3 修复了 `collectAdapterOutput` 丢弃 `error` 类型 chunk 的问题，Round 10 确认"全部 4 个模块包含 `chunk.type === 'error'`"，但实际验证发现 `task-init.ts:63` 仍然只收集 `'text'` 和 `'code'`：
  ```typescript
  // task-init.ts:63 — 缺少 'error'
  if (chunk.type === 'text' || chunk.type === 'code') {
  ```
  对比其他 3 个已修复的模块：
  ```typescript
  // god-convergence.ts:357, god-router.ts:104, auto-decision.ts:60 — 已包含 'error'
  if (chunk.type === 'text' || chunk.type === 'code' || chunk.type === 'error') {
  ```
  当使用 TextStreamParser 适配器（Aider、Amazon Q、Goose）作为 God adapter 进行 TASK_INIT 时，God 推理文本中匹配 `ERROR_PATTERNS`（如以 `Error:`、`fatal:`、`exception:` 开头的行）的内容会被 TextStreamParser 分类为 `type: 'error'` 并被 `task-init.ts` 丢弃。如果 God 的 GodTaskAnalysis JSON 块恰好在被丢弃的 error 行之后输出，JSON 提取仍然可以工作（因为 JSON 在 code fence 内作为 `type: 'code'` 收集）。但 `rawOutput`（`TaskInitResult.rawOutput`，line 101）会不完整，影响审计日志记录和调试。更严重的是，如果 God 的推理文本中包含 `Error: the task analysis shows...` 这样以 Error 开头的正常推理行，这些行会被丢弃，导致 `rawOutput` 缺失上下文。
- **预期**: 与其他 3 个模块保持一致，添加 `|| chunk.type === 'error'`。
- **建议修复**: 将 line 63 改为 `if (chunk.type === 'text' || chunk.type === 'code' || chunk.type === 'error') {`

### BUG-2 [P1] convergence-service detectLoop Check 2 扫描全部历史输出，长会话中产生大量误报

- **文件**: `src/decision/convergence-service.ts:199-208`
- **问题**: `detectLoop` 的 Check 2 遍历 **所有** `previousOutputs`（不限于最近几轮），只要当前输出与其中任意 2 个历史输出的 Jaccard 相似度 ≥ 0.45 即判定为 loop：
  ```typescript
  // Check 2: recurring pattern — current similar to 2+ non-consecutive older outputs
  if (previousOutputs.length >= 3) {
    let matchCount = 0;
    for (const previous of previousOutputs) {  // ← 遍历 ALL history
      if (this.isSimilar(current, previous)) {
        matchCount++;
        if (matchCount >= 2) return true;  // ← 仅需 2 个匹配
      }
    }
  }
  ```
  在 20 轮长会话中，随着同一项目的多轮修复，reviewer 输出必然共享大量项目/文件名关键词（如 `session`, `adapter`, `manager`, `convergence` 等），即使讨论的具体问题完全不同。`isSimilar` 的 Jaccard 计算包括这些共享术语，在 20 个历史输出中找到 2 个超过 0.45 阈值的非常容易。一旦触发，`evaluate()`（line 122-123）会返回 `shouldTerminate: true, reason: 'loop_detected'`，直接终止任务。此路径是 God 降级后（L4）的 fallback 路径，在 God 不可用时承担收敛判断。
- **预期**: Check 2 应限制扫描范围（如最近 6-8 轮），或提高多历史匹配的阈值（如需要 3+ 匹配而非 2），以避免长会话中的误报。
- **建议修复**: 将 `previousOutputs` 替换为 `previousOutputs.slice(-8)` 或提高 `matchCount` 阈值到 3。

### BUG-3 [P2] DegradationState (L4 godDisabled) 未持久化到 SessionState，duo resume 后 L4 状态丢失

- **文件**: `src/god/degradation-manager.ts:95-97` + `src/session/session-manager.ts:31-47`
- **问题**: `DegradationManager` 提供了 `serializeState()` 方法（line 95-97）和构造函数 `restoredState` 参数（line 78-79），但 `SessionState`（session-manager.ts:31-47）没有 `degradationState` 字段，也没有任何代码路径调用 `serializeState()` 并写入 snapshot.json。当 God 在会话中因 3 次连续失败进入 L4（禁用）后，`duo resume` 恢复会话时，`DegradationManager` 以默认 L1 状态构造，立即重新尝试已证明不可用的 God 调用。这导致：(1) 恢复后浪费 3 次调用才能重新达到 L4；(2) 这 3 次调用的延迟和错误对用户可见。`serializeState`/`restoredState` 的基础设施已建好但从未接入持久化层。
- **预期**: SessionState 应包含 `degradationState?: DegradationState` 字段，在每次状态保存时调用 `serializeState()` 写入，在 `duo resume` 时传入构造函数。
- **建议修复**: 在 `SessionState` 中添加 `degradationState?: DegradationState`，在 session 保存时包含降级状态。

### BUG-4 [P2] PHASE_TRANSITION 事件的 nextPhaseId 和 summary 未存入 WorkflowContext，用户确认后阶段信息丢失

- **文件**: `src/engine/workflow-machine.ts:260-262`
- **问题**: `PHASE_TRANSITION` 事件定义携带 `nextPhaseId` 和 `summary` 数据（line 47），但状态机转换到 `WAITING_USER` 时没有 `assign` 动作保存这些数据：
  ```typescript
  PHASE_TRANSITION: {
    target: 'WAITING_USER',  // ← 无 assign，事件数据丢失
  },
  ```
  对比 `CODE_COMPLETE`（line 129-134）正确使用 `assign` 保存 `output` 到 `lastCoderOutput`。`WorkflowContext`（line 11-20）也没有 `pendingPhaseId` 或类似字段。当用户在 WAITING_USER 状态确认 `continue` 时，状态机不知道应该转换到哪个阶段——`USER_CONFIRM` 的 `continue` 分支（line 306-311）只是递增 round 并进入 CODING，完全忽略了阶段转换的意图。这导致 compound 类型任务的阶段转换在经过 WAITING_USER 确认后退化为普通的轮次继续。
- **预期**: 要么在 `WorkflowContext` 中添加 `pendingPhaseTransition` 字段并通过 `assign` 保存事件数据，要么在 `USER_CONFIRM` 中添加专门处理阶段转换的分支。
- **建议修复**: 在 `WorkflowContext` 中添加 `pendingPhaseId?: string`，在 PHASE_TRANSITION 转换中使用 `assign({ pendingPhaseId: ({ event }) => event.nextPhaseId })` 保存。

---

VERDICT: BUGS_FOUND | P0:0 P1:2 P2:2

**修复优先级建议**：BUG-1（P1）最先修复——这是 Round 9 修复的遗漏，一行代码修复。BUG-2（P1）影响 God 降级后的 fallback 路径，长会话中可能过早终止任务。BUG-3 和 BUG-4 按 P2 优先级处理。

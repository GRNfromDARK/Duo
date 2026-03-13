Good — `InterruptHandler` is not used in App.tsx. The interrupt handling is done inline with `handleInterrupt` callback. So that class-level issue doesn't affect the current workflow.

Now let me finalize my findings:

审计完成。以下是 Bug 报告：

---

### BUG-14 [P1] compound 任务的 `phaseId`/`phaseType` 未传递给 God prompt 生成，所有阶段使用相同的通用策略

- 文件: `src/ui/components/App.tsx:572-580` + `src/ui/components/App.tsx:840-846`
- 问题: `generateCoderPrompt` 和 `generateReviewerPrompt` 调用均未传递 `phaseId` 和 `phaseType` 参数。`currentPhaseId` React state（line 271）在阶段转换后正确更新（line 1705），但从未传入 prompt 生成函数。

  `god-prompt-generator.ts` 中的关键逻辑：
  - Line 108-110: `effectiveType = ctx.taskType === 'compound' && ctx.phaseType ? ctx.phaseType : ctx.taskType` — 没有 `phaseType` 时，compound 任务 fallback 到 `ctx.taskType`（即 `'compound'`），映射到 `CODE_INSTRUCTIONS`（line 96 default）
  - Line 118-120: `if (ctx.taskType === 'compound' && ctx.phaseId)` — 没有 `phaseId` 时，不添加当前阶段信息 section

  结果：
  1. compound 任务的 explore 阶段仍收到 code 策略指令（包含 "implement", "write code" 等执行动词），违反 AC-013
  2. Coder/Reviewer 不知道当前处于哪个阶段，无法针对性地工作
  3. 阶段转换后（`setCurrentPhaseId`），prompt 未反映阶段变化，阶段转换实质无效
  4. `taskAnalysis.phases` 中定义的 phase type 信息（每个阶段的 `type` 字段）被完全浪费

- 预期: CODING 和 REVIEWING useEffect 中的 God prompt 路径应传递 `phaseId: currentPhaseId` 和 `phaseType: taskAnalysis.phases.find(p => p.id === currentPhaseId)?.type`
- 建议修复: 在 `generateCoderPrompt` 调用（line 572）中添加：
  ```typescript
  phaseId: currentPhaseId ?? undefined,
  phaseType: currentPhaseId
    ? taskAnalysis.phases?.find(p => p.id === currentPhaseId)?.type as PromptContext['phaseType']
    : undefined,
  ```
  `generateReviewerPrompt` 同理（如果 `PromptContext` 在该函数签名中也接受 phaseType）

---

### BUG-15 [P1] WAITING_USER auto-decision 的 `auditSeqRef` 使用 post-increment，与其他决策点的 pre-increment 不一致，可能导致 seq 冲突

- 文件: `src/ui/components/App.tsx:1358`
- 问题: WAITING_USER useEffect 中 auto-decision 的 audit seq 使用 `auditSeqRef.current++`（post-increment），而所有其他决策点使用 `++auditSeqRef.current`（pre-increment）：
  - Line 585: `seq: ++auditSeqRef.current`（CODING prompt 审计）
  - Line 1654: `seq: ++auditSeqRef.current`（reclassify 审计）
  - Line 1358: `seq: auditSeqRef.current++`（WAITING_USER auto-decision）

  触发场景：
  1. `auditSeqRef.current = 0`（初始值，新会话未触发 TASK_INIT 降级）
  2. TASK_INIT 成功但 God 的 `godAuditLoggerRef` 通过 `append()` 管理自己的 seq（line 464-473 使用 `godAuditLoggerRef.current.append({...})`，不更新 `auditSeqRef`）
  3. 直接进入 WAITING_USER → `auditSeqRef.current++` → 审计条目 `seq: 0`，ref 变 1
  4. 后续 CODING prompt → `++auditSeqRef.current` → 审计条目 `seq: 2`
  
  更严重：`makeAutoDecision` 内部调用 `appendAuditLog`（auto-decision.ts line 157）时使用传入的 `context.seq`（即 0）。如果 `godAuditLoggerRef.current.append()` 也从 0 开始写 TASK_INIT 条目，两个审计条目会有相同的 `seq: 0`，违反 audit log 唯一性假设。

- 预期: 所有审计 seq 应使用一致的 pre-increment 模式，确保唯一性
- 建议修复: 将 line 1358 改为 `seq: ++auditSeqRef.current`

---

### BUG-16 [P2] `handlePhaseTransitionConfirm` 中 `setCurrentPhaseId` 与 XState `confirmContinueWithPhase` 的 `taskPrompt` 更新语义不一致

- 文件: `src/ui/components/App.tsx:1701-1717` + `src/engine/workflow-machine.ts:349-360`
- 问题: `handlePhaseTransitionConfirm` 设置 `setCurrentPhaseId(pendingPhaseTransition.nextPhaseId)` 后发送 `USER_CONFIRM` continue。XState `confirmContinueWithPhase` guard 检测到 `pendingPhaseId !== null`，执行：
  ```typescript
  taskPrompt: context.pendingPhaseSummary
    ? `[Phase: ${context.pendingPhaseId}] ${context.pendingPhaseSummary}`
    : context.taskPrompt,
  ```
  
  这里 `context.pendingPhaseId` 来自 God routing 的原始 `nextPhaseId`（line 296 in workflow-machine），而 React state `currentPhaseId` 也来自同一个值（line 1705）。但 `context.pendingPhaseSummary` 来自 God routing 的 `summary`（即 `reasoning` 字段），是 God 的推理说明而非上一阶段的完成摘要。
  
  即便 `evaluatePhaseTransition` 返回了 `previousPhaseSummary`（line 1049-1051），这个值通过 `setPendingPhaseTransition` 传入，但 XState 的 `pendingPhaseSummary` 使用的是原始的 `godResult.decision.reasoning`（通过 `PHASE_TRANSITION` event 的 `summary` 字段，line 1064 中 `previousPhaseSummary: phaseSummary` 虽然被赋值给 React state，但 XState context 中的 `pendingPhaseSummary` 在 line 297 已经被设为 `event.summary`）。
  
  结果：`taskPrompt` 可能被设为 God 的原始 reasoning（如 "Exploration phase complete, all findings documented"），而非 `evaluatePhaseTransition` 返回的结构化摘要。对于后续 Coder prompt，`config.task`（原始任务描述）会被这段临时推理文本替代。

- 预期: XState `taskPrompt` 应保留原始任务描述或使用结构化的阶段前缀，而非 God 的原始推理文本
- 建议修复: 在 `handlePhaseTransitionConfirm` 中，在发送 `USER_CONFIRM` 之前，先发送一个自定义 event 更新 `pendingPhaseSummary` 为结构化摘要；或在 prompt 生成中不依赖 `taskPrompt` 而使用原始 `config.task`

---

VERDICT: BUGS_FOUND | P0:0 P1:2 P2:1

我已经完成了对所有变更文件的全面审计。以下是我的发现：

---

### BUG-17 [P1] REVIEWING useEffect 中 God prompt 路径丢弃用户中断指令（interruptInstruction）

- **文件**: src/ui/components/App.tsx:827-854
- **问题**: 在 REVIEWING useEffect 中，`interruptInstruction` 在第 827 行从 `pendingInstructionRef` 捕获并在第 828 行清空该 ref，但 God prompt 路径（第 840-854 行）调用 `generateReviewerPrompt` 时**未传递 `instruction` 参数**。而同一 useEffect 的 v1 回退路径（第 856-866 行）正确地将 `interruptInstruction` 传给了 `buildReviewerPrompt`。

  对比 CODING useEffect（第 580 行），God prompt 路径明确传递了 `instruction: interruptInstruction`：
  ```typescript
  // CODING — 正确 ✓
  generateCoderPrompt({
    ...
    instruction: interruptInstruction,  // 第 580 行
    ...
  });

  // REVIEWING — 缺失 ✗
  generateReviewerPrompt({
    taskType: taskAnalysis.taskType,
    round: ctx.round,
    maxRounds: ctx.maxRounds,
    taskGoal: config.task,
    lastCoderOutput: ctx.lastCoderOutput ?? undefined,
    phaseId: currentPhaseId ?? undefined,
    phaseType: ...
    // ← 无 instruction 字段
  });
  ```

- **触发路径**: 用户在 REVIEWING 状态下中断（Ctrl+C + 输入指令）→ `pendingInstructionRef.current = text`（第 1438 行）→ 状态机 INTERRUPTED → REVIEWING → useEffect 捕获 instruction → God prompt 路径丢弃它 → 指令无效
- **预期**: `generateReviewerPrompt` 应接收并使用 `instruction` 参数（与 CODING 路径的 `generateCoderPrompt` 对称），或至少将其包含在 prompt 上下文中
- **建议修复**: 在 `generateReviewerPrompt` 的 PromptContext 中添加 `instruction` 字段，并在 REVIEWING useEffect 的 God prompt 路径中传入 `interruptInstruction`

---

### BUG-18 [P2] XState `taskPrompt` 在多次阶段转换后累积 `[Phase: ...]` 前缀

- **文件**: src/engine/workflow-machine.ts:354-356
- **问题**: `confirmContinueWithPhase` 转换的 assign action 将 `[Phase: ${pendingPhaseId}]` **前缀追加**到现有 `taskPrompt`：
  ```typescript
  taskPrompt: ({ context }) =>
    context.pendingPhaseId
      ? `[Phase: ${context.pendingPhaseId}] ${context.taskPrompt}`
      : context.taskPrompt,
  ```
  经过多次阶段转换后，`taskPrompt` 变为：
  `[Phase: phase3] [Phase: phase2] [Phase: phase1] 原始任务描述`

  虽然当前 prompt 生成使用 `config.task`（原始任务）而非 `ctx.taskPrompt`，但该值会通过 `saveState`（第 510 行 `status: stateValue.toLowerCase()` 保存的是 xstate 状态，不包括 taskPrompt 直接引用但间接通过 workflowInput 恢复）和会话恢复路径 `buildRestoredSessionRuntime` 中 `taskPrompt: loaded.metadata.task` 被重置，所以恢复路径当前不受影响。但 XState context 中的 `taskPrompt` 数据不断膨胀是数据完整性问题，且未来任何读取 `ctx.taskPrompt` 的逻辑都会得到错误值。
- **预期**: 应先移除旧的 phase 前缀再添加新的，或使用独立字段追踪 phase 信息
- **建议修复**: 替换为剥离已有 phase 前缀后再追加，或在 XState context 中使用独立的 `activePhaseId` 字段而非修改 `taskPrompt`

---

VERDICT: BUGS_FOUND | P0:0 P1:1 P2:1

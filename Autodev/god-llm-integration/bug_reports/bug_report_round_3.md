I've completed a thorough audit of all changed files. Here is my Bug Report:

---

### BUG-8 [P1] TaskAnalysisCard 用户选择的 taskType 未更新到 taskAnalysis state

- 文件: `src/ui/components/App.tsx:1540-1557`
- 问题: `handleTaskAnalysisConfirm(taskType: string)` 接收用户在 TaskAnalysisCard 中选择的 taskType 参数，但**从未调用 `setTaskAnalysis` 更新 state**。`taskAnalysis.taskType` 始终保留 God 原始推荐值。

  触发路径：
  1. God 分析推荐 `taskType='code'`，用户在卡片中按 `3` 选择 `discuss`
  2. `onConfirm('discuss')` → `handleTaskAnalysisConfirm('discuss')`
  3. 系统消息显示 `"Task analysis confirmed: type=discuss"`（仅展示用）
  4. `taskAnalysis.taskType` 仍为 `'code'` → 后续所有 God prompt 生成（`generateCoderPrompt`, `generateReviewerPrompt`）、路由决策、收敛判断均使用 `'code'`

  衍生问题：第 1545 行的 compound 检查 `if (taskAnalysis?.taskType === 'compound' ...)` 也使用原始类型。若 God 推荐 compound 但用户选 code，仍会错误设置 `currentPhaseId`；反之若 God 推荐 code 但用户选 compound，phases 不会被初始化。

- 预期: 用户在 TaskAnalysisCard 中的选择应更新 `taskAnalysis` state，使后续所有决策使用用户确认的类型
- 建议修复: 在 `handleTaskAnalysisConfirm` 中添加：
  ```typescript
  setTaskAnalysis(prev => prev ? { ...prev, taskType: taskType as GodTaskAnalysis['taskType'] } : prev);
  ```
  并将 compound 检查改为基于 `taskType` 参数而非 `taskAnalysis.taskType`

---

### BUG-9 [P1] God auto-decision `continue_with_instruction` 的 instruction 在 God prompt 路径下丢失

- 文件: `src/ui/components/App.tsx:1576-1584`（设置 instruction）+ `568-602`（CODING prompt 构建）
- 问题: 当 God WAITING_USER 自动决策返回 `continue_with_instruction` 并附带具体 instruction 时：
  1. `handleGodDecisionExecute` 将 instruction 写入 `pendingInstructionRef.current`（line 1577）
  2. `send({ type: 'USER_CONFIRM', action: 'continue' })` → XState → CODING
  3. CODING useEffect 的 God prompt 路径调用 `generateCoderPrompt({...})` — **`PromptContext` 接口无 instruction 字段**（`src/god/god-prompt-generator.ts:15-28`），instruction 被丢弃
  4. `pendingInstructionRef.current` 仅在 v1 fallback 路径使用（line 593: `interruptInstruction`）

  结果：God 自主决策的指令（如 "focus on error handling edge cases"）在 God 可用时被完全忽略，仅在 God 降级到 v1 时生效。

- 预期: God auto-decision 的 instruction 应传递到 `generateCoderPrompt`，作为高优先级指令影响 Coder prompt
- 建议修复: 
  1. 在 `PromptContext` 中添加 `instruction?: string` 字段
  2. `generateCoderPrompt` 中将 instruction 作为高优先级 section 插入（优先级高于 unresolvedIssues）
  3. CODING useEffect God path 传递 `pendingInstructionRef.current` 到 generateCoderPrompt

---

### BUG-10 [P2] EVALUATING God 路径未更新 godLatency 导致 StatusBar 显示过期延迟

- 文件: `src/ui/components/App.tsx:1204+1234-1256`
- 问题: EVALUATING useEffect 中声明了 `godCallStart = Date.now()`（line 1204），但 God 成功路径（lines 1234-1256）**未调用 `setGodLatency(Date.now() - godCallStart)`**。对比 ROUTING_POST_CODE（line 764）和 ROUTING_POST_REVIEW（line 1026）均正确更新了 godLatency。

  结果：StatusBar 在 EVALUATING 阶段显示的是上一次 routing 决策的延迟值，而非当前 convergence evaluation 的延迟。

- 预期: EVALUATING God 成功路径应与其他决策点一致，更新 `godLatency`
- 建议修复: 在 line 1234 的 `if (usedGod)` 块内添加 `setGodLatency(Date.now() - godCallStart);`

---

VERDICT: BUGS_FOUND | P0:0 P1:2 P2:1

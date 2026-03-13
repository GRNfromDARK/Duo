两个关键发现已确认。审计完成，以下是 Bug 报告：

---

### BUG-11 [P1] CODING useEffect 中 God prompt 路径读取已清空的 `pendingInstructionRef`，导致指令丢失

- 文件: `src/ui/components/App.tsx:559-580`
- 问题: CODING useEffect 在第 559 行将 `pendingInstructionRef.current` 捕获到局部变量 `interruptInstruction`，然后在第 560 行立即将 ref 清空为 `null`。但 God prompt 路径（第 580 行）读取的是 **已清空的 ref** 而非局部变量：
  ```typescript
  // Line 559-560
  const interruptInstruction = pendingInstructionRef.current ?? undefined;
  pendingInstructionRef.current = null;  // ref 已清空
  
  // Line 580 (God path)
  instruction: pendingInstructionRef.current ?? undefined,  // 永远是 undefined！
  ```
  
  v1 fallback 路径（第 593-595 行）正确使用了 `interruptInstruction` 局部变量。
  
  触发场景：
  1. God auto-decision 返回 `continue_with_instruction`，`pendingInstructionRef` 设为 instruction（第 1582 行）
  2. `send({ type: 'USER_CONFIRM', action: 'continue' })` → 转到 CODING
  3. CODING useEffect 读取并清空 ref（第 559-560 行）
  4. God prompt 路径读取已清空的 ref → instruction 丢失
  5. Coder 收到的 prompt 中不包含 God 的自主指令

  同样影响用户通过 `handleInputSubmit` 输入的 `pendingInstruction`（第 1456 行设置）。

- 预期: God prompt 路径应使用第 559 行捕获的 `interruptInstruction` 局部变量
- 建议修复: 将第 580 行改为 `instruction: interruptInstruction,`

---

### BUG-12 [P1] EVALUATING useEffect 从未向 `convergenceLogRef` 追加条目，God 路由缺失历史收敛数据

- 文件: `src/ui/components/App.tsx:1117-1289`
- 问题: Card B.3 要求在 EVALUATING useEffect 中将每轮收敛判断结果追加到 `convergenceLogRef`。但整个 EVALUATING useEffect 中 **不存在任何 `convergenceLogRef.current.push(...)` 调用**。

  全局搜索 `convergenceLogRef.current.push` 在整个 `src/` 目录下**无结果**。`convergenceLogRef` 在以下位置被读取但从未被写入：
  - 第 249 行：从恢复的 session 初始化
  - 第 524 行：保存到 session state
  - 第 1011 行：传给 `routePostReviewer`
  - 第 1216 行：传给 `evaluateConvergence`

  后果：
  1. `routePostReviewer` 和 `evaluateConvergence` 始终收到空的 convergenceLog（除非从 session 恢复）
  2. God 路由决策缺失历史收敛趋势信息（如 progressTrend、blockingIssueCount 变化）
  3. 多轮 session 中 God 无法利用历史数据做出更准确的收敛/路由判断
  4. `duo resume` 后保存的 convergenceLog 始终为空数组

- 预期: EVALUATING God 成功路径应将 `godResult.judgment` 的关键字段追加到 `convergenceLogRef.current`
- 建议修复: 在 EVALUATING useEffect 的 God 成功路径（第 1236 行 `if (usedGod)` 块内）添加：
  ```typescript
  convergenceLogRef.current.push({
    round: ctx.round,
    timestamp: new Date().toISOString(),
    classification: judgment.classification,
    shouldTerminate: godResult.shouldTerminate,
    blockingIssueCount: judgment.blockingIssueCount,
    criteriaProgress: judgment.criteriaProgress,
    summary: judgment.reason ?? '',
  });
  ```

---

### BUG-13 [P2] ReclassifyOverlay 对 `discuss`/`compound` 类型无高亮选中项，Enter 静默确认不可见类型

- 文件: `src/ui/reclassify-overlay.ts:13,36-46` + `src/ui/components/ReclassifyOverlay.tsx:91-93`
- 问题: `RECLASSIFY_TYPES` 只包含 `['explore', 'code', 'review', 'debug']`，不含 `discuss` 和 `compound`。当当前任务类型为 `discuss` 或 `compound` 时，`createReclassifyState` 将 `selectedType` 初始化为当前类型（如 `'discuss'`），但该类型不在 `availableTypes` 中。

  结果：
  1. overlay 打开时**无任何项被高亮**（`state.selectedType === type` 不匹配任何项）
  2. 用户如果直接按 Enter，`handleReclassifyKey` 返回 `action: 'confirm'` 且 `selectedType` 仍为 `'discuss'`
  3. `handleReclassifySelect('discuss')` 执行，任务类型"重分类"为原始值，触发不必要的审计日志和系统消息
  4. arrow_down 导航时，`availableTypes.indexOf('discuss')` 返回 -1，`(-1 + 1 + 4) % 4 = 0` 跳到第一项 —— 功能上可用但行为不直观

- 预期: `selectedType` 应初始化为 `availableTypes[0]`（当 `currentType` 不在 `availableTypes` 中时），或在 overlay 中显示当前类型不可重新选择的提示
- 建议修复: 在 `createReclassifyState` 中添加：
  ```typescript
  const initialSelected = RECLASSIFY_TYPES.includes(currentType) ? currentType : RECLASSIFY_TYPES[0];
  ```

---

VERDICT: BUGS_FOUND | P0:0 P1:2 P2:1

审计完成。以下是 Bug 报告：

---

### BUG-5 [P1] BUG-3 fix 中 setMessages 创建的 Message 缺少必需的 `id` 字段

- 文件: `src/ui/components/App.tsx:1337-1343`
- 问题: BUG-3 fix 使用 `setMessages(prev => ...)` 回调来避免 stale closure，但在创建新消息时缺少 `Message.id` 字段：
  ```typescript
  return [...prev, { role: 'system' as const, content: manualWaitingMsg, timestamp: Date.now() }];
  ```
  
  `Message` 类型定义（`src/types/ui.ts:52`）中 `id: string` 是**必需字段**。此处创建的对象没有 `id`，运行时 `msg.id` 为 `undefined`。

  影响路径：God 被禁用/降级到 L4 → 进入 WAITING_USER → 执行 setMessages 回调 → 创建无 id 的 Message。

  后果：
  1. `buildRenderedMessageLines` 使用 `msg.id` 生成 React key，`undefined` key 导致渲染不稳定
  2. 如果后续调用 `updateMessage(undefined, ...)` 会匹配所有 `id === undefined` 的消息
  3. TypeScript 类型违约（vitest 使用 esbuild/swc 转译不检查类型，故未在测试中暴露）

- 预期: 新消息应包含唯一 `id`，与 `addMessage` 生成的 id 格式一致
- 建议修复: 在 setMessages 回调内使用 `nextMsgId()` 生成 id：`{ id: nextMsgId(), role: 'system' as const, ... }`，或将去重逻辑改为在 `addMessage` 外部用 ref flag 实现

---

### BUG-6 [P1] compound 任务的 `currentPhaseId` 未持久化，`duo resume` 后丢失

- 文件: `src/ui/components/App.tsx:502-530`（session 保存）+ `329-368`（session 恢复）
- 问题: `currentPhaseId` React state（line 271）在 session 保存时**未写入 snapshot**。在 `duo resume` 恢复时，`currentPhaseId` 初始化为 `null`（line 271），导致 compound 任务恢复后：

  1. StatusBar 不显示当前阶段（`currentPhase: currentPhaseId ?? undefined` → `undefined`）
  2. `evaluatePhaseTransition`（line 1037）中使用 `currentPhaseId ?? phases[0]?.id` 回退到**第一阶段**，即使任务已经进行到第 2/3 阶段
  3. God 的 phase transition 决策基于错误的当前阶段，可能触发重复的阶段转换

  保存路径（line 509-526）包含 `godTaskAnalysis`、`godConvergenceLog`、`degradationState`，但**遗漏了 `currentPhaseId`**。Ctrl+C 退出路径（line 1490-1507）同样遗漏。

- 预期: compound 任务的 `currentPhaseId` 应在 session state 中持久化，恢复时正确初始化
- 建议修复: 
  1. 保存时添加 `currentPhaseId` 到 saveState 调用
  2. `buildRestoredSessionRuntime` 返回 `currentPhaseId`
  3. 恢复时通过 `setCurrentPhaseId(restoredRuntime?.currentPhaseId ?? null)` 初始化

---

### BUG-7 [P2] WAITING_USER 状态下 Ctrl+R 重分类后，过期的 God 自动决策 Banner 仍会显示

- 文件: `src/ui/components/App.tsx:1599-1620`（handleReclassify）+ `1741-1781`（渲染优先级）
- 问题: 在 WAITING_USER 状态下：
  1. WAITING_USER useEffect 启动异步 God auto-decision IIFE
  2. 用户按 Ctrl+R → `showReclassify = true` → ReclassifyOverlay 全屏渲染
  3. 异步 IIFE 在后台完成 → `setGodDecision(...)` + `setShowGodBanner(true)`
  4. 用户确认重分类 → `showReclassify = false` → 组件重新渲染
  5. 渲染优先级：`showReclassify`(false) → `showPhaseTransition`(false) → **`showGodBanner`(true)** → GodDecisionBanner **显示！**
  
  此时 `godDecision` 保存的是重分类**之前**的旧决策（基于旧的 taskType）。2 秒倒计时重新开始（组件重新挂载），倒计时结束后自动执行过期的决策。

  根本原因：WAITING_USER useEffect 的依赖数组 `[stateValue, showPhaseTransition]` 不包含 `taskAnalysis`，重分类后 effect 不会重新运行来清除旧的 `godDecision`。

- 预期: 重分类完成后，应清除 `godDecision` 和 `showGodBanner`，让 WAITING_USER effect 基于新的 taskType 重新运行 auto-decision
- 建议修复: 在 `handleReclassifySelect` 中添加 `setGodDecision(null); setShowGodBanner(false);`，或将 `taskAnalysis` 加入 WAITING_USER useEffect 的依赖数组

---

VERDICT: BUGS_FOUND | P0:0 P1:2 P2:1

# Card B.4: God 动态 Prompt 生成替代 ContextManager

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-003: 动态 Prompt 生成（AC-013, AC-014, AC-015）
- FR-003a: 任务类型 → Prompt 策略映射
- FR-003b: 上下文感知 Prompt 动态组装（Reviewer-Driven）
- FR-003c: Prompt 质量保证

从 `docs/requirements/god-llm-integration-todolist.md` 读取：
- Phase B > B-4

## 读取已有代码
- `src/ui/components/App.tsx` — CODING useEffect 中的 prompt 构建（contextManagerRef.current.buildCoderPrompt），REVIEWING useEffect 中的 prompt 构建（contextManagerRef.current.buildReviewerPrompt）
- `src/session/context-manager.ts` — v1 ContextManager（fallback）
- `src/god/god-prompt-generator.ts` — generateCoderPrompt(), generateReviewerPrompt()

## 任务

### 1. 修改 CODING useEffect 中的 prompt 构建
在 `App.tsx` 中：

1. 检查 God 是否可用且 taskAnalysis 存在
2. God 可用时：
   ```typescript
   const prompt = generateCoderPrompt({
     taskType: taskAnalysis.taskType,
     round: ctx.round,
     maxRounds: ctx.maxRounds,
     taskGoal: config.task,
     lastReviewerOutput: ctx.lastReviewerOutput ?? undefined,
     unresolvedIssues: lastUnresolvedIssuesRef.current,
     convergenceLog: convergenceLogRef.current,
   });
   ```
3. God 不可用时：保持 v1 的 `contextManagerRef.current.buildCoderPrompt()`

### 2. 修改 REVIEWING useEffect 中的 prompt 构建
类似地替换 `contextManagerRef.current.buildReviewerPrompt()` 为 God 的 `generateReviewerPrompt()`

### 3. Prompt 质量保证
- explore 型 prompt 不包含执行动词（implement/create/write code）（AC-013）
- prompt 长度检查（AC-014）
- prompt 摘要写入 audit log（AC-015）

### 4. unresolvedIssues 传递
- God 生成的 Coder prompt 必须包含上一轮 unresolvedIssues 作为必做清单
- 这确保 Coder 逐条回应 Reviewer 的 issues

## 验收标准
- [ ] AC-1: God 动态生成 Coder prompt（替代 ContextManager.buildCoderPrompt）
- [ ] AC-2: God 动态生成 Reviewer prompt（替代 ContextManager.buildReviewerPrompt）
- [ ] AC-3: explore 型 prompt 不含执行动词（AC-013）
- [ ] AC-4: Reviewer unresolvedIssues 作为 Coder prompt 的必做清单
- [ ] AC-5: prompt 摘要写入 audit log
- [ ] AC-6: God 失败时降级到 v1 ContextManager prompt
- [ ] AC-7: 所有测试通过: `npx vitest run`
- [ ] AC-8: 现有测试不受影响

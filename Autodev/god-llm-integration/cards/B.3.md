# Card B.3: EVALUATING 替换 — ConvergenceService → GodConvergence

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-005: 收敛判断（AC-019, AC-019a, AC-019b, AC-020）
- 终止条件决策树

从 `docs/requirements/god-llm-integration-todolist.md` 读取：
- Phase B > B-3

## 读取已有代码
- `src/ui/components/App.tsx` — EVALUATING useEffect（当前使用 convergenceRef.current.evaluate()）
- `src/decision/convergence-service.ts` — v1 ConvergenceService（fallback）
- `src/god/god-convergence.ts` — evaluateConvergence() 函数
- `src/god/consistency-checker.ts` — checkConsistency() 函数
- `src/god/degradation-manager.ts` — DegradationManager

## 任务

### 1. 修改 EVALUATING useEffect
在 `App.tsx` 中：

1. 检查 God 是否可用
2. God 可用时：
   ```typescript
   const result = await evaluateConvergence(
     godAdapterRef.current,
     ctx.lastReviewerOutput ?? '',
     {
       round: ctx.round,
       maxRounds: ctx.maxRounds,
       taskGoal: config.task,
       terminationCriteria: taskAnalysis?.terminationCriteria ?? [],
       convergenceLog: convergenceLogRef.current,
       sessionDir,
       seq,
     }
   );
   // 追加 convergenceLog
   convergenceLogRef.current.push({
     round: ctx.round,
     timestamp: new Date().toISOString(),
     classification: result.judgment.classification,
     shouldTerminate: result.shouldTerminate,
     blockingIssueCount: result.judgment.blockingIssueCount,
     criteriaProgress: result.judgment.criteriaProgress,
     summary: result.judgment.reason ?? '',
   });
   ```
3. God 不可用或失败时：回退到 v1 的 `convergenceRef.current.evaluate()`

### 2. 一致性校验
- shouldTerminate=true 时 blockingIssueCount 必须为 0（AC-019）
- shouldTerminate=true 时所有 criteriaProgress.satisfied 必须为 true（AC-019a，max_rounds/loop_detected 例外）
- 这些校验在 `god-convergence.ts` 中已实现，确保集成时正确传递参数

### 3. Round 记录和消息
- 保留现有的 roundsRef.current.push() 逻辑
- 保留 createRoundSummaryMessage() 调用
- 添加 God 收敛判断信息到消息流（classification, blockingIssueCount, progressTrend）

## 验收标准
- [ ] AC-1: God 做收敛判断替代 ConvergenceService
- [ ] AC-2: shouldTerminate=true 时 blockingIssueCount===0
- [ ] AC-3: criteriaProgress 全部 satisfied 才允许终止（max_rounds/loop_detected 例外）
- [ ] AC-4: convergenceLog 正确追加每轮结果
- [ ] AC-5: God 失败时降级到 v1 ConvergenceService
- [ ] AC-6: 所有测试通过: `npx vitest run`
- [ ] AC-7: 现有测试不受影响

# Card B.2: ROUTING_POST_REVIEW 替换 — ChoiceDetector → GodRouter

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-004: 输出分析与路由判断（AC-016, AC-017, AC-018, AC-018b）
- God action → XState event 映射表（route_to_coder, converged, phase_transition, loop_detected, request_user_input）

从 `docs/requirements/god-llm-integration-todolist.md` 读取：
- Phase B > B-2

## 读取已有代码
- `src/ui/components/App.tsx` — ROUTING_POST_REVIEW useEffect（当前使用 decidePostReviewRoute）
- `src/ui/session-runner-state.ts` — decidePostReviewRoute() 函数
- `src/god/god-router.ts` — routePostReviewer() 函数接口
- `src/god/god-convergence.ts` — ConvergenceLogEntry 类型
- `src/god/degradation-manager.ts` — DegradationManager

## 任务

### 1. 修改 ROUTING_POST_REVIEW useEffect
在 `App.tsx` 中：

1. 检查 God 是否可用
2. God 可用时：
   ```typescript
   const result = await routePostReviewer(
     godAdapterRef.current,
     ctx.lastReviewerOutput ?? '',
     {
       round: ctx.round,
       maxRounds: ctx.maxRounds,
       taskGoal: config.task,
       sessionDir,
       seq,
       convergenceLog: convergenceLogRef.current,
       unresolvedIssues: lastUnresolvedIssuesRef.current,
     }
   );
   // 存储 unresolvedIssues 供下一轮 Coder prompt 使用
   if (result.decision.action === 'route_to_coder') {
     lastUnresolvedIssuesRef.current = result.decision.unresolvedIssues;
   }
   send(result.event);
   ```
3. God 不可用或失败时：回退到 v1 的 `decidePostReviewRoute()`

### 2. 添加 React refs 追踪 God 状态
```typescript
const convergenceLogRef = useRef<ConvergenceLogEntry[]>([]);
const lastUnresolvedIssuesRef = useRef<string[]>([]);
```

### 3. 确保 route_to_coder 携带 unresolvedIssues
- God router 的 `routePostReviewer` 返回 route_to_coder 时必须包含非空 `unresolvedIssues`（AC-018b）

### 4. 处理 phase_transition 和 loop_detected
- phase_transition → send PHASE_TRANSITION event
- loop_detected → send LOOP_DETECTED event + 在消息流中显示告警

## 验收标准
- [ ] AC-1: God 在 Reviewer 完成后做路由决策（调用 routePostReviewer）
- [ ] AC-2: route_to_coder 携带非空 unresolvedIssues（AC-018b）
- [ ] AC-3: converged 只在 POST_REVIEW 产生
- [ ] AC-4: phase_transition 和 loop_detected 正确处理
- [ ] AC-5: God 失败时降级到 v1 ChoiceDetector + ConvergenceService
- [ ] AC-6: 所有决策写入 audit log
- [ ] AC-7: 所有测试通过: `npx vitest run`
- [ ] AC-8: 现有测试不受影响

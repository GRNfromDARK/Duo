# Card B.1: ROUTING_POST_CODE 替换 — ChoiceDetector → GodRouter

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-004: 输出分析与路由判断（AC-016, AC-017, AC-018a）
- God action → XState event 映射表

从 `docs/requirements/god-llm-integration-todolist.md` 读取：
- Phase B > B-1

## 读取已有代码
- `src/ui/components/App.tsx` — ROUTING_POST_CODE useEffect（当前使用 decidePostCodeRoute）
- `src/ui/session-runner-state.ts` — decidePostCodeRoute() 函数
- `src/god/god-router.ts` — routePostCoder() 函数接口
- `src/god/god-prompt-generator.ts` — generateGodDecisionPrompt() 函数
- `src/god/degradation-manager.ts` — DegradationManager
- `src/god/god-audit.ts` — appendAuditLog()

## 任务

### 1. 添加 God routing 到 App.tsx
修改 `ROUTING_POST_CODE` useEffect：

1. 检查 God 是否可用（DegradationManager 未降级到 L4）
2. God 可用时：
   ```typescript
   // 调用 God router
   const result = await routePostCoder(
     godAdapterRef.current,
     ctx.lastCoderOutput ?? '',
     { round: ctx.round, maxRounds: ctx.maxRounds, taskGoal: config.task, sessionDir, seq }
   );
   // 映射 God action → XState event
   send(result.event);
   ```
3. God 不可用或失败时：回退到 v1 的 `decidePostCodeRoute()`
4. 使用 DegradationManager 的 `handleError()` 处理 God 失败

### 2. 确保 converged 不在 POST_CODE 产生
- God router 的 `routePostCoder` 只返回 continue_to_review / retry_coder / request_user_input
- 不允许返回 converged（AC-018a）

### 3. Audit log 记录
- 每次路由决策写入 God audit log

## 验收标准
- [ ] AC-1: God 在 Coder 完成后做路由决策（调用 routePostCoder）
- [ ] AC-2: God 决策正确映射到 XState event（continue_to_review → ROUTE_TO_REVIEW, retry_coder → ROUTE_TO_CODER, request_user_input → NEEDS_USER_INPUT）
- [ ] AC-3: God 失败时降级到 v1 ChoiceDetector（decidePostCodeRoute）
- [ ] AC-4: converged 不会在 POST_CODE 产生（AC-018a）
- [ ] AC-5: 路由决策写入 God audit log
- [ ] AC-6: 所有测试通过: `npx vitest run`
- [ ] AC-7: 现有测试不受影响

# Card B.2: 输出分析与路由判断 PostCoder/PostReviewer

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-004: 输出分析与路由 (AC-016, AC-017, AC-018, AC-018a, AC-018b)
- God action → XState event 映射（7 种映射关系）
- GodPostCoderDecision, GodPostReviewerDecision 接口

从 `docs/requirements/god-llm-todolist.md` 读取：
- B-2 任务描述和验证标准

## 读取已有代码
- `src/god/god-prompt-generator.ts` — generateGodDecisionPrompt（Card B.1 已创建）
- `src/god/task-init.ts` — TaskInitResult
- `src/parsers/god-json-extractor.ts` — extractGodJson, extractWithRetry
- `src/types/god-schemas.ts` — GodPostCoderDecisionSchema, GodPostReviewerDecisionSchema
- `src/engine/workflow-machine.ts` — WorkflowEvent, workflowMachine
- `src/decision/convergence-service.ts` — 旧 ConvergenceService（参考 + 同向验证）
- `src/god/god-audit.ts` — appendAuditLog

## 任务

### 1. 实现 ROUTING_POST_CODE 路由
创建 `src/god/god-router.ts`：

```typescript
export interface PostCoderRoutingResult {
  event: WorkflowEvent;
  decision: GodPostCoderDecision;
  rawOutput: string;
}

export async function routePostCoder(
  godAdapter: CLIAdapter,
  coderOutput: string,
  context: RoutingContext,
): Promise<PostCoderRoutingResult>
```

- 默认 continue_to_review（95%）
- retry_coder：崩溃/空输出
- request_user_input：需要用户确认时

### 2. 实现 ROUTING_POST_REVIEW 路由

```typescript
export interface PostReviewerRoutingResult {
  event: WorkflowEvent;
  decision: GodPostReviewerDecision;
  rawOutput: string;
}

export async function routePostReviewer(
  godAdapter: CLIAdapter,
  reviewerOutput: string,
  context: RoutingContext,
): Promise<PostReviewerRoutingResult>
```

- route_to_coder + unresolvedIssues（60-70%）
- converged
- phase_transition
- loop_detected
- request_user_input

### 3. 关键约束实现
- converged 只能在 ROUTING_POST_REVIEW 产生（routePostCoder 不可返回 converged）
- route_to_coder 必须携带非空 unresolvedIssues（运行时校验）

### 4. God action → XState event 映射
实现 7 种映射关系：
```typescript
export function godActionToEvent(decision: GodPostCoderDecision | GodPostReviewerDecision): WorkflowEvent
```

### 5. XState 状态机扩展
修改 `src/engine/workflow-machine.ts`：
- 添加 ROUTING_POST_CODE 和 ROUTING_POST_REVIEW 状态（或扩展现有 ROUTING/EVALUATING 为 async）
- God router 作为 async effect handler

### 6. 编写测试
在 `src/__tests__/god/god-router.test.ts` 中：
- JSON 提取成功率测试
- converged 不在 ROUTING_POST_CODE 产生
- route_to_coder 必须携带非空 unresolvedIssues
- God action 正确映射为 XState event（7 种映射）
- 路由决策写入 audit log

## 验收标准
- [ ] AC-1: ROUTING_POST_CODE 路由正确分析 Coder 输出
- [ ] AC-2: ROUTING_POST_REVIEW 路由正确分析 Reviewer 输出
- [ ] AC-3: converged 决策不在 ROUTING_POST_CODE 阶段产生
- [ ] AC-4: route_to_coder 必须携带非空 unresolvedIssues
- [ ] AC-5: God action 正确映射为 XState event（7 种映射）
- [ ] AC-6: 路由决策写入 audit log
- [ ] AC-7: 所有测试通过: `npx vitest run`
- [ ] AC-8: 现有测试不受影响

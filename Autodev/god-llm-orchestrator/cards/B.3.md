# Card B.3: 收敛判断 Reviewer-Authority

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-005: 收敛判断 (AC-019, AC-019a, AC-019b, AC-020)
- GodConvergenceJudgment 接口定义
- 终止条件决策树
- 不可违反原则

从 `docs/requirements/god-llm-todolist.md` 读取：
- B-3 任务描述和验证标准

## 读取已有代码
- `src/god/god-router.ts` — routePostReviewer（Card B.2 已创建）
- `src/types/god-schemas.ts` — GodConvergenceJudgmentSchema
- `src/parsers/god-json-extractor.ts` — extractGodJson
- `src/decision/convergence-service.ts` — 旧 ConvergenceService（同向验证）
- `src/god/god-audit.ts` — appendAuditLog
- `src/engine/workflow-machine.ts` — WorkflowContext

## 任务

### 1. 实现收敛判断服务
创建 `src/god/god-convergence.ts`：

```typescript
export interface ConvergenceResult {
  judgment: GodConvergenceJudgment;
  shouldTerminate: boolean;
  terminationReason?: string;
}

export async function evaluateConvergence(
  godAdapter: CLIAdapter,
  reviewerOutput: string,
  context: ConvergenceContext,
): Promise<ConvergenceResult>
```

### 2. 终止条件决策树
```
Reviewer blocking issues 清零
  → 所有 criteriaProgress.satisfied === true
    → shouldTerminate: true
```

例外条件：
- max_rounds 强制终止
- loop_detected 且 3 轮无改善强制终止

### 3. 不可违反原则（硬约束）
- 终止必须经过 Reviewer
- blocking issues 必须清零
- 所有 terminationCriteria 必须满足
- Reviewer 驱动方向

### 4. 一致性校验
```typescript
export function validateConvergenceConsistency(
  judgment: GodConvergenceJudgment,
): { valid: boolean; violations: string[] }
```
- shouldTerminate: true 时 blockingIssueCount 必须为 0
- shouldTerminate: true 时所有 criteriaProgress[].satisfied 为 true（例外除外）

### 5. convergenceLog 记录
收敛判断结果（含 criteriaProgress）写入 convergenceLog：
```typescript
export interface ConvergenceLogEntry {
  round: number;
  timestamp: string;
  classification: string;
  shouldTerminate: boolean;
  blockingIssueCount: number;
  criteriaProgress: { criterion: string; satisfied: boolean }[];
  summary: string;  // ≤ 200 chars
}
```

### 6. 编写测试
在 `src/__tests__/god/god-convergence.test.ts` 中：
- shouldTerminate: true 时 blockingIssueCount 为 0
- shouldTerminate: true 时所有 criteriaProgress[].satisfied 为 true
- God 不在未经 Reviewer 审查时输出 shouldTerminate: true
- max_rounds 达到时强制终止
- loop_detected 且 3 轮无改善强制终止
- 一致性校验检测矛盾
- convergenceLog 正确追加

## 验收标准
- [ ] AC-1: shouldTerminate: true 时 blockingIssueCount 为 0
- [ ] AC-2: shouldTerminate: true 时所有 criteriaProgress[].satisfied 为 true（例外除外）
- [ ] AC-3: God 不在未经 Reviewer 审查时输出 shouldTerminate: true
- [ ] AC-4: 收敛判断含 criteriaProgress 写入 convergenceLog
- [ ] AC-5: max_rounds 达到时强制终止
- [ ] AC-6: 一致性校验检测矛盾并报告 violations
- [ ] AC-7: 所有测试通过: `npx vitest run`
- [ ] AC-8: 现有测试不受影响

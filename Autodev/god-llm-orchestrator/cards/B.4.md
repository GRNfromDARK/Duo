# Card B.4: 异常/死循环检测 + 阶段转换

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-009: 死循环检测 (AC-031, AC-032)
- FR-010: 阶段转换 (AC-033, AC-034)

从 `docs/requirements/god-llm-todolist.md` 读取：
- B-4 任务描述和验证标准

## 读取已有代码
- `src/god/god-convergence.ts` — ConvergenceLogEntry（Card B.3 已创建）
- `src/god/god-router.ts` — routePostReviewer（Card B.2 已创建）
- `src/types/god-schemas.ts` — GodPostReviewerDecisionSchema（progressTrend 字段）
- `src/engine/workflow-machine.ts` — WorkflowContext, WorkflowEvent
- `src/god/god-audit.ts` — appendAuditLog

## 任务

### 1. 死循环检测
创建 `src/god/loop-detector.ts`：

```typescript
export interface LoopDetectionResult {
  detected: boolean;
  reason?: string;
  suggestedAction?: string;
}

export function detectLoop(
  convergenceLog: ConvergenceLogEntry[],
  recentDecisions: GodPostReviewerDecision[],
): LoopDetectionResult
```

检测信号：
- 连续 3 轮 progressTrend === 'stagnant'
- 语义重复检测（连续轮次的 unresolvedIssues 高度相似）
- blockingIssueCount 趋势未下降

### 2. 死循环处理
检测到死循环 → God 生成 loop_detected 决策 + 干预措施：
```typescript
export interface LoopIntervention {
  type: 'rephrase_prompt' | 'skip_issue' | 'force_converge' | 'request_human';
  details: string;
}
```

### 3. 阶段转换
创建 `src/god/phase-transition.ts`：

```typescript
export interface PhaseTransitionResult {
  shouldTransition: boolean;
  nextPhaseId?: string;
  previousPhaseSummary?: string;
}

export function evaluatePhaseTransition(
  currentPhase: Phase,
  convergenceLog: ConvergenceLogEntry[],
  godDecision: GodPostReviewerDecision,
): PhaseTransitionResult
```

- compound 型任务中 God 基于阶段完成度输出 phase_transition 决策
- 阶段转换行为：保留之前 RoundRecord、下一阶段 prompt 携带上阶段结论摘要

### 4. XState 集成
- loop_detected → 触发 XState LOOP_DETECTED event
- phase_transition → 触发 XState PHASE_TRANSITION event
- 扩展 WorkflowEvent 类型

### 5. 编写测试
在 `src/__tests__/god/loop-detector.test.ts` 和 `src/__tests__/god/phase-transition.test.ts` 中：
- 连续 3 轮停滞触发 loop_detected
- 非停滞不触发 (false positive 控制)
- compound 型任务阶段转换正确触发
- 转换前后 RoundRecord 均保留
- loop_detected 和 phase_transition 映射为正确 XState event

## 验收标准
- [ ] AC-1: 连续 3 轮停滞触发 loop_detected
- [ ] AC-2: loop_detected 的 false positive 率低（非停滞场景不触发）
- [ ] AC-3: compound 型任务阶段转换正确触发
- [ ] AC-4: 阶段转换保留已有 RoundRecord
- [ ] AC-5: loop_detected 和 phase_transition 正确映射 XState event
- [ ] AC-6: 所有测试通过: `npx vitest run`
- [ ] AC-7: 现有测试不受影响

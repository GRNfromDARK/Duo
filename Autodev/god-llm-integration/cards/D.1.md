# Card D.1: 集成测试 — God 完整工作流端到端

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-001 ~ FR-011, FR-G01, FR-G04 的所有 AC

从 `docs/requirements/god-llm-integration-todolist.md` 读取：
- Phase D > D-1

## 读取已有代码
- `src/ui/components/App.tsx` — 完整的 SessionRunner（经过 Phase A-C 修改后）
- `src/engine/workflow-machine.ts` — XState 状态机（含 TASK_INIT 状态）
- `src/god/` — 所有 God 模块
- `src/__tests__/` — 现有测试结构和模式
- `src/adapters/` — CLI adapter 接口和工厂

## 任务

### 1. 创建 God 集成测试套件
新建 `src/__tests__/integration/god-workflow.test.ts`：

使用 mock adapter 模拟 God/Coder/Reviewer 的 CLI 输出。

#### 测试场景 1: 正常路径
```
TASK_INIT(God) → TaskAnalysisCard → CODING(Coder) →
ROUTING_POST_CODE(God: continue_to_review) → REVIEWING(Reviewer) →
ROUTING_POST_REVIEW(God: route_to_coder) → CODING(Coder) →
ROUTING_POST_CODE(God: continue_to_review) → REVIEWING(Reviewer) →
ROUTING_POST_REVIEW(God: converged) → EVALUATING(God) → CONVERGED → DONE
```

#### 测试场景 2: God 降级
```
TASK_INIT(God fails) → fallback to CODING directly →
ROUTING_POST_CODE(God fails) → fallback to v1 ChoiceDetector →
ROUTING_POST_REVIEW(God fails × 3) → L4 disabled → v1 ConvergenceService → CONVERGED
```

#### 测试场景 3: 代理决策
```
... → WAITING_USER → God auto-decision(continue_with_instruction) → 2s window → CODING
```

#### 测试场景 4: compound 阶段转换
```
TASK_INIT(compound: explore → code) →
CODING(explore) → ... → ROUTING_POST_REVIEW(phase_transition) →
CODING(code) → ... → CONVERGED
```

#### 测试场景 5: duo resume
```
Session saved → restoreGodSession() → taskAnalysis restored →
convergenceLog restored → degradationState restored → continue workflow
```

### 2. 验证现有测试不受影响
- 运行全量 `npx vitest run`，确认 1246+ 个测试全部通过
- 不修改任何现有测试

## 验收标准
- [ ] AC-1: 正常路径端到端集成测试通过
- [ ] AC-2: God 降级路径集成测试通过
- [ ] AC-3: 代理决策路径集成测试通过
- [ ] AC-4: compound 阶段转换集成测试通过
- [ ] AC-5: duo resume 路径集成测试通过
- [ ] AC-6: 所有现有测试不受影响（1246+ 个测试全部通过）
- [ ] AC-7: `npx vitest run` 全量通过

# Phase Gate 审计

## 你的角色
你是 duo God LLM Integration 项目的合规审计员。

## 审计步骤

1. **读取设计文档**
   - `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md`
   - `docs/requirements/god-llm-integration-todolist.md`

2. **读取代码变更**
   - 运行 `git diff` 查看当前 Phase 的代码变更
   - 重点关注 `src/ui/components/App.tsx`、`src/engine/workflow-machine.ts`、`src/ui/components/SetupWizard.tsx`

3. **逐项检查清单**
   - [ ] God 模块（src/god/）未被修改（它们是只读引用）
   - [ ] v1 组件（ContextManager, ConvergenceService, ChoiceDetector）未被删除
   - [ ] 所有 God 调用点有 DegradationManager 包裹
   - [ ] God 降级时回退到 v1 组件
   - [ ] converged 只在 ROUTING_POST_REVIEW 产生（不在 POST_CODE）
   - [ ] route_to_coder 携带 unresolvedIssues
   - [ ] 规则引擎 block 不可被 God 覆盖
   - [ ] XState 状态机 TASK_INIT 状态正确

4. **运行测试**
   ```bash
   npx vitest run
   ```
   确认所有测试通过（包括原有 1246+ 测试）

5. **决策审计**
   - 读取 `Autodev/god-llm-integration/decisions.jsonl`
   - 检查：
     - 所有 BLOCK 级决策是否已达成共识
     - 跨文件变更是否有对应 AI-REVIEW 记录
     - SPEC-DECISION 的残余风险是否合理
     - 统计本 Phase 决策分布

6. **输出审计报告**
   格式：
   ```
   ✅ 通过项: [列表]
   ❌ P0 问题: [如有]
   ⚠️ P1/P2 问题: [如有]
   📊 决策审计: SPEC-DECISION ×N, AI-REVIEW ×M, BLOCK ×K
   结论: PASS / FAIL
   ```

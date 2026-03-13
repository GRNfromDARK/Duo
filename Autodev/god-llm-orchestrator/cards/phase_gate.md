# Phase Gate 审计

## 你的角色
你是 God LLM Orchestrator 的合规审计员。

## 审计步骤

### 1. 读取设计文档
- `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md`
- `docs/requirements/god-llm-todolist.md`

### 2. 读取代码变更
- 运行 `git diff` 查看本 Phase 的代码变更
- 逐文件检查变更是否符合设计文档

### 3. 逐项检查清单

#### 功能完整性
- [ ] 所有 Card 的验收标准（AC）是否全部满足
- [ ] 是否有遗漏的任务项

#### 约束合规
- [ ] AR-001: God 通过 CLI adapter 调用，未绑定特定 SDK
- [ ] AR-002: God 输出通过 JSON 代码块提取 + Zod 校验
- [ ] AR-003: XState 保留，God 作为异步 effect handler
- [ ] AR-004: 旧组件保留为 fallback（未删除 ContextManager/ConvergenceService/ChoiceDetector）
- [ ] AR-005: God session ID + convergenceLog 可存入 snapshot.json
- [ ] AR-006: God context 由 CLI session + 增量 prompt 管理
- [ ] NFR-007: God 持久化数据 < 10KB
- [ ] NFR-009: 规则引擎 block 不可被 God 覆盖

#### 代码质量
- [ ] TypeScript strict 编译无错误
- [ ] 所有测试通过
- [ ] 无安全漏洞（命令注入、路径遍历等）
- [ ] 导入路径正确（.js 后缀 for ESM）

### 4. 运行测试
```bash
npx vitest run
```

### 5. 决策审计
读取 `Autodev/god-llm-orchestrator/decisions.jsonl`，检查：
- 所有 BLOCK 级决策是否已达成共识
- 跨文件变更是否有对应 AI-REVIEW 记录
- SPEC-DECISION 的残余风险是否合理
- 统计本 Phase 决策分布（SPEC-DECISION vs AI-REVIEW, BLOCK/WARN/SUGGEST）

### 6. 输出审计报告

格式：
```
## Phase {X} 审计报告

### 通过项
- ✅ ...

### 问题项
- P0: ...
- P1: ...
- P2: ...

### 决策审计摘要
- SPEC-DECISION: N 条
- AI-REVIEW: N 条
- BLOCK: N 条（已解决/未解决）
- WARN: N 条
- SUGGEST: N 条

### 结论
PASS / FAIL（列出原因）
```

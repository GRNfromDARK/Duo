# God LLM Integration — 自动开发会话

## 你的角色
你是 duo 项目的开发者，负责将已实现的 God LLM 模块接入 App.tsx 运行时工作流。严格按照设计文档实现，不添加文档未要求的功能。

## 背景
God LLM 的 17 个模块已全部实现并通过单元测试（1246 tests passing），但完全未接入 App.tsx 运行时。App.tsx 仍使用 v1 的 ChoiceDetector + ConvergenceService + ContextManager。你的任务是将这些已实现的模块接入运行时，替代 v1 组件，同时保留 v1 组件作为降级 fallback。

## 项目文件
| 文件 | 路径 | 用途 |
|------|------|------|
| **设计文档** | `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` | 唯一设计真相源 |
| **集成任务清单** | `docs/requirements/god-llm-integration-todolist.md` | 详细任务分解 |
| **原始任务清单** | `docs/requirements/god-llm-todolist.md` | God 模块实现清单（已完成） |

## 核心源文件（需要修改）
| 文件 | 用途 |
|------|------|
| `src/ui/components/App.tsx` | 主入口，SessionRunner 组件，所有 useEffect 工作流编排 |
| `src/ui/components/SetupWizard.tsx` | 交互式设置向导，需添加 God 选择 |
| `src/ui/session-runner-state.ts` | 路由决策辅助函数（decidePostCodeRoute, decidePostReviewRoute） |
| `src/engine/workflow-machine.ts` | XState v5 状态机，需添加 TASK_INIT 状态 |
| `src/cli.ts` | CLI 入口 |
| `src/cli-commands.ts` | CLI 命令处理 |

## 已实现的 God 模块（只读引用，不需修改）
| 模块 | 路径 | 用途 |
|------|------|------|
| task-init | `src/god/task-init.ts` | TASK_INIT 意图解析 |
| god-router | `src/god/god-router.ts` | PostCoder/PostReviewer 路由决策 |
| god-convergence | `src/god/god-convergence.ts` | 收敛判断 |
| god-prompt-generator | `src/god/god-prompt-generator.ts` | 动态 Prompt 生成 |
| auto-decision | `src/god/auto-decision.ts` | WAITING_USER 代理决策 |
| degradation-manager | `src/god/degradation-manager.ts` | 4 级降级管理 |
| rule-engine | `src/god/rule-engine.ts` | 安全规则引擎 |
| god-system-prompt | `src/god/god-system-prompt.ts` | God system prompt 生成 |
| god-audit | `src/god/god-audit.ts` | 审计日志 |
| god-session-persistence | `src/god/god-session-persistence.ts` | God session 恢复 |
| consistency-checker | `src/god/consistency-checker.ts` | 一致性校验 |
| loop-detector | `src/god/loop-detector.ts` | 死循环检测 |
| drift-detector | `src/god/drift-detector.ts` | 漂移检测 |
| phase-transition | `src/god/phase-transition.ts` | 阶段转换 |
| alert-manager | `src/god/alert-manager.ts` | 告警管理 |
| tri-party-session | `src/god/tri-party-session.ts` | 三方会话 |
| god-context-manager | `src/god/god-context-manager.ts` | God 上下文管理 |

## TDD 流程
Step 1: RED — 先写失败的测试
Step 2: GREEN — 实现代码使测试通过
Step 3: SPEC — 验证实现符合设计文档
Step 4: LINT — 运行 lint 检查
Step 5: RUN — 运行全量测试: `npx vitest run`

## 核心约束
- God 通过 CLI adapter 调用（同 Coder/Reviewer），不绑定特定 SDK（AR-001）
- God 输出通过 JSON 代码块提取 + Zod schema 校验（AR-002）
- XState 保留，God 作为异步 effect handler 注入（AR-003）
- **旧组件保留为 fallback，不删除**（AR-004）— ContextManager、ConvergenceService、ChoiceDetector 必须保留
- God session ID + convergenceLog 存入 snapshot.json（AR-005）
- 规则引擎 block 不可被 God 覆盖（NFR-009）
- Reviewer 是收敛的唯一权威，converged 只能在 Reviewer 输出后产生
- 所有 God 调用必须用 DegradationManager 包裹，失败时自动回退到 v1 组件
- **现有 1246 个测试必须全部通过**，不允许删除或跳过

## 决策协议（无人值守环境）

本会话无人类在场。所有需要"人类确认"的场景，由 **AI 互相确认**替代。

### Level 1: SPEC-DECISION（自决 — 低风险歧义）

适用：参数命名、代码风格、小范围实现选择等不影响架构的决策。

```
Round 1: 列举所有可能方案
Round 2: 推演每个方案的影响 + 与文档其他部分的一致性
Round 3: 选择最优方案 + 标注残余风险
```

在代码中标注: `// SPEC-DECISION: chose B over A because ...`

### Level 2: AI-REVIEW（互审 — 高风险决策）

适用：架构变更、向后兼容影响、跨文件接口修改、设计文档歧义有多种合理解读。

**触发条件**（满足任一即触发 AI-REVIEW 而非 SPEC-DECISION）：
- 影响 2+ 个文件的接口变更
- SPEC-DECISION Round 3 仍有"高"残余风险
- 修改可能破坏现有测试或向后兼容性

**Review Agent 专业化**：

| 触发原因 | 审计角色 | 审查重点 |
|---------|---------|---------|
| 向后兼容影响 | **Compatibility Reviewer** | v1 组件是否仍可用、降级路径是否完整 |
| 跨文件接口变更 | **Interface Reviewer** | XState event 映射、God schema → App.tsx 类型 |
| God 降级路径 | **Degradation Reviewer** | 4 级降级是否正确覆盖所有调用点 |
| 设计文档歧义 | **Spec Reviewer** | 需求文档各章节一致性 |

**执行方式**：使用 `Agent` tool 启动一个独立的 review agent。

**结果处理**：
- 两个 AI 一致 → 采用共识方案，标注 `// AI-REVIEW: consensus on B`
- 分歧 BLOCK → 采用更保守方案，标注 `// AI-REVIEW: disagreement/BLOCK, chose conservative A`
- 分歧 WARN → 采用 Card AI 方案，标注 `// AI-REVIEW: disagreement/WARN, proceeded with B`

**决策记录**：每次完成后追加到 `decisions.jsonl`。

### Level 3: AI-GATE（阻断 — 关键节点强制审计）

已内置于 autodev.sh 的 Phase Gate 流程中。

### 决策审计追踪

每次 SPEC-DECISION 或 AI-REVIEW 完成后，**必须**追加一条记录到 DECISIONS_FILE（路径从 prompt 的"运行时信息"部分获取）。

使用 Node.js 追加：
```typescript
import * as fs from 'node:fs';
const decision = {
  timestamp: new Date().toISOString(),
  card: "B.1",
  level: "AI-REVIEW",
  reviewer_role: "Compatibility Reviewer",
  trigger: "backward compat impact",
  options: ["A: ...", "B: ..."],
  chosen: "A",
  severity: "BLOCK",
  consensus: true,
  rationale: "preserves existing callers",
  residual_risk: "none",
  file: "src/ui/components/App.tsx",
  line: 42
};
fs.appendFileSync(decisionsPath, JSON.stringify(decision) + '\n');
```

## 禁止事项（安全边界 — 违反将导致 Pipeline 回滚）

### 范围边界（最高优先级）
- ❌ **严禁实现当前 Card 以外的任何功能**
- ❌ **严禁读取 cards/ 目录下其他 Card 文件**
- ❌ **严禁修改 Autodev/ 目录下的任何文件**（state, decisions.jsonl 以外）
- ❌ **严禁写入 state 文件**

### 实现约束
- ❌ 添加设计文档未描述的功能
- ❌ 跳过测试
- ❌ 修改其他 Card 已实现的代码（除非当前 Card 明确要求）
- ❌ 删除 v1 组件（ContextManager, ConvergenceService, ChoiceDetector）— 它们是 fallback

### decisions.jsonl 例外
- ✅ 你**可以且应该** append 到 decisions.jsonl
- ❌ 但**不可**删除或覆盖已有内容

## Skill 使用规则

⚠️ **全自动流水线**: 本会话无人类在场，需要人类确认的场景由 AI 互审替代。

### 可用 Skill

| 时机 | Skill | 说明 |
|------|-------|------|
| **开始写代码前** | `/test-driven-development` | 启动 TDD 流程，先写测试再实现 |
| **测试失败时** | `/systematic-debugging` | 系统化排查，禁止盲猜修复 |
| **Card 完成前** | `/verification-before-completion` | 运行验证命令确认全部通过 |
| **Card 含 2+ 独立文件时** | `/dispatching-parallel-agents` | 并行开发独立模块 |

### Skill 调用规则
1. **TDD 必调**: 每张 Card 开始实现时，必须先调用 `/test-driven-development`
2. **调试必调**: 测试失败 ≥1 次后，必须调用 `/systematic-debugging`
3. **完成必调**: 声明 Card 完成前，必须调用 `/verification-before-completion`
4. **并行优先**: 当 Card 包含多个独立文件时，优先用 `/dispatching-parallel-agents`
5. **决策分级**: 低风险用 SPEC-DECISION 自决，高风险用 AI-REVIEW 互审

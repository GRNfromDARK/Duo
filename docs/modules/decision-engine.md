# 决策引擎模块（已简化）

> **简化说明**：原 `src/decision/` 目录（包含 `choice-detector.ts` 和 `convergence-service.ts`）在 "God Authoritative" 重构中**完全删除**。后续又经过进一步简化：`task-init.ts`、`interrupt-clarifier.ts`、`god-system-prompt.ts` 均已删除，GodDecisionEnvelope 移除了 `authority`、`autonomousResolutions`、`currentPhaseId` 字段，action 精简为 5 种，hand-executor 不再依赖 rule-engine。
>
> 需求追溯: FR-005, FR-006（原始需求），FR-003, FR-004, FR-008a（重构后实现）

---

## 1. 架构变更概述

### 1.1 被删除的模块

| 原模块 | 原文件 | 删除原因 |
|--------|--------|----------|
| **ChoiceDetector** | `src/decision/choice-detector.ts` | God LLM 直接处理 Worker 输出中的选择题/提问，不再需要独立的正则检测层 |
| **ConvergenceService** | `src/decision/convergence-service.ts` | God LLM 是收敛判定的唯一权威，基于规则的收敛检测被移除 |
| **TaskInit** | `src/god/task-init.ts` | 任务初始化逻辑已移除 |
| **InterruptClarifier** | `src/god/interrupt-clarifier.ts` | 中断澄清逻辑已移除 |
| **GodSystemPrompt** | `src/god/god-system-prompt.ts` | System prompt 已内联到 `god-decision-service.ts` 中 |

### 1.2 简化动机

经过两轮简化，决策架构从多层规则+LLM 混合模式精简为：

1. **God LLM 作为唯一决策权威** — 所有工作流决策（选择题路由、收敛判定、任务分配）由 God 统一处理
2. **5 种 action 类型** — `send_to_coder`、`send_to_reviewer`、`accept_task`、`wait`、`request_user_input`，移除了 `set_phase` 等复杂 action
3. **Rule Engine 独立存在** — 不再被 hand-executor 调用，作为独立的安全校验工具保留

---

## 2. 当前决策架构

决策由两个独立组件承担，职责完全分离：

```
Observations (Coder/Reviewer/Runtime/Human 产出)
    │
    v
GodDecisionService.makeDecision()
    │
    ├── God LLM 分析 observations + context
    │       │
    │       v
    │   GodDecisionEnvelope (结构化决策)
    │       │
    │       ├── diagnosis: { summary, currentGoal, notableObservations }
    │       ├── actions: GodAction[] (5 种类型)
    │       └── messages: EnvelopeMessage[]
    │
    └── Fallback: God 调用失败时返回 wait action

    ──────────────────────────────────────────────────

RuleEngine.evaluateRules()  ← 独立安全校验（不被 hand-executor 调用）
    │
    ├── block-level 规则命中 → 绝对阻止（God 不可覆盖）
    └── warn-level 规则命中 → 警告记录
```

### 2.1 GodDecisionService（`src/god/god-decision-service.ts`）

God Decision Service 是所有工作流决策的**统一入口点**。

**核心方法**：`makeDecision(observations, context, isResuming)` → `GodDecisionEnvelope`

**决策流程**：

1. 构建 prompt（含 observations、context、Hand catalog）
2. 通过 `collectGodAdapterOutput` 调用 God adapter 获取 LLM 输出
3. 通过 `extractGodJson` + Zod schema 校验提取结构化 envelope
4. 成功 → 返回 envelope，通知 Watchdog 成功
5. 失败 → Watchdog 判断是否重试（backoff 策略）
6. 重试仍失败 → 返回 fallback envelope（包含 `wait` action）

**System Prompt**：直接定义在 `god-decision-service.ts` 中（导出为 `SYSTEM_PROMPT` 常量），不再依赖独立的 `god-system-prompt.ts` 文件。Prompt 指导 God 使用 5 种 action、处理 coder/reviewer 交互、自主解决常规决策。

**GodDecisionEnvelope 结构**（`src/types/god-envelope.ts`）：

```typescript
{
  diagnosis: {
    summary: string;         // 形势评估
    currentGoal: string;     // 当前目标
    notableObservations: string[];  // 驱动决策的关键观察
  },
  actions: GodAction[],      // 5 种 action 类型
  messages: EnvelopeMessage[] // 消息路由
}
```

注意：相比重构前的版本，envelope 已移除 `authority`（权限声明）和 `autonomousResolutions`（proxy 决策记录）字段。

**5 种 GodAction**（`src/types/god-actions.ts`）：

| Action | 字段 | 说明 |
|--------|------|------|
| `send_to_coder` | `dispatchType` (`explore`/`code`/`debug`/`discuss`), `message` | 发送工作给 Coder，dispatchType 控制 Coder 模式 |
| `send_to_reviewer` | `message` | 发送 Coder 工作成果给 Reviewer |
| `accept_task` | `summary` | 任务完成，summary 说明完成内容 |
| `wait` | `reason`, `estimatedSeconds?` | 暂停等待 |
| `request_user_input` | `question` | 向用户提问（仅限真正需要人类输入的场景） |

### 2.2 Hand Executor（`src/god/hand-executor.ts`）

Hand Executor 负责顺序执行 `GodAction[]` 并返回 `Observation[]`。

**关键变更**：hand-executor **不再依赖 rule-engine**。所有 action 直接执行，没有安全规则拦截。这是因为简化后的 5 种 action 都是纯粹的工作流控制操作（消息路由、状态变更），不涉及文件写入或命令执行等需要安全校验的操作。

**执行逻辑**：
- 每个 action 设置对应的 context 状态（如 `pendingCoderMessage`、`taskCompleted`）
- 返回 `Observation`（`source: 'runtime'`）记录执行结果
- 异常时返回 `runtime_error` observation，不中断后续 action 执行

### 2.3 Rule Engine（`src/god/rule-engine.ts`）

Rule Engine 是系统中**唯一保留的同步规则引擎**，作为**独立的安全校验工具**存在。它不参与工作流决策，也不再被 hand-executor 调用。当前仅在测试中直接使用。

**关键设计**：block-level 规则具有绝对优先级，God 不可覆盖（NFR-009）。

#### 规则清单

| 规则 ID | Level | 描述 | 触发条件 |
|---------|-------|------|----------|
| R-001 | `block` | 文件写入超出 `~/Documents` 范围 | `file_write` / `config_modify` 路径不在 `~/Documents` 下 |
| R-002 | `block` | 访问系统关键目录 | 路径或命令引用 `/etc`、`/usr`、`/bin`、`/System`、`/Library`（含 symlink 解析） |
| R-003 | `block` | 可疑的网络外发 | 命令匹配 `curl` + 数据上传模式 |
| R-004 | `warn` | God 批准与规则引擎冲突 | `godApproved = true` 但存在 block-level 命中 |
| R-005 | `warn` | Coder 修改 `.duo/` 配置 | 路径包含 `/.duo/` |

#### 路径解析安全

`resolvePath()` 函数处理 symlink 绕过攻击：
- 优先使用 `realpathSync` 解析完整路径
- 路径不存在时，逐级向上查找最深的存在祖先目录，解析其 realpath 后拼接剩余路径
- macOS 特殊处理：`/etc` → `/private/etc` 等系统目录 symlink 在初始化时预解析

#### 评估接口

```typescript
function evaluateRules(action: ActionContext): RuleEngineResult
```

返回 `{ blocked: boolean, results: RuleResult[] }`。`blocked` 为 `true` 当且仅当存在 `level: 'block'` 且 `matched: true` 的规则。

---

## 3. 原决策模块功能的去向

| 原功能 | 原实现 | 当前实现 |
|--------|--------|----------|
| 选择题检测（正则） | `ChoiceDetector.detect()` | God LLM 直接从 observation 中识别 |
| 选择题转发 prompt 构建 | `ChoiceDetector.buildForwardPrompt()` | God 通过 `send_to_coder` / `send_to_reviewer` action 路由 |
| Reviewer 输出分类 | `ConvergenceService.classify()` | God 直接分析 Reviewer verdict |
| Blocking issue 计数 | `ConvergenceService.countBlockingIssues()` | God 从 Reviewer 输出语义理解 issue 数量 |
| 终止条件评估 | `ConvergenceService.evaluate()` | God 通过 `accept_task` action 决定终止 |
| 循环检测 | `ConvergenceService.detectLoop()` | God 通过 observation 历史判断是否陷入循环 |
| 进展趋势分析 | `ConvergenceService.detectProgressTrend()` | God 在 `diagnosis.summary` 中评估进展 |
| God 降级 fallback | ConvergenceService 作为规则兜底 | `buildFallbackEnvelope()` 返回 `wait` action |
| 任务初始化 | `task-init.ts` | 已删除，God 直接开始工作 |
| 中断澄清 | `interrupt-clarifier.ts` | 已删除，通过 `request_user_input` action 处理 |
| System prompt 构建 | `god-system-prompt.ts` | 内联到 `god-decision-service.ts` |
| Hand 执行安全校验 | hand-executor 调用 rule-engine | 已移除，5 种 action 不涉及文件/命令操作 |

---

## 4. 关键设计决策

| 决策 | 理由 |
|------|------|
| 删除 ChoiceDetector | God LLM 能更准确地理解问题语义和上下文，正则检测在中英文混合场景下存在误判 |
| 删除 ConvergenceService | 基于规则的收敛判定无法处理复杂的任务完成度评估；God 作为唯一权威消除了判定冲突 |
| 精简为 5 种 action | 移除 `set_phase` 等复杂 action，简化工作流控制；phase 管理不再是 God 的职责 |
| 移除 GodDecisionEnvelope 中的 authority/autonomousResolutions | 简化 envelope 结构，God 的决策权限不需要在 envelope 中声明 |
| hand-executor 不再调用 rule-engine | 5 种 action 都是纯工作流控制，不涉及文件写入或命令执行，无需安全校验 |
| 保留 Rule Engine 作为独立安全工具 | 安全规则（防止文件越权写入、系统目录访问）仍有价值，作为可复用的安全组件保留 |
| Rule Engine block-level 不可被 God 覆盖 | NFR-009 要求：安全边界由确定性规则保障，LLM 的不确定性不应影响安全决策 |
| God 失败时返回 wait action（非空 action） | 空 actions 导致死循环。wait action 确保执行循环产生新 observation |
| System prompt 内联 | 删除独立的 `god-system-prompt.ts`，减少文件数量，prompt 与 service 逻辑就近维护 |
| Watchdog backoff 重试 | God adapter 可能因网络、rate limit 等暂时失败，自动重试避免不必要的 fallback |

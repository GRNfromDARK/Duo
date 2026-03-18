# 决策引擎模块（已重构）

> **重构说明**：原 `src/decision/` 目录（包含 `choice-detector.ts` 和 `convergence-service.ts`）已在 "God Authoritative" 重构中**完全删除**。本文档描述重构后的决策架构。
>
> 需求追溯: FR-005, FR-006（原始需求），FR-003, FR-004, FR-008a（重构后实现）

---

## 1. 架构变更概述

### 1.1 被删除的模块

| 原模块 | 原文件 | 删除原因 |
|--------|--------|----------|
| **ChoiceDetector** | `src/decision/choice-detector.ts` | God LLM 直接处理 Worker 输出中的选择题/提问，通过 proxy decision-making 自主决策或路由给 Reviewer 评估，不再需要独立的正则检测层 |
| **ConvergenceService** | `src/decision/convergence-service.ts` | God LLM 是收敛判定的唯一权威。基于规则的收敛检测（marker 匹配、issue 计数、循环检测）被移除，God 通过 `accept_task` action 直接决定任务终止 |

### 1.2 重构动机

原架构中，决策逻辑分散在两层：

1. **规则层**（ChoiceDetector + ConvergenceService）—— 基于正则和 heuristic 的同步判定
2. **God 层**（God LLM）—— 基于 LLM 的智能判定，ConvergenceService 作为 God 降级时的 fallback

重构后，God LLM 成为**唯一的决策权威**（Sovereign God 模式）。所有工作流决策——包括选择题路由、收敛判定、阶段推进——都由 God 统一处理。这消除了规则层与 God 层之间的判定冲突和优先级歧义。

---

## 2. 当前决策架构

重构后的决策由两个组件承担，职责分明：

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
    │       ├── actions: Hand[] (send_to_coder, accept_task, set_phase, ...)
    │       ├── authority: 权限声明
    │       ├── diagnosis: 形势分析
    │       └── autonomousResolutions: proxy 决策记录
    │
    └── Fallback: God 调用失败时返回 wait action（BUG-22 修复）

    ──────────────────────────────────────────────────

ActionContext (file_write / command_exec / config_modify)
    │
    v
RuleEngine.evaluateRules()  ← 唯一的同步规则引擎
    │
    ├── block-level 规则命中 → 绝对阻止（God 不可覆盖）
    └── warn-level 规则命中 → 警告记录
```

### 2.1 GodDecisionService（`src/god/god-decision-service.ts`）

God Decision Service 是所有工作流决策的**统一入口点**，取代了原先分散在 5 个调用点的 God 调用（`routePostCoder` / `routePostReviewer` / `evaluateConvergence` / `makeAutoDecision` / `classifyTask`）。

**核心方法**：`makeDecision(observations, context, isResuming)` → `GodDecisionEnvelope`

**决策流程**：

1. 构建 prompt（含 observations、context、Hand catalog、phase plan）
2. 调用 God adapter 获取 LLM 输出
3. 通过 `extractGodJson` + Zod schema 校验提取结构化 envelope
4. 成功 → 返回 envelope，通知 Watchdog 成功
5. 失败 → Watchdog 判断是否重试（backoff 策略）
6. 重试仍失败 → 返回 fallback envelope（包含 `wait` action，防止空 action 导致的死循环）

**God 承担的原 ChoiceDetector 职责**：

God system prompt 中包含 `CHOICE_HANDLING_INSTRUCTIONS` 和 `PROXY_DECISION_INSTRUCTIONS`，指导 God 处理 Worker 输出中的选择题：
- 实现细节类问题 → God 自主决策，记录到 `autonomousResolutions`
- 设计方案类选择（多方案对比） → 路由给 Reviewer 评估（`send_to_reviewer`）
- 用户偏好类问题 → `request_user_input`（仅限真正需要人类输入的场景）

**God 承担的原 ConvergenceService 职责**：

God 通过 `accept_task` action 直接判定任务收敛，携带 `rationale` 字段说明终止原因：
- `reviewer_aligned` — Reviewer 已通过，God 认同
- `god_override` — God 覆盖 Reviewer 判定
- `forced_stop` — 强制终止

God system prompt 中的 `REVIEWER_HANDLING_INSTRUCTIONS` 和 `DECISION_REFLECTION_INSTRUCTIONS` 确保 God 在做出收敛判定时：
- 必须参考 Reviewer verdict（`[APPROVED]` / `[CHANGES_REQUESTED]`）
- 在高风险决策前执行 self-check（scope、quality、plan consistency）
- 不得在 Reviewer 未参与时使用 `reviewer_aligned` rationale

### 2.2 Rule Engine（`src/god/rule-engine.ts`）

Rule Engine 是系统中**唯一保留的同步规则引擎**，但它不参与工作流决策（选择题路由、收敛判定），而是作为**安全沙箱**，对 Coder 的具体操作（文件写入、命令执行、配置修改）进行安全校验。

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
| God 降级 fallback | ConvergenceService 作为规则兜底 | `buildFallbackEnvelope()` 返回 `wait` action，等待重试 |

---

## 4. 关键设计决策

| 决策 | 理由 |
|------|------|
| 删除 ChoiceDetector | God LLM 能更准确地理解问题语义和上下文，正则检测在中英文混合场景下存在误判；God 的 proxy decision-making 同时解决了"检测"和"决策"两个问题 |
| 删除 ConvergenceService | 基于规则的收敛判定无法处理复杂的任务完成度评估；God 作为唯一权威消除了规则判定与 God 判定之间的冲突 |
| 保留 Rule Engine 作为安全沙箱 | 安全规则（防止文件越权写入、系统目录访问）是不可协商的硬约束，不应依赖 LLM 判断 |
| Rule Engine block-level 不可被 God 覆盖 | NFR-009 要求：安全边界由确定性规则保障，LLM 的不确定性不应影响安全决策 |
| God 失败时返回 wait action（非空 action） | BUG-22 修复：空 actions 导致空结果 → 丢失 observations → 死循环。wait action 确保执行循环产生新 observation |
| Watchdog backoff 重试 | God adapter 可能因网络、rate limit 等暂时失败，自动重试避免不必要的 fallback |

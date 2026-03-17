# God LLM 编排器模块

## 1. 模块概述

### God LLM 的角色

God LLM 是 Duo 系统中的 Sovereign 编排层。在 Coder/Reviewer 双方协作模式之上，God 作为唯一决策者（Sovereign God），通过统一的 **Observe -> Decide -> Act** 管线驱动整个运行时：

- **任务分析**：解析用户意图，分类任务类型（explore/code/discuss/review/debug/compound），制定终止条件和动态轮次
- **统一决策**：通过 `GodDecisionService.makeDecision(observations, context)` 单入口生成 `GodDecisionEnvelope`，取代原先分散在 5 个调用点的决策逻辑
- **Hand 执行**：通过结构化 `GodAction[]` 执行状态变更，rule engine 逐条校验，所有状态变化必须 action-backed（NFR-001 / FR-016）
- **消息分发**：自然语言消息通道将 envelope 中的 messages 路由到 coder/reviewer/user/system_log，且不触发任何状态变化
- **观察管线**：Coder/Reviewer/Runtime/Human 的所有输出通过 observation-classifier 归一化为 `Observation`，non-work 输出（quota/auth/empty 等）被拦截不得推进工作流
- **质量保障**：检测 God 自身输出的幻觉和逻辑矛盾
- **可靠性**：Watchdog AI 诊断故障 + 四级降级策略确保 God 不可用时自动回退
- **代理决策**：God 拦截 worker 提出的问题，自主解决实现细节，设计方案则路由给 Reviewer 评估

### 架构演进：从五散点到统一管线

| 维度 | 旧五散点模式 | Sovereign God 统一管线 |
|------|-------------|----------------------|
| 决策入口 | routePostCoder / routePostReviewer / evaluateConvergence / makeAutoDecision / classifyTask | `GodDecisionService.makeDecision()` 单入口 |
| 输入格式 | 各调用点拼接不同 prompt | 统一 `Observation[]` 输入 |
| 输出格式 | 5 种不同 JSON schema | 统一 `GodDecisionEnvelope`（diagnosis + authority + actions + messages） |
| 状态变更 | 隐含在 XState 事件映射中 | 显式 `GodAction[]` 经 Hand Executor 执行 |
| 消息通道 | 无独立通道 | 独立 `EnvelopeMessage[]` 分发，保证不触发状态变化 |
| NL/Action 一致性 | 无检查 | `checkNLInvariantViolations()` 检测不一致 |
| 故障恢复 | 规则化降级（L1-L4） | Watchdog AI 诊断 + 智能恢复 |

### 核心循环：Observe -> Decide -> Act

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Observe                                       │
│  Worker Output → observation-classifier → Observation                │
│  Human Input → observation-integration → Observation                 │
│  Runtime Error → observation-integration → Observation               │
└────────────────────────┬─────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────────────┐
│                        Decide                                        │
│  Observation[] → GodDecisionService.makeDecision() →                 │
│                   GodDecisionEnvelope {                               │
│                     diagnosis, authority, actions, messages,          │
│                     autonomousResolutions?                            │
│                   }                                                   │
│  失败时 → Watchdog AI 诊断 → retry/construct/escalate               │
└────────────────────────┬─────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────────────┐
│                         Act                                          │
│  envelope.actions → HandExecutor (rule engine 校验) → Observation[]  │
│  envelope.messages → MessageDispatcher → pending messages / UI / log │
│  NL invariant 检查 → runtime_invariant_violation（如有不一致）        │
└──────────────────────────────────────────────────────────────────────┘
```

### 文件清单

**类型定义（5 个文件）**
- `src/types/god-adapter.ts` — GodAdapter 接口定义
- `src/types/god-schemas.ts` — God 输出 Zod schema（5 个遗留 schema + GodTaskAnalysis 活跃使用）
- `src/types/god-actions.ts` — Hand / GodAction catalog（11 种 action 的 Zod schema）
- `src/types/god-envelope.ts` — GodDecisionEnvelope + Authority 类型
- `src/types/observation.ts` — Observation 类型系统（13 种观察类型）
- `src/types/degradation.ts` — 降级状态类型

**Adapter 层（5 个文件）**
- `src/god/god-adapter-config.ts` — adapter 配置与解析
- `src/god/god-adapter-factory.ts` — adapter 工厂
- `src/god/adapters/claude-code-god-adapter.ts` — Claude Code 实现
- `src/god/adapters/codex-god-adapter.ts` — Codex 实现
- `src/god/adapters/gemini-god-adapter.ts` — Gemini CLI 实现

**调用链（3 个文件）**
- `src/god/god-call.ts` — God adapter 统一调用入口
- `src/god/god-system-prompt.ts` — God system prompt 构建（TASK_INIT 分类格式）
- `src/god/god-prompt-generator.ts` — Coder/Reviewer prompt 动态生成（含 propose-first 模式和 Reviewer 反馈直传）

**统一决策管线（4 个文件）**
- `src/god/god-decision-service.ts` — 统一决策服务 GodDecisionService（含 Sovereign God system prompt）
- `src/god/hand-executor.ts` — Hand 执行器，执行 GodAction[] 并返回 Observation[]
- `src/god/message-dispatcher.ts` — 消息分发器，路由 EnvelopeMessage[]
- `src/god/observation-integration.ts` — 观察集成层，连接 classifier 到各输出源

**观察系统（1 个文件）**
- `src/god/observation-classifier.ts` — 输出分类 + Non-Work Guard + Incident Tracker

**遗留决策（2 个文件）**
- `src/god/auto-decision.ts` — GOD_DECIDING 自主决策
- `src/god/god-convergence.ts` — 收敛判定

**任务管理（3 个文件）**
- `src/god/task-init.ts` — 任务初始化与分类
- `src/god/phase-transition.ts` — compound 任务阶段转换
- `src/god/tri-party-session.ts` — 三方会话管理

**质量保障（1 个文件）**
- `src/god/consistency-checker.ts` — God 输出一致性检查

**可靠性（3 个文件）**
- `src/god/watchdog.ts` — Watchdog AI 故障诊断与恢复
- `src/god/degradation-manager.ts` — 四级降级管理（被 Watchdog 部分取代）
- `src/god/interrupt-clarifier.ts` — 人类中断意图分类

**持久化与审计（2 个文件）**
- `src/god/god-audit.ts` — 审计日志（append-only JSONL + Envelope Decision Audit）
- `src/god/god-session-persistence.ts` — God 会话持久化

---

## 2. 类型基础设施

### 2.1 `src/types/observation.ts` — Observation 类型系统

Sovereign God Runtime 的核心数据类型。所有来自 coder/reviewer/god/human/runtime 的输出都被归一化为 Observation。

```typescript
type ObservationType =
  | 'work_output'                 // Coder 工作输出
  | 'review_output'               // Reviewer 审查输出
  | 'quota_exhausted'             // API 配额耗尽
  | 'auth_failed'                 // 认证失败
  | 'adapter_unavailable'         // Adapter 进程不可用
  | 'empty_output'                // 空输出
  | 'meta_output'                 // 非工作元输出（AI 拒绝等）
  | 'tool_failure'                // 工具/进程故障
  | 'human_interrupt'             // 人类 Ctrl+C 中断
  | 'human_message'               // 人类文本中断
  | 'clarification_answer'        // 人类回答澄清问题
  | 'phase_progress_signal'       // 阶段进展信号（Hand 执行结果）
  | 'runtime_invariant_violation' // 运行时不变量违规

type ObservationSource = 'coder' | 'reviewer' | 'god' | 'human' | 'runtime';
type ObservationSeverity = 'info' | 'warning' | 'error' | 'fatal';

interface Observation {
  source: ObservationSource;
  type: ObservationType;
  summary: string;
  rawRef?: string;               // 完整原始输出引用
  severity: ObservationSeverity;
  timestamp: string;
  round: number;
  phaseId?: string | null;
  adapter?: string;
}
```

关键函数：`isWorkObservation(obs)` — 仅 `work_output` 和 `review_output` 返回 `true`，其他类型均为 non-work。

### 2.2 `src/types/god-actions.ts` — Hand / GodAction Catalog

使用 Zod discriminated union 定义 11 种结构化 action：

| Action | 参数 | 用途 |
|--------|------|------|
| `send_to_coder` | `message: string` | 向 Coder 发送工作指令 |
| `send_to_reviewer` | `message: string` | 向 Reviewer 发送审查指令 |
| `stop_role` | `role, reason` | 停止运行中的角色 |
| `retry_role` | `role, hint?` | 重试角色（可附带提示） |
| `switch_adapter` | `role, adapter, reason` | 切换某角色的 adapter |
| `set_phase` | `phaseId, summary?` | 设置当前 phase（显式阶段转换） |
| `accept_task` | `rationale, summary` | 接受/完成任务，rationale 必须为 `reviewer_aligned` / `god_override` / `forced_stop` |
| `wait` | `reason, estimatedSeconds?` | 进入等待状态 |
| `request_user_input` | `question` | 请求人类输入 |
| `resume_after_interrupt` | `resumeStrategy` | 中断后恢复，策略为 `continue` / `redirect` / `stop` |
| `emit_summary` | `content` | 发出管理摘要 |

### 2.3 `src/types/god-envelope.ts` — GodDecisionEnvelope

统一的 God 决策输出格式，取代 5 个遗留 schema：

```typescript
interface GodDecisionEnvelope {
  diagnosis: {
    summary: string;               // 简要情势评估
    currentGoal: string;           // 当前目标
    currentPhaseId: string;        // 当前 phase ID
    notableObservations: string[]; // 驱动此决策的关键观察
  };
  authority: {
    userConfirmation: 'human' | 'god_override' | 'not_required';
    reviewerOverride: boolean;
    acceptAuthority: 'reviewer_aligned' | 'god_override' | 'forced_stop';
  };
  actions: GodAction[];            // 结构化 Hand actions
  messages: EnvelopeMessage[];     // NL 消息通道
  autonomousResolutions?: AutonomousResolution[]; // God 代理决策记录
}

interface EnvelopeMessage {
  target: 'coder' | 'reviewer' | 'user' | 'system_log';
  content: string;
}

interface AutonomousResolution {
  question: string;    // worker 提出的问题
  choice: string;      // God 初始决策
  reflection: string;  // God 反思（一致性、风险、替代方案）
  finalChoice: string; // 反思后的最终决策
}
```

**Authority 语义约束**（Zod superRefine 强制执行）：
- `reviewerOverride = true` -> messages 必须包含 `system_log` 条目说明 override 原因
- `acceptAuthority = 'god_override'` -> messages 必须包含 `system_log` 条目说明原因
- `userConfirmation = 'god_override'` -> messages 必须包含 `system_log` 条目说明原因（BUG-18 fix）
- `acceptAuthority = 'forced_stop'` -> messages 必须包含 `user` 目标的摘要消息

### 2.4 `src/types/god-schemas.ts` — Zod Schema（5 个遗留 + 1 个活跃）

| Schema | 用途 | 状态 |
|--------|------|------|
| `GodTaskAnalysisSchema` | TASK_INIT 输出 | **活跃** — task-init.ts 使用 |
| `GodPostCoderDecisionSchema` | POST_CODER 路由 | deprecated |
| `GodPostReviewerDecisionSchema` | POST_REVIEWER 路由 | deprecated（consistency-checker 仍引用） |
| `GodConvergenceJudgmentSchema` | 收敛判定 | deprecated（god-convergence.ts 仍引用） |
| `GodAutoDecisionSchema` | 自主决策 | deprecated（auto-decision.ts 仍引用） |

**GodTaskAnalysisSchema** 详细字段：

```typescript
{
  taskType: 'explore' | 'code' | 'discuss' | 'review' | 'debug' | 'compound',
  reasoning: string,
  confidence: number,              // 0.0 ~ 1.0
  suggestedMaxRounds: number,      // 1 ~ 20
  terminationCriteria: string[],
  phases?: Phase[] | null,         // compound 类型时必须非空
}
```

Zod refine 约束：`taskType === 'compound'` 时 `phases` 必须为非空数组。

### 2.5 `src/types/god-adapter.ts` — GodAdapter 接口

```typescript
type GodAdapterName = 'claude-code' | 'codex' | 'gemini';
type GodToolUsePolicy = 'forbid' | 'allow-readonly';

interface GodAdapter {
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly toolUsePolicy?: GodToolUsePolicy;
  readonly minimumTimeoutMs?: number;

  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string>;
  execute(prompt, opts): AsyncIterable<OutputChunk>;
  kill(): Promise<void>;
  isRunning(): boolean;
  clearSession?(): void;  // 清除会话状态，强制下次 execute 使用新会话
}
```

关键设计：
- `toolUsePolicy` 控制 God 是否允许使用工具。`'forbid'`（Claude Code、Gemini）完全禁止；`'allow-readonly'`（Codex）允许只读
- `minimumTimeoutMs` 允许 adapter 声明最低超时要求（Codex 为 600s）
- `execute()` 返回 `AsyncIterable<OutputChunk>`，支持流式处理
- `clearSession()` 被 Watchdog 在 `retry_fresh` 时调用，清除可能污染的会话状态

### 2.6 `src/types/degradation.ts` — 降级状态类型

```typescript
type DegradationLevel = 'L1' | 'L2' | 'L3' | 'L4';
type GodErrorKind = 'process_exit' | 'timeout' | 'parse_failure' | 'schema_validation';

interface DegradationState {
  level: DegradationLevel;
  consecutiveFailures: number;
  godDisabled: boolean;
  fallbackActive: boolean;
  lastError?: string;
}
```

此类型被 `WatchdogService` 和 `DegradationManager` 共同使用，支持会话持久化（duo resume）。

---

## 3. God Adapter 层

### 3.1 `src/god/god-adapter-config.ts` — Adapter 配置与解析

支持的 God adapter 列表：`['claude-code', 'codex', 'gemini']`。

导出函数：
- `isSupportedGodAdapterName(name)` — 类型守卫，校验 adapter 名称
- `getInstalledGodAdapters(detected)` — 从已检测 CLI 列表中过滤已安装的 God adapter
- `resolveGodAdapterForStart(reviewer, detected, explicitGod?)` — 启动时解析 God adapter：优先显式指定 > reviewer 同名 > 已安装 fallback（优先 `claude-code`）
- `sanitizeGodAdapterForResume(reviewer, detected, persistedGod?)` — resume 时恢复 God adapter，不可用时自动降级

返回类型 `GodAdapterResolution` 区分 `ResolutionSuccess` 和 `ResolutionFailure`，携带 `warnings` 数组。

**解析优先级**：
1. 用户显式指定 `--god` 参数 -> 校验是否支持且已安装
2. reviewer 同名 adapter（如 reviewer 使用 claude-code，God 也使用 claude-code）
3. 自动选择已安装的 fallback，优先 `claude-code`

### 3.2 `src/god/god-adapter-factory.ts` — Adapter 工厂

```typescript
function createGodAdapter(name: string): GodAdapter
```

简单工厂，根据名称创建 `ClaudeCodeGodAdapter`、`CodexGodAdapter` 或 `GeminiGodAdapter` 实例。不支持的名称抛出 Error。

### 3.3 `src/god/adapters/claude-code-god-adapter.ts` — Claude Code 实现

- `toolUsePolicy = 'forbid'` — 完全禁止工具调用
- 使用 `ProcessManager` 管理子进程，`StreamJsonParser` 解析 stream-json 格式输出
- 构建参数：`-p prompt --output-format stream-json --verbose --dangerously-skip-permissions --system-prompt ... --tools '' --add-dir cwd`
- 通过 `buildAdapterEnv` 过滤环境变量，仅保留 `ANTHROPIC_` 和 `CLAUDE_` 前缀
- 删除 `CLAUDECODE` 环境变量以避免递归检测
- **会话恢复**：支持 `--resume sessionId`，通过 `lastSessionId` 跟踪会话 ID，从 stream-json 的 status chunk 中捕获 `session_id`
- resume 失败时自动清除 stale session ID，下次回退到全新会话

### 3.4 `src/god/adapters/codex-god-adapter.ts` — Codex 实现

- `toolUsePolicy = 'allow-readonly'` — 允许只读工具
- `minimumTimeoutMs = 600_000` — 声明最低 600s 超时
- 使用 `JsonlParser` 解析 JSONL 格式输出
- 通过 `buildCodexGodPrompt()` 包装 prompt，前置 `SYSTEM EXECUTION MODE` 声明：这是 Duo 的隐藏编排器子调用，不要直接解决任务
- 运行在 `--full-auto --ephemeral` 模式（无会话恢复）
- 启动前检测 git repo 状态，非 git repo 时添加 `--skip-git-repo-check`

### 3.5 `src/god/adapters/gemini-god-adapter.ts` — Gemini CLI 实现

- `toolUsePolicy = 'forbid'` — 完全禁止工具调用
- 使用 `ProcessManager` + `StreamJsonParser`，与 Claude Code adapter 架构一致
- 通过 `buildGeminiGodPrompt()` 包装 prompt（与 Codex 类似的前置声明）
- 构建参数：`-p prompt --output-format stream-json --yolo --include-directories cwd`
- **会话恢复**：与 Claude Code 相同模式 — 支持 `--resume sessionId`，跟踪 `lastSessionId`
- resume 模式下跳过 system prompt 包装（直接发送用户 prompt），因为 system prompt 已在首次调用中建立
- 环境变量过滤：仅保留 `GOOGLE_` 和 `GEMINI_` 前缀

**三种 adapter 对比**：

| 特性 | Claude Code | Codex | Gemini |
|------|-------------|-------|--------|
| Tool Policy | forbid | allow-readonly | forbid |
| Min Timeout | 无 | 600s | 无 |
| 会话恢复 | 支持 (--resume) | 不支持 (--ephemeral) | 支持 (--resume) |
| 输出格式 | stream-json | JSONL | stream-json |
| Prompt 包装 | 原生 system-prompt 参数 | 前置 SYSTEM EXECUTION MODE | 首轮前置包装，resume 轮直接发送 |
| 环境变量前缀 | ANTHROPIC_, CLAUDE_ | OPENAI_ | GOOGLE_, GEMINI_ |

---

## 4. 调用链

### 4.1 `src/god/god-call.ts` — 统一调用入口

```typescript
interface GodCallOptions {
  adapter: GodAdapter;
  prompt: string;
  systemPrompt: string;
  projectDir?: string;
  timeoutMs: number;
  model?: string;          // 可选 model override
  logging?: GodCallLoggingOptions;
}

async function collectGodAdapterOutput(options): Promise<string>
```

核心逻辑：
- 使用 `Math.max(timeoutMs, adapter.minimumTimeoutMs)` 确保不低于 adapter 最低超时
- 可选 `logging` 参数将 prompt 写入 prompt-log（FR-018 审计追溯）
- 流式消费 adapter 输出，收集 `text`/`code`/`error` 类型 chunk
- 对 `tool_use`/`tool_result` chunk：`forbid` policy 时抛错，`allow-readonly` policy 时跳过
- `finally` 块确保进程清理（检查 `adapter.isRunning()` 后调用 `adapter.kill()`）

### 4.2 `src/god/god-system-prompt.ts` — System Prompt 构建（遗留格式）

```typescript
function buildGodSystemPrompt(context: GodPromptContext): string
```

生成的 system prompt 包含：
- **CRITICAL OVERRIDE 开头**：明确覆盖宿主 CLI 的内置指令（CLAUDE.md、skills 等），声明这是 JSON-only orchestrator 角色
- **角色定义**：纯 JSON 决策者，不写代码、不读文件、不使用工具
- **5 个决策点的 JSON schema**：
  - `TASK_INIT` — 任务分类（taskType, confidence, suggestedMaxRounds, terminationCriteria, phases）
  - `POST_CODER` — Coder 输出后路由（continue_to_review / retry_coder）
  - `POST_REVIEWER` — Reviewer 输出后路由（route_to_coder / converged / phase_transition / loop_detected）
  - `CONVERGENCE` — 收敛判定（approved / changes_requested / needs_discussion）
  - `AUTO_DECISION` — 自主决策（accept / continue_with_instruction）
- **规则约束**：只输出 JSON code block，保守优先，禁止请求人类介入
- override/forced_stop 时必须附带 system_log/user 消息

> 注：此 prompt 用于遗留的分散调用路径。统一管线使用 `god-decision-service.ts` 中的 `SYSTEM_PROMPT` 常量。

### 4.3 `src/god/god-prompt-generator.ts` — Coder/Reviewer Prompt 动态生成

导出两个 prompt 生成函数，用于向 Coder 和 Reviewer 发送工作指令。

**`generateCoderPrompt(ctx: PromptContext, audit?: AuditOptions): string`**

按优先级组装 prompt 内容：

1. **Worker 角色声明**（Card D.2，FR-009）：明确 Coder 为纯执行者，不具有 accept authority，不决定 phase 切换
2. **Task goal**（P3）：任务目标
3. **Phase info**：compound 类型时显示当前 phase ID 和 type
4. **God instruction**（P0，最高优先级）：God auto-decision 注入的指令
5. **unresolvedIssues**（P1）：Reviewer 驱动的必须修复项
6. **suggestions**（P2）：非阻塞建议
7. **convergenceLog 趋势**（P3）：收敛历史概要
8. **策略指令模板**（FR-003a）：根据 `taskType` 选择对应指令

策略指令模板按任务类型区分，每种类型有两个变体——**propose（方案模式）** 和 **implement（实现模式）**：

| 类型 | Propose 模式（首轮） | Implement 模式（经 Reviewer 确认后） |
|------|---------------------|--------------------------------------|
| `explore` | 分析代码库，不修改文件 | （相同，始终只读） |
| `code` | 分析 + 提出实现计划，不修改文件 | 实现变更，编写测试，自主决策 |
| `debug` | 诊断问题 + 提出修复方案，不修改文件 | 定位根因，最小化修复 |
| `review` | 审查代码变更，检查 bug 和安全问题 | （相同） |
| `discuss` | 评估方案优劣，提供建议 | （相同） |

**Propose-first 判定逻辑**：当 `!isPostReviewerRouting && !instruction` 时（即首轮、无 God 指令），`code`/`debug` 类型使用 propose 变体。经过 Reviewer 反馈后自动切换到 implement 变体。

**Reviewer 反馈直传**（Priority 0.5）：当 `isPostReviewerRouting` 为 true 且存在 `lastReviewerOutput` 时，注入 `## Reviewer Feedback (Round N)` 段落，包含 Reviewer 的完整原始分析（经 `stripToolMarkers()` 清理工具标记后）。这确保 Coder 直接看到 Reviewer 的一手代码引用和根因分析，而非 God 的二次转述。

**`extractBlockingIssues(reviewerOutput)`**：从 Reviewer 输出中提取 blocking issues，用于填充 `unresolvedIssues` 列表。支持 `Blocking:` 前缀、编号 `[Blocking]` 格式和 `**Blocking**:` 粗体格式。

**compound 类型的动态调整**：`resolveEffectiveType()` 检测 God instruction 中是否包含实现类关键词（implement the/build the/write the 等短语级匹配），如果 phaseType 为 explore 或 discuss 但 instruction 要求实现，自动切换为 code 类型指令。中文关键词保持宽松匹配（实现/开发/编写/修改）。

可选的 `audit` 参数触发 `PROMPT_GENERATION` 类型的审计日志写入。

**`generateReviewerPrompt(ctx): string`**

1. **Worker 角色声明**（Card D.2，FR-010）：明确 Reviewer 为观察提供者，verdict（[APPROVED] / [CHANGES_REQUESTED]）仅为参考信息，God 做最终决策
2. **Task goal** + Phase info
3. **God instruction**（P0）：如有
4. **Coder Output**：当前轮次 Coder 的输出
5. **Review Instructions**：根据 effectiveType 区分
   - `explore` — 验证探索结果的完整性，确认没有修改文件
   - `review` — 评估提案合理性（Bug 11 fix：提案合理即可 approve，轻微分歧非阻塞）
   - 通用 — 识别 blocking issues 和 non-blocking suggestions
6. **Anti-nitpick guardrail**：零 blocking issue 必须 approve，不得因风格偏好而阻塞
7. **Round Info**

---

## 5. 统一决策管线

### 5.1 `src/god/god-decision-service.ts` — 统一决策服务

**`GodDecisionService` 类**——核心决策引擎：

```typescript
class GodDecisionService {
  constructor(adapter: GodAdapter, watchdog: WatchdogService, model?: string);
  async makeDecision(
    observations: Observation[],
    context: GodDecisionContext,
    isResuming?: boolean,
  ): Promise<GodDecisionEnvelope>;
}
```

**`GodDecisionContext`**：

```typescript
interface GodDecisionContext {
  taskGoal: string;
  currentPhaseId: string;
  currentPhaseType?: 'explore' | 'code' | 'discuss' | 'review' | 'debug';
  phases?: { id: string; name: string; type: string; description: string }[];
  round: number;
  maxRounds: number;
  previousDecisions: GodDecisionEnvelope[];
  availableAdapters: string[];
  activeRole: 'coder' | 'reviewer' | null;
  sessionDir: string;
}
```

**决策流程（三步 AI 调用上限）**：

1. **调用 God** — 构建 prompt，通过 `collectGodAdapterOutput()` 发起请求（timeout 600s），使用 `GodDecisionEnvelopeSchema` 验证输出
2. **God 成功** -> 重置 Watchdog 计数，返回 envelope
3. **God 失败** -> 调用 Watchdog AI 诊断（见 11.1 节）
4. **执行 Watchdog 决策**：
   - `retry_fresh` -> 清除 adapter 会话，全量 prompt 重试一次
   - `retry_with_hint` -> 清除 adapter 会话，附带格式纠正提示重试
   - `construct_envelope` -> Watchdog 根据 God 原始输出意图构建 envelope
   - `escalate` / 重试再失败 -> 返回 fallback envelope（包含 wait action，防止 BUG-22 死循环）

**最大 AI 调用数**：God(1) + Watchdog(1) + retry(1) = 3。

**System Prompt（Sovereign God）**：

`god-decision-service.ts` 中定义了完整的 `SYSTEM_PROMPT` 常量，包含以下核心指令模块：

- **角色定义**：Sovereign God，编排协调者，拥有最终决策权
- **Phase-following instructions**：compound 任务必须按 phase plan 顺序执行，review-type phase 必须先 send_to_reviewer，任何 phase 中 Coder 提出多方案时必须路由给 Reviewer
- **Reviewer handling instructions**（Card D.2）：reviewer verdict 是参考信息，God 做最终裁定；如果 override reviewer 必须在 system_log 中说明原因
- **Proposal routing instructions**：当 Coder 输出包含多个实现方案（方案 A/B/C、Option 1/2/3、pros/cons 对比表）时，必须先路由给 Reviewer 评估，不得自行选择
- **Proxy decision instructions**（BUG-24 fix）：God 拦截 worker 问题，区分实现细节（自主解决）和设计方案（路由给 Reviewer）；自主解决时使用 choice -> reflection -> finalChoice 三步流程
- **Decision reflection instructions**：高风险决策前自检 — 验证 scope 覆盖、测试覆盖、计划一致性、方案评审

**Prompt 构建细节**：

**`buildUserPrompt(observations, context)`** — 完整 prompt，用于首次调用：
- Task Goal（ANSI escape 序列清理）
- Phase & Round 信息
- Phase Plan（compound 任务，标记当前 phase）
- Available Adapters
- Observations section（按 severity 排序，review_output 高亮 reviewer verdict）
- Previous Decision Summary（含 autonomous resolutions）
- Hand Catalog（11 种 action 的可读列表）

**`buildResumePrompt(observations, context)`** — 精简 prompt，用于 resume 轮次：
- 仅包含 Phase & Round、Observations、格式提醒
- 因为会话上下文已包含 system prompt、Hand catalog、task goal 等不变信息

**Observations 预处理**：
- `stripAnsiEscapes()` — 清除终端控制码
- `stripToolMarkers()` — 去除 `[Read]`、`[Bash]`、`[shell result]` 等 tool 标记噪声
- `extractReviewerVerdict(obs)` — 从 review_output 提取 `[APPROVED]`/`[CHANGES_REQUESTED]` 标记

**Fallback Envelope**（BUG-22 fix）：

当 God 和 Watchdog 都失败时，生成包含 `wait` action 的 fallback envelope，而非空 actions 列表。这防止了 "空 actions -> 空 results -> observations 丢失" 的死循环。

### 5.2 `src/god/hand-executor.ts` — Hand 执行器

```typescript
async function executeActions(
  actions: GodAction[],
  context: HandExecutionContext
): Promise<Observation[]>
```

**执行流程**（逐条顺序执行）：

1. **Rule engine 检查** — 每个 action 通过 `evaluateRules()` 校验
   - 被 block -> 生成 `runtime_invariant_violation` observation，跳过执行
2. **执行 action** — 通过 `executeSingleAction()` dispatch
   - 成功 -> 生成 `phase_progress_signal` observation
   - 失败 -> 生成 `runtime_invariant_violation` observation

**`HandExecutionContext`** 封装了所有可变运行时状态：

```typescript
interface HandExecutionContext {
  currentPhaseId: string;
  pendingCoderMessage: string | null;
  pendingReviewerMessage: string | null;
  adapters: Map<string, HandAdapter>;
  auditLogger: GodAuditLogger | null;
  activeRole: 'coder' | 'reviewer' | null;
  taskCompleted: boolean;
  waitState: { active: boolean; reason: string | null; estimatedSeconds: number | null };
  clarificationState: { active: boolean; question: string | null };
  interruptResumeStrategy: 'continue' | 'redirect' | 'stop' | null;
  adapterConfig: Map<string, string>;  // role -> adapter name
  round: number;
  sessionDir: string;
  cwd: string;
  envelopeMessages?: EnvelopeMessage[];  // D.3: 用于 accept_task 验证
}
```

**各 action 执行器**：

| Action | 副作用 | 审计 |
|--------|--------|------|
| `send_to_coder` | 设置 `pendingCoderMessage`，`activeRole = 'coder'` | - |
| `send_to_reviewer` | 设置 `pendingReviewerMessage`，`activeRole = 'reviewer'` | - |
| `set_phase` | 更新 `currentPhaseId` | 写入 `phase_transition` 审计 |
| `accept_task` | 设置 `taskCompleted = true`；D.3 验证：`god_override` 需 system_log，`forced_stop` 需 user message | 写入 `accept_task` 审计（含 envelope messages） |
| `stop_role` | 调用 `adapter.kill()` | - |
| `retry_role` | kill 当前 adapter，设置 pending message 和 `activeRole` | - |
| `switch_adapter` | 更新 `adapterConfig` | - |
| `wait` | 设置 `waitState` | - |
| `request_user_input` | 设置 `clarificationState` | - |
| `resume_after_interrupt` | 设置 `interruptResumeStrategy`，清除 `clarificationState` | - |
| `emit_summary` | - | 写入 `emit_summary` 审计 |

**SPEC-DECISION**：大多数 action 映射到 `config_modify` ActionContext（不涉及文件系统或命令执行），避免 rule engine 误报。

### 5.3 `src/god/message-dispatcher.ts` — 消息分发器

**关键约束**：消息分发 **不得** 触发任何状态变化（NFR-001 / FR-016）。

```typescript
function dispatchMessages(
  messages: EnvelopeMessage[],
  context: DispatchContext
): DispatchResult

interface DispatchResult {
  pendingCoderMessage: string | null;
  pendingReviewerMessage: string | null;
}
```

**分发规则**：

| target | 处理方式 |
|--------|---------|
| `coder` | 返回在 `result.pendingCoderMessage` 中（多条消息合并换行） |
| `reviewer` | 返回在 `result.pendingReviewerMessage` 中 |
| `user` | 通过 `formatGodMessage()` 格式化后调用 `context.displayToUser()` |
| `system_log` | 写入 `god-audit.jsonl`（`message_dispatch` 类型） |

`dispatchMessages()` 是纯函数，不直接修改 context 的 pending messages——而是返回新值由调用方决定如何应用。

**NL/Action 不变量检查**：

```typescript
function checkNLInvariantViolations(
  messages: EnvelopeMessage[],
  actions: GodAction[],
  context: { round: number; phaseId: string }
): Observation[]
```

检测自然语言消息中的状态变更关键词是否有对应的结构化 action：

| 检测模式 | 需要的 action | 违规类型 |
|---------|--------------|---------|
| "进入/切换到/transition to/enter phase" | `set_phase` | `runtime_invariant_violation` |
| "accepted/接受任务/结果" | `accept_task` | `runtime_invariant_violation` |
| "切换/switch/change adapter" | `switch_adapter` | `runtime_invariant_violation` |

SPEC-DECISION：使用 regex + keyword pattern 而非 LLM 检测，确保 < 1ms 延迟、确定性、零 API 成本。支持中英文关键词。

---

## 6. 观察系统

### 6.1 `src/god/observation-classifier.ts` — 观察分类器

纯同步 regex + keyword pattern matching，< 5ms 延迟，无 LLM 调用。

```typescript
function classifyOutput(
  raw: string,
  source: ObservationSource,
  meta: { round: number; phaseId?: string; adapter?: string }
): Observation

function guardNonWorkOutput(obs: Observation): {
  isWork: boolean;
  shouldRouteToGod: boolean;
}
```

**分类优先级**（高到低）：

1. 空输出 -> `empty_output` (warning)
2. Quota/rate limit（`429`、`rate limit`、`usage limit` 等） -> `quota_exhausted` (error)
3. 认证失败（`unauthorized`、`403`、`invalid api key`） -> `auth_failed` (error)
4. Adapter 不可用（`command not found`、`ENOENT`） -> `adapter_unavailable` (error)
5. Meta output（`I cannot`、`As an AI`） -> `meta_output` (warning)
6. Tool failure（仅 runtime source 匹配 `error`/`exception`/`traceback`） -> `tool_failure` (error)
7. 默认：reviewer source -> `review_output` (info)，其他 -> `work_output` (info)

SPEC-DECISION：quota/auth 模式在通用 error 模式之前检查，确保 "Error 429: rate limit" 被正确分类为 `quota_exhausted` 而非 `tool_failure`。`tool_failure` 仅匹配 `runtime` source，避免 Coder 讨论 "error handling" 被误判。

**Non-Work Guard**：`guardNonWorkOutput()` 判断观察是否为真实工作输出。non-work observations（quota/auth/empty/meta/tool_failure 等）不得触发 `CODE_COMPLETE` / `REVIEW_COMPLETE` 事件，而应路由到 God 处理。

**`IncidentTracker` 类**（Card F.1）：

追踪连续 incident 发生次数，实现严重度自动升级：
- `empty_output` 连续 2+ 次 -> severity 从 warning 升级为 error
- `tool_failure` 连续 3+ 次 -> severity 从 error 升级为 fatal
- 工作输出重置所有 incident 计数
- 不同类型的 incident 之间互相重置计数

**`createDegradationObservation()`**：将 DegradationManager/Watchdog 状态变化（L4 / fallback）转为 Observation，`godDisabled` 时严重度为 `fatal`。

### 6.2 `src/god/observation-integration.ts` — 观察集成层

GLUE 层，连接 observation-classifier 到各输出源。

```typescript
function processWorkerOutput(raw, role, meta): {
  observation: Observation;
  isWork: boolean;
  shouldRouteToGod: boolean;
}
```

使用模式：在发送 `CODE_COMPLETE` / `REVIEW_COMPLETE` 之前调用，仅当 `isWork === true` 时才发送完成事件。

**便捷工厂函数**：

| 函数 | 输出 Observation |
|------|-----------------|
| `processWorkerOutput(raw, role, meta)` | Coder/Reviewer 工作输出 -> 分类 + guard |
| `createInterruptObservation(round, opts?)` | 人类 Ctrl+C -> `human_interrupt` (warning) |
| `createTextInterruptObservation(text, round, opts?)` | 人类文本输入 -> `human_message` (info) |
| `createProcessErrorObservation(msg, round, opts?)` | 进程错误 -> `tool_failure` (error) |
| `createTimeoutObservation(round, opts?)` | 进程超时 -> `tool_failure` (error) |

---

## 7. 任务初始化与分类

### `src/god/task-init.ts` — 任务初始化

```typescript
async function initializeTask(
  godAdapter, taskPrompt, systemPrompt, projectDir?, sessionDir?, model?
): Promise<TaskInitResult | null>
```

- 向 God 发送 `TASK_INIT` 决策点 prompt："Classify the task below for orchestration planning. Do not answer or solve the task itself."
- 使用 `extractGodJson` 提取并验证 `GodTaskAnalysisSchema` 格式 JSON
- 最终失败返回 `null`，由调用方决定 fallback（外层 Watchdog 处理重试）
- 可选 `sessionDir` 参数启用 prompt 日志记录

**`validateRoundsForType(taskType, rounds)`** — 按任务类型限定轮次范围：

| 任务类型 | min | max |
|---------|-----|-----|
| explore | 2 | 5 |
| code | 3 | 10 |
| review | 1 | 3 |
| debug | 2 | 6 |
| discuss | 2 | 5 |
| compound | 不限制（pass through） |

**`applyDynamicRounds(currentMax, suggested, taskType)`** — 运行时动态调整轮次，但始终受 `validateRoundsForType` 约束。

---

## 8. 决策服务与路由

决策服务的详细说明见 5.1 节（GodDecisionService）。本节补充路由相关的内部逻辑。

**Reviewer Verdict 提取**（Card D.2）：

```typescript
function extractReviewerVerdict(obs: Observation): 'APPROVED' | 'CHANGES_REQUESTED' | null
```

从 `review_output` 类型的 observation 中用正则提取 `[APPROVED]` 或 `[CHANGES_REQUESTED]` 标记。提取结果用于：
- 在 God prompt 的 observations section 中高亮显示 reviewer verdict
- 审计日志中记录 reviewer 原始结论

**Previous Decision 上下文**：

`buildPreviousDecisionSection()` 将上一轮的 GodDecisionEnvelope 摘要注入 God prompt，包含：
- Diagnosis summary
- Action types
- Authority 状态
- Autonomous Resolutions（BUG-24 fix：确保 God 对代理决策维持上下文一致性）

---

## 9. 收敛判定

### `src/god/god-convergence.ts` — 收敛判定

核心原则：**Reviewer 是收敛的唯一权威来源**。

```typescript
async function evaluateConvergence(
  godAdapter, reviewerOutput, context: ConvergenceContext
): Promise<ConvergenceResult>
```

**决策树**（按优先级）：

1. 无 Reviewer 输出 -> 不终止（AC-019b）
2. `round >= maxRounds` -> 强制终止（reason: `max_rounds`）
3. `loop_detected` + 连续 3 轮无改善 -> 强制终止（reason: `loop_detected`）
4. 一致性检查通过后信任 God 判断
5. 一致性检查失败 -> `shouldTerminate` 覆盖为 `false`

**一致性检查流程**：
- 调用 `checkConsistency()` 检测幻觉
- 幻觉检测到时写入 `HALLUCINATION_DETECTED` 审计条目
- 使用自动纠正后的 judgment
- 额外强制：`shouldTerminate: true` 但有 blocking issues 或未满足 criteria（非 exception reason）-> 覆盖为 `false`

**`hasNoImprovement(log, rounds)`** — 检查最近 N 轮是否无改善：所有 `blockingIssueCount` 相同且大于 0（排除全为 0 的情况，那表示已收敛）。

**`ConvergenceLogEntry`** — 每轮收敛评估结果记录：

```typescript
interface ConvergenceLogEntry {
  round: number;
  timestamp: string;
  classification: string;
  shouldTerminate: boolean;
  blockingIssueCount: number;
  criteriaProgress: { criterion: string; satisfied: boolean }[];
  summary: string;  // <= 200 chars
}
```

收敛日志用于：
- 提供给 God prompt 的 convergence history section
- Coder prompt 中的 convergence trend 信息
- Phase transition 时的 phase summary 生成

---

## 10. 自主决策

### `src/god/auto-decision.ts` — GOD_DECIDING 自主决策

在 `GOD_DECIDING` 状态下，God 自主决定下一步操作。

```typescript
async function makeAutoDecision(
  godAdapter, context: AutoDecisionContext, ruleEngine
): Promise<AutoDecisionResult>
```

**两种 action**：
- `accept` — 任务完成，接受输出
- `continue_with_instruction` — 需要继续工作，提供明确指令

**流程**：
1. 构建 prompt：包含任务目标、轮次、等待原因、当前 phase/phases 列表、Coder/Reviewer 输出、unresolved issues、convergence 历史
2. 调用 God adapter，通过 `extractWithRetry` 提取 `GodAutoDecisionSchema` 格式 JSON
3. 解析成功 -> 经 rule engine 检查后返回
4. 解析失败 -> 降级为 `makeLocalAutoDecision()`
5. 结果写入 `AUTO_DECISION` 审计日志

**`makeLocalAutoDecision(context, ruleEngine)`** — 本地降级决策（纯规则，无 LLM）：
- Reviewer 输出包含 `[APPROVED]` 且无 unresolved issues -> `accept`
- 有 unresolved issues -> `continue_with_instruction`，指令为"Address the remaining issues: ..."
- 有当前 phase -> `continue_with_instruction`，指令为"Continue working on phase X..."
- 否则 -> `continue_with_instruction`，通用指令

**Rule engine 集成**：对 `continue_with_instruction` 的 instruction 文本进行 rule engine 检查。如果被 block，`AutoDecisionResult.blocked = true`。

---

## 11. 可靠性保障

### 11.1 `src/god/watchdog.ts` — Watchdog AI 故障诊断

WatchdogService 取代了规则化降级（DegradationManager L1-L4），使用 AI 分析 God 失败并决定最佳恢复策略。

```typescript
class WatchdogService {
  constructor(adapter: GodAdapter, opts?: { model?: string; restoredState?: WatchdogState | DegradationState });

  async diagnose(
    error: { kind: string; message: string },
    rawOutput: string | null,
    observations: Observation[],
    context: { taskGoal: string; round: number; maxRounds: number },
  ): Promise<WatchdogDecision>;

  handleGodSuccess(): void;
  isGodAvailable(): boolean;
  getState(): WatchdogState;
  serializeState(): DegradationState;  // 向后兼容
}
```

**Watchdog 决策类型**（WatchdogDecisionSchema）：

```typescript
interface WatchdogDecision {
  analysis: string;        // 失败原因分析
  decision: 'retry_fresh' | 'retry_with_hint' | 'construct_envelope' | 'escalate';
  hint?: string;           // retry_with_hint 时的纠正指令
  constructedAction?: {    // construct_envelope 时的 action 规格
    actionType: string;
    summary: string;
    userMessage?: string;
  };
}
```

**四种恢复决策**：

| 决策 | 适用场景 | 行为 |
|------|---------|------|
| `retry_fresh` | 会话污染、格式混乱 | 清除 adapter 会话，全量 prompt 重试 |
| `retry_with_hint` | 结构基本正确但有特定字段错误 | 附带纠正提示重试 |
| `construct_envelope` | God 输出可辨意图但格式错误 | Watchdog 直接构建 envelope |
| `escalate` | 不可恢复、连续失败 > 2 次 | 返回 fallback envelope |

**安全机制**：
- 连续失败 >= 5 次 -> 自动 `escalate`，禁用 God（`godDisabled = true`）
- Watchdog 自身调用失败 -> 立即 `escalate`（不递归诊断）
- `handleGodSuccess()` -> 重置连续失败计数和 godDisabled 状态

**`buildEnvelopeFromWatchdogAction(decision, context)`** — 将 Watchdog 的 `constructedAction` 转化为完整的 `GodDecisionEnvelope`。支持的 actionType：
- `accept_task` -> `god_override` rationale
- `send_to_coder` / `send_to_reviewer` / `wait` / `request_user_input`
- 未识别的 actionType -> fallback 为 `wait`

### 11.2 `src/god/degradation-manager.ts` — 四级降级管理

> 注：`DegradationManager` 的运行时职责已被 `WatchdogService` 取代。此模块仍保留用于 `DegradationState` 类型兼容和会话持久化。

四级降级策略：

| 级别 | 触发条件 | 处理 |
|------|---------|------|
| L1 | 正常 | 无降级 |
| L2 | 可重试错误（process_exit, timeout） | 奇数次失败重试，偶数次 fallback |
| L3 | 不可重试错误（parse_failure, schema_validation） | 奇数次格式纠正重试，偶数次 fallback |
| L4 | 连续 3 次失败 | 本会话永久禁用 God，完全 fallback |

Fallback 服务：切换到旧组件（`ContextManager` + `ConvergenceService` + `ChoiceDetector`）。

三层安全保障：God -> fallback -> ERROR -> `GOD_DECIDING`/`MANUAL_FALLBACK` -> duo resume。

关键方法：
- `handleGodFailure(error, context?)` — 返回 `DegradationAction`（`retry` / `retry_with_correction` / `fallback`）
- `handleGodSuccess()` — 成功后重置计数（L4 永久不恢复）
- `serializeState()` — 序列化状态用于 duo resume
- 构造函数支持 `restoredState` 恢复之前的降级状态

---

## 12. Rule Engine

### `src/god/rule-engine.ts` — 不可委托场景规则引擎

同步规则引擎，执行时间 < 5ms，无 LLM 调用。**Block 级别规则具有绝对优先权，God 无法覆盖**（NFR-009）。

```typescript
interface ActionContext {
  type: 'file_write' | 'command_exec' | 'config_modify';
  path?: string;
  command?: string;
  cwd: string;
  godApproved?: boolean;
}

function evaluateRules(action: ActionContext): RuleEngineResult
```

**5 条规则**：

| ID | 级别 | 描述 | 详细逻辑 |
|----|------|------|---------|
| R-001 | block | 文件写入必须在 `~/Documents` 目录内 | 仅检查 `file_write` / `config_modify` 类型，使用 `realpathSync` 解析符号链接 |
| R-002 | block | 禁止访问系统关键目录 | 检查路径或命令参数中的绝对路径是否属于 `/etc`, `/usr`, `/bin`, `/System`, `/Library`（含 macOS symlink 变体如 `/private/etc`） |
| R-003 | block | 检测可疑网络外传 | 仅检查 `command_exec`，匹配 `curl -d @file` 模式 |
| R-004 | warn | God 批准 vs rule engine block 矛盾 | 当 `godApproved = true` 但存在 block 级别匹配时发出警告 |
| R-005 | warn | Coder 修改 `.duo/` 配置 | 路径包含 `/.duo/` 时发出警告 |

路径解析使用 `realpathSync` 解析符号链接，并向上遍历目录层级找到最深的已存在祖先进行解析，防止通过 symlink 绕过目录限制。

Hand Executor 在执行每个 GodAction 前调用 `evaluateRules()`。`blocked = true` 时 action 不执行，产生 `runtime_invariant_violation` observation。

---

## 13. 一致性检查

### `src/god/consistency-checker.ts` — God 输出一致性检查

纯规则检查（< 1ms，无 LLM 调用），检测 God JSON 输出中的逻辑矛盾（幻觉）。

**三种违规类型和处理策略**：

| 类型 | 描述 | 处理 |
|------|------|------|
| `structural` | 给定状态下缺少必需字段 | 保守偏向（不终止） |
| `semantic` | 可计数字段与分类字段矛盾 | 自动纠正（以可计数字段为权威） |
| `low_confidence` | 低置信度关键决策 | 保守偏向（不终止，改为 route_to_coder） |

**ConvergenceJudgment 检查规则**：
- `classification: approved` + `blockingIssueCount > 0` -> 纠正为 `classification: changes_requested`（semantic）
- `classification: needs_discussion` + `shouldTerminate: true` -> 纠正为 `shouldTerminate: false`（semantic）
- `shouldTerminate: true` + `reason: null` -> 纠正为 `shouldTerminate: false`（structural）

**PostReviewerDecision 检查规则**：
- `confidenceScore < 0.5` + `action: converged` -> 纠正为 `action: route_to_coder`（low_confidence，阈值 0.5）

**`crossValidate(godClassification, localClassification)`** — God 与本地 ConvergenceService 交叉验证。不一致时本地结果为权威。`soft_approved` 等价于 `approved` 进行比较。

---

## 14. 阶段转换管理

### `src/god/phase-transition.ts` — compound 任务阶段转换

管理 compound 任务的多阶段转换。

```typescript
function evaluatePhaseTransition(
  currentPhase: Phase,
  phases: Phase[],
  convergenceLog: ConvergenceLogEntry[],
  godDecision: GodPostReviewerDecision,
): PhaseTransitionResult
```

**转换条件**（必须全部满足）：
1. God decision `action === 'phase_transition'`
2. 当前 phase 在 phases 数组中有效
3. 目标 phase 存在：优先使用 God 指定的 `nextPhaseId`，fallback 到顺序下一个 phase
4. 目标 phase 不等于当前 phase（防止 God 幻觉自转换）

**转换结果**：

```typescript
interface PhaseTransitionResult {
  shouldTransition: boolean;
  nextPhaseId?: string;
  previousPhaseSummary?: string;  // 已完成 phase 的摘要
}
```

**Phase Summary 生成**（AC-034）：
- 包含 phase ID、name、"completed" 状态
- 从 convergenceLog 提取最后一轮的：round 数、classification、blocking issues 数、criteria 达成率

---

## 15. 中断意图分类

### `src/god/interrupt-clarifier.ts` — 人类中断意图分类

人类观察者中断时，God 分类中断意图并生成可执行指令。

```typescript
interface InterruptClassification {
  intent: 'restart' | 'redirect' | 'continue';
  instruction: string;        // 可执行的系统指令
  reasoning: string;
  needsClarification: boolean; // 消息模糊时为 true
}

async function classifyInterruptIntent(
  godAdapter, context: InterruptContext, model?
): Promise<InterruptClassification>
```

**三种意图**：
- `restart` — 从头开始，使用不同方法
- `redirect` — 改变方向但保留有用进展
- `continue` — 保持当前方向，小幅调整

**System Prompt 关键指导**：
- "人类很少中断，所以将消息视为重要的方向性指导"
- 模糊消息时设置 `needsClarification = true`，将澄清问题放在 instruction 字段
- 始终返回清晰可执行的指令

**Fallback 机制**：God adapter 调用失败时，直接使用用户输入文本作为 `redirect` intent 的 instruction，`needsClarification = false`。

**JSON 解析**：手动 regex 提取 ```json code block，非标准解析器（未使用 extractGodJson）。解析失败时使用原始输出作为 instruction。

结果写入 `INTERRUPT_CLASSIFICATION` 类型的审计日志。

---

## 16. 三方会话协调

### `src/god/tri-party-session.ts` — 三方会话管理

```typescript
interface TriPartySessionState {
  coderSessionId: string | null;
  reviewerSessionId: string | null;
  godSessionId: string | null;
}
```

**`extractTriPartyState(state)`** — 从 `SessionState` 提取三方会话 ID，`undefined` 转为 `null`（显式"无会话"语义）。

**`restoreTriPartySession(triParty, config, adapterFactory)`** — resume 时恢复三方会话：
- **独立恢复**：Coder、Reviewer、God 各自独立恢复，一方失败不影响其他（AC-040）
- **会话隔离**：每个 party 获得独立的 adapter 实例（`adapterFactory` 每次创建新实例），即使使用相同 CLI 工具（AC-041a）
- **God 会话恢复**：对于支持会话的 adapter（Claude Code、Gemini），God 也可以恢复会话（kill-and-resume 模式）
- **容错**：adapter factory 抛异常时返回 null，该 party 从零开始

---

## 17. Hand 执行器详解

Hand Executor 的完整说明见 5.2 节。本节补充各 action 的验证规则。

### accept_task 验证（D.3: FR-016, FR-017）

当 `envelopeMessages` 存在于 context 中时，Hand Executor 对 `accept_task` 执行额外验证：

- **`rationale: 'god_override'`**：envelope messages 必须包含至少一条 `target: 'system_log'` 消息，说明为何 override reviewer。缺失时返回 `runtime_invariant_violation`。
- **`rationale: 'forced_stop'`**：envelope messages 必须包含至少一条 `target: 'user'` 消息，向用户总结任务状态。缺失时返回 `runtime_invariant_violation`。

### Rule Engine 映射策略

`toActionContext()` 将 GodAction 映射为 ActionContext 供 rule engine 检查。当前所有 action 都映射到 `{ type: 'config_modify', cwd }` 且不带 path——因为 Hand actions 本身不直接触碰文件系统或运行命令。真正的文件操作和命令执行发生在 Coder adapter 中，由 Coder 自身的 sandbox 机制管控。

---

## 18. 消息分发详解

Message Dispatcher 的完整说明见 5.3 节。本节补充 NL invariant 检查的设计决策。

**为何使用 regex 而非 LLM**：
- 延迟：< 1ms vs 数秒
- 确定性：regex 匹配结果确定，不会因模型差异而不同
- 成本：零 API 成本（AR-003）
- 覆盖率：中英文关键词双语覆盖

**检查时机**：在 Hand Executor 执行 actions 之后、消息分发之前。检测到的违规作为 `runtime_invariant_violation` observation 加入下一轮的 observation 集合，供 God 在下次决策时感知。

---

## 19. God 审计日志

### `src/god/god-audit.ts` — 审计日志

Append-only JSONL 格式审计日志，记录所有 God 决策。

```typescript
interface GodAuditEntry {
  seq: number;
  timestamp: string;
  round: number;
  decisionType: string;
  inputSummary: string;     // <= 500 chars
  outputSummary: string;    // <= 500 chars
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  decision: unknown;
  model?: string;
  phaseId?: string;
  outputRef?: string;       // god-decisions/ 中的完整输出引用
}
```

**两种 API**：

**`appendAuditLog(sessionDir, entry)`** — 兼容函数，直接追加条目到 `god-audit.jsonl`

**`GodAuditLogger` 类** — 带 seq 追踪和 outputRef 支持：
- `append(entry, fullOutput?)` — 自动递增 seq（3 位 0 填充），可选存储完整 God 输出到 `god-decisions/` 目录（文件名格式：`{seq}-{decisionType}.json`）
- `getEntries(filter?)` — 读取所有条目，可按 `decisionType` 过滤
- `getSequence()` — 获取当前 seq
- 构造时从已有日志文件恢复 seq，确保 resume 后审计连续性

**`cleanupOldDecisions(dir, maxSizeMB)`** — `god-decisions/` 目录超限时清理最旧的文件（NFR-008：上限 50MB）。按 seq 数字排序，从最旧开始删除直到低于上限。

### 专项审计函数

**`logEnvelopeDecision(logger, params)`**（Card F.2）——记录完整 God 决策上下文：
- Input observations（summary + severity + type）
- God diagnosis
- Authority override 详情（NFR-002）
- Chosen actions
- NL messages
- Action execution results
- 完整归档存储在 `god-decisions/` 目录

**`logReviewerOverrideAudit(logger, params)`**（Card D.2）——记录 reviewer 原始结论 + God 最终裁定：
- 从 observation 提取 reviewer verdict（[APPROVED] / [CHANGES_REQUESTED]）
- 是否 override
- 从 system_log messages 提取 override reason

**`logIncidentAudit(logger, params)`**（Card F.1）——记录 incident 响应：
- Incident observation（type, summary, severity, source）
- God envelope（diagnosis, authority, actions, messages）
- Action execution results

**Override Tracking**（NFR-002）：
- `userConfirmation = 'god_override'` -> 记录 override reason
- `reviewerOverride = true` -> 记录 reviewer 原始结论 + override reason
- 仅在存在实际 override 时包含 overrides section

---

## 20. God 会话持久化

### `src/god/god-session-persistence.ts`

```typescript
async function restoreGodSession(state, adapterFactory): Promise<null>
```

当前实现始终返回 `null`。God 通过无状态的 `GodAdapter` 接口运行，持久化的 God session ID 仅保留在快照中用于向后兼容。

> 实际的会话恢复逻辑已迁移到各 GodAdapter 实现中（`lastSessionId` / `restoreSessionId` / `clearSession`），以及 `tri-party-session.ts` 的 `restoreTriPartySession()`。此文件仅保留兼容性接口。

---

## 21. Zod Schema 设计

### GodDecisionEnvelope 的 Schema 约束

`GodDecisionEnvelopeSchema` 使用 Zod `superRefine` 实现跨字段语义约束：

1. **reviewerOverride + system_log**：当 `authority.reviewerOverride = true` 时，`messages` 必须包含 `target: 'system_log'` 条目说明 override 原因。God 不能无声地 override reviewer。

2. **acceptAuthority + system_log**：当 `authority.acceptAuthority = 'god_override'` 时，同样要求 `system_log` 条目。这确保自主接受决策有审计痕迹。

3. **userConfirmation + system_log**（BUG-18 fix）：当 `authority.userConfirmation = 'god_override'` 时，同样要求 `system_log` 条目。

4. **forced_stop + user message**：当 `authority.acceptAuthority = 'forced_stop'` 时，`messages` 必须包含 `target: 'user'` 的摘要消息，确保用户知道任务被强制终止。

### GodTaskAnalysis 的 Schema 约束

`GodTaskAnalysisSchema` 使用 Zod `refine` 实现：
- `taskType === 'compound'` 时 `phases` 必须为非空数组
- `confidence` 范围 0.0 ~ 1.0
- `suggestedMaxRounds` 范围 1 ~ 20

### GodPostReviewerDecision 的 Schema 约束

`GodPostReviewerDecisionSchema` 使用 Zod `refine` 实现：
- `action === 'route_to_coder'` 时 `unresolvedIssues` 必须为非空数组

### GodAction 的 Schema 设计

`GodActionSchema` 使用 Zod `discriminatedUnion`（按 `type` 字段区分），11 个成员 schema 各有严格的字段定义。关键设计：

- `accept_task.rationale` 限制为三个枚举值，确保接受决策总是有明确理由
- `resume_after_interrupt.resumeStrategy` 限制为 `continue` / `redirect` / `stop`
- `switch_adapter.role` 支持 `god` 角色，允许 God 自主切换自己的 adapter

### AutonomousResolution 的 Schema 设计

`AutonomousResolutionSchema`（BUG-24 fix）——三步代理决策流程：

```typescript
{
  question: string,    // worker 提出的问题
  choice: string,      // God 初始决策（基于代码库上下文和任务目标）
  reflection: string,  // God 反思检查（一致性、可行性、风险、替代方案）
  finalChoice: string, // 反思后的最终决策（可能与 choice 不同）
}
```

此字段在 `GodDecisionEnvelope` 中为 optional array，仅当 God 拦截了 worker 问题并自主解决时才出现。

---

## 22. 集成点

### 统一管线数据流

```
Worker Output -> observation-classifier -> Observation
                                              |
Observation[] -> GodDecisionService.makeDecision() -> GodDecisionEnvelope
                                                          |
                              +---------------------------+---------------------------+
                              |                                                       |
                  envelope.actions -> HandExecutor -> Observation[]    envelope.messages -> MessageDispatcher
                                        |                                           |
                              (rule engine 校验)                         (NL invariant 检查)
                                        |                                           |
                            phase_progress_signal /                    pendingCoder/ReviewerMessage
                            runtime_invariant_violation                displayToUser / auditLog
```

### God 决策上下文传递

```
task-init.ts        -> GodTaskAnalysis (taskType, phases, maxRounds, terminationCriteria)
                           |
god-prompt-generator.ts -> Coder/Reviewer prompts (策略模板 + Worker 角色声明)
                           |
god-decision-service.ts -> GodDecisionEnvelope (diagnosis + authority + actions + messages)
                           |
hand-executor.ts       -> Observation[] (执行结果)
                           |
god-audit.ts           -> god-audit.jsonl + god-decisions/ (审计归档)
```

### 故障恢复链

```
God adapter 调用
    |
    +-- 成功 -> Watchdog.handleGodSuccess() -> 重置计数
    |
    +-- 失败 -> Watchdog.diagnose()
                   |
                   +-- retry_fresh -> clearSession + 重试 -> 成功/fallback
                   +-- retry_with_hint -> clearSession + 提示重试 -> 成功/fallback
                   +-- construct_envelope -> Watchdog 构建 envelope
                   +-- escalate -> fallback envelope (wait action)
                   |
                   +-- 连续 5 次失败 -> godDisabled = true
```

### 与 Session 层的集成

- `WatchdogService` 支持 `serializeState()` 返回 `DegradationState` 兼容对象，用于 duo resume
- `DegradationManager` 支持 `serializeState()` / `restoredState` 用于 duo resume
- `GodAuditLogger` 的 seq 从已有日志文件恢复，确保 resume 后审计连续性
- `TriPartySession` 确保 resume 时三方会话独立恢复

### 与 Parser 层的集成

God 模块依赖 `src/parsers/god-json-extractor.ts` 的 `extractGodJson()` 和 `extractWithRetry()` 从 God 原始输出中提取和验证 JSON。支持 markdown code block 提取、Zod schema 验证。`extractWithRetry()` 在失败时通过回调获取重试输出，最多重试一次。

### 与旧组件的 Fallback 关系

降级时 God 模块回退到以下旧组件：
- `ContextManager`（`src/session/context-manager.ts`）— 替代 God prompt 管理
- `ConvergenceService`（`src/decision/convergence-service.ts`）— 替代 `god-convergence.ts`
- `ChoiceDetector`（`src/decision/choice-detector.ts`）— 替代路由功能

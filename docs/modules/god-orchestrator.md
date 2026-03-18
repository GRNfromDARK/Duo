# God LLM 编排器模块

## 1. 模块概述

### God LLM 的角色

God LLM 是 Duo 系统中的 Sovereign 编排层。在 Coder/Reviewer 双方协作模式之上，God 作为**唯一决策者**（Sovereign God），通过统一的 **Observe -> Decide -> Act** 管线驱动整个运行时：

- **任务分析**：解析用户意图，分类任务类型（explore/code/discuss/review/debug/compound）
- **统一决策**：通过 `GodDecisionService.makeDecision(observations, context)` 单入口生成 `GodDecisionEnvelope`
- **Hand 执行**：通过结构化 `GodAction[]` 执行状态变更，rule engine 逐条校验，所有状态变化必须 action-backed（NFR-001 / FR-016）
- **消息分发**：自然语言消息通道将 envelope 中的 messages 路由到 coder/reviewer/user/system_log，且不触发任何状态变化
- **观察管线**：Coder/Reviewer/Runtime/Human 的所有输出通过 observation-classifier 归一化为 `Observation`，non-work 输出（quota/auth/empty 等）被拦截不得推进工作流
- **可靠性**：WatchdogService 实现 retry + backoff + pause，God 不可用时系统暂停而非降级
- **代理决策**：God 拦截 worker 提出的问题，自主解决实现细节，设计方案则路由给 Reviewer 评估
- **Choice 处理**：当 Worker 输出包含多个方案时，God 根据方案差异程度选择自主决策、Reviewer 评审或请求用户输入

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
│  失败时 → Watchdog retry + backoff → fallback envelope               │
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
- `src/types/god-schemas.ts` — GodTaskAnalysis Zod schema
- `src/types/god-actions.ts` — Hand / GodAction catalog（11 种 action 的 Zod schema）
- `src/types/god-envelope.ts` — GodDecisionEnvelope + Authority 类型
- `src/types/observation.ts` — Observation 类型系统（13 种观察类型）

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

**任务管理（2 个文件）**
- `src/god/task-init.ts` — 任务初始化与分类
- `src/god/tri-party-session.ts` — 三方会话管理

**可靠性（2 个文件）**
- `src/god/watchdog.ts` — 简化的 retry + backoff + pause 机制
- `src/god/interrupt-clarifier.ts` — 人类中断意图分类

**安全（1 个文件）**
- `src/god/rule-engine.ts` — 不可委托场景规则引擎

**持久化与审计（2 个文件）**
- `src/god/god-audit.ts` — 审计日志（append-only JSONL + Envelope Decision Audit）
- `src/god/god-session-persistence.ts` — God 会话持久化（兼容性接口）

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
| `switch_adapter` | `role, adapter, reason` | 切换某角色的 adapter（未实现，no-op） |
| `set_phase` | `phaseId, summary?` | 设置当前 phase（显式阶段转换） |
| `accept_task` | `rationale, summary` | 接受/完成任务，rationale 必须为 `reviewer_aligned` / `god_override` / `forced_stop` |
| `wait` | `reason, estimatedSeconds?` | 进入等待状态 |
| `request_user_input` | `question` | 请求人类输入 |
| `resume_after_interrupt` | `resumeStrategy` | 中断后恢复，策略为 `continue` / `redirect` / `stop` |
| `emit_summary` | `content` | 发出管理摘要 |

### 2.3 `src/types/god-envelope.ts` — GodDecisionEnvelope

统一的 God 决策输出格式：

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

### 2.4 `src/types/god-schemas.ts` — GodTaskAnalysis Schema

```typescript
{
  taskType: 'explore' | 'code' | 'discuss' | 'review' | 'debug' | 'compound',
  reasoning: string,
  confidence: number,              // 0.0 ~ 1.0
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
- `clearSession()` 被 WatchdogService 在 retry 时调用，清除可能污染的会话状态

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

### 4.2 `src/god/god-system-prompt.ts` — System Prompt 构建（TASK_INIT 分类格式）

```typescript
function buildGodSystemPrompt(context: GodPromptContext): string
```

生成的 system prompt 包含：
- **CRITICAL OVERRIDE 开头**：明确覆盖宿主 CLI 的内置指令（CLAUDE.md、skills 等），声明这是 JSON-only orchestrator 角色
- **角色定义**：纯 JSON 决策者，不写代码、不读文件、不使用工具
- **TASK_INIT JSON schema**：taskType, confidence, phases（用于任务分类）
- **规则约束**：只输出 JSON code block，不确定时倾向保守分类（compound over simple types）

> 注：此 prompt 仅用于 `task-init.ts` 的任务分类。统一决策管线使用 `god-decision-service.ts` 中的 `SYSTEM_PROMPT` 常量。

### 4.3 `src/god/god-prompt-generator.ts` — Coder/Reviewer Prompt 动态生成

导出两个 prompt 生成函数，用于向 Coder 和 Reviewer 发送工作指令。

**`generateCoderPrompt(ctx: PromptContext, audit?: AuditOptions): string`**

按优先级组装 prompt 内容：

1. **Worker 角色声明**（Card D.2，FR-009）：明确 Coder 为纯执行者，不具有 accept authority，不决定 phase 切换
2. **Task goal**（P3）：任务目标
3. **Phase info**：compound 类型时显示当前 phase ID 和 type
4. **God instruction**（P0，最高优先级）：God 决策注入的指令
5. **Reviewer 反馈直传**（P0.5）：当 `isPostReviewerRouting` 为 true 时，注入 Reviewer 完整原始分析
6. **unresolvedIssues**（P1）：Reviewer 驱动的必须修复项
7. **suggestions**（P2）：非阻塞建议
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

**Reviewer 反馈直传**（Priority 0.5）：当 `isPostReviewerRouting` 为 true 且存在 `lastReviewerOutput` 时，注入 `## Reviewer Feedback` 段落，包含 Reviewer 的完整原始分析（经 `stripToolMarkers()` 清理工具标记后）。这确保 Coder 直接看到 Reviewer 的一手代码引用和根因分析，而非 God 的二次转述。God 的 `send_to_coder.message` 仅需提供路由指导（优先什么、采用什么方法），不必重复 Reviewer 分析内容。

**`extractBlockingIssues(reviewerOutput)`**：从 Reviewer 输出中提取 blocking issues，用于填充 `unresolvedIssues` 列表。支持三种格式：
- `Blocking:` 前缀（含 `-`/`*` 列表项和 `**Blocking**:` 粗体格式）
- 编号 `[Blocking]` 格式（如 `1. [Blocking]: ...`）
- 编号 `[Blocking] -` 格式

可选的 `audit` 参数触发 `PROMPT_GENERATION` 类型的审计日志写入。

**`generateReviewerPrompt(ctx): string`**

1. **Worker 角色声明**（Card D.2，FR-010）：明确 Reviewer 为观察提供者，verdict（[APPROVED] / [CHANGES_REQUESTED]）仅为参考信息，God 做最终决策
2. **Task goal** + Phase info
3. **God instruction**（P0）：如有
4. **Coder Output**：当前 Coder 的输出
5. **Review Instructions**：根据 effectiveType 区分
   - `explore` — 验证探索结果的完整性，确认没有修改文件
   - `review` — 评估提案合理性（Bug 11 fix：提案合理即可 approve，轻微分歧非阻塞）
   - 通用 — 识别 blocking issues 和 non-blocking suggestions
6. **Anti-nitpick guardrail**：零 blocking issue 必须 approve，不得因风格偏好而阻塞

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
  previousDecisions: GodDecisionEnvelope[];
  availableAdapters: string[];
  activeRole: 'coder' | 'reviewer' | null;
  sessionDir: string;
}
```

**决策流程**：

1. **调用 God** — 构建 prompt，通过 `collectGodAdapterOutput()` 发起请求（timeout 600s），使用 `GodDecisionEnvelopeSchema` 验证输出
2. **God 成功** -> `watchdog.handleSuccess()` 重置计数，返回 envelope
3. **God 失败** -> 检查 `watchdog.shouldRetry()`
   - 可重试 -> exponential backoff 后清除 adapter 会话，重试一次
   - 重试成功 -> 返回 envelope
   - 重试失败或不可重试 -> 返回 fallback envelope（包含 wait action，防止 BUG-22 死循环）

**System Prompt（Sovereign God）**：

`god-decision-service.ts` 中定义了完整的 `SYSTEM_PROMPT` 常量，包含以下核心指令模块：

- **角色定义**：Sovereign God，编排协调者，拥有最终决策权
- **Phase-following instructions**：compound 任务必须按 phase plan 顺序执行，review-type phase 必须先 send_to_reviewer，任何 phase 中 Coder 提出多方案时必须路由给 Reviewer
- **Mandatory review before code changes**：在任何 code/debug phase 转入实现前，必须先 send_to_reviewer 进行 Reviewer 评估。即使 Coder 只提出一个方案也需要 Reviewer 验证。正确序列：Coder 提案 -> send_to_reviewer -> Reviewer 评估 -> send_to_coder 实现
- **Reviewer handling instructions**（Card D.2）：reviewer verdict 是参考信息，God 做最终裁定；如果 override reviewer 必须在 system_log 中说明原因；Reviewer 的完整原始分析由平台自动注入 Coder prompt，God 的 send_to_coder.message 应聚焦路由指导
- **Proposal routing instructions**：当 Coder 输出包含多个实现方案（方案 A/B/C、Option 1/2/3、pros/cons 对比表）时，必须先路由给 Reviewer 评估，不得自行选择
- **Choice handling instructions**：Worker 输出包含多方案时的三条路径——相似方案有明显优选时自主决策，差异大需专业评估时路由 Reviewer，涉及用户偏好时 request_user_input
- **Worker mode specification instructions**：当 phase type 与预期工作不匹配时，God 应在指令中显式指定执行模式
- **Proxy decision instructions**（BUG-24 fix）：God 拦截 worker 问题，区分实现细节（自主解决）和设计方案（路由给 Reviewer）；自主解决时使用 choice -> reflection -> finalChoice 三步流程；`request_user_input` 仅限真正的人类中断事件或代码库中完全找不到所需信息的情况
- **Decision reflection instructions**：高风险决策前自检 — 验证 scope 覆盖、测试覆盖、计划一致性、方案评审。常规同 phase 内的简单交接（如 CHANGES_REQUESTED -> send_to_coder）是低风险操作，无需 reflection

**Prompt 构建细节**：

**`buildUserPrompt(observations, context)`** — 完整 prompt，用于首次调用：
- Task Goal（ANSI escape 序列清理）
- Phase 信息（phase type 和 active role）
- Phase Plan（compound 任务，标记当前 phase）
- Available Adapters
- Observations section（按 severity 排序，review_output 高亮 reviewer verdict）
- Previous Decision Summary（含 autonomous resolutions）
- Hand Catalog（11 种 action 的可读列表）

**`buildResumePrompt(observations, context)`** — 精简 prompt，用于 resume 迭代：
- 仅包含 Phase、Observations、格式提醒
- 因为会话上下文已包含 system prompt、Hand catalog、task goal 等不变信息

**Observations 预处理**：
- `stripAnsiEscapes()` — 清除终端控制码
- `stripToolMarkers()` — 去除 `[Read]`、`[Bash]`、`[shell result]` 等 tool 标记噪声
- `extractReviewerVerdict(obs)` — 从 review_output 提取 `[APPROVED]`/`[CHANGES_REQUESTED]` 标记

**Fallback Envelope**（BUG-22 fix）：

当 God 失败且重试也失败时，生成包含 `wait` action 的 fallback envelope，而非空 actions 列表。这防止了 "空 actions -> 空 results -> observations 丢失" 的死循环。

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
| `switch_adapter` | **未实现** — 返回 warning，当前为 no-op | - |
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
  context: { phaseId: string }
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
  meta: { phaseId?: string; adapter?: string }
): Observation

function guardNonWorkOutput(obs: Observation): {
  isWork: boolean;
  shouldRouteToGod: boolean;
}
```

**分类优先级**（高到低）：

1. 空输出 -> `empty_output` (warning)
2. Quota/rate limit（`429`、`rate limit`、`usage limit` 等） -> `quota_exhausted` (error)
3. 认证失败（`unauthorized`、`403`、`invalid api key`） -> `auth_failed` (error)；但如果清理后实质内容 > 500 字符，视为真实工作输出（auth 关键词来自 MCP init 等辅助输出）
4. Adapter 不可用（`command not found`、`ENOENT`） -> `adapter_unavailable` (error)
5. Meta output（`I cannot`、`As an AI`） -> `meta_output` (warning)；但 reviewer source 且包含 `[APPROVED]`/`[CHANGES_REQUESTED]` verdict 时跳过（真实 review 中包含分析性 "I cannot"）
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

**`deduplicateObservations()`**：使用 `timestamp+source+type` 作为 identity key 去重。用于合并 clarificationObservations 与 currentObservations 时避免重复。

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
| `createInterruptObservation(opts?)` | 人类 Ctrl+C -> `human_interrupt` (warning) |
| `createTextInterruptObservation(text, opts?)` | 人类文本输入 -> `human_message` (info) |
| `createProcessErrorObservation(msg, opts?)` | 进程错误 -> `tool_failure` (error) |
| `createTimeoutObservation(opts?)` | 进程超时 -> `tool_failure` (error) |

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
- 单次提取尝试——不做内部重试。外层 Watchdog 驱动的 `withRetry` 负责失败重试
- 最终失败返回 `null`，由调用方决定 fallback
- 可选 `sessionDir` 参数启用 prompt 日志记录

---

## 8. 可靠性保障

### 8.1 `src/god/watchdog.ts` — WatchdogService

WatchdogService 实现简单的 retry + backoff + pause 机制。核心原则：**LLM 下线 = 系统暂停，而非降级模式**。

```typescript
class WatchdogService {
  static readonly MAX_RETRIES = 3;

  handleSuccess(): void;        // 重置失败计数和 paused 状态
  shouldRetry(): boolean;       // 记录失败，返回是否应重试
  getBackoffMs(): number;       // Exponential backoff: 2s, 4s, 8s (上限 10s)
  isPaused(): boolean;          // 是否已暂停
  isGodAvailable(): boolean;    // 等同于 !isPaused()
  reset(): void;                // 用户选择重试后调用
  getConsecutiveFailures(): number;
}
```

**行为**：
- 每次 God 调用失败时调用 `shouldRetry()`，递增 `consecutiveFailures` 计数
- `consecutiveFailures <= MAX_RETRIES (3)` 时返回 `true`（应重试）
- 超过 3 次连续失败 -> `paused = true`，后续返回 `false`
- God 调用成功 -> `handleSuccess()` 重置所有状态
- 用户手动 `reset()` 后可重新尝试

`GodDecisionService` 与 WatchdogService 的协作：
1. God 调用失败
2. `watchdog.shouldRetry()` 判断是否重试
3. 是 -> `watchdog.getBackoffMs()` 获取等待时间，`adapter.clearSession()` 清除污染会话，重试
4. 否 -> 返回 fallback envelope（含 wait action）

### 8.2 `src/god/interrupt-clarifier.ts` — 人类中断意图分类

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

**JSON 解析**：手动 regex 提取 ```json code block。解析失败时使用原始输出作为 instruction。

结果写入 `INTERRUPT_CLASSIFICATION` 类型的审计日志。

---

## 9. Rule Engine

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

## 10. God 审计日志

### `src/god/god-audit.ts` — 审计日志

Append-only JSONL 格式审计日志，记录所有 God 决策。

```typescript
interface GodAuditEntry {
  seq: number;
  timestamp: string;
  decisionType: string;
  inputSummary: string;     // <= 2000 chars
  outputSummary: string;    // <= 2000 chars
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

## 11. 三方会话协调

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

## 12. God 会话持久化

### `src/god/god-session-persistence.ts`

```typescript
async function restoreGodSession(state, adapterFactory): Promise<null>
```

当前实现始终返回 `null`。God 通过无状态的 `GodAdapter` 接口运行，持久化的 God session ID 仅保留在快照中用于向后兼容。

> 实际的会话恢复逻辑已迁移到各 GodAdapter 实现中（`lastSessionId` / `restoreSessionId` / `clearSession`），以及 `tri-party-session.ts` 的 `restoreTriPartySession()`。此文件仅保留兼容性接口。

---

## 13. Zod Schema 设计

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

## 14. 集成点

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
task-init.ts        -> GodTaskAnalysis (taskType, phases)
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
    +-- 成功 -> watchdog.handleSuccess() -> 重置计数
    |
    +-- 失败 -> watchdog.shouldRetry()
                   |
                   +-- true  -> backoff 等待 -> clearSession -> 重试
                   |               |
                   |               +-- 成功 -> handleSuccess() -> 返回 envelope
                   |               +-- 失败 -> fallback envelope (wait action)
                   |
                   +-- false -> fallback envelope (wait action)
                   |
                   +-- 连续 > MAX_RETRIES (3) -> paused = true
```

### 与 Session 层的集成

- `GodAuditLogger` 的 seq 从已有日志文件恢复，确保 resume 后审计连续性
- `TriPartySession` 确保 resume 时三方会话独立恢复
- God adapter 的 `clearSession()` / `restoreSessionId()` 支持会话级别的恢复与清理

### 与 Parser 层的集成

God 模块依赖 `src/parsers/god-json-extractor.ts` 的 `extractGodJson()` 从 God 原始输出中提取和验证 JSON。支持 markdown code block 提取、Zod schema 验证。

# Duo 系统架构

> **Duo** -- Multi AI Coding Assistant Collaboration Platform
>
> Duo 是一个多 AI 编码助手协作平台，通过 **Coder + Reviewer + God LLM** 三方协作模型，实现自主化的代码编写、审查与迭代收敛。God LLM 作为 Sovereign（主权）决策者，统一编排 Coder 和 Reviewer 的工作流，所有状态变更通过结构化 Action 表达，确保可审计、可恢复、可降级。

---

## 目录

1. [八层架构总览](#八层架构总览)
2. [三方协作模型](#三方协作模型)
3. [数据流全景](#数据流全景)
4. [XState v5 状态机详解](#xstate-v5-状态机详解)
5. [God LLM 决策循环](#god-llm-决策循环)
6. [关键设计模式](#关键设计模式)
7. [技术栈](#技术栈)

---

## 八层架构总览

Duo 采用八层架构，自顶向下职责分明，层间严格单向依赖：

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1: CLI 入口层                                                │
│  cli.ts, cli-commands.ts, index.ts                                  │
│  职责: 命令解析、参数校验、渲染启动                                      │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 2: UI 组件层                                                 │
│  App.tsx, MainLayout.tsx, SetupWizard.tsx, StatusBar.tsx,            │
│  StreamRenderer.tsx, GodDecisionBanner.tsx, ... (24 components)     │
│  职责: 终端交互界面 (Ink + React)、流式输出渲染、Overlay 面板           │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 3: UI 状态层                                                 │
│  session-runner-state.ts, god-decision-banner.ts,                   │
│  overlay-state.ts, god-decision-banner.ts, ... (21 state files)     │
│  职责: 纯函数状态管理，为 UI 组件提供数据                                │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 4: Sovereign God Runtime                                     │
│  god-decision-service.ts, hand-executor.ts, rule-engine.ts,         │
│  observation-classifier.ts, watchdog.ts, task-init.ts,              │
│  degradation-manager.ts, message-dispatcher.ts, ... (28 files)      │
│  职责: Observe → Decide → Act 自主决策循环                            │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 5: 工作流引擎层                                               │
│  workflow-machine.ts (XState v5)                                    │
│  职责: 状态机驱动、会话恢复状态路由                                      │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 6: 决策引擎层 (旧版 fallback)                                 │
│  choice-detector.ts, convergence-service.ts                         │
│  职责: God 降级到 L4 后的规则兜底决策                                   │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 7: 会话管理层                                                 │
│  session-starter.ts, session-manager.ts, context-manager.ts,        │
│  prompt-log.ts                                                      │
│  职责: 启动参数解析、会话持久化 (原子写入)、Prompt 上下文                   │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 8: 适配层                                                     │
│  adapters/ (registry + detect + factory + 12 adapters)              │
│  parsers/ (stream-json / jsonl / text / god-json-extractor)         │
│  types/ (adapter / session / god-adapter / god-actions /             │
│          god-envelope / observation)                                 │
│  职责: AI 工具统一接口、输出解析、核心类型定义                             │
└─────────────────────────────────────────────────────────────────────┘
```

### 各层职责

#### Layer 1: CLI 入口层

| 文件 | 职责 |
|------|------|
| `src/cli.ts` | 程序入口。解析 `process.argv`，分发到 `start` / `resume` / `log` / `help` / `--version`。`start` 命令检测已安装 CLI、创建 `SessionConfig`、渲染 Ink `App` 组件 |
| `src/cli-commands.ts` | 命令处理器。`handleStart` 检测工具 + 校验参数；`handleResume` 加载会话快照并校验完整性；`handleLog` 读取 God 审计日志、按类型过滤、输出延迟统计 |
| `src/index.ts` | 版本号导出 (`VERSION = '1.0.0'`) |

CLI 支持的命令：

```bash
duo start --coder <cli> --reviewer <cli> --task <desc>  # 启动新会话
duo resume [session-id]                                  # 恢复会话
duo log <session-id> [--type <type>]                     # 查看审计日志
duo                                                      # 交互式模式
```

#### Layer 2 & 3: UI 层

基于 **Ink + React** 的 24 个终端 UI 组件，配合 24 个纯函数状态管理模块。核心组件包括 `App.tsx`（根组件，管理 XState 状态机生命周期）、`SetupWizard.tsx`（交互式设置向导）、`StreamRenderer.tsx`（实时流式渲染 LLM 输出）、`GodDecisionBanner.tsx`（God 决策横幅）等。

#### Layer 4: Sovereign God Runtime

**核心创新层** -- 28 个文件，实现 God LLM 作为自主决策者的完整运行时。详见下方 [God LLM 决策循环](#god-llm-决策循环) 章节。

#### Layer 5: 工作流引擎层

| 文件 | 职责 |
|------|------|
| `src/engine/workflow-machine.ts` | XState v5 状态机。12 个状态、20+ 事件类型。详见 [XState v5 状态机详解](#xstate-v5-状态机详解) |

#### Layer 6: 决策引擎层 (旧版 fallback)

God 降级到 L4 后的兜底组件：`choice-detector.ts`（检测 LLM 输出中的提问/选项）、`convergence-service.ts`（基于规则的收敛判断，不依赖 God LLM）。

#### Layer 7: 会话管理层

| 文件 | 职责 |
|------|------|
| `session-starter.ts` | 解析 CLI 参数，创建 `SessionConfig`，校验 Coder/Reviewer 是否已安装 |
| `session-manager.ts` | 会话持久化。原子写入 (write-tmp-rename) 到 `.duo/sessions/<id>/snapshot.json` |
| `context-manager.ts` | Prompt 上下文构建 (God 降级时使用) |
| `prompt-log.ts` | Prompt 日志记录，用于审计追溯 |

#### Layer 8: 适配层

三个子系统：

- **Adapter 子系统**：统一 12 种 AI CLI 工具的执行接口（`CLIAdapter`），通过 registry + detect + factory 模式管理。每种工具定义 command / detectCommand / execCommand / outputFormat / yoloFlag / parserType。
- **Parser 子系统**：三种输出格式解析器（stream-json / jsonl / text）+ God JSON 提取器（`god-json-extractor.ts`，含 Zod schema 校验）。
- **Type 子系统**：核心类型定义，被所有层共享。包括 `CLIAdapter`、`GodAdapter`、`SessionConfig`、`GodAction`、`GodDecisionEnvelope`、`Observation` 等。

---

## 三方协作模型

Duo 的核心创新是 **Coder + Reviewer + God LLM** 三方协作模型：

```
                    ┌─────────────────────────┐
                    │       God LLM           │
                    │   (Sovereign Orchestrator)│
                    │                         │
                    │  - 分析所有 Observation   │
                    │  - 输出 GodDecisionEnvelope│
                    │  - 最终权威，但默认促进   │
                    │    Coder-Reviewer 协作    │
                    └────────┬───┬────────────┘
                     指令下发 │   │ 指令下发
                  ┌──────────┘   └──────────┐
                  │                         │
                  v                         v
         ┌──────────────┐          ┌──────────────┐
         │    Coder     │          │   Reviewer   │
         │  (代码编写)   │  ←────→  │  (代码审查)   │
         │              │ God 协调  │              │
         │  CLIAdapter  │ 消息传递  │  CLIAdapter  │
         └──────────────┘          └──────────────┘
              │                         │
              │    任务产出 + 反馈        │
              └────────────┬────────────┘
                           │
                      ┌────v─────┐
                      │  Human   │
                      │  (用户)   │
                      └──────────┘
```

### 角色定义

| 角色 | 职责 | 接口 | 权限 |
|------|------|------|------|
| **Coder** | 编写代码、实现功能、修复 bug | `CLIAdapter` | 无决策权，只执行 God 的指令 |
| **Reviewer** | 审查代码、指出问题、给出建议 | `CLIAdapter` | 收敛信号提供者（verdict: APPROVED / CHANGES_REQUESTED） |
| **God LLM** | 编排协调、分析态势、做出决策 | `GodAdapter` | **Sovereign Authority** -- 最终决策者 |
| **Human** | 启动任务、中断干预、回答澄清 | CLI / Ctrl+C / 文本输入 | 可中断流程，God 决定如何响应 |

### 协作规则

1. **God 是唯一决策者**：所有状态变更（路由、收敛、中止）必须通过 God 的结构化 `GodAction` 表达
2. **Reviewer 是收敛信号源**：God 参考 Reviewer 的 verdict，但保留 override 权力（需 `system_log` 审计）
3. **Coder 和 Reviewer 是 Worker**：在 God 管理下工作，不具备 accept authority
4. **先方案后实现**：Coder 首轮仅分析和提出方案（不修改文件），Reviewer 评估后达成共识，Coder 才开始实现
5. **Reviewer 反馈直传**：Reviewer 的原始分析直接注入 Coder 的 prompt，God 只提供路由指导而不复述 Reviewer 的分析
6. **设计决策需要共识**：当 Coder 提出多个方案时，God 必须路由给 Reviewer 评估，不可自行选择
7. **God 不向人类求助**：God 自主解决 Worker 提出的实现细节问题（proxy decision-making），仅在真正无法解决时才 `request_user_input`

### Propose-First Workflow

```
Round 0: Coder 分析 + 提方案 → Reviewer 评估方案 → 达成共识
Round N: Coder 实现（带 Reviewer 原始反馈）→ Reviewer 验证 → God 判断收敛
```

- **首轮（无 Reviewer 反馈时）**：`code`/`debug` 类型使用 propose-only 指令，Coder 只分析不动代码
- **后续轮（isPostReviewerRouting=true）**：Coder 拿到完整实现指令 + Reviewer 原始分析
- **God 路由指导**：God 不复述 Reviewer 内容，而是提供策略方向（优先修哪个问题、用什么方法）
- **explore/discuss 类型**：始终为只读模式，不受此规则影响

### Tri-Party Session 隔离

`src/god/tri-party-session.ts` 负责三方会话管理：

- 每方独立的 session ID（`coderSessionId` / `reviewerSessionId` / `godSessionId`）
- 即使 Coder 和 Reviewer 使用相同 CLI 工具，也通过独立 adapter 实例保证隔离
- 每方独立恢复 -- 一方失败不影响其他方（fault tolerance）
- God 在 resume 时可选择恢复会话或全新开始

---

## 数据流全景

### 完整会话数据流 (Observe -> Decide -> Act)

```
用户输入任务
    │
    v
┌──────────────┐     SessionConfig     ┌────────────────┐
│  CLI 入口     │ ─────────────────────>│  App.tsx (Ink)  │
└──────────────┘                       └───────┬────────┘
                                               │
                                               v
                                    ┌─────────────────────┐
                                    │  TASK_INIT           │ God 分析任务意图
                                    │  task-init.ts        │ -> taskType / phases / rounds
                                    └──────────┬──────────┘
                                               │
                                               v
                                    ┌─────────────────────┐
                               ┌──> │  CODING              │ Coder 编码
                               │    │  CLIAdapter.execute() │
                               │    └──────────┬──────────┘
                               │               │ coderOutput
                               │               v
                               │    ┌─────────────────────┐
                               │    │  OBSERVING           │ 收集 + 分类 Observation
                               │    │  observation-        │ (work_output / incident /
                               │    │  classifier.ts       │  quota_exhausted / ...)
                               │    └──────────┬──────────┘
                               │               │ Observation[]
                               │               v
                               │    ┌─────────────────────┐
                               │    │  GOD_DECIDING        │ God 统一决策
                               │    │  god-decision-       │ observations + context
                               │    │  service.ts          │ -> GodDecisionEnvelope
                               │    └──────────┬──────────┘
                               │               │ GodDecisionEnvelope
                               │               │   { diagnosis, authority,
                               │               │     actions[], messages[] }
                               │               v
                               │    ┌─────────────────────┐
                               │    │  EXECUTING           │ Hand 执行器
                               │    │  hand-executor.ts    │ GodAction[] -> 执行
                               │    │  rule-engine.ts      │ (含规则引擎安全校验)
                               │    └──────────┬──────────┘
                               │               │ result Observation[]
                               │               v
                               │         ┌───────────┐
                               │         │  路由分支   │ resolvePostExecutionTarget()
                               │         └─────┬─────┘
                               │               │
                 ┌─────────────┼───────────────┼──────────────┬──────────────┐
                 │             │               │              │              │
                 v             v               v              v              v
          ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌──────────┐  ┌────────────┐
          │  CODING   │  │ REVIEWING │  │    DONE    │  │CLARIFYING│  │GOD_DECIDING│
          │(round++)  │  │           │  │  (final)   │  │(多轮问答) │  │ (re-enter) │
          └──────────┘  └───────────┘  └────────────┘  └──────────┘  └────────────┘
                               │
                               │ reviewerOutput
                               v
                        (回到 OBSERVING → GOD_DECIDING → EXECUTING → ...)
```

### God LLM 决策流

```
Observation[] + GodDecisionContext
    │
    v
┌───────────────────────────────────────────────┐
│  GodDecisionService.makeDecision()            │
│                                               │
│  Step 1: tryGodCall()                         │
│    ├── buildUserPrompt() / buildResumePrompt()│
│    │     - Task Goal                          │
│    │     - Phase & Round                      │
│    │     - Phase Plan (compound 任务)          │
│    │     - Available Adapters                 │
│    │     - Observations (severity 排序)        │
│    │     - Last Decision Summary              │
│    │     - Hand Action Catalog (11 种动作)     │
│    ├── collectGodAdapterOutput()              │
│    │     - GodAdapter.execute() (10min timeout)│
│    │     - System Prompt (Sovereign God)      │
│    └── extractGodJson() + Zod 校验            │
│                                               │
│  Step 2: (失败时) Watchdog 诊断               │
│    └── WatchdogService.diagnose()             │
│          - 分析失败原因                        │
│          - 决策: retry_fresh / retry_with_hint │
│          -       construct_envelope / escalate │
│                                               │
│  Step 3: 执行 Watchdog 决策 (最多 1 次重试)   │
│    └── executeWatchdogDecision()              │
│                                               │
│  最大 AI 调用: God(1) + Watchdog(1) + Retry(1) = 3 │
└───────────────────┬───────────────────────────┘
                    │
                    v
            GodDecisionEnvelope
```

### Hand Action 执行流

```
GodAction[] (from GodDecisionEnvelope.actions)
    │
    v (per action, sequentially)
┌───────────────────────────┐
│  rule-engine.ts           │
│  evaluateRules(action)    │
│  R-001..R-005 安全校验     │
└──────────┬────────────────┘
           │
    ┌──────┴──────┐
    │             │
  blocked       pass
    │             │
    v             v
violation    executeSingleAction()
observation       │
    │        ┌────┴────────────────────────────────────────────┐
    │        │ send_to_coder:     ctx.pendingCoderMessage = msg │
    │        │ send_to_reviewer:  ctx.pendingReviewerMessage    │
    │        │ accept_task:       ctx.taskCompleted = true       │
    │        │ set_phase:         ctx.currentPhaseId = phaseId   │
    │        │ stop_role:         adapter.kill()                 │
    │        │ retry_role:        kill + queue message           │
    │        │ switch_adapter:    ctx.adapterConfig.set()        │
    │        │ wait:              ctx.waitState.active = true    │
    │        │ request_user_input: ctx.clarificationState        │
    │        │ resume_after_interrupt: resumeStrategy             │
    │        │ emit_summary:      audit log                      │
    │        └────┬────────────────────────────────────────────┘
    │             │
    v             v
  Observation[] (result observations → 回到状态机)
```

### 消息分发流

```
GodDecisionEnvelope.messages[]
    │
    v
┌──────────────────────────────┐
│  message-dispatcher.ts       │
│  dispatchMessages()          │
│                              │
│  target: 'coder'             │──> pendingCoderMessage (下次 CODING 时发送)
│  target: 'reviewer'          │──> pendingReviewerMessage (下次 REVIEWING 时发送)
│  target: 'user'              │──> formatGodMessage() → displayToUser()
│  target: 'system_log'        │──> god-audit.jsonl (append-only)
│                              │
│  ⚠ 不产生状态变更 (FR-016)    │
│  ⚠ NL 不变量检查:             │
│    - 消息提及 phase 变更但无   │
│      set_phase action → error │
│    - 消息提及 accept 但无      │
│      accept_task action → error│
└──────────────────────────────┘
```

---

## XState v5 状态机详解

### 12 个状态

基于 XState v5 的 `workflowMachine`，定义在 `src/engine/workflow-machine.ts`：

```
                         START_TASK
┌──────┐ ─────────────────────────────────> ┌───────────┐
│ IDLE │                                    │ TASK_INIT │
└──┬───┘                                    └─────┬─────┘
   │                                              │
   │ RESUME_SESSION                  TASK_INIT_COMPLETE / TASK_INIT_SKIP
   v                                              │
┌──────────┐                                      v
│ RESUMING │                               ┌──────────┐
└──────────┘                          ┌──> │  CODING  │ <──────────────────────┐
  RESTORED_TO_*                       │    └────┬─────┘                        │
  → 对应状态                          │         │                              │
                                      │    CODE_COMPLETE                       │
                                      │         │ (clear observations)         │
                                      │         v                              │
                                      │    ┌───────────┐                       │
                               ┌──────┼──> │ OBSERVING │ <──────────┐          │
                               │      │    └─────┬─────┘            │          │
                               │      │          │                  │          │
                               │      │   OBSERVATIONS_READY        │          │
                               │      │          │                  │          │
                               │      │          v                  │          │
                               │      │    ┌──────────────┐        │          │
                               │      │    │ GOD_DECIDING │ <──┐   │          │
                               │      │    └──────┬───────┘    │   │          │
                               │      │           │            │   │          │
                               │      │    DECISION_READY      │   │          │
                               │      │           │            │   │          │
                               │      │           v            │   │          │
                               │      │    ┌───────────┐       │   │          │
                               │      │    │ EXECUTING │ ──────┘   │          │
                               │      │    └─────┬─────┘  (default:│          │
                               │      │          │      re-enter)  │          │
                               │      │   EXECUTION_COMPLETE       │          │
                               │      │          │                 │          │
                               │      │    ┌─────┴──────────┐     │          │
                               │      │    │ 路由分支 (guards)│     │          │
                               │      │    └─┬──┬──┬──┬──┬──┘     │          │
                               │      │      │  │  │  │  │        │          │
      ┌──────────────────── CODING ───┘      │  │  │  │  │        │          │
      │                                      │  │  │  │  │        │          │
      │ REVIEW_COMPLETE        REVIEWING ────┘  │  │  │  │        │          │
      │ (clear observations)                    │  │  │  │        │          │
      │                                   DONE ─┘  │  │  │        │          │
      v                                            │  │  │        │          │
┌───────────┐                           CLARIFYING─┘  │  │        │          │
│ REVIEWING │                                         │  │        │          │
└───────────┘                          GOD_DECIDING ──┘  │        │          │
                                                         │        │          │
                              ┌───────────────── circuit  │        │          │
                              │                  breaker  │        │          │
                              v                  tripped  │        │          │
                       ┌─────────────────┐                │        │          │
                       │ MANUAL_FALLBACK │ <──────────────┘        │          │
                       └────────┬────────┘                         │          │
                                │                                  │          │
                         USER_CONFIRM                              │          │
                           │        │                              │          │
                      accept    continue                           │          │
                           │        └──────────────────────────────│──────────┘
                           v                                       │
                       ┌────────┐                                  │
                       │  DONE  │ (final)                          │
                       └────────┘                                  │
                                                                   │
┌─────────────┐     OBSERVATIONS_READY → GOD_DECIDING              │
│ INTERRUPTED │ (backward compat, session resume)                  │
└─────────────┘                                                    │
                                                                   │
┌────────────┐      OBSERVATIONS_READY ────────────────────────────┘
│ CLARIFYING │      (God 多轮澄清: human answers → GOD_DECIDING
│            │       → God 再问或 resume_after_interrupt)
└────────────┘

┌─────────┐
│  ERROR  │ <── PROCESS_ERROR / TIMEOUT (from CODING / REVIEWING /
└────┬────┘     OBSERVING / GOD_DECIDING / EXECUTING / RESUMING)
     │
     │ RECOVERY
     v
  GOD_DECIDING (reset consecutiveRouteToCoder)
```

### 状态说明

| 状态 | 类型 | 说明 |
|------|------|------|
| `IDLE` | 初始 | 等待 `START_TASK` 或 `RESUME_SESSION` |
| `TASK_INIT` | 过渡 | God 分析任务意图，确定 taskType / phases / maxRounds |
| `CODING` | 活跃 | Coder 正在执行编码任务 |
| `REVIEWING` | 活跃 | Reviewer 正在执行审查任务 |
| `OBSERVING` | 过渡 | 收集并分类 Observation（Coder/Reviewer 输出或事件） |
| `GOD_DECIDING` | 过渡 | God 分析所有 Observation，输出 GodDecisionEnvelope |
| `EXECUTING` | 过渡 | Hand 执行器逐个执行 GodAction，产生结果 Observation |
| `CLARIFYING` | 等待 | God 通过 `request_user_input` 向人类提问，等待回答 |
| `MANUAL_FALLBACK` | 等待 | Circuit breaker 触发或 God 降级，需人工确认 |
| `INTERRUPTED` | 兼容 | 旧版中断状态，保留用于 session resume backward compat |
| `RESUMING` | 过渡 | 从持久化快照恢复会话，按 `RESTORED_TO_*` 路由到对应状态 |
| `DONE` | 终态 | 任务完成 |
| `ERROR` | 错误 | 进程错误/超时，可通过 `RECOVERY` 恢复到 `GOD_DECIDING` |

### 20+ 事件类型

| 事件 | 源状态 | 目标状态 | 说明 |
|------|--------|---------|------|
| `START_TASK` | IDLE | TASK_INIT | 用户启动任务，设置 `taskPrompt` |
| `TASK_INIT_COMPLETE` | TASK_INIT | CODING | God 完成意图解析，可选更新 `maxRounds` |
| `TASK_INIT_SKIP` | TASK_INIT | CODING | God 不可用，跳过分析直接开始 |
| `CODE_COMPLETE` | CODING | OBSERVING | Coder 输出完成，清空旧 observations |
| `REVIEW_COMPLETE` | REVIEWING | OBSERVING | Reviewer 输出完成，清空旧 observations |
| `OBSERVATIONS_READY` | OBSERVING / INTERRUPTED / CLARIFYING | GOD_DECIDING | Observation 分类完成，送 God 决策 |
| `DECISION_READY` | GOD_DECIDING | EXECUTING | God 返回 GodDecisionEnvelope |
| `EXECUTION_COMPLETE` | EXECUTING | (多目标) | Hand 执行完毕，按 guard 路由到目标状态 |
| `INCIDENT_DETECTED` | CODING / REVIEWING | OBSERVING | 运行时事件（中断/异常），冻结 `activeProcess` |
| `USER_CONFIRM` | MANUAL_FALLBACK | DONE / CODING | 用户确认 accept 或 continue |
| `PROCESS_ERROR` | 多个状态 | ERROR | 进程错误 |
| `TIMEOUT` | CODING / REVIEWING | ERROR | 进程超时 |
| `RECOVERY` | ERROR | GOD_DECIDING | 错误恢复，重置 circuit breaker |
| `RESUME_SESSION` | IDLE | RESUMING | 恢复会话 |
| `RESTORED_TO_CODING` | RESUMING | CODING | 恢复到 CODING 状态 |
| `RESTORED_TO_REVIEWING` | RESUMING | REVIEWING | 恢复到 REVIEWING 状态 |
| `RESTORED_TO_WAITING` | RESUMING | GOD_DECIDING | 恢复到 GOD_DECIDING 状态 |
| `RESTORED_TO_INTERRUPTED` | RESUMING | INTERRUPTED | 恢复到 INTERRUPTED 状态 |
| `RESTORED_TO_CLARIFYING` | RESUMING | CLARIFYING | 恢复到 CLARIFYING 状态 |
| `CLEAR_PENDING_PHASE` | GOD_DECIDING / MANUAL_FALLBACK | (保持) | 清除待转换阶段信息 |
| `MANUAL_FALLBACK_REQUIRED` | GOD_DECIDING | MANUAL_FALLBACK | God 降级需人工介入 |

### EXECUTION_COMPLETE 路由守卫

`EXECUTION_COMPLETE` 是状态机最复杂的事件，通过 `resolvePostExecutionTarget()` 函数和 6 个 guard 决定目标状态：

| Guard | 条件 | 目标 | 说明 |
|-------|------|------|------|
| `circuitBreakerTripped` | 目标为 CODING 且 `consecutiveRouteToCoder + 1 >= 3` | `MANUAL_FALLBACK` | 防止死循环 |
| `executionTargetCoding` | actions 含 `send_to_coder` 或 `retry_role(coder)` | `CODING` | `round++`, `counter++` |
| `executionTargetReviewing` | actions 含 `send_to_reviewer` 或 `retry_role(reviewer)` | `REVIEWING` | 重置 counter |
| `executionTargetDone` | actions 含 `accept_task` | `DONE` | 任务完成 |
| `executionTargetClarifying` | actions 含 `request_user_input` | `CLARIFYING` | God 向人类提问 |
| (default) | 其他 (`wait` / `emit_summary` / `set_phase`) | `GOD_DECIDING` | re-enter 决策循环，保留现有 observations |

### WorkflowContext 完整字段

```typescript
interface WorkflowContext {
  round: number;                          // 当前轮次
  maxRounds: number;                      // 最大轮次 (默认 10，TASK_INIT 可动态调整)
  consecutiveRouteToCoder: number;        // 连续 route-to-coder 次数 (circuit breaker 计数器)
  taskPrompt: string | null;              // 任务描述
  activeProcess: 'coder' | 'reviewer' | null;  // 当前活跃进程
  lastError: string | null;              // 最近错误
  lastCoderOutput: string | null;        // Coder 最近输出
  lastReviewerOutput: string | null;     // Reviewer 最近输出
  sessionId: string | null;              // 会话 ID
  pendingPhaseId: string | null;         // 待转换阶段 ID
  pendingPhaseSummary: string | null;    // 待转换阶段摘要
  currentObservations: Observation[];    // 当前 Observation 列表
  lastDecision: GodDecisionEnvelope | null;  // 最近 God 决策
  incidentCount: number;                 // 事件计数
  frozenActiveProcess: 'coder' | 'reviewer' | null;  // CLARIFYING 前冻结的活跃进程
  clarificationRound: number;            // 澄清轮次计数
  clarificationObservations: Observation[];  // 累积的澄清 Observation (保留完整上下文)
}
```

---

## God LLM 决策循环

### 设计原则

1. **Sovereign Authority**：God 是运行时唯一决策者，所有状态变更必须通过结构化 `GodAction` 表达
2. **Reviewer 是收敛信号**：Reviewer 的 verdict 是重要参考，但 God 保留 override 权力（需 `system_log` 审计）
3. **Rule Engine 不可覆盖**：block 级别规则（R-001..R-005）具有绝对优先级，God 无法 override
4. **统一决策信封**：`GodDecisionEnvelope` 替代旧版 5 种分散 schema，所有决策走同一管道
5. **Proxy Decision-Making**：God 自主代理回答 Worker 的实现细节问题，避免不必要的人类交互
6. **Decision Reflection**：高风险决策前 God 进行自检（scope / quality / plan consistency / proposal check）

### Observe → Decide → Act 循环

这是 God Runtime 的核心循环，替代了旧版散点路由（ROUTING_POST_CODE / ROUTING_POST_REVIEW / EVALUATING）：

```
      ┌─────────────────────────────────────────────────────┐
      │                                                     │
      │              Observe → Decide → Act                 │
      │                                                     │
      │  ┌───────────┐    ┌──────────────┐    ┌───────────┐│
      │  │  OBSERVE  │───>│    DECIDE    │───>│    ACT    ││
      │  │           │    │              │    │           ││
      │  │ Classify  │    │ God analyzes │    │ Execute   ││
      │  │ worker    │    │ observations │    │ GodActions││
      │  │ output    │    │ + context    │    │ via Hand  ││
      │  │ into      │    │ → outputs    │    │ Executor  ││
      │  │ Observation│    │ Envelope     │    │ → results ││
      │  └───────────┘    └──────────────┘    └─────┬─────┘│
      │       ^                                      │      │
      │       │                                      │      │
      │       └──────────────────────────────────────┘      │
      │              result observations feed back          │
      └─────────────────────────────────────────────────────┘
```

#### Phase 1: OBSERVE（观测）

`src/god/observation-classifier.ts` + `src/god/observation-integration.ts`

- **输入**：Coder/Reviewer 的原始输出、中断事件、进程错误
- **处理**：纯正则 + 关键词匹配（< 5ms，无 LLM 调用），分类为 13 种 Observation 类型
- **输出**：`Observation[]`，按 severity 排序（fatal > error > warning > info）
- **Non-Work Guard**：非工作 Observation（quota_exhausted / empty_output / meta_output 等）不触发 `CODE_COMPLETE` / `REVIEW_COMPLETE`，直接路由到 God 处理

**13 种 Observation 类型**：

| 类型 | 来源 | 严重性 | 说明 |
|------|------|--------|------|
| `work_output` | coder | info | Coder 的工作输出 |
| `review_output` | reviewer | info | Reviewer 的审查输出 |
| `quota_exhausted` | runtime | error | API 配额/频率限制 |
| `auth_failed` | runtime | error | 认证失败 |
| `adapter_unavailable` | runtime | error | Adapter 不可用 |
| `empty_output` | runtime | warning | LLM 输出为空 |
| `meta_output` | coder/reviewer | warning | 非实质工作的元信息输出 |
| `tool_failure` | runtime | error | 工具调用失败 |
| `human_interrupt` | human | warning | 用户 Ctrl+C 中断 |
| `human_message` | human | info | 用户文本中断（附带指令） |
| `clarification_answer` | human | info | 用户回答 God 的澄清问题 |
| `phase_progress_signal` | runtime | info | 阶段进度信号（Hand 执行结果） |
| `runtime_invariant_violation` | runtime | error/fatal | 运行时不变量违反 |

**IncidentTracker** 提供严重性自动升级：
- `empty_output` 连续 2+ 次：warning → error
- `tool_failure` 连续 3+ 次：error → fatal

#### Phase 2: DECIDE（决策）

`src/god/god-decision-service.ts`

- **输入**：`Observation[]` + `GodDecisionContext`
- **处理**：
  1. 构建 User Prompt（Task Goal / Phase & Round / Observations / Hand Catalog / Last Decision）
  2. 调用 God Adapter（system prompt 使用 CRITICAL OVERRIDE 强制 JSON-only 输出）
  3. 提取 JSON + Zod schema 校验 → `GodDecisionEnvelope`
  4. 失败时由 Watchdog AI 诊断并决定恢复策略
- **输出**：`GodDecisionEnvelope`

God 的 system prompt 包含以下指令集：
- **Phase-following**：compound 任务必须按阶段顺序执行
- **Reviewer handling**：尊重 Reviewer verdict，override 需审计
- **Proposal routing**：Coder 多方案时必须路由给 Reviewer 评估
- **Proxy decision-making**：实现细节问题自主回答，设计问题路由给 Reviewer
- **Decision reflection**：高风险决策前自检 scope / quality / plan consistency

#### Phase 3: ACT（执行）

`src/god/hand-executor.ts` + `src/god/rule-engine.ts`

- **输入**：`GodAction[]`（从 GodDecisionEnvelope.actions 中提取）
- **处理**：逐个执行 action，每个 action 先经 Rule Engine 校验
- **输出**：`Observation[]`（执行结果，反馈回状态机）

### GodDecisionEnvelope 结构

所有 God 决策通过统一的 Envelope 表达（定义在 `src/types/god-envelope.ts`，Zod schema 校验）：

```
GodDecisionEnvelope
├── diagnosis                        God 对当前态势的诊断
│   ├── summary: string              情况评估摘要
│   ├── currentGoal: string          当前目标
│   ├── currentPhaseId: string       当前阶段 ID
│   └── notableObservations: string[]  驱动本次决策的关键观察
│
├── authority                        权限声明 (Zod superRefine 强制语义约束)
│   ├── userConfirmation: 'human' | 'god_override' | 'not_required'
│   ├── reviewerOverride: boolean    是否覆盖 Reviewer (true 需 system_log)
│   └── acceptAuthority: 'reviewer_aligned' | 'god_override' | 'forced_stop'
│
├── actions: GodAction[]             结构化动作列表 (11 种 Hand Action)
│
├── messages: EnvelopeMessage[]      消息列表
│   └── { target: 'coder'|'reviewer'|'user'|'system_log', content }
│
└── autonomousResolutions?           God 代理决策记录 (BUG-24)
    └── { question, choice, reflection, finalChoice }[]
```

Authority 语义约束（schema 层强制执行）：
- `reviewerOverride = true` → messages 必须包含 `system_log` 条目解释原因
- `acceptAuthority = 'god_override'` → messages 必须包含 `system_log` 条目
- `userConfirmation = 'god_override'` → messages 必须包含 `system_log` 条目
- `acceptAuthority = 'forced_stop'` → messages 必须包含 `user` 条目（用户摘要）

### 11 种 Hand Action（GodAction）

定义在 `src/types/god-actions.ts`，使用 Zod discriminated union：

| Action | 参数 | 状态机效果 |
|--------|------|-----------|
| `send_to_coder` | `{ message }` | → CODING |
| `send_to_reviewer` | `{ message }` | → REVIEWING |
| `stop_role` | `{ role, reason }` | kill adapter |
| `retry_role` | `{ role, hint? }` | kill + restart → CODING/REVIEWING |
| `switch_adapter` | `{ role, adapter, reason }` | 更换某角色的 adapter |
| `set_phase` | `{ phaseId, summary? }` | 阶段转换，写审计日志 |
| `accept_task` | `{ rationale, summary }` | → DONE，rationale 必须声明 |
| `wait` | `{ reason, estimatedSeconds? }` | re-enter GOD_DECIDING |
| `request_user_input` | `{ question }` | → CLARIFYING |
| `resume_after_interrupt` | `{ resumeStrategy }` | continue/redirect/stop |
| `emit_summary` | `{ content }` | 管理摘要，写审计日志 |

### Rule Engine（规则引擎）

`src/god/rule-engine.ts` -- 同步执行（< 5ms），block 级别规则具有绝对优先级，God 无法 override（NFR-009）：

| 规则 | 级别 | 说明 |
|------|------|------|
| R-001 | block | 禁止写入 `~/Documents` 目录之外 |
| R-002 | block | 禁止访问系统关键目录（`/etc`, `/usr`, `/bin`, `/System`, `/Library`），含 symlink 解析 |
| R-003 | block | 禁止可疑网络外传（curl 带 `-d @` 等） |
| R-004 | warn | God 批准但 Rule Engine 阻止的矛盾检测 |
| R-005 | warn | Coder 修改 `.duo/` 配置目录 |

### Watchdog 服务

`src/god/watchdog.ts` -- AI 驱动的错误诊断系统，替代旧版规则降级：

```
God 决策失败
    │
    v
┌────────────────────────────────┐
│  WatchdogService.diagnose()    │
│                                │
│  输入: 失败信息 + 原始输出 +    │
│        observations + context  │
│                                │
│  输出 (4 种决策):               │
│  ├── retry_fresh               │ 清空 God session，全新重试
│  ├── retry_with_hint           │ 带纠正提示重试
│  ├── construct_envelope        │ Watchdog 根据 God 意图构造 envelope
│  └── escalate                  │ 不可恢复，使用 fallback
│                                │
│  安全: 连续 5 次失败 → 自动     │
│  escalate + godDisabled        │
│                                │
│  自身失败 → 立即 escalate      │
└────────────────────────────────┘
```

### 降级策略

四级降级（`src/god/degradation-manager.ts`），保留用于与 Watchdog 的兼容：

```
L1 (正常)
 │
 │ God adapter 超时/崩溃
 v
L2 (可重试)
 │  - 重试 1 次
 │  - 失败则使用 fallback envelope (wait action)
 │
 │ JSON 解析/Zod 校验失败
 v
L3 (不可重试)
 │  - 带错误提示重试 1 次
 │  - 失败则使用 fallback envelope
 │
 │ 连续 3 次失败
 v
L4 (God 禁用)
    - 切换到旧版 decision/ 组件 (ChoiceDetector + ConvergenceService)
    - 全程无 God 参与
    - MANUAL_FALLBACK_REQUIRED → 人工介入
```

三层安全网：God → Watchdog/Fallback → ERROR/MANUAL_FALLBACK → `duo resume`

### 收敛判断

`src/god/god-convergence.ts` -- Reviewer-Authority 收敛评估：

决策树：
1. 无 Reviewer 输出 → 不能终止（AC-019b，Reviewer 是收敛唯一信号）
2. `max_rounds` 到达 → 强制终止
3. `loop_detected` + 3 轮无改善 → 强制终止
4. `blockingIssueCount > 0` → 不终止
5. 所有 `criteriaProgress` 满足 → 终止
6. 否则 → 不终止

内置一致性校验（检测 God 幻觉）：
- `classification: approved` 但 `blockingIssueCount > 0` → 矛盾
- `shouldTerminate: true` 但 `blockingIssueCount > 0` → 矛盾
- `shouldTerminate: true` 但有未满足的 criteria → 矛盾

### TASK_INIT 任务分析

`src/god/task-init.ts` -- God 启动时分析任务意图：

- 输出 `GodTaskAnalysis`：taskType / confidence / suggestedMaxRounds / terminationCriteria / phases
- 支持 6 种 taskType：`explore` / `code` / `discuss` / `review` / `debug` / `compound`
- 每种 taskType 有对应的轮次范围约束：

| taskType | 最小轮次 | 最大轮次 |
|----------|---------|---------|
| explore | 2 | 5 |
| code | 3 | 10 |
| review | 1 | 3 |
| debug | 2 | 6 |
| discuss | 2 | 5 |
| compound | (不限) | (不限) |

### God 子系统全景

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Sovereign God Runtime                               │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Decision Pipeline (统一决策管道)                                  │   │
│  │                                                                    │   │
│  │  observation-classifier.ts    Observation 分类 (regex, < 5ms)     │   │
│  │        │                                                           │   │
│  │        v                                                           │   │
│  │  god-decision-service.ts      makeDecision(obs, ctx) → Envelope  │   │
│  │        │                                                           │   │
│  │        v                                                           │   │
│  │  hand-executor.ts             executeActions(actions) → obs[]     │   │
│  │        │                                                           │   │
│  │        v                                                           │   │
│  │  rule-engine.ts               R-001..R-005 安全校验               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Adapter Layer (God 专用适配器)                                   │   │
│  │                                                                    │   │
│  │  god-call.ts                  collectGodAdapterOutput (统一调用)   │   │
│  │  god-system-prompt.ts         CRITICAL OVERRIDE 系统 prompt       │   │
│  │  god-adapter-factory.ts       创建 GodAdapter 实例                │   │
│  │  god-adapter-config.ts        配置 + resume 兼容性                │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Quality & Safety Guards (质量与安全守卫)                          │   │
│  │                                                                    │   │
│  │  watchdog.ts                  AI 驱动的错误诊断与恢复              │   │
│  │  consistency-checker.ts       检测 God 输出逻辑矛盾/幻觉           │   │
│  │  loop-detector.ts             循环检测 (3 轮 stagnant / 语义重复)  │   │
│  │  degradation-manager.ts       L1-L4 四级降级策略                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Task & Session (任务与会话管理)                                   │   │
│  │                                                                    │   │
│  │  task-init.ts                 任务分析 (类型/阶段/轮次/终止标准)   │   │
│  │  god-convergence.ts           收敛判断 (Reviewer-Authority)       │   │
│  │  tri-party-session.ts         Coder/Reviewer/God 三方会话隔离      │   │
│  │  message-dispatcher.ts        消息分发器 (NL 不变量校验)           │   │
│  │  observation-integration.ts   中断/文本中断 → Observation 转换     │   │
│  │  god-audit.ts                 审计日志 (append-only JSONL)         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 关键设计模式

### 1. Sovereign Authority 模式

God LLM 是系统中唯一的决策者。所有状态变更（路由、收敛、中止、中断恢复）必须通过结构化 `GodAction` 表达，不允许通过自然语言消息暗示状态变更。`message-dispatcher.ts` 中的 NL 不变量检查确保消息内容与 action 一致（FR-016）。

### 2. Envelope 模式（统一决策信封）

旧版使用多种独立 schema（GodTaskAnalysis / GodPostCoderDecision / GodPostReviewerDecision / GodConvergenceJudgment 等）。新版 `GodDecisionEnvelope` 统一所有决策场景：
- 一个入口（`makeDecision`），一种输出格式
- 通过 `actions[]` 的组合表达任意决策
- `authority` 语义约束通过 Zod `superRefine` 在 schema 层强制执行

### 3. Observation Pipeline 模式

所有来源的输出（Coder / Reviewer / 中断 / 错误 / 超时）统一归一化为 `Observation` 对象，再流入 God 决策管道。这替代了旧版的散点路由：

- 中断（Ctrl+C / 文本中断）不再直接发送 XState 事件，而是生成 `human_interrupt` / `human_message` Observation
- 通过 `INCIDENT_DETECTED` 事件进入 OBSERVING
- 正常走 OBSERVING → GOD_DECIDING → EXECUTING 管道
- God 决定如何处理中断（continue / redirect / stop）

### 4. Hand 模式（结构化动作目录）

God 的决策通过 11 种预定义的 Hand Action 表达，每种 action 有明确的参数和执行语义。Hand Executor 逐个执行 action，每个 action 先经 Rule Engine 校验。被阻止的 action 产生 `runtime_invariant_violation` Observation 反馈给 God。

### 5. Watchdog 模式（AI 错误诊断）

当 God 决策失败时，不是简单降级，而是由 Watchdog AI 分析失败原因并决定最优恢复策略：
- `retry_fresh`：清空 God session，全新重试
- `retry_with_hint`：带纠正提示重试
- `construct_envelope`：Watchdog 根据 God 意图构造 envelope
- `escalate`：不可恢复

最大 AI 调用数限制为 3（God + Watchdog + Retry），防止失控。

### 6. Circuit Breaker 模式

连续 3 次 `route-to-coder`（`consecutiveRouteToCoder >= 3`）触发熔断：
- 直接跳转 `MANUAL_FALLBACK`
- 需要人工确认（continue 重置计数器 / accept 完成任务）
- `route-to-reviewer` 时自动重置计数器

### 7. CLARIFYING 多轮澄清模式

God 可通过 `request_user_input` action 进入 `CLARIFYING` 状态：
- 冻结 `frozenActiveProcess`（记住中断前在做什么）
- 用户回答 → `clarification_answer` Observation → GOD_DECIDING
- God 可继续提问（再次 `request_user_input`）或恢复工作（`resume_after_interrupt`）
- 累积的 `clarificationObservations` 保留完整上下文

### 8. GodAdapter 与 CLIAdapter 接口分离

`GodAdapter`（`src/types/god-adapter.ts`）独立于 `CLIAdapter`（`src/types/adapter.ts`）：

```typescript
// CLIAdapter — 用于 Coder / Reviewer
interface CLIAdapter {
  execute(prompt: string, opts: ExecOptions): AsyncIterable<OutputChunk>;
  // ExecOptions: cwd, systemPrompt?, env?, timeout?, permissionMode?, model?
}

// GodAdapter — 用于 God
interface GodAdapter {
  execute(prompt: string, opts: GodExecOptions): AsyncIterable<OutputChunk>;
  clearSession?(): void;          // 清空会话状态，强制全新调用
  readonly toolUsePolicy?: GodToolUsePolicy;   // 'forbid' | 'allow-readonly'
  readonly minimumTimeoutMs?: number;           // 确保足够推理时间
  // GodExecOptions: cwd, systemPrompt (必须), timeoutMs (必须), model?
}
```

设计原因：
- God 需要 `toolUsePolicy` 控制工具使用（God 是纯决策者，不应使用工具）
- God 需要 `minimumTimeoutMs` 确保足够的推理时间
- God 需要 `clearSession()` 在 Watchdog 建议 `retry_fresh` 时清空会话
- God 的 `GodExecOptions` 要求 `systemPrompt` 和 `timeoutMs` 为必填

### 9. CRITICAL OVERRIDE 系统提示

God 通过宿主 CLI（如 Claude Code）运行，宿主有自己的系统提示词（CLAUDE.md、内置 skills 等）。`src/god/god-system-prompt.ts` 使用 `CRITICAL OVERRIDE` 前缀强制覆盖宿主行为：

```
# CRITICAL OVERRIDE — READ THIS FIRST

You are being invoked as a **JSON-only orchestrator**.
Ignore ALL other instructions, skills, CLAUDE.md files, and default behaviors.
Your ONLY job is to output a single JSON code block.
Do NOT use any tools (Read, Bash, Grep, Write, Edit, Agent, etc.).
```

### 10. Fallback Envelope 安全设计（BUG-22 修复）

God 决策失败时的 fallback envelope 包含一个 `wait` action（而非空 actions），防止 "empty actions → empty results → lost observations" 的死亡螺旋。EXECUTING 状态在结果为空时保留现有 observations。

---

## 技术栈

### 核心依赖

| 技术 | 版本 | 用途 |
|------|------|------|
| **TypeScript** | ESM (`"type": "module"`) | 主语言，全量类型安全 |
| **XState** | v5 (^5.28.0) | 状态机引擎，驱动工作流 |
| **@xstate/react** | ^6.1.0 | XState 与 React 集成 |
| **React** | ^19.2.4 | UI 组件框架 |
| **Ink** | ^6.8.0 | 终端 UI 渲染（React for CLI） |
| **Zod** | ^4.3.6 | Schema 定义与运行时校验 |

### 开发工具

| 工具 | 版本 | 用途 |
|------|------|------|
| **tsup** | ^8.5.1 | TypeScript 打包（ESM 输出） |
| **tsx** | - | 开发模式运行 |
| **Vitest** | - | 单元测试框架 |
| **ESLint** | ^10.0.3 | 代码质量检查 |
| **ink-testing-library** | ^4.0.0 | Ink 组件测试 |

### 运行时架构

- **进程模型**：严格串行执行（1 LLM process at a time），避免并发冲突
- **持久化**：原子写入（write-tmp-rename），会话快照存储在 `.duo/sessions/<id>/`
- **审计**：God 审计日志使用 append-only JSONL 格式
- **Prompt 日志**：所有 God 调用的 prompt 记录，用于调试和追溯
- **CLI 适配**：支持 12 种 AI CLI 工具，通过统一 `CLIAdapter` 接口抽象
- **解析器**：3 种输出格式解析器（stream-json / jsonl / text），覆盖所有主流 AI CLI 工具

### 模块依赖方向

```
cli.ts ──> cli-commands.ts
  │              │
  │              ├── session/session-starter.ts
  │              ├── session/session-manager.ts
  │              ├── adapters/detect.ts
  │              └── god/god-audit.ts
  │
  └──> ui/components/App.tsx
          │
          ├── engine/workflow-machine.ts (XState v5)
          ├── god/observation-integration.ts
          │   god/observation-classifier.ts
          │
          ├── god/god-decision-service.ts ────> god/god-call.ts
          │       │                                   │
          │       ├── parsers/god-json-extractor.ts   ├── types/god-adapter.ts
          │       ├── types/god-envelope.ts            └── god/god-system-prompt.ts
          │       └── god/watchdog.ts
          │
          ├── god/hand-executor.ts
          │       └── god/rule-engine.ts
          │
          ├── god/task-init.ts ──> god/god-call.ts
          ├── god/god-convergence.ts
          ├── god/tri-party-session.ts
          ├── god/message-dispatcher.ts
          ├── god/degradation-manager.ts
          │       └── decision/convergence-service.ts (fallback)
          │           decision/choice-detector.ts (fallback)
          │
          ├── adapters/factory.ts ──> adapters/process-manager.ts
          │                           adapters/{cli}/adapter.ts (x12)
          ├── adapters/registry.ts
          │
          ├── session/session-manager.ts
          │
          └── types/ (adapter, session, god-adapter, god-actions,
                      god-envelope, observation, god-schemas)
```

**依赖方向原则**：

- **上层 → 下层**：严格单向依赖，上层可以依赖下层，反之不行
- **types/ 是最底层**：不依赖任何其他模块，被所有层共享
- **god/ → decision/**：`degradation-manager.ts` 降级时依赖旧版 decision/ 组件
- **god/ 不依赖 ui/**：God Runtime 与 UI 解耦，通过 App.tsx 集成
- **engine/ 不依赖 god/**：状态机只定义状态和事件，不包含业务逻辑
- **adapters/ 不依赖 god/**：Adapter 层只负责工具统一接口，不参与决策

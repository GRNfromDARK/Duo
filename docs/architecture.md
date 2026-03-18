# Duo 系统架构

> **Duo** -- Multi AI Coding Assistant Collaboration Platform
>
> Duo 是一个多 AI 编码助手协作平台，通过 **Coder + Reviewer + God LLM** 三方协作模型，实现自主化的代码编写、审查与迭代收敛。God LLM 作为 Sovereign（主权）决策者，统一编排 Coder 和 Reviewer 的工作流，所有状态变更通过结构化 Action 表达，确保可审计、可恢复。

---

## 目录

1. [五层架构总览](#五层架构总览)
2. [三方协作模型](#三方协作模型)
3. [数据流全景](#数据流全景)
4. [XState v5 状态机详解](#xstate-v5-状态机详解)
5. [God LLM 决策循环](#god-llm-决策循环)
6. [关键设计模式](#关键设计模式)
7. [技术栈](#技术栈)

---

## 五层架构总览

Duo 采用五层架构，自顶向下职责分明，层间严格单向依赖：

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1: CLI + TUI 入口层                                          │
│  cli.ts, cli-commands.ts, index.ts                                  │
│  tui/cli.tsx, tui/app.tsx, tui/primitives.tsx,                      │
│  tui/runtime/bun-launcher.ts                                        │
│  职责: 命令解析、参数校验、Bun OpenTUI 渲染运行时、进程启动             │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 2: UI 层                                                     │
│  App.tsx, MainLayout.tsx, SetupWizard.tsx, StatusBar.tsx,            │
│  StreamRenderer.tsx, ... (21 components)                            │
│  职责: 终端交互界面 (OpenTUI + React)、流式输出渲染、                   │
│        原生 ScrollBox 滚动、Overlay 面板                              │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 3: Sovereign God Runtime + 工作流引擎                         │
│  god-decision-service.ts, hand-executor.ts, observation-factory.ts, │
│  watchdog.ts, tri-party-session.ts, message-dispatcher.ts,          │
│  god-audit.ts, god-prompt-generator.ts, god-call.ts,                │
│  god-adapter-factory.ts, god-adapter-config.ts,                     │
│  god-session-persistence.ts, rule-engine.ts                         │
│  engine/workflow-machine.ts                                          │
│  职责: God LLM 自主决策运行时 (Observe → Decide → Act)                │
│        XState v5 状态机驱动工作流循环                                  │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 4: 会话管理层                                                 │
│  session-starter.ts, session-manager.ts, prompt-log.ts              │
│  职责: 启动参数解析、会话持久化 (原子写入)、Prompt 日志                    │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 5: 适配层                                                     │
│  adapters/ (registry + detect + factory + model-discovery +          │
│            process-manager + output-stream-manager + adapters)       │
│  parsers/ (stream-json / jsonl / text / god-json-extractor)         │
│  types/ (adapter / session / god-adapter / god-actions /             │
│          god-envelope / god-schemas / observation / degradation)     │
│  职责: AI 工具统一接口、动态 Model 发现、输出解析、核心类型定义            │
└─────────────────────────────────────────────────────────────────────┘
```

### 各层职责

#### Layer 1: CLI + TUI 入口层

| 文件 | 职责 |
|------|------|
| `src/cli.ts` | 程序入口（Node.js 侧）。解析 `process.argv`，轻量命令（`--version` / `help` / `resume` 列表 / `log`）在 Node 中直接处理；`start` / `resume <id>` 等 TUI 命令通过 `bun-launcher.ts` 交接给 Bun OpenTUI 运行时 |
| `src/cli-commands.ts` | 命令处理器。`handleStart` 检测工具 + 校验参数；`handleResume` 加载会话快照并校验完整性；`handleLog` 读取 God 审计日志、按类型过滤、输出延迟统计 |
| `src/index.ts` | 版本号导出 (`VERSION = '1.0.0'`) |
| `tui/runtime/bun-launcher.ts` | 解析 Bun 二进制路径（优先级：`DUO_BUN_BINARY` 环境变量 > 项目内 `.local/bun/bin/bun` > 系统 `which bun`），构建 OpenTUI 启动命令 |
| `tui/cli.tsx` | Bun 侧入口，使用 `@opentui/core` 的 `createCliRenderer` 和 `@opentui/react` 的 `createRoot` 渲染 React 组件树；处理 `start` / `resume` / `--smoke-test` 命令 |
| `tui/primitives.tsx` | UI 原语适配层，将 OpenTUI 的 `box` / `text` / `span` / `scrollbox` 元素和 `useKeyboard` / `useAppContext` hook 封装为 `Box` / `Text` / `ScrollBox` / `useInput` / `useApp` / `useStdout` 等与旧 Ink API 兼容的接口 |
| `tui/app.tsx` | 轻量 TUI 组件，用于 smoke test 和 resume 预览 |

CLI 支持的命令：

```bash
duo start --coder <cli> --reviewer <cli> --task <desc>  # 启动新会话
duo resume [session-id]                                  # 恢复会话
duo log <session-id> [--type <type>]                     # 查看审计日志
duo                                                      # 交互式模式
```

#### Layer 2: UI 层

基于 **OpenTUI + React** 的终端 UI 组件（21 个）。核心组件包括：

- `App.tsx` — 根组件，管理 XState 状态机生命周期
- `SetupWizard.tsx` — 交互式设置向导
- `StreamRenderer.tsx` — 实时流式渲染 LLM 输出
- `MainLayout.tsx` — 使用 OpenTUI 原生 `ScrollBox` 组件实现滚动（`stickyScroll` / `scrollBy` / `scrollTo`），替代旧版手动 scroll-state 管理

> **已移除的模块**（功能由 OpenTUI 原生提供）：`alternate-screen.ts`（OpenTUI `createCliRenderer` 内置 alternate screen 管理）、`mouse-input.ts`（OpenTUI 原生处理鼠标输入）、`scroll-state.ts`（OpenTUI `ScrollBox` 原生滚动）、`ScrollIndicator.tsx`（OpenTUI `scrollbox` 内置滚动条）

#### Layer 3: Sovereign God Runtime + 工作流引擎

**核心创新层** -- 实现 God LLM 作为自主决策者的完整运行时，与 XState v5 工作流引擎合并为一层。详见下方 [God LLM 决策循环](#god-llm-决策循环) 章节。

> **已移除的模块**：`god-system-prompt.ts`（system prompt 内联到 `god-decision-service.ts`）、`observation-classifier.ts`（正则分类移除，由 `observation-factory.ts` 替代）、`observation-integration.ts`（中断/事件转换逻辑简化移除）、`interrupt-clarifier.ts`（中断意图分类移除）、`task-init.ts`（TASK_INIT 阶段移除，God 直接从 GOD_DECIDING 开始决策）

#### Layer 4: 会话管理层

| 文件 | 职责 |
|------|------|
| `session-starter.ts` | 解析 CLI 参数，创建 `SessionConfig`，校验 Coder/Reviewer 是否已安装 |
| `session-manager.ts` | 会话持久化。原子写入 (write-tmp-rename) 到 `.duo/sessions/<id>/snapshot.json` |
| `prompt-log.ts` | Prompt 日志记录，用于审计追溯 |

#### Layer 5: 适配层

三个子系统：

- **Adapter 子系统**：统一多种 AI CLI 工具的执行接口（`CLIAdapter`），通过 registry + detect + factory 模式管理。每种工具定义 command / detectCommand / execCommand / outputFormat / yoloFlag / parserType。新增 `model-discovery.ts` 支持动态 Model 发现（Codex 读取 `~/.codex/models_cache.json`、Gemini 从 `@google/gemini-cli-core` 读取 `VALID_GEMINI_MODELS`、Claude Code 使用 CLI 稳定别名）。
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
| **Reviewer** | 审查代码、指出问题、给出建议 | `CLIAdapter` | 收敛信号提供者 |
| **God LLM** | 编排协调、分析态势、做出决策 | `GodAdapter` | **Sovereign Authority** -- 最终决策者 |
| **Human** | 启动任务、中断干预、回答澄清 | CLI / Ctrl+C / 文本输入 | 可中断流程，God 决定如何响应 |

### 协作规则

1. **God 是唯一决策者**：所有状态变更（路由、收敛、中止）必须通过 God 的结构化 `GodAction` 表达
2. **Reviewer 是收敛信号源**：God 参考 Reviewer 的反馈，但保留 override 权力
3. **Coder 和 Reviewer 是 Worker**：在 God 管理下工作，不具备 accept authority
4. **God 不向人类求助**：God 自主解决 Worker 提出的实现细节问题，仅在真正无法解决时才 `request_user_input`
5. **Reviewer 反馈直传**：Reviewer 的原始分析直接注入 Coder 的 prompt，God 只提供路由指导而不复述 Reviewer 的分析
6. **设计决策需要共识**：当 Coder 提出多个方案时，God 必须路由给 Reviewer 评估，不可自行选择

### Tri-Party Session 隔离

`src/god/tri-party-session.ts` 负责三方会话管理：

- 每方独立的 session ID（`coderSessionId` / `reviewerSessionId` / `godSessionId`）
- 即使 Coder 和 Reviewer 使用相同 CLI 工具，也通过独立 adapter 实例保证隔离
- 每方独立恢复 -- 一方失败不影响其他方（fault tolerance）
- God 在 resume 时可选择恢复会话或全新开始

---

## 数据流全景

### 完整会话数据流 (Observe → Decide → Act)

```
用户输入任务
    │
    v
┌──────────────┐     SessionConfig     ┌────────────────┐
│  CLI 入口     │ ─────────────────────>│ App.tsx (OpenTUI)│
└──────────────┘                       └───────┬────────┘
                                               │
                                               v
                                    ┌─────────────────────┐
                               ┌──> │  CODING              │ Coder 编码
                               │    │  CLIAdapter.execute() │
                               │    └──────────┬──────────┘
                               │               │ coderOutput
                               │               v
                               │    ┌─────────────────────┐
                               │    │  OBSERVING           │ 收集 Observation
                               │    │  observation-        │ (observation-factory.ts
                               │    │  factory.ts          │  创建, God 直接解读)
                               │    └──────────┬──────────┘
                               │               │ Observation[]
                               │               v
                               │    ┌─────────────────────┐
                               │    │  GOD_DECIDING        │ God 统一决策
                               │    │  god-decision-       │ observations + context
                               │    │  service.ts          │ → GodDecisionEnvelope
                               │    └──────────┬──────────┘
                               │               │ GodDecisionEnvelope
                               │               │   { diagnosis,
                               │               │     actions[], messages[] }
                               │               v
                               │    ┌─────────────────────┐
                               │    │  EXECUTING           │ Hand 执行器
                               │    │  hand-executor.ts    │ GodAction[] → 执行
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
          │           │  │           │  │  (final)   │  │(多轮问答) │  │ (re-enter) │
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
│    │     - Active Role                        │
│    │     - Available Adapters                 │
│    │     - Observations (severity 排序)        │
│    │     - Hand Action Catalog (5 种动作)      │
│    ├── collectGodAdapterOutput()              │
│    │     - GodAdapter.execute() (10min timeout)│
│    │     - System Prompt (内联于 service)      │
│    └── extractGodJson() + Zod 校验            │
│                                               │
│  Step 2: (失败时) Watchdog retry + backoff    │
│    └── WatchdogService.shouldRetry()          │
│          - 连续失败计数                        │
│          - 指数退避: 2s, 4s, 8s (上限 10s)     │
│          - 最多 3 次重试后 pause               │
│                                               │
│  Step 3: 重试失败 → fallback envelope         │
│    └── buildFallbackEnvelope()                │
│          - 含 wait action (防空结果死亡螺旋)   │
│                                               │
│  最大 AI 调用: God(1) + Retry(1) = 2          │
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
executeSingleAction()
    │
    ├── send_to_coder:     ctx.pendingCoderMessage = msg
    │                      ctx.pendingCoderDispatchType = dispatchType
    ├── send_to_reviewer:  ctx.pendingReviewerMessage = msg
    ├── accept_task:       ctx.taskCompleted = true + 审计日志
    ├── wait:              ctx.waitState.active = true
    └── request_user_input: ctx.clarificationState.active = true
    │
    v
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
└──────────────────────────────┘
```

---

## XState v5 状态机详解

### 10 个状态

基于 XState v5 的 `workflowMachine`，定义在 `src/engine/workflow-machine.ts`：

```
                         START_TASK
┌──────┐ ─────────────────────────────────> ┌──────────────┐
│ IDLE │                                    │ GOD_DECIDING │
└──┬───┘                                    └──────┬───────┘
   │                                               │
   │ RESUME_SESSION                         DECISION_READY
   v                                               │
┌──────────┐                                       v
│ RESUMING │                               ┌───────────┐
└──────────┘                          ┌──> │ EXECUTING │ ──────┐
  RESTORED_TO_*                       │    └─────┬─────┘       │
  → 对应状态                          │          │     (default:│
                                      │   EXECUTION_COMPLETE   │
                                      │          │     re-enter)
                               ┌──────┼──────────┼─────────────┘
                               │      │    ┌─────┴──────────┐
                               │      │    │ 路由分支 (guards)│
                               │      │    └─┬──┬──┬──┬──┬──┘
                               │      │      │  │  │  │  │
      ┌──────────────────── CODING ───┘      │  │  │  │  │
      │                                      │  │  │  │  │
      │ CODE_COMPLETE         REVIEWING ─────┘  │  │  │  │
      │ (clear observations)                    │  │  │  │
      │                                   DONE ─┘  │  │  │
      v                                            │  │  │
┌───────────┐                           CLARIFYING─┘  │  │
│ OBSERVING │                                         │  │
└─────┬─────┘                          GOD_DECIDING ──┘  │
      │                                                   │
OBSERVATIONS_READY                                        │
      │                                                   │
      v                                                   │
┌──────────────┐    PAUSE_REQUIRED     ┌──────────┐       │
│ GOD_DECIDING │ ─────────────────────>│  PAUSED  │       │
└──────────────┘                       └────┬─────┘       │
                                            │             │
                                     USER_CONFIRM         │
                                       │        │        │
                                  accept    continue ────┘
                                       │
                                       v
                                   ┌────────┐
     ┌───────────┐                 │  DONE  │ (final)
     │ REVIEWING │                 └────────┘
     └─────┬─────┘
           │
    REVIEW_COMPLETE
    (clear observations)
           │
           v
     ┌───────────┐    OBSERVATIONS_READY
     │ OBSERVING │ ──────────────────────> GOD_DECIDING
     └───────────┘

┌────────────┐
│ CLARIFYING │  OBSERVATIONS_READY → GOD_DECIDING
│            │  (用户回答 → God 再问或恢复工作)
└────────────┘

┌─────────┐
│  ERROR  │ <── PROCESS_ERROR / TIMEOUT (from CODING / REVIEWING /
└────┬────┘     OBSERVING / GOD_DECIDING / EXECUTING / RESUMING)
     │
     │ RECOVERY
     v
  GOD_DECIDING
```

### 状态说明

| 状态 | 类型 | 说明 |
|------|------|------|
| `IDLE` | 初始 | 等待 `START_TASK` 或 `RESUME_SESSION` |
| `CODING` | 活跃 | Coder 正在执行编码任务 |
| `REVIEWING` | 活跃 | Reviewer 正在执行审查任务 |
| `OBSERVING` | 过渡 | 收集 Observation（Coder/Reviewer 输出） |
| `GOD_DECIDING` | 过渡 | God 分析所有 Observation，输出 GodDecisionEnvelope |
| `EXECUTING` | 过渡 | Hand 执行器逐个执行 GodAction，产生结果 Observation |
| `CLARIFYING` | 等待 | God 通过 `request_user_input` 向人类提问，等待回答 |
| `PAUSED` | 等待 | Watchdog retries 耗尽，需人工确认 |
| `RESUMING` | 过渡 | 从持久化快照恢复会话，按 `RESTORED_TO_*` 路由到对应状态 |
| `DONE` | 终态 | 任务完成 |
| `ERROR` | 错误 | 进程错误/超时，可通过 `RECOVERY` 恢复到 `GOD_DECIDING` |

> **已移除的状态**：`TASK_INIT`（God 不再需要预分析任务意图，直接从 GOD_DECIDING 开始）、`INTERRUPTED`（中断处理简化，不再需要独立状态）

### 事件类型

| 事件 | 源状态 | 目标状态 | 说明 |
|------|--------|---------|------|
| `START_TASK` | IDLE | GOD_DECIDING | 用户启动任务，设置 `taskPrompt` |
| `CODE_COMPLETE` | CODING | OBSERVING | Coder 输出完成，清空旧 observations |
| `REVIEW_COMPLETE` | REVIEWING | OBSERVING | Reviewer 输出完成，清空旧 observations |
| `OBSERVATIONS_READY` | OBSERVING / CLARIFYING | GOD_DECIDING | Observation 收集完成，送 God 决策 |
| `DECISION_READY` | GOD_DECIDING | EXECUTING | God 返回 GodDecisionEnvelope |
| `EXECUTION_COMPLETE` | EXECUTING | (多目标) | Hand 执行完毕，按 guard 路由到目标状态 |
| `USER_CONFIRM` | PAUSED | DONE / GOD_DECIDING | 用户确认 accept 或 continue |
| `PAUSE_REQUIRED` | GOD_DECIDING | PAUSED | Watchdog retries 耗尽需人工介入 |
| `PROCESS_ERROR` | 多个状态 | ERROR | 进程错误 |
| `TIMEOUT` | CODING / REVIEWING | ERROR | 进程超时 |
| `RECOVERY` | ERROR | GOD_DECIDING | 错误恢复 |
| `RESUME_SESSION` | IDLE | RESUMING | 恢复会话 |
| `RESTORED_TO_CODING` | RESUMING | CODING | 恢复到 CODING 状态 |
| `RESTORED_TO_REVIEWING` | RESUMING | REVIEWING | 恢复到 REVIEWING 状态 |
| `RESTORED_TO_WAITING` | RESUMING | GOD_DECIDING | 恢复到 GOD_DECIDING 状态 |
| `RESTORED_TO_CLARIFYING` | RESUMING | CLARIFYING | 恢复到 CLARIFYING 状态 |

### EXECUTION_COMPLETE 路由守卫

`EXECUTION_COMPLETE` 通过 `resolvePostExecutionTarget()` 函数和 5 个 guard 决定目标状态：

| Guard | 条件 | 目标 | 说明 |
|-------|------|------|------|
| `executionTargetCoding` | actions 含 `send_to_coder` | `CODING` | 设置 `activeProcess = 'coder'` |
| `executionTargetReviewing` | actions 含 `send_to_reviewer` | `REVIEWING` | 设置 `activeProcess = 'reviewer'` |
| `executionTargetDone` | actions 含 `accept_task` | `DONE` | 任务完成 |
| `executionTargetClarifying` | actions 含 `request_user_input` | `CLARIFYING` | God 向人类提问 |
| (default) | 其他（`wait` 等） | `GOD_DECIDING` | re-enter 决策循环，保留现有 observations |

### WorkflowContext 完整字段

```typescript
interface WorkflowContext {
  taskPrompt: string | null;              // 任务描述
  activeProcess: 'coder' | 'reviewer' | null;  // 当前活跃进程
  lastError: string | null;              // 最近错误
  lastCoderOutput: string | null;        // Coder 最近输出
  lastReviewerOutput: string | null;     // Reviewer 最近输出
  sessionId: string | null;              // 会话 ID
  currentObservations: Observation[];    // 当前 Observation 列表
  lastDecision: GodDecisionEnvelope | null;  // 最近 God 决策
}
```

> **已移除的字段**：`consecutiveRouteToCoder`（circuit breaker 计数器移除）、`pendingPhaseId` / `pendingPhaseSummary`（phase 系统移除）、`incidentCount`（事件计数移除）、`frozenActiveProcess`（冻结进程移除）、`clarificationRound` / `clarificationObservations`（澄清累积移除）

---

## God LLM 决策循环

### 设计原则

1. **Sovereign Authority**：God 是运行时唯一决策者，所有状态变更必须通过结构化 `GodAction` 表达
2. **统一决策信封**：`GodDecisionEnvelope` 统一所有决策场景 — 一个入口（`makeDecision`），一种输出格式
3. **God 直接解读**：Worker 输出不再经过正则分类预处理，God LLM 直接解读原始内容
4. **Retry + Pause（不降级）**：God 失败时通过 Watchdog retry + exponential backoff 恢复，retries 耗尽后 pause 等待人工介入，不存在 "降级模式"

### Observe → Decide → Act 循环

这是 God Runtime 的核心循环：

```
      ┌─────────────────────────────────────────────────────┐
      │                                                     │
      │              Observe → Decide → Act                 │
      │                                                     │
      │  ┌───────────┐    ┌──────────────┐    ┌───────────┐│
      │  │  OBSERVE  │───>│    DECIDE    │───>│    ACT    ││
      │  │           │    │              │    │           ││
      │  │ Factory   │    │ God analyzes │    │ Execute   ││
      │  │ creates   │    │ observations │    │ GodActions││
      │  │ Observation│    │ + context    │    │ via Hand  ││
      │  │ from      │    │ → outputs    │    │ Executor  ││
      │  │ worker    │    │ Envelope     │    │ → results ││
      │  │ output    │    │              │    │           ││
      │  └───────────┘    └──────────────┘    └─────┬─────┘│
      │       ^                                      │      │
      │       │                                      │      │
      │       └──────────────────────────────────────┘      │
      │              result observations feed back          │
      └─────────────────────────────────────────────────────┘
```

#### Phase 1: OBSERVE（观测）

`src/god/observation-factory.ts`

- **输入**：Coder/Reviewer 的原始输出、人类消息/中断、运行时错误
- **处理**：工厂函数直接创建 Observation（无正则分类，无 LLM 调用）
- **输出**：`Observation[]`，按 severity 排序（fatal > error > warning > info）
- **去重**：`deduplicateObservations()` 按 `timestamp-source-type` key 去重

**6 种 Observation 类型**：

| 类型 | 来源 | 严重性 | 说明 |
|------|------|--------|------|
| `work_output` | coder | info | Coder 的工作输出 |
| `review_output` | reviewer | info | Reviewer 的审查输出 |
| `human_message` | human | info | 用户文本消息 |
| `human_interrupt` | human | info | 用户中断信号 |
| `runtime_error` | runtime | error | 运行时错误 |
| `phase_progress_signal` | runtime | info | 阶段进度信号（Hand 执行结果） |

> **已移除的 Observation 类型**：`quota_exhausted`、`auth_failed`、`adapter_unavailable`、`empty_output`、`meta_output`、`tool_failure`、`clarification_answer`、`runtime_invariant_violation`（正则分类器移除后，这些细粒度类型不再需要，God 直接从原始内容中判断情况）

#### Phase 2: DECIDE（决策）

`src/god/god-decision-service.ts`

- **输入**：`Observation[]` + `GodDecisionContext`
- **处理**：
  1. 构建 User Prompt（Task Goal / Active Role / Available Adapters / Observations / Hand Catalog）
  2. 调用 God Adapter（system prompt 内联于 `god-decision-service.ts`，直接描述 5 种 action）
  3. 提取 JSON + Zod schema 校验 → `GodDecisionEnvelope`
  4. 失败时 Watchdog retry with backoff，retries 耗尽则返回 fallback envelope
- **输出**：`GodDecisionEnvelope`

God 的 system prompt 核心指令：
- 路由工作直到任务完成
- Coder 多方案时先送 Reviewer 评估
- 确认 Reviewer 反馈（`diagnosis.notableObservations`）
- 路由指导而非复述 Reviewer 分析
- 自主决策，极少求助人类
- 输出格式：单一 JSON code block

#### Phase 3: ACT（执行）

`src/god/hand-executor.ts`

- **输入**：`GodAction[]`（从 GodDecisionEnvelope.actions 中提取）
- **处理**：逐个执行 action，直接 switch-case 分发（无 rule engine 前置校验）
- **输出**：`Observation[]`（执行结果，反馈回状态机）

### GodDecisionEnvelope 结构

所有 God 决策通过统一的 Envelope 表达（定义在 `src/types/god-envelope.ts`，Zod schema 校验）：

```
GodDecisionEnvelope
├── diagnosis                        God 对当前态势的诊断
│   ├── summary: string              情况评估摘要
│   ├── currentGoal: string          当前目标
│   └── notableObservations: string[]  驱动本次决策的关键观察
│
├── actions: GodAction[]             结构化动作列表 (5 种 Hand Action)
│
└── messages: EnvelopeMessage[]      消息列表
    └── { target: 'coder'|'reviewer'|'user'|'system_log', content }
```

> **已移除的字段**：`authority`（权限声明及其 Zod superRefine 约束全部移除）、`autonomousResolutions`（God 代理决策记录移除）、`diagnosis.currentPhaseId`（phase 系统移除）

### 5 种 Hand Action（GodAction）

定义在 `src/types/god-actions.ts`，使用 Zod discriminated union：

| Action | 参数 | 状态机效果 |
|--------|------|-----------|
| `send_to_coder` | `{ dispatchType: 'explore'\|'code'\|'debug'\|'discuss', message }` | → CODING |
| `send_to_reviewer` | `{ message }` | → REVIEWING |
| `accept_task` | `{ summary }` | → DONE |
| `wait` | `{ reason, estimatedSeconds? }` | re-enter GOD_DECIDING |
| `request_user_input` | `{ question }` | → CLARIFYING |

`send_to_coder` 的 `dispatchType` 控制 Coder 的工作模式：
- `explore`：只读调查，不修改文件
- `discuss`：评估选项，推荐方案
- `code`：实现、重构、写测试（允许修改文件）
- `debug`：诊断并最小化修复（窄范围修改）

> **已移除的 Action**：`stop_role`、`retry_role`、`switch_adapter`、`set_phase`、`resume_after_interrupt`、`emit_summary`（6 种 action 移除，从 11 种简化到 5 种）

### 4 种 Task Type

定义在 `src/types/god-schemas.ts`：

| TaskType | 说明 |
|----------|------|
| `explore` | 只读调查 |
| `code` | 编码实现 |
| `debug` | 调试修复 |
| `discuss` | 方案讨论 |

> **已移除的 TaskType**：`review`、`compound`（`compound` 类型及其 phases 系统全部移除）

### Rule Engine（规则引擎）

`src/god/rule-engine.ts` -- 同步执行（< 5ms），block 级别规则具有绝对优先级：

| 规则 | 级别 | 说明 |
|------|------|------|
| R-001 | block | 禁止写入 `~/Documents` 目录之外 |
| R-002 | block | 禁止访问系统关键目录（`/etc`, `/usr`, `/bin`, `/System`, `/Library`），含 symlink 解析 |
| R-003 | block | 禁止可疑网络外传（curl 带 `-d @` 等） |
| R-004 | warn | God 批准但 Rule Engine 阻止的矛盾检测 |
| R-005 | warn | Coder 修改 `.duo/` 配置目录 |

> **注意**：Rule Engine 仍然存在，但 Hand Executor 不再将其作为 action 执行的前置校验。Rule Engine 作为独立的安全组件提供文件/命令级别的安全检查。

### Watchdog 服务

`src/god/watchdog.ts` -- 简单的 retry + backoff + pause 机制：

```
God 决策失败
    │
    v
┌────────────────────────────────┐
│  WatchdogService               │
│                                │
│  核心原则: LLM down = pause    │
│            不降级，不猜测       │
│                                │
│  retry + exponential backoff:  │
│  ├── 第 1 次重试: 2s 后        │
│  ├── 第 2 次重试: 4s 后        │
│  └── 第 3 次重试: 8s 后        │
│                                │
│  3 次重试后:                    │
│  └── paused = true             │
│      → PAUSED 状态，等人工介入  │
│                                │
│  成功后:                        │
│  └── 重置失败计数               │
└────────────────────────────────┘
```

### God 子系统全景

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Sovereign God Runtime                               │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Decision Pipeline (统一决策管道)                                  │   │
│  │                                                                    │   │
│  │  observation-factory.ts        Observation 创建 (工厂函数)         │   │
│  │        │                                                           │   │
│  │        v                                                           │   │
│  │  god-decision-service.ts      makeDecision(obs, ctx) → Envelope  │   │
│  │        │                      (system prompt 内联)                 │   │
│  │        v                                                           │   │
│  │  hand-executor.ts             executeActions(actions) → obs[]     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Adapter Layer (God 专用适配器)                                   │   │
│  │                                                                    │   │
│  │  god-call.ts                  collectGodAdapterOutput (统一调用)   │   │
│  │  god-adapter-factory.ts       创建 GodAdapter 实例                │   │
│  │  god-adapter-config.ts        配置 + resume 兼容性                │   │
│  │  adapters/                    claude-code / codex / gemini         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Resilience & Safety (容错与安全)                                  │   │
│  │                                                                    │   │
│  │  watchdog.ts                  retry + backoff + pause             │   │
│  │  rule-engine.ts               R-001..R-005 安全校验               │   │
│  │  god-fallback.ts (ui/)        withRetry — 简单重试包装器          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Session & Messaging (会话与消息)                                  │   │
│  │                                                                    │   │
│  │  tri-party-session.ts         Coder/Reviewer/God 三方会话隔离      │   │
│  │  message-dispatcher.ts        消息分发器                           │   │
│  │  god-prompt-generator.ts      Coder/Reviewer prompt 生成          │   │
│  │  god-session-persistence.ts   God 会话持久化                      │   │
│  │  god-audit.ts                 审计日志 (append-only JSONL)         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 关键设计模式

### 1. Sovereign Authority 模式

God LLM 是系统中唯一的决策者。所有状态变更（路由、收敛、中止）必须通过结构化 `GodAction` 表达，不允许通过自然语言消息暗示状态变更。

### 2. Envelope 模式（统一决策信封）

`GodDecisionEnvelope` 统一所有决策场景：
- 一个入口（`makeDecision`），一种输出格式
- 通过 `actions[]` 的组合表达任意决策
- 3 个顶层字段：`diagnosis`、`actions`、`messages`

### 3. Observation Factory 模式

所有来源的输出（Coder / Reviewer / 人类消息 / 错误）通过 `observation-factory.ts` 的工厂函数统一创建为 `Observation` 对象，再流入 God 决策管道。God 直接解读 Observation 内容，不依赖预分类标签。

### 4. Hand 模式（结构化动作目录）

God 的决策通过 5 种预定义的 Hand Action 表达，每种 action 有明确的参数和执行语义。Hand Executor 逐个执行 action，通过 switch-case 直接分发。

### 5. Retry + Pause 模式（替代降级）

God 失败时不降级，而是通过 Watchdog 进行简单的 retry + exponential backoff：
- 最多 3 次重试（2s → 4s → 8s），backoff 上限 10s
- 重试耗尽 → pause，等待人工确认（continue / accept）
- 成功后立即重置失败计数器
- **核心原则：LLM down = system pause，不存在降级模式**

### 6. Fallback Envelope 安全设计

God 决策失败时的 fallback envelope 包含一个 `wait` action（而非空 actions），防止 "empty actions → empty results → lost observations" 的死亡螺旋。EXECUTING 状态在结果为空时保留现有 observations。

### 7. CLARIFYING 多轮澄清模式

God 可通过 `request_user_input` action 进入 `CLARIFYING` 状态：
- 用户回答 → Observation → GOD_DECIDING
- God 可继续提问（再次 `request_user_input`）或恢复工作

### 8. GodAdapter 与 CLIAdapter 接口分离

`GodAdapter`（`src/types/god-adapter.ts`）独立于 `CLIAdapter`（`src/types/adapter.ts`）：

```typescript
// CLIAdapter — 用于 Coder / Reviewer
interface CLIAdapter {
  execute(prompt: string, opts: ExecOptions): AsyncIterable<OutputChunk>;
}

// GodAdapter — 用于 God
interface GodAdapter {
  execute(prompt: string, opts: GodExecOptions): AsyncIterable<OutputChunk>;
  clearSession?(): void;          // 清空会话状态，强制全新调用
  readonly toolUsePolicy?: GodToolUsePolicy;   // 'forbid' | 'allow-readonly'
  readonly minimumTimeoutMs?: number;           // 确保足够推理时间
}
```

### 9. Dynamic Model Discovery

`src/adapters/model-discovery.ts` 为各 CLI adapter 提供动态模型发现，结果在模块作用域缓存：
- **Codex**：读取 `~/.codex/models_cache.json`，按 visibility/priority 过滤排序
- **Gemini**：通过 `createRequire` 从安装的 `@google/gemini-cli-core` 包读取 `VALID_GEMINI_MODELS`
- **Claude Code**：使用 CLI 稳定别名（sonnet / opus / haiku）
- 所有列表末尾追加 `__custom__` sentinel，允许用户手动输入 model ID

---

## 技术栈

### 核心依赖

| 技术 | 版本 | 用途 |
|------|------|------|
| **TypeScript** | ESM (`"type": "module"`) | 主语言，全量类型安全 |
| **XState** | v5 (^5.28.0) | 状态机引擎，驱动工作流 |
| **@xstate/react** | ^6.1.0 | XState 与 React 集成 |
| **React** | ^19.2.4 | UI 组件框架 |
| **Bun OpenTUI** | `@opentui/core` + `@opentui/react` | 终端 UI 渲染运行时（替代 Ink） |
| **Bun** | - | TUI 进程运行时（通过 `bun-launcher.ts` 启动） |
| **Zod** | ^4.3.6 | Schema 定义与运行时校验 |

### 开发工具

| 工具 | 版本 | 用途 |
|------|------|------|
| **tsup** | ^8.5.1 | TypeScript 打包（ESM 输出） |
| **tsx** | - | 开发模式运行 |
| **Vitest** | - | 单元测试框架 |
| **ESLint** | ^10.0.3 | 代码质量检查 |

### 运行时架构

- **双进程模型**：CLI 入口在 Node.js 中运行，TUI 渲染在 Bun 进程中运行（通过 `spawnSync` 交接，`stdio: 'inherit'`）；LLM 调用严格串行执行（1 LLM process at a time），避免并发冲突
- **持久化**：原子写入（write-tmp-rename），会话快照存储在 `.duo/sessions/<id>/`
- **审计**：God 审计日志使用 append-only JSONL 格式
- **Prompt 日志**：所有 God 调用的 prompt 记录，用于调试和追溯
- **CLI 适配**：支持多种 AI CLI 工具，通过统一 `CLIAdapter` 接口抽象
- **解析器**：3 种输出格式解析器（stream-json / jsonl / text），覆盖所有主流 AI CLI 工具

### 模块依赖方向

```
cli.ts (Node.js) ──> cli-commands.ts
  │                       │
  │                       ├── session/session-starter.ts
  │                       ├── session/session-manager.ts
  │                       ├── adapters/detect.ts
  │                       └── god/god-audit.ts
  │
  └──> tui/runtime/bun-launcher.ts ──> (spawnSync Bun)
                                          │
                                    tui/cli.tsx (Bun)
                                          │
                                          └──> ui/components/App.tsx
          │
          ├── engine/workflow-machine.ts (XState v5)
          │
          ├── god/observation-factory.ts
          │
          ├── god/god-decision-service.ts ────> god/god-call.ts
          │       │                                   │
          │       ├── parsers/god-json-extractor.ts   └── types/god-adapter.ts
          │       ├── types/god-envelope.ts
          │       └── god/watchdog.ts
          │
          ├── god/hand-executor.ts
          │
          ├── god/tri-party-session.ts
          ├── god/message-dispatcher.ts
          ├── god/god-prompt-generator.ts
          ├── god/god-session-persistence.ts
          │
          ├── ui/god-fallback.ts (withRetry)
          │
          ├── adapters/factory.ts ──> adapters/process-manager.ts
          │                           adapters/{cli}/adapter.ts
          ├── adapters/registry.ts
          ├── adapters/model-discovery.ts
          │
          ├── session/session-manager.ts
          │
          └── types/ (adapter, session, god-adapter, god-actions,
                      god-envelope, observation, god-schemas)
```

**依赖方向原则**：

- **上层 → 下层**：严格单向依赖，上层可以依赖下层，反之不行
- **types/ 是最底层**：不依赖任何其他模块，被所有层共享
- **god/ 不依赖 ui/**：God Runtime 与 UI 解耦，通过 App.tsx 集成
- **engine/ 不依赖 god/**：状态机只定义状态和事件，不包含业务逻辑
- **adapters/ 不依赖 god/**：Adapter 层只负责工具统一接口，不参与决策

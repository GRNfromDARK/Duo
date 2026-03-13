# Duo 系统架构

## 分层架构

Duo 采用七层架构，自顶向下职责分明，层间单向依赖：

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Layer 1: TUI (Ink/React)                        │
│  App.tsx, MainLayout, StatusBar, MessageView, StreamRenderer, ...    │
│  纯展示层，React 组件化，响应状态变化                                    │
├──────────────────────────────────────────────────────────────────────┤
│                      Layer 2: UI State                               │
│  scroll-state, overlay-state, display-mode, keybindings,             │
│  session-runner-state, message-lines, directory-picker-state         │
│  纯函数状态模块，驱动 UI 组件渲染                                       │
├──────────────────────────────────────────────────────────────────────┤
│                  Layer 3: Workflow Engine (xstate v5)                 │
│  workflow-machine.ts (11 states, 20+ events, 7 guards)               │
│  interrupt-handler.ts (Ctrl+C / text interrupt / double-exit)        │
│  编排 IDLE→CODING→REVIEWING→EVALUATING→DONE 全生命周期                │
├──────────────────────────────────────────────────────────────────────┤
│                    Layer 4: Context Manager                          │
│  context-manager.ts — Coder/Reviewer prompt 构建                     │
│  模板解析、历史摘要（最近 3 轮完整 + 旧轮摘要）、Token 预算（80%）        │
│  自定义模板加载、Previous Feedback Checklist、key points 提取          │
├──────────────────────────────────────────────────────────────────────┤
│                    Layer 5: CLI Adapter Layer                         │
│  CLIAdapter 接口 → 12 个具体 Adapter 实现                              │
│  registry.ts (注册表), factory.ts (工厂), detect.ts (自动检测)         │
│  output-stream-manager.ts (多消费者广播)                               │
│  process-manager.ts (子进程生命周期)                                    │
│  env-builder.ts (环境变量隔离)                                         │
├──────────────────────────────────────────────────────────────────────┤
│                Layer 6: Session / Persistence Layer                   │
│  session-starter.ts — 参数解析、配置验证、会话创建                       │
│  session-manager.ts — snapshot.json 原子写入、history.jsonl 追加、     │
│                       legacy 格式兼容、崩溃容错                         │
├──────────────────────────────────────────────────────────────────────┤
│                    Layer 7: Decision Service                         │
│  convergence-service.ts — 收敛分类 / 终止判定 / 循环检测 / 趋势分析     │
│  choice-detector.ts — 选择题模式检测 / 转发 prompt 构建                 │
└──────────────────────────────────────────────────────────────────────┘
```

## 各层职责

### Layer 1: TUI（展示层）

- **技术**: Ink 6 + React 19
- **职责**: 纯 UI 渲染，不包含业务逻辑
- **核心组件**:
  - `App.tsx` — 根组件，连接 xstate 状态机与 UI
  - `MainLayout.tsx` — [NEW] 主布局组件，统一页面结构
  - `StreamRenderer.tsx` — 实时流式输出渲染
  - `MessageView.tsx` — 消息展示（Coder / Reviewer 输出）
  - `StatusBar.tsx` — 状态栏（当前状态、轮次、活跃进程）
  - `CodeBlock.tsx` — 代码块语法高亮渲染
  - `ConvergenceCard.tsx` / `DisagreementCard.tsx` — 收敛/分歧结果展示
  - `InputArea.tsx` — 用户输入区域
  - Overlay 系列 — `HelpOverlay`, `ContextOverlay`, `TimelineOverlay`, `SearchOverlay`
  - `DirectoryPicker.tsx` — 交互式目录选择器
  - `ScrollIndicator.tsx` / `SystemMessage.tsx` — 辅助展示组件
- **设计原则**: 组件只通过 props/hooks 接收数据，不直接调用 adapter 或 engine

### Layer 2: UI State（UI 状态层）

- **职责**: 为 TUI 组件提供纯函数状态管理
- **模块**:
  - `scroll-state.ts` — 滚动状态（offset/viewportHeight/totalLines/autoFollow）
  - `overlay-state.ts` — Overlay 弹出层状态
  - `display-mode.ts` — 显示模式切换（normal/verbose/minimal 等）
  - `keybindings.ts` — 快捷键定义
  - `session-runner-state.ts` — 会话运行状态
  - `directory-picker-state.ts` — 目录选择器状态
  - `round-summary.ts` — 轮次摘要
  - `markdown-parser.ts` — Markdown 解析渲染
  - `git-diff-stats.ts` — Git diff 统计信息
  - `message-lines.ts` — [NEW] 消息行处理
- **设计原则**: 所有模块导出纯函数，输入确定则输出确定，便于 vitest 单元测试

### Layer 3: Workflow Engine（工作流引擎）

- **技术**: xstate v5 状态机
- **职责**: 编排 Coder-Reviewer 协作循环的完整生命周期
- **核心文件**:
  - `workflow-machine.ts` — 状态机定义（11 states, 20+ events, 7 guards），详见 [状态机详解](#状态机详解)
  - `interrupt-handler.ts` — 中断处理
- **InterruptHandler 职责**:
  - 单击 Ctrl+C：kill 当前 LLM 进程 -> INTERRUPTED 状态 -> 保留已输出内容
  - 文本中断：用户在 LLM 运行时输入文字 -> kill + 附加指令
  - 双击 Ctrl+C（<500ms）：保存会话状态 -> 退出应用
  - `handleUserInput` 恢复：从 INTERRUPTED 状态恢复到 CODING/REVIEWING/WAITING_USER
- **与 UI 的集成**: 通过 `@xstate/react` hooks（`useMachine`/`useActor`）在 React 组件中消费状态

### Layer 4: Context Manager（上下文管理层）

- **职责**: 为每一轮 Coder/Reviewer 调用构建最优 prompt
- **核心类**: `ContextManager`
- **功能**:
  - `buildCoderPrompt()` — 构建 Coder prompt：系统角色 + 任务 + 历史 + Reviewer 反馈 + 中断指令 + "不要提问" 指令
  - `buildReviewerPrompt()` — 构建 Reviewer prompt：系统角色 + 任务 + 历史 + Coder 输出 + Progress Checklist + 结构化输出格式要求（Blocking/Non-blocking/Verdict）
  - `generateSummary()` — 摘要生成：优先提取结构化 key points（verdict/blocking/issue），不足时截断（<=200 tokens）
  - Previous Feedback Checklist — 从上轮 Reviewer 输出提取分组问题（Location/Problem/Fix），生成逐项验证清单
  - Token 预算：最近 3 轮完整历史 + 旧轮次摘要，总量 <= 80% context window
  - 自定义模板：从 `.duo/prompts/coder.md` / `reviewer.md` 加载，`{{key}}` 占位符单次 pass 替换（防注入）
  - 多字节安全截断：使用 `Array.from()` 按完整字符截断，不破坏 CJK 字符

### Layer 5: CLI Adapter Layer（适配器层）

- **技术**: 插件架构，统一的 `CLIAdapter` 接口
- **职责**: 将 12 种不同的 AI CLI 工具抽象为统一的调用接口
- **核心接口**:
  ```typescript
  interface CLIAdapter {
    readonly name: string;
    readonly displayName: string;
    readonly version: string;
    isInstalled(): Promise<boolean>;
    getVersion(): Promise<string>;
    execute(prompt: string, opts: ExecOptions): AsyncIterable<OutputChunk>;
    kill(): Promise<void>;
    isRunning(): boolean;
  }
  ```
- **组成模块**:
  - `registry.ts` — 12 个工具的静态注册表（name/command/detectCommand/execCommand/outputFormat/yoloFlag/parserType）
  - `detect.ts` — 并行检测已安装的 CLI 工具（`Promise.all`，3s 超时），支持 `.duo/adapters.json` 自定义适配器和禁用列表
  - `factory.ts` — 按名称创建 adapter 实例
  - `output-stream-manager.ts` — 多消费者广播：将 `AsyncIterable<OutputChunk>` 分发给多个消费者（UI 渲染 + 缓冲），支持中断后保留已接收输出
  - `process-manager.ts` — [NEW] 子进程生命周期管理，详见下方
  - `env-builder.ts` — [NEW] 环境变量隔离构建，详见下方
- **Parser 类型**:
  - `StreamJsonParser` — NDJSON stream-json 格式（Claude Code、Gemini、Amp、Qwen）
  - `JsonlParser` — JSONL/--json 格式（Codex、Cline、Copilot、Cursor、Continue）
  - `TextStreamParser` — 纯文本流，正则提取代码块 + 错误模式检测（Aider、Amazon Q、Goose）
  - 所有 parser 均支持 `malformedLineCount` 畸形行计数（可观测性）

#### ProcessManager（进程管理器）

[NEW] 完整的子进程生命周期管理：

- **spawn**: detached 进程组（`detached: true`），独立 env/CWD，stdio 配置为 `['ignore', 'pipe', 'pipe']`
- **kill**: 优雅退出序列 SIGTERM -> 5s grace period -> SIGKILL（发送到进程组 `-pid`），附加 3s SIGKILL 等待超时
- **timeout**: 可配置超时（默认 10 分钟），超时自动 kill
- **heartbeat**: 30s 间隔检测，60s 无输出发出 `heartbeat-warning` 事件
- **缓冲区**: 50MB 上限，超限时保留最新数据（join + slice）
- **父进程退出处理**: 注册 `process.on('exit')` handler，确保父进程退出时 SIGKILL 子进程
- **dispose()**: 清理所有 timer、listener、子进程引用，防止 listener 泄露
- **事件**: `process-error`、`process-complete`、`timeout`、`heartbeat-warning`

#### EnvBuilder（环境变量构建器）

[NEW] 为子进程构建最小化、显式的环境变量集：

- **BASE_ENV_VARS**: `PATH`、`HOME`、`SHELL`、`LANG`、`TERM`、`USER`、`LOGNAME`、`TMPDIR`、`XDG_*`、`LC_ALL`、`LC_CTYPE`
- **requiredVars**: 适配器需要的精确变量名（如 `ANTHROPIC_API_KEY`）
- **requiredPrefixes**: 前缀模式匹配（如 `ANTHROPIC_` 匹配所有 `ANTHROPIC_*` 变量）
- **extraEnv**: 适配器注入的额外变量（如 `GOOSE_MODE=auto`），优先级最高
- **返回** `{ env, replaceEnv: true }`，配合 `ProcessManager` 实现完整环境替换

### Layer 6: Session / Persistence Layer（会话持久化层）

- **职责**: 会话生命周期管理与数据持久化
- **SessionStarter**（`session-starter.ts`）:
  - `parseStartArgs()` — 解析 CLI argv（--dir/--coder/--reviewer/--task）
  - `validateProjectDir()` — 验证目录存在性、可访问性、是否为 git 仓库
  - `validateCLIChoices()` — 验证 Coder/Reviewer 选择（不能相同、必须已安装）
  - `createSessionConfig()` — 组合验证，返回 `StartResult`
- **SessionManager**（`session-manager.ts`）[NEW]:
  - 存储路径：`.duo/sessions/<uuid>/`
  - **文件格式**:
    - `snapshot.json` — 合并的 metadata + state（单个原子写入）
    - `history.jsonl` — 对话历史，每行一个 JSON 对象（append-only，无 read-modify-write 竞态）
    - Legacy 兼容：`session.json` + `state.json` + `history.json`（读写双向兼容）
  - **原子写入**: `atomicWriteSync()` — 写入 `.tmp` 文件然后 `rename`（Windows 兼容：先 unlink 目标再 rename）
  - **崩溃容错**: `loadHistory()` 对最后一行截断/畸形容忍（crash artifact），中间行损坏则抛出 `SessionCorruptedError`
  - **类型守卫**: `isValidSnapshot()` / `isValidHistoryEntry()` 运行时结构验证
  - **接口**: `createSession()` / `saveState()` / `addHistoryEntry()` / `loadSession()` / `validateSessionRestore()` / `listSessions()`

### Layer 7: Decision Service（决策服务层）

- **职责**: 判断协作是否收敛，检测选择题模式
- **ConvergenceService**（`convergence-service.ts`）[NEW]:
  - `classify()` — 分类 Reviewer 输出：
    - `approved`：检测到 `[APPROVED]` 标记
    - `soft_approved`：无 blocking issues + 匹配 soft approval 短语（LGTM、looks good to me、no more issues、ship it、代码已通过、可以合并等，含中文模式）
    - `changes_requested`：其他情况
  - `evaluate()` — 完整评估，返回 `ConvergenceResult`：
    - `shouldTerminate` + `reason`：approved / soft_approved / max_rounds / loop_detected / diminishing_issues
    - `loopDetected`：Jaccard 关键词相似度 >= 0.35（最近 4 轮 + 2+ 非连续旧轮匹配）
    - `issueCount`：优先解析 `Blocking: N` 行，fallback 到启发式标记计数（`**Blocking**` - `**Non-blocking**`）
    - `progressTrend`：improving / stagnant / unknown
    - `extractKeywords()`：英文词（>=3 字符，过滤 stop words） + CJK bigram（滑动窗口）+ CJK 单字（过滤停用字）
- **ChoiceDetector**（`choice-detector.ts`）:
  - `detect()` — 检测 LLM 输出中的选择题模式：
    - 支持格式：A/B/C、1/2/3、方案一/方案二、Option 1/2、Bullet list
    - 过滤代码块内的内容
    - 要求同时有问题行（`?`/`？` 或 choice-indicating phrases）和 >= 2 个选项
  - `buildForwardPrompt()` — 构建转发给对方 LLM 的作答 prompt

## 数据流

完整的一轮 code-review-evaluate 数据流：

```
用户输入 task
    │
    ▼
┌─ CLI 入口 (cli.ts) ─────────────────────────────────────────────┐
│  parseStartArgs() → detectInstalledCLIs() → createSessionConfig() │
│  render(App, { initialConfig, detected })                         │
└──────────────────────────────┬────────────────────────────────────┘
                               │ START_TASK event
                               ▼
┌─ Workflow Machine ───────────────────────────────────────────────┐
│  IDLE ──START_TASK──▶ CODING                                      │
│                         │                                         │
│    ContextManager.buildCoderPrompt(task, rounds, feedback)        │
│    Adapter.execute(prompt, { cwd, env, timeout })                 │
│         │                                                         │
│         ▼                                                         │
│    ┌─ ProcessManager ──────────────────────────────┐              │
│    │  spawn(cmd, args, { cwd, env: buildAdapterEnv() })          │
│    │  detached process group, heartbeat, timeout    │              │
│    └────────┬──────────────────────────────────────┘              │
│             ▼                                                     │
│    ┌─ Parser (stream-json / jsonl / text) ─────────┐              │
│    │  raw stdout → OutputChunk stream               │              │
│    └────────┬──────────────────────────────────────┘              │
│             ▼                                                     │
│    ┌─ OutputStreamManager ─────────────────────────┐              │
│    │  broadcast to consumers: UI + buffer           │              │
│    └────────┬──────────────────────────────────────┘              │
│             │ CODE_COMPLETE                                        │
│             ▼                                                     │
│  ROUTING_POST_CODE                                                │
│    ├── ROUTE_TO_REVIEW ──▶ REVIEWING                              │
│    │     ContextManager.buildReviewerPrompt(task, rounds, output) │
│    │     (含 Previous Feedback Checklist)                          │
│    │     同上 ProcessManager → Parser → OutputStreamManager 流程   │
│    │         │ REVIEW_COMPLETE                                    │
│    │         ▼                                                    │
│    │   ROUTING_POST_REVIEW                                        │
│    │     ├── ROUTE_TO_EVALUATE ──▶ EVALUATING                     │
│    │     │     ConvergenceService.evaluate(reviewerOutput, ctx)   │
│    │     │       ├── CONVERGED ──▶ WAITING_USER                   │
│    │     │       │     USER_CONFIRM(accept) ──▶ DONE              │
│    │     │       │     USER_CONFIRM(continue) ──▶ CODING          │
│    │     │       └── NOT_CONVERGED                                │
│    │     │             ├── canContinueRounds ──▶ CODING (round++) │
│    │     │             └── maxRoundsReached ──▶ WAITING_USER      │
│    │     └── ROUTE_TO_CODER ──▶ CODING                            │
│    └── CHOICE_DETECTED ──▶ WAITING_USER                           │
│                                                                   │
│  中断流:                                                          │
│    CODING/REVIEWING + Ctrl+C ──▶ INTERRUPTED                      │
│    INTERRUPTED + USER_INPUT ──▶ CODING/REVIEWING/WAITING_USER     │
│    双击 Ctrl+C ──▶ saveState() ──▶ exit                           │
│                                                                   │
│  恢复流:                                                          │
│    IDLE + RESUME_SESSION ──▶ RESUMING                              │
│    RESUMING + RESTORED_TO_* ──▶ 目标状态                           │
│                                                                   │
│  错误流:                                                          │
│    任何活跃状态 + PROCESS_ERROR/TIMEOUT ──▶ ERROR                  │
│    ERROR + RECOVERY ──▶ WAITING_USER                               │
└───────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─ TUI Layer ──────────────────────────────────────────────────────┐
│  StreamRenderer — 实时渲染流式 OutputChunk                         │
│  MessageView — 显示 Coder/Reviewer 消息（role 样式、border 区分）   │
│  StatusBar — 当前状态 / 轮次 / 活跃进程                            │
│  ConvergenceCard / DisagreementCard — 评估结果展示                 │
│  Overlay 面板 — Help / Context / Timeline / Search                │
└──────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─ Persistence ────────────────────────────────────────────────────┐
│  SessionManager.saveState() → snapshot.json (atomic write)        │
│  SessionManager.addHistoryEntry() → history.jsonl (append-only)   │
│  .duo/sessions/<uuid>/ 目录存储                                    │
└──────────────────────────────────────────────────────────────────┘
```

## 状态机详解

### 11 个状态

| 状态 | 说明 |
|------|------|
| `IDLE` | 初始状态，等待 `START_TASK` 或 `RESUME_SESSION` |
| `CODING` | Coder Agent 正在执行编码任务，`activeProcess = 'coder'` |
| `ROUTING_POST_CODE` | 编码完成后的路由中间态：检查是否有选择题，决定转入 REVIEWING 还是 WAITING_USER |
| `REVIEWING` | Reviewer Agent 正在执行 code review，`activeProcess = 'reviewer'` |
| `ROUTING_POST_REVIEW` | Review 完成后的路由中间态：转入 EVALUATING 或直接回到 CODING |
| `EVALUATING` | ConvergenceService 判断收敛性：CONVERGED -> WAITING_USER；NOT_CONVERGED -> CODING/WAITING_USER |
| `WAITING_USER` | 等待用户操作：`accept`（完成）或 `continue`（继续迭代） |
| `INTERRUPTED` | 用户主动中断（Ctrl+C），可选择恢复到 coder / reviewer / decision |
| `RESUMING` | 从持久化会话恢复中，根据保存的状态发出 `RESTORED_TO_*` 事件跳转 |
| `DONE` | 终态（final state），任务完成 |
| `ERROR` | 错误状态，可通过 `RECOVERY` 事件转入 `WAITING_USER` |

### 事件类型（20+ 种）

| 事件 | 说明 |
|------|------|
| `START_TASK` | 启动新任务，携带 prompt |
| `CODE_COMPLETE` | Coder 完成编码，携带 output |
| `REVIEW_COMPLETE` | Reviewer 完成审查，携带 output |
| `CONVERGED` | 收敛判定：代码通过审查 |
| `NOT_CONVERGED` | 未收敛：需要继续迭代 |
| `USER_INTERRUPT` | 用户按 Ctrl+C |
| `USER_INPUT` | 中断后用户输入，携带 input + resumeAs |
| `USER_CONFIRM` | 用户确认，携带 action (continue/accept) |
| `PROCESS_ERROR` | 进程错误，携带 error 信息 |
| `TIMEOUT` | 进程超时 |
| `RESUME_SESSION` | 恢复会话，携带 sessionId |
| `ROUTE_TO_REVIEW` | 路由：编码完成后转入审查 |
| `ROUTE_TO_EVALUATE` | 路由：审查完成后转入评估 |
| `ROUTE_TO_CODER` | 路由：直接回到编码 |
| `CHOICE_DETECTED` | 检测到选择题，携带 choices 列表 |
| `RECOVERY` | 从错误状态恢复 |
| `RESTORED_TO_CODING` | 恢复到 CODING 状态 |
| `RESTORED_TO_REVIEWING` | 恢复到 REVIEWING 状态 |
| `RESTORED_TO_WAITING` | 恢复到 WAITING_USER 状态 |
| `RESTORED_TO_INTERRUPTED` | 恢复到 INTERRUPTED 状态 |

### Guards（守卫条件）

| Guard | 条件 | 用途 |
|-------|------|------|
| `canContinueRounds` | `round < maxRounds` | 未收敛时是否可继续迭代 |
| `maxRoundsReached` | `round >= maxRounds` | 达到最大轮次上限 |
| `resumeAsCoder` | `event.resumeAs === 'coder'` | 中断后恢复到 Coder |
| `resumeAsReviewer` | `event.resumeAs === 'reviewer'` | 中断后恢复到 Reviewer |
| `resumeAsDecision` | `event.resumeAs === 'decision'` | 中断后恢复到决策 |
| `confirmContinue` | `event.action === 'continue'` | 用户选择继续迭代 |
| `confirmAccept` | `event.action === 'accept'` | 用户接受当前结果 |

### Context（状态机上下文）

```typescript
interface WorkflowContext {
  round: number;              // 当前轮次（从 0 开始）
  maxRounds: number;          // 最大轮次（默认 10）
  taskPrompt: string | null;  // 用户任务描述
  activeProcess: 'coder' | 'reviewer' | null;  // 当前活跃进程
  lastError: string | null;   // 最近错误信息
  lastCoderOutput: string | null;    // 最近 Coder 输出
  lastReviewerOutput: string | null; // 最近 Reviewer 输出
  sessionId: string | null;   // 会话 ID（用于 resume）
}
```

### 状态转换图

```
                    START_TASK
            IDLE ──────────────▶ CODING ◀─────────────────┐
              │                    │  │                    │
              │ RESUME_SESSION     │  │ USER_INTERRUPT     │ NOT_CONVERGED
              ▼                    │  ▼                    │ (round < max)
          RESUMING                 │ INTERRUPTED           │
           │ │ │ │                 │  │                    │
  RESTORED_*  跳转到               │  │ USER_INPUT         │
  对应目标状态                      │  └──▶ CODING/         │
                                   │       REVIEWING/      │
                                   │       WAITING_USER    │
              CODE_COMPLETE        │                       │
            ┌──────────────────────┘                       │
            ▼                                              │
    ROUTING_POST_CODE                                      │
            │         │                                    │
  ROUTE_TO_ │  CHOICE │                                    │
  REVIEW    │  DETECTED                                    │
            ▼         ▼                                    │
        REVIEWING   WAITING_USER ──┐                       │
            │                      │                       │
            │ REVIEW_COMPLETE      │ USER_CONFIRM          │
            ▼                      │ (continue)            │
    ROUTING_POST_REVIEW            └───────────────────────┘
            │         │
  ROUTE_TO_ │  ROUTE_ │            USER_CONFIRM
  EVALUATE  │  TO_    │            (accept)
            │  CODER  │      WAITING_USER ──────▶ DONE
            ▼    │    │
        EVALUATING   └──▶ CODING
            │
     ┌──────┴──────┐
     │             │
  CONVERGED   NOT_CONVERGED
     │             │
     ▼             ├── canContinueRounds ──▶ CODING (round++)
  WAITING_USER     └── maxRoundsReached ──▶ WAITING_USER

  任何 CODING/REVIEWING/ROUTING/EVALUATING 状态:
    PROCESS_ERROR / TIMEOUT ──▶ ERROR
    ERROR ──RECOVERY──▶ WAITING_USER
```

### 序列化与恢复

状态机上下文支持完整的序列化/反序列化，实现会话恢复：

1. **序列化**: `SessionManager.saveState()` 将 `WorkflowContext` + 当前状态原子写入 `.duo/sessions/<id>/snapshot.json`
2. **恢复**: `RESUME_SESSION` 事件 -> `RESUMING` 状态 -> 根据保存的状态发出对应的 `RESTORED_TO_*` 事件 -> 跳转到目标状态（CODING/REVIEWING/WAITING_USER/INTERRUPTED）

## 关键设计决策

### 纯函数与可测试性

- UI 状态模块（`scroll-state.ts`、`overlay-state.ts` 等）导出纯函数，输入确定则输出确定
- 解析器为无状态流式转换
- 决策逻辑（`ChoiceDetector`、`ConvergenceService`）为纯判定类
- `ContextManager` 的模板解析、摘要生成均为确定性逻辑
- 便于用 vitest 编写单元测试，无需 mock 复杂外部依赖

### Adapter Pattern（适配器模式）

- 统一 `CLIAdapter` 接口抽象了 12 种不同 CLI 工具的差异（命令格式、输出格式、权限标志）
- 新增 AI 工具只需：实现 `CLIAdapter` 接口 + 在 `registry.ts` 注册 + 在 `factory.ts` 添加构造函数
- 支持用户自定义适配器（`.duo/adapters.json`）和禁用内置适配器
- 工作流引擎不关心底层用的是哪个 CLI 工具，只通过接口通信

### xstate v5 状态机

- **可预测性**: 有限状态机确保系统在任何时刻只处于一个明确的状态
- **可视化**: xstate 支持状态图可视化，便于理解和调试复杂工作流
- **序列化**: 状态机上下文天然支持 JSON 序列化，完美适配会话恢复需求
- **守卫与条件**: guards 机制让状态转换条件清晰可测试
- **React 集成**: `@xstate/react` 提供原生 hooks，与 Ink/React TUI 无缝配合

### Serial Execution（串行执行）

- 同一时间只运行一个 LLM 子进程（`activeProcess` 只能是 `'coder'` 或 `'reviewer'` 或 `null`）
- 原因：避免多个 AI 工具同时修改文件造成冲突；减少系统资源占用；状态转换更可控
- Trade-off：牺牲并行速度，换取确定性和稳定性

### 环境隔离（env-builder）

- 不盲目转发 `process.env` 全量变量给子进程
- 通过 `buildAdapterEnv()` 构建最小化环境：仅包含系统基础变量 + 适配器声明的必需变量/前缀
- 返回 `replaceEnv: true` 配合 `ProcessManager` 实现完整环境替换
- 防止敏感变量（如其他 API key）泄露给不相关的子进程

### Atomic Writes（原子写入）

- 所有持久化写入使用 `atomicWriteSync()`：先写 `.tmp` 文件，再 `rename`
- 防止写入中途崩溃导致文件损坏
- Windows 兼容：rename 前先尝试 unlink 目标文件
- `history.jsonl` 使用 `appendFileSync`（append-only），避免 read-modify-write 竞态

## P0 升级要点

本轮升级引入了多个关键模块和 bug 修复：

### 新增模块

| 模块 | 文件 | 核心价值 |
|------|------|----------|
| ProcessManager | `adapters/process-manager.ts` | 完整的子进程生命周期管理：detached 进程组、SIGTERM/SIGKILL 优雅退出、心跳检测、超时控制、缓冲区上限、父进程退出清理 |
| EnvBuilder | `adapters/env-builder.ts` | 环境变量隔离：最小化 env 构建，防止泄露，`replaceEnv: true` 完整替换 |
| SessionManager | `session/session-manager.ts` | 会话持久化重构：snapshot.json 原子写入、history.jsonl append-only、legacy 兼容、崩溃容错、类型守卫验证 |
| ContextManager | `session/context-manager.ts` | Prompt 构建引擎：双语模板、历史摘要、Token 预算、自定义模板、Previous Feedback Checklist、key points 提取 |
| ConvergenceService | `decision/convergence-service.ts` | 智能收敛判定：多级分类、5 种终止原因、循环检测（Jaccard）、趋势分析、CJK 支持 |
| StreamJsonParser | `parsers/stream-json-parser.ts` | NDJSON 流解析，畸形行计数 |
| JsonlParser | `parsers/jsonl-parser.ts` | JSONL 格式解析，畸形行计数 |
| MainLayout | `ui/components/MainLayout.tsx` | 统一主布局组件 |
| message-lines | `ui/message-lines.ts` | 消息行处理 |

### 关键修复与改进

| 改进 | 说明 |
|------|------|
| Template Resolver 安全 | `resolveTemplate()` 使用单次 pass regex 替换 `{{key}}`，replacement 值中的 `{{...}}` 不会被再次解析，防止模板注入 |
| Listener Leak Fix | `ProcessManager.dispose()` 清理所有 timer（timeout/heartbeat）、stdio listener、`process.exit` handler，防止 EventEmitter 泄露 |
| Atomic Writes | 所有持久化写入使用 tmp+rename 原子写入，防止崩溃导致文件损坏 |
| Process Lifecycle | 完整的 spawn -> heartbeat -> timeout -> SIGTERM -> grace -> SIGKILL -> dispose 生命周期，覆盖所有退出路径 |
| Env Isolation | `buildAdapterEnv()` 替代 `process.env` 全量转发，子进程环境最小化 |
| Parser Observability | 所有 parser 支持 `malformedLineCount` 计数，便于监控和调试 |
| Generator Cleanup | `OutputStreamManager` 的 consumer iterator 实现了 `return()` 方法，确保 `for await...of` 循环提前退出时正确清理 |
| Crash Tolerance | `SessionManager.loadHistory()` 对最后一行截断/畸形行容忍（crash artifact），中间行损坏则抛出明确错误 |
| Multi-byte Safety | `ContextManager` 的截断逻辑使用 `Array.from()` 按完整字符切割，不破坏 CJK 多字节字符 |

## 模块依赖关系图

```
┌──────────┐
│  cli.ts  │ ── 入口
└────┬─────┘
     │ 依赖
     ├──────────────────────────────┐
     ▼                              ▼
┌──────────────────┐     ┌───────────────────┐
│ session/          │     │ adapters/detect    │
│ session-starter   │     │ (并行 CLI 检测)     │
└────────┬─────────┘     └─────────┬─────────┘
         │                         │
         ▼                         ▼
┌────────────────────────────────────────────┐
│          ui/components/App.tsx              │
│  (接收 SessionConfig + detected + resume)  │
└──────────────────┬─────────────────────────┘
                   │ 使用
          ┌────────┴────────┐
          ▼                 ▼
┌──────────────────┐  ┌─────────────────────┐
│ engine/           │  │ ui/ state modules   │
│ workflow-machine  │  │ (scroll, overlay,   │
│ interrupt-handler │  │  display, keys...)  │
└────────┬─────────┘  └─────────────────────┘
         │ 编排
    ┌────┴─────────────────┐
    ▼                      ▼
┌──────────────────┐  ┌─────────────────────────┐
│ session/          │  │ session/                 │
│ context-manager   │  │ session-manager          │
│ (prompt 构建)     │  │ (持久化)                  │
└────────┬─────────┘  └─────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────┐
│  adapters/                                            │
│  factory → registry → 12 个 adapter 实现               │
│  ├── process-manager (spawn/kill/heartbeat)           │
│  ├── env-builder (环境隔离)                             │
│  └── output-stream-manager (多消费者广播)               │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│  parsers/ (stream-json / jsonl / text)                │
└──────────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│  decision/                                            │
│  convergence-service (收敛判定)                        │
│  choice-detector (选择题检测)                          │
└──────────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│  types/ (adapter.ts, session.ts, ui.ts)               │
│  被所有层引用，不依赖任何业务模块                         │
└──────────────────────────────────────────────────────┘
```

### 依赖方向原则

- **单向依赖**: 上层依赖下层，下层不依赖上层
- **类型共享**: `types/` 目录被所有层引用，不依赖任何业务模块
- **Engine 不依赖 UI**: 状态机定义是纯逻辑，通过 `@xstate/react` hooks 在 UI 层绑定
- **Adapter 不依赖 Engine**: Adapter 只负责执行和输出，由 Engine 层调度
- **Decision 不依赖 Adapter**: 决策服务只接收文本输入，不关心输出来源
- **Session 不依赖 UI**: 持久化层只处理数据存储，不关心展示

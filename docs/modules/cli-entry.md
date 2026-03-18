# CLI 入口与命令解析模块

## 概述

本模块负责 Duo 的命令行入口、参数解析和命令分发。采用双进程架构：Node.js 进程处理轻量命令，Bun 进程运行 OpenTUI 渲染。包含四个源文件：

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 版本常量导出 |
| `src/cli.ts` | CLI 主入口（Node.js 侧），命令分发与 Bun 交接 |
| `src/cli-commands.ts` | 各命令的具体处理逻辑（可测试，I/O 与逻辑分离） |
| `src/tui/cli.tsx` | TUI 入口（Bun 侧），OpenTUI 渲染与 React 组件挂载 |

---

## index.ts

导出唯一常量：

```ts
export const VERSION = '1.0.0';
```

被 `cli.ts` 引用，用于 `--version` 输出和 `help` 命令中的版本展示。

---

## cli.ts — Node.js 侧主入口

`cli.ts` 是 `#!/usr/bin/env node` 入口文件，负责解析 `process.argv` 并分发命令。作为轻量分发器：简单命令在 Node.js 中直接处理，TUI 命令交接给 Bun OpenTUI 运行时。

### 双进程架构

```
┌──────────────────────────────────┐     ┌──────────────────────────────────┐
│  Node.js 进程 (cli.ts)           │     │  Bun 进程 (tui/cli.tsx)          │
│                                  │     │                                  │
│  处理:                            │     │  处理:                            │
│  - --version / -v                │     │  - start (TUI 渲染)              │
│  - help / --help / -h            │────>│  - resume <id> (TUI 渲染)        │
│  - resume (列表，无 id)           │     │  - --smoke-test                  │
│  - log <id>                      │     │                                  │
│                                  │     │  使用 @opentui/core +            │
│  交接方式: spawnSync(bun,        │     │  @opentui/react 渲染             │
│    ['run', 'tui/cli.tsx', ...])  │     │                                  │
└──────────────────────────────────┘     └──────────────────────────────────┘
```

### 命令路由判断：`shouldHandleInNode(argv)`

决定一个命令是否在 Node.js 侧直接处理：

| 条件 | 结果 |
|------|------|
| `--version` 或 `-v` 在 argv 中 | Node.js 处理 |
| `help`、`--help` 或 `-h` | Node.js 处理 |
| `log` 命令 | Node.js 处理 |
| `resume` 且无 session-id | Node.js 处理 |
| 其他所有情况 | 交接给 Bun |

### 命令体系

| 命令 | 用法 | 处理位置 | 说明 |
|------|------|----------|------|
| `duo start` | `duo start [--dir <path>] [--coder <cli>] [--reviewer <cli>] [--task <desc>] [--god <adapter>] [--coder-model <model>] [--reviewer-model <model>] [--god-model <model>]` | Bun OpenTUI | 启动新的协作会话 |
| `duo resume` | `duo resume` | Node.js | 列出所有可恢复的会话 |
| `duo resume <id>` | `duo resume <session-id>` | Bun OpenTUI | 恢复指定会话 |
| `duo log` | `duo log <session-id> [--type <type>]` | Node.js | 查看 God audit log |
| `duo help` | `duo help` / `duo --help` / `duo -h` | Node.js | 打印帮助信息 |
| `duo --version` | `duo -v` / `duo --version` | Node.js | 打印版本号并退出 |
| (无子命令) | `duo [options]` | Bun OpenTUI | 等同于 `duo start`，进入交互式模式或带参数启动 |

### 启动流程

```
process.argv
  │
  ├── shouldHandleInNode(argv)?
  │     │
  │     ├── YES (轻量命令，Node.js 直接处理)
  │     │     ├── --version / -v  →  打印 VERSION，退出
  │     │     ├── help / --help / -h  →  打印帮助信息
  │     │     ├── resume (无 id)  →  handleResumeList(sessionsDir, console.log)
  │     │     └── log <id>  →  handleLog(sessionId, { type }, sessionsDir, console.log)
  │     │
  │     └── NO (TUI 命令，交接给 Bun OpenTUI)
  │           │
  │           └── handOffToOpenTui(argv)
  │                 ├── resolveBunBinary({ cwd, env })
  │                 │     ├── DUO_BUN_BINARY 环境变量  (优先)
  │                 │     ├── .local/bun/bin/bun      (项目内 bundled)
  │                 │     └── which bun               (系统 PATH)
  │                 │
  │                 ├── buildOpenTuiLaunchSpec({ bunBinary, cwd, argv })
  │                 │     └── { command: bunBinary, args: ['run', 'tui/cli.tsx', ...argv] }
  │                 │
  │                 └── spawnSync(command, args, { stdio: 'inherit' })
  │                       └── process.exit(result.status)
```

### `handOffToOpenTui` — Bun 进程交接

`cli.ts` 中的核心分发函数：

1. 调用 `resolveBunBinary()` 定位 Bun 二进制（支持 bundled / 环境变量 / 系统 PATH）
2. 调用 `buildOpenTuiLaunchSpec()` 构建启动参数
3. 通过 `spawnSync` 启动 Bun 进程运行 `tui/cli.tsx`，`stdio: 'inherit'` 直接透传终端 I/O
4. 进程退出后将 exit code 传播回 Node.js

Bun 未安装时输出错误提示：`'Bun is required for the OpenTUI runtime. Set DUO_BUN_BINARY or install Bun.'`

---

## tui/cli.tsx — Bun 侧 TUI 入口

Bun 进程中的主入口，负责 OpenTUI 渲染器创建、React 组件树挂载，以及 `start` / `resume` / `smoke-test` 三种运行模式的分发。

### 核心函数

#### `renderNode(node, options?)`

底层渲染函数，创建 OpenTUI 渲染器并挂载 React 节点：

1. 调用 `createCliRenderer({ exitOnCtrlC: false, useAlternateScreen, useConsole: false })` 创建渲染器
2. 调用 `createRoot(renderer)` 创建 React root
3. `root.render(node)` 渲染传入的 React 节点
4. 如果设置了 `autoExitMs`，等待指定时间后自动 unmount 并 destroy（用于 smoke test）
5. 否则等待 `renderer` 的 `'destroy'` 事件（App 退出时触发）

配置说明：`exitOnCtrlC: false` 表示 Ctrl+C 不直接退出进程，由 `App` 组件自行处理退出逻辑。

#### `renderApp(props, autoExitMs?)`

高级渲染函数，自动检测 CLI 工具并传入 `App` 组件：

1. 调用 `detectInstalledCLIs()` 获取可用 CLI 列表
2. 创建 `App` 组件并传入 `initialConfig`、`detected`、`resumeSession` 等 props
3. 调用 `renderNode` 执行渲染

#### `buildResumeConfig(session, detected)`

从持久化 session 重建 `SessionConfig`：

1. 调用 `sanitizeGodAdapterForResume()` 校验 God adapter 是否仍可用
2. 输出可能的 warning
3. 从 session metadata 中恢复所有配置字段（含 model override）

### 运行模式

#### `runSmokeTest()`

用于 CI/CD 的快速冒烟测试：

- 渲染一个简单的 `TuiApp` 组件（标题 + body 文本）
- `alternateScreen: false`，不切换 alternate buffer
- `autoExitMs: 30`，30ms 后自动退出

#### `runStart(argv, smokeTest)`

处理 `start` 命令：

1. `detectInstalledCLIs()` 检测已安装 CLI
2. `parseStartArgs(argv)` 解析命令行参数
3. 如果 `--coder`、`--reviewer`、`--task` 三个必选参数齐全：
   - `createSessionConfig()` 创建并验证配置
   - 验证失败 -> 输出错误，`process.exit(1)`
   - 验证通过 -> 将 `SessionConfig` 作为 `initialConfig` 传入 `App`
4. 参数不完整时 `initialConfig` 为 `undefined`，`App` 启动交互式设置向导
5. 调用 `renderNode` 渲染 `App` 组件

#### `runResume(sessionId, smokeTest)`

处理 `resume <id>` 命令：

1. 调用 `handleResume()` 加载并验证 session
2. 失败 -> `process.exit(1)`
3. Smoke test 模式 -> 渲染 `TuiApp`（显示 task 和 history），30ms 后退出
4. 正常模式：
   - `detectInstalledCLIs()` 重新检测 CLI
   - `buildResumeConfig()` 从 session 重建 `SessionConfig`
   - 渲染 `App` 组件，传入 `initialConfig` + `resumeSession`

### `main()` — 入口路由

```
argv (从 process.argv.slice(2) 获取)
  │
  ├── --smoke-test 且无命令 / command === 'start'
  │     └── runSmokeTest()
  │
  ├── command === 'resume' 且有 session-id
  │     └── runResume(id, smokeTest)
  │
  ├── command === 'start'
  │     └── runStart(filteredArgs, smokeTest)
  │
  └── 其他（无子命令 / 带参数）
        └── runStart(['start', ...filteredArgs], smokeTest)
            （前置 'start' 使 parseStartArgs 正确解析）
```

### `duo start` 详解

支持两种启动模式：

**1. 命令行参数直传模式**

当 `--coder`、`--reviewer`、`--task` 三个必选参数齐全时：
- 调用 `createSessionConfig(parsed, detected)` 创建并验证 SessionConfig
- 验证失败则输出错误并 `process.exit(1)`
- 验证通过则将完整 `SessionConfig` 作为 `initialConfig` 传入 `App` 组件

**2. 交互式引导模式**

当必要参数不完整时（如仅执行 `duo start` 或 `duo`）：
- `initialConfig` 为 `undefined`
- `App` 组件接收到 `undefined` 后启动内置的交互式设置向导

**支持的参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `--dir <path>` | 否 | 项目目录（默认 `cwd`） |
| `--coder <cli>` | 是* | Coder 角色使用的 CLI 工具（如 `claude-code`、`codex`） |
| `--reviewer <cli>` | 是* | Reviewer 角色使用的 CLI 工具 |
| `--task <desc>` | 是* | 任务描述 |
| `--god <adapter>` | 否 | God adapter 名称 |
| `--coder-model <model>` | 否 | Coder 的 model override（如 `sonnet`、`gpt-5.4`） |
| `--reviewer-model <model>` | 否 | Reviewer 的 model override |
| `--god-model <model>` | 否 | God 的 model override（如 `opus`、`gemini-2.5-pro`） |

*不提供时进入交互式模式。

### 默认命令行为

当用户不指定子命令（直接执行 `duo` 或 `duo --coder ... --task ...`）时，CLI 将其视为 `start` 命令处理，直接交接给 Bun OpenTUI 运行时。`tui/cli.tsx` 在 Bun 侧将 args 前置 `'start'` 后解析，后续流程与 `duo start` 完全一致。

### `duo resume <id>` — Resume 流程

Resume 流程在 Bun OpenTUI 侧（`tui/cli.tsx` 的 `runResume` 函数）执行：

```
cli.ts (Node.js) ──> handOffToOpenTui(['resume', id])
                          │
                    tui/cli.tsx (Bun)
                          │
  ├── handleResume(sessionId, sessionsDir, log)
  │     ├── SessionManager.loadSession()  →  加载 session 数据
  │     │     ├── SessionCorruptedError  →  提示数据损坏，exit(1)
  │     │     └── 其他错误  →  提示 session 未找到，exit(1)
  │     └── SessionManager.validateSessionRestore()  →  验证可恢复性
  │
  ├── detectInstalledCLIs()  →  重新检测 CLI
  │
  ├── buildResumeConfig(session, detected)
  │     ├── sanitizeGodAdapterForResume(reviewer, detected, god)
  │     │     └── 校验 God adapter 是否仍可用，返回 { god, warnings }
  │     └── 构建 SessionConfig（所有字段从 session metadata 恢复）
  │
  └── renderNode(React.createElement(App, { initialConfig, detected, resumeSession }))
        └── 等待 renderer 'destroy' 事件
```

Resume 流程的关键特点：
- 从持久化的 session 元数据中重建 `SessionConfig`（包含 model override 字段）
- 通过 `sanitizeGodAdapterForResume()` 确保 God adapter 在当前环境仍然可用
- 将 `resumeSession`（`LoadedSession`）传入 `App` 组件，使 TUI 从断点处继续

### `duo log <session-id>` 详解

查看指定 session 的 God audit log。

| 参数 | 说明 |
|------|------|
| `<session-id>` | 必选，session 标识 |
| `--type <type>` | 可选，按 decision type 过滤日志条目 |

### `duo help` 详解

打印完整帮助信息，包含：
- 版本号（`Duo v{VERSION}`）
- 所有命令的用法说明
- 支持的选项列表（含 model override 参数）
- 使用示例

可通过 `duo help`、`duo --help` 或 `duo -h` 触发。

---

## cli-commands.ts — 命令处理函数

本文件将命令处理逻辑从 `cli.ts` 中解耦。所有函数接收 `log: (msg: string) => void` 回调，而非直接使用 `console`，实现了 I/O 与逻辑分离，便于单元测试。

> 源自需求：FR-001 (AC-001 ~ AC-004)、FR-002 (AC-005 ~ AC-008)

### 导出接口

#### `HandleStartResult`

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | `boolean` | 命令是否成功 |
| `config` | `SessionConfig \| null` | 创建的 session 配置（验证失败时为 null） |
| `needsInteractive` | `boolean?` | 是否需要进入交互模式（缺少必要参数时为 true） |

#### `HandleResumeListResult`

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | `boolean` | 命令是否成功 |
| `sessions` | `SessionSummary[]` | 可恢复 session 列表 |

#### `HandleResumeResult`

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | `boolean` | 命令是否成功 |
| `session` | `LoadedSession \| null` | 加载的 session 数据（失败时为 null） |

### 导出函数

#### `handleStart(argv, log): Promise<HandleStartResult>`

处理 `duo start` 命令的完整逻辑：

1. 调用 `parseStartArgs(argv)` 解析命令行参数
2. 调用 `detectInstalledCLIs()` 检测已安装 CLI 并通过 `log` 展示 onboarding 信息（检测结果 + Quick Tips）
3. 判断 `--coder`、`--reviewer`、`--task` 是否齐全：
   - 不齐全 -> 返回 `{ success: false, needsInteractive: true }`
   - 齐全 -> 调用 `createSessionConfig()` 验证并创建配置
4. 验证失败 -> 输出错误，返回 `{ success: false }`
5. 验证通过 -> 输出会话信息，返回 `{ success: true, config }`

> 注意：`tui/cli.tsx` 中的 `runStart` 直接内联了参数解析和配置创建逻辑（不经过 `handleStart`），`handleStart()` 是独立的可测试版本，包含 onboarding 展示等额外功能。两者核心流程一致。

#### `handleResumeList(sessionsDir, log): HandleResumeListResult`

处理 `duo resume`（无 session-id）命令：

1. 创建 `SessionManager` 实例
2. 调用 `mgr.listSessions()` 获取会话列表
3. 无会话时提示用户使用 `duo start`
4. 有会话时格式化输出：

```
<id前8位>  <项目名>  "<task>"  [<status>]  <更新时间>
```

#### `handleResume(sessionId, sessionsDir, log): HandleResumeResult`

处理 `duo resume <session-id>` 命令：

1. 创建 `SessionManager` 实例
2. 调用 `mgr.loadSession(sessionId)` 加载会话数据
   - 捕获 `SessionCorruptedError` -> 提示数据损坏，建议手动修复或删除
   - 捕获其他错误 -> 提示会话未找到
3. 调用 `mgr.validateSessionRestore(sessionId)` 验证可恢复性
4. 验证失败 -> 输出错误，返回 `{ success: false }`
5. 验证通过 -> 输出恢复信息（task、coder/reviewer、status、directory），返回 `{ success: true, session: loaded }`

#### `handleLog(sessionId, options, sessionsDir, log): void`

处理 `duo log <session-id>` 命令。来源：FR-020。

展示 God audit log，包含：

1. **日志条目**：逐条输出序号、时间、decision type、输入/输出摘要、延迟、引用文件路径
2. **按 type 过滤**：通过 `options.type` 筛选特定 decision type
3. **统计信息**：
   - 总条目数
   - 按 decision type 分组计数
   - 延迟统计：平均值、最小值、最大值

---

## 依赖关系

```
cli.ts (Node.js 侧)
  ├── index.ts (VERSION)
  ├── cli-commands.ts (handleResumeList, handleLog)
  └── tui/runtime/bun-launcher.ts (resolveBunBinary, buildOpenTuiLaunchSpec)

tui/cli.tsx (Bun 侧)
  ├── @opentui/core (createCliRenderer)
  ├── @opentui/react (createRoot)
  ├── adapters/detect.ts (detectInstalledCLIs)
  ├── cli-commands.ts (handleResume)
  ├── god/god-adapter-config.ts (sanitizeGodAdapterForResume)
  ├── session/session-starter.ts (parseStartArgs, createSessionConfig)
  ├── ui/components/App.tsx (App 组件)
  └── tui/app.tsx (TuiApp，smoke test 用)

tui/runtime/bun-launcher.ts
  └── (无外部依赖，纯 Node.js fs/path)

cli-commands.ts
  ├── adapters/detect.ts (detectInstalledCLIs)
  ├── session/session-starter.ts (parseStartArgs, createSessionConfig)
  ├── session/session-manager.ts (SessionManager, SessionNotFoundError, SessionCorruptedError)
  ├── god/god-audit.ts (GodAuditLogger)
  └── types/session.ts (SessionConfig)
```

**类型依赖**：
- `SessionConfig`（来自 `types/session.ts`）
- `LoadedSession` / `SessionSummary`（来自 `session/session-manager.ts`）
- `GodAdapterName`（来自 `types/god-adapter.ts`，通过 `SessionConfig.god` 间接引用）

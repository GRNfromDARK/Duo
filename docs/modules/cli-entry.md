# CLI 入口与命令解析模块

## 概述

本模块负责 Duo 的命令行入口、参数解析和命令分发。包含三个源文件：

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 版本常量导出 |
| `src/cli.ts` | CLI 主入口，命令分发与 TUI 渲染 |
| `src/cli-commands.ts` | 各命令的具体处理逻辑（可测试，I/O 与逻辑分离） |

---

## index.ts

导出唯一常量：

```ts
export const VERSION = '1.0.0';
```

被 `cli.ts` 引用，用于 `--version` 输出和 `help` 命令中的版本展示。

---

## cli.ts — 主入口

`cli.ts` 是 `#!/usr/bin/env node` 入口文件，负责解析 `process.argv` 并分发到对应命令。

### 命令体系

| 命令 | 用法 | 说明 |
|------|------|------|
| `duo start` | `duo start [--dir <path>] [--coder <cli>] [--reviewer <cli>] [--task <desc>] [--god <adapter>] [--coder-model <model>] [--reviewer-model <model>] [--god-model <model>]` | 启动新的协作会话 |
| `duo resume` | `duo resume` | 列出所有可恢复的会话 |
| `duo resume <id>` | `duo resume <session-id>` | 恢复指定会话 |
| `duo log` | `duo log <session-id> [--type <type>]` | 查看 God audit log |
| `duo help` | `duo help` / `duo --help` / `duo -h` | 打印帮助信息 |
| `duo --version` | `duo -v` / `duo --version` | 打印版本号并退出 |
| (无子命令) | `duo [options]` | 等同于 `duo start`，进入交互式模式或带参数启动 |

### 启动流程

```
process.argv
  │
  ├── --version / -v  →  打印 VERSION，退出
  │
  ├── start
  │     │
  │     ├── detectInstalledCLIs()         检测已安装的 CLI 工具
  │     ├── parseStartArgs(args)          解析全部参数
  │     │
  │     ├── [参数完整?]  (coder + reviewer + task 三项齐全)
  │     │     ├── YES → createSessionConfig(parsed, detected)
  │     │     │         ├── 验证失败 → 输出错误，exit(1)
  │     │     │         ├── 有警告 → 打印警告（不阻止启动）
  │     │     │         └── 验证通过 → config = result.config
  │     │     └── NO  → config = undefined（交互式模式）
  │     │
  │     └── runInkApp({ initialConfig: config, detected })
  │           └── waitUntilExit()
  │
  ├── resume
  │     ├── sessionsDir = cwd/.duo/sessions/
  │     ├── [有 session-id?]
  │     │     ├── YES → Resume 流程（见下方）
  │     │     └── NO  → handleResumeList(sessionsDir, console.log)
  │
  ├── log
  │     ├── [有 session-id?]
  │     │     ├── NO  → 打印 usage，exit(1)
  │     │     └── YES → 解析 --type 参数，调用 handleLog(sessionId, { type }, sessionsDir, console.log)
  │
  ├── help / --help / -h  →  打印帮助信息（版本、用法、选项、示例）
  │
  └── (default，无子命令)  →  等同于 start，检测 CLI 并尝试启动
        │
        ├── detectInstalledCLIs()
        ├── parseStartArgs(['start', ...args])   将现有参数注入 start 解析器
        ├── [参数完整?]
        │     ├── YES → createSessionConfig → 验证 → config
        │     └── NO  → config = undefined（交互式模式）
        └── runInkApp({ initialConfig: config, detected })
```

### `runInkApp` — TUI 渲染辅助函数

`cli.ts` 中的内部辅助函数，封装了 Ink 渲染的完整生命周期：

1. 调用 `createTerminalInput(process.stdin)` 创建自定义终端输入（支持鼠标事件）
2. 调用 `enterAlternateScreen(process.stdout)` 进入备用屏幕缓冲区（TUI 退出后恢复原终端内容）
3. 调用 `render(React.createElement(App, props), { exitOnCtrlC: false, stdin })` 渲染 App 组件
4. `waitUntilExit()` 等待 App 退出
5. `finally` 块中执行 `cleanupInput()` 和 `cleanupScreen()` 清理资源

```ts
async function runInkApp(props: Record<string, unknown>): Promise<void>
```

`exitOnCtrlC: false` 表示 Ctrl+C 不直接退出进程，由 `App` 组件自行处理退出逻辑。

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

当用户不指定子命令（直接执行 `duo` 或 `duo --coder ... --task ...`）时，CLI 将其视为 `start` 命令处理：
1. 将 `args` 前置 `'start'` 后传入 `parseStartArgs()`
2. 后续流程与 `duo start` 完全一致
3. 支持无参数进入交互式模式，也支持带完整参数直接启动

### `duo resume <id>` — Resume 流程

```
duo resume <id>
  │
  ├── handleResume(sessionId, sessionsDir, log)
  │     ├── SessionManager.loadSession()  →  加载 session 数据
  │     │     ├── SessionCorruptedError  →  提示数据损坏，exit(1)
  │     │     └── 其他错误  →  提示 session 未找到，exit(1)
  │     └── SessionManager.validateSessionRestore()  →  验证可恢复性
  │
  ├── detectInstalledCLIs()  →  重新检测 CLI
  │
  ├── sanitizeGodAdapterForResume(reviewer, detected, god)
  │     └── 校验 God adapter 是否仍可用，返回 { god, warnings }
  │
  ├── 构建 SessionConfig
  │     ├── projectDir    ← session metadata
  │     ├── coder         ← session metadata
  │     ├── reviewer      ← session metadata
  │     ├── god           ← sanitizeGodAdapterForResume 结果
  │     ├── task          ← session metadata
  │     ├── coderModel    ← session metadata
  │     ├── reviewerModel ← session metadata
  │     └── godModel      ← session metadata
  │
  └── runInkApp({ initialConfig, detected, resumeSession })
        └── waitUntilExit()
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
   - 不齐全 → 返回 `{ success: false, needsInteractive: true }`
   - 齐全 → 调用 `createSessionConfig()` 验证并创建配置
4. 验证失败 → 输出错误，返回 `{ success: false }`
5. 验证通过 → 输出会话信息，返回 `{ success: true, config }`

> 注意：`cli.ts` 中的 `start` 分支直接内联了参数解析和配置创建逻辑（不经过 `handleStart`），`handleStart()` 是独立的可测试版本，包含 onboarding 展示等额外功能。两者核心流程一致。

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
   - 捕获 `SessionCorruptedError` → 提示数据损坏，建议手动修复或删除
   - 捕获其他错误 → 提示会话未找到
3. 调用 `mgr.validateSessionRestore(sessionId)` 验证可恢复性
4. 验证失败 → 输出错误，返回 `{ success: false }`
5. 验证通过 → 输出恢复信息（task、coder/reviewer、status、directory），返回 `{ success: true, session: loaded }`

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
cli.ts
  ├── index.ts (VERSION)
  ├── cli-commands.ts (handleResumeList, handleResume, handleLog)
  ├── session/session-starter.ts (parseStartArgs, createSessionConfig)
  ├── adapters/detect.ts (detectInstalledCLIs)
  ├── god/god-adapter-config.ts (sanitizeGodAdapterForResume)
  ├── ui/components/App.ts (App 组件)
  ├── ui/alternate-screen.ts (enterAlternateScreen)
  ├── ui/mouse-input.ts (createTerminalInput)
  └── types/session.ts (SessionConfig)

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

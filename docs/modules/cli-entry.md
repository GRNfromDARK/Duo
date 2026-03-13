# CLI 入口与命令解析模块

## 模块职责

本模块是 Duo 应用的入口层，负责：

1. 解析命令行参数，分发到对应的子命令处理逻辑
2. 检测系统中已安装的 CLI 工具
3. 验证用户输入参数的合法性
4. 根据参数完整度选择 **直传模式** 或 **交互式引导模式** 启动 TUI
5. 管理会话的恢复（resume）流程，包括列表展示与单会话加载

## 涉及文件

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 导出版本常量 `VERSION`（当前值 `'1.0.0'`） |
| `src/cli.ts` | CLI 入口脚本（`#!/usr/bin/env node`），包含参数解析、命令分发、TUI 渲染启动 |
| `src/cli-commands.ts` | **命令处理函数模块（NEW）**，将 `start`、`resume`、`resume list` 的业务逻辑从 `cli.ts` 中抽离，提供可测试的纯函数式命令处理器 |

### 文件职责划分

- **`cli.ts`** 承担"胶水"角色：读取 `process.argv`、调用命令处理函数、启动 Ink TUI 渲染。
- **`cli-commands.ts`** 承担"业务逻辑"角色：CLI 检测展示、参数验证、会话加载与列表，所有函数均通过 `log` 回调输出，不直接操作 `console`，便于单元测试。

## 命令体系

### `duo start`

启动新的协作会话。支持两种模式（见下方「两种启动模式」）。

```
duo start                                             # 交互式引导
duo start --dir <path> --coder <cli> --reviewer <cli> --task <desc>  # 直传模式
```

完整示例：

```bash
duo start --coder claude-code --reviewer codex --task "Add JWT auth"
```

### `duo resume`

恢复已有会话。

```
duo resume                # 列出所有可恢复的会话
duo resume <session-id>   # 恢复指定会话
```

- 无参数时调用 `handleResumeList()` 列出 `.duo/sessions/` 目录下的会话
- 带 session-id 时调用 `handleResume()` 加载会话数据，验证可恢复性，重建 `SessionConfig` 并渲染 TUI（传入 `resumeSession`）

### `--version` / `-v`

打印 `VERSION` 并退出。

### 默认（无命令）

打印使用说明（Usage + Examples），包含所有可用命令的简要描述。

## cli-commands.ts 命令处理函数详解

本文件是 v1.0 新增的模块，将命令处理逻辑从 `cli.ts` 中解耦。所有函数接收 `log: (msg: string) => void` 回调，而非直接使用 `console`，实现了 I/O 与逻辑分离。

> 源自需求：FR-001 (AC-001 ~ AC-004)、FR-002 (AC-005 ~ AC-008)

### 导出接口

#### `HandleStartResult`

`handleStart()` 的返回类型。

```ts
interface HandleStartResult {
  success: boolean;            // 命令是否成功执行
  config: SessionConfig | null; // 验证通过时为 SessionConfig，否则为 null
  needsInteractive?: boolean;  // 是否需要进入交互式模式（缺少必要参数时为 true）
}
```

#### `HandleResumeListResult`

`handleResumeList()` 的返回类型。

```ts
interface HandleResumeListResult {
  success: boolean;            // 命令是否成功执行
  sessions: SessionSummary[];  // 可恢复的会话摘要列表
}
```

#### `HandleResumeResult`

`handleResume()` 的返回类型。

```ts
interface HandleResumeResult {
  success: boolean;            // 命令是否成功执行
  session: LoadedSession | null; // 成功时为加载的会话数据，失败时为 null
}
```

### 导出函数

#### `handleStart(argv, log) → Promise<HandleStartResult>`

处理 `duo start` 命令的完整逻辑：

1. 调用 `parseStartArgs(argv)` 解析命令行参数
2. 调用 `detectInstalledCLIs()` 检测已安装的 CLI 工具并通过 `log` 展示 onboarding 信息（检测结果 + Quick Tips）
3. 判断 `--coder`、`--reviewer`、`--task` 是否齐全：
   - 不齐全 → 返回 `{ success: false, needsInteractive: true }`
   - 齐全 → 调用 `createSessionConfig()` 验证并创建配置
4. 验证失败 → 输出错误，返回 `{ success: false }`
5. 验证通过 → 输出会话信息，返回 `{ success: true, config }`

#### `handleResumeList(sessionsDir, log) → HandleResumeListResult`

处理 `duo resume`（无 session-id）命令：

1. 创建 `SessionManager` 实例
2. 调用 `mgr.listSessions()` 获取会话列表
3. 无会话时提示用户使用 `duo start`
4. 有会话时格式化输出：`ID前缀  项目名  "任务"  Round N  [状态]  时间`

#### `handleResume(sessionId, sessionsDir, log) → HandleResumeResult`

处理 `duo resume <session-id>` 命令：

1. 创建 `SessionManager` 实例
2. 调用 `mgr.loadSession(sessionId)` 加载会话数据
   - 捕获 `SessionCorruptedError` → 提示数据损坏
   - 捕获其他错误 → 提示会话未找到
3. 调用 `mgr.validateSessionRestore(sessionId)` 验证可恢复性
4. 验证失败 → 输出错误，返回 `{ success: false }`
5. 验证通过 → 输出恢复信息，返回 `{ success: true, session: loaded }`

## 两种启动模式

### 1. 命令行参数直传模式

当 `--coder`、`--reviewer`、`--task` 三个参数都提供时，进入直传模式：

- `cli.ts` 中直接调用 `parseStartArgs(args)` 解析为 `StartArgs` 对象
- 调用 `createSessionConfig(parsed, detected)` 创建并验证会话配置
- 验证失败（`validation.valid === false`）则输出错误并 `process.exit(1)`
- 验证通过则将完整的 `SessionConfig` 作为 `initialConfig` 传入 `App` 组件

### 2. 交互式引导模式

当必要参数不完整时（如仅执行 `duo start`）：

- `initialConfig` 为 `undefined`
- `App` 组件接收到 `undefined` 后启动内置的交互式设置向导
- 用户在 TUI 中逐步选择 coder、reviewer 并输入 task

> **注意**：`cli.ts` 中的 `start` 分支直接内联了参数解析和配置创建逻辑（不经过 `handleStart`），而 `cli-commands.ts` 中的 `handleStart()` 是一个独立的、可测试的版本，包含 onboarding 展示等额外功能。两者的核心流程一致。

## 启动流程

```
process.argv
  │
  ├── --version / -v  →  打印版本，退出
  │
  ├── start
  │     │
  │     ├── detectInstalledCLIs()        // 检测已安装的 CLI 工具
  │     ├── parseStartArgs(args)         // 解析 --dir, --coder, --reviewer, --task
  │     │
  │     ├── [参数完整?]
  │     │     ├── YES → createSessionConfig(parsed, detected)
  │     │     │         ├── 验证失败 → 输出错误，exit(1)
  │     │     │         └── 验证通过 → config = result.config
  │     │     └── NO  → config = undefined（交互式模式）
  │     │
  │     └── render(App, { initialConfig: config, detected })
  │           └── waitUntilExit()
  │
  ├── resume
  │     ├── sessionsDir = .duo/sessions/
  │     ├── [有 session-id?]
  │     │     ├── YES → handleResume(sessionId, sessionsDir, log)
  │     │     │         ├── 失败 → 输出日志，exit(1)
  │     │     │         └── 成功 → 重建 SessionConfig
  │     │     │                   → detectInstalledCLIs()
  │     │     │                   → render(App, { initialConfig, detected, resumeSession })
  │     │     │                         └── waitUntilExit()
  │     │     └── NO  → handleResumeList(sessionsDir, console.log)
  │     │               └── 列出可恢复会话
  │
  └── (default) → 打印 Usage 帮助信息
```

## 关键函数说明

### index.ts 导出

| 导出 | 类型 | 说明 |
|------|------|------|
| `VERSION` | `string` | 版本常量，当前值 `'1.0.0'` |

### cli-commands.ts 导出

| 导出 | 类型 | 说明 |
|------|------|------|
| `HandleStartResult` | interface | `handleStart` 返回值类型 |
| `HandleResumeListResult` | interface | `handleResumeList` 返回值类型 |
| `HandleResumeResult` | interface | `handleResume` 返回值类型 |
| `handleStart(argv, log)` | async function | 处理 `duo start` 命令，含 CLI 检测展示与配置验证 |
| `handleResumeList(sessionsDir, log)` | function | 列出可恢复会话 |
| `handleResume(sessionId, sessionsDir, log)` | function | 加载并验证指定会话 |

### cli.ts 调用的外部依赖

| 函数 | 来源模块 | 说明 |
|------|----------|------|
| `parseStartArgs(args: string[])` | `session/session-starter` | 将命令行参数数组解析为 `StartArgs` 对象 |
| `createSessionConfig(parsed, detected)` | `session/session-starter` | 根据 `StartArgs` 和已检测到的 CLI 创建 `StartResult`（含 `SessionConfig` + `ValidationResult`） |
| `detectInstalledCLIs()` | `adapters/detect` | 异步检测系统中已安装的 CLI 工具，返回检测结果数组 |
| `handleResume(sessionId, sessionsDir, logger)` | `cli-commands` | 按 session-id 加载会话数据，返回 `HandleResumeResult` |
| `handleResumeList(sessionsDir, logger)` | `cli-commands` | 列出指定目录下所有可恢复的会话，返回 `HandleResumeListResult` |

### 渲染入口

使用 [Ink](https://github.com/vadimdemedes/ink) 框架的 `render()` 函数将 React 组件 `App` 渲染为终端 TUI：

```ts
render(
  React.createElement(App, {
    initialConfig: config,    // SessionConfig | undefined
    detected,                 // 检测到的已安装 CLI 数组
    resumeSession?,           // 仅 resume 模式传入（LoadedSession）
  }),
  { exitOnCtrlC: false },
);
```

`exitOnCtrlC: false` 表示 Ctrl+C 不直接退出进程，由 `App` 组件自行处理退出逻辑。

## 与其他模块的关系

```
┌─────────────┐     ┌──────────────────────┐
│  index.ts   │     │  VERSION 常量         │
│  (版本导出)  │────→│  供 cli.ts 引用       │
└─────────────┘     └──────────────────────┘

┌─────────────┐     ┌──────────────────────┐
│  cli.ts     │────→│ session/session-starter│  参数解析 & 配置创建
│  (入口)     │     └──────────────────────┘
│             │     ┌──────────────────────┐
│             │────→│ adapters/detect       │  CLI 工具检测
│             │     └──────────────────────┘
│             │     ┌──────────────────────┐
│             │────→│ cli-commands          │  resume 命令处理
│             │     └──────────────────────┘
│             │     ┌──────────────────────┐
│             │────→│ ui/components/App     │  TUI 渲染
└─────────────┘     └──────────────────────┘

┌─────────────┐     ┌──────────────────────┐
│cli-commands │────→│ adapters/detect       │  CLI 工具检测（handleStart 中使用）
│  (命令处理)  │     └──────────────────────┘
│             │     ┌──────────────────────┐
│             │────→│ session/session-starter│  参数解析 & 配置创建
│             │     └──────────────────────┘
│             │     ┌──────────────────────────────┐
│             │────→│ session/session-manager       │  会话持久化（resume 系列）
└─────────────┘     └──────────────────────────────┘
```

- **上游**：无（`cli.ts` 是进程入口）
- **下游**：`session-starter`（会话配置）、`adapters/detect`（CLI 检测）、`cli-commands`（命令处理逻辑）、`session-manager`（会话持久化）、`App`（TUI 渲染）
- **类型依赖**：`SessionConfig`（来自 `types/session.ts`）、`LoadedSession` / `SessionSummary`（来自 `session/session-manager`）

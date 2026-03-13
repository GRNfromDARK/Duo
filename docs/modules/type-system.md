# 类型系统

## 概述

Duo 的类型系统分为三大类型域，分别定义在 `src/types/` 目录下：

| 类型域 | 文件 | 职责 |
|--------|------|------|
| Adapter Types | `types/adapter.ts` | CLI 适配器插件架构的接口定义 |
| Session Types | `types/session.ts` | 会话配置、启动参数、验证结果 |
| UI Types | `types/ui.ts` | TUI 层的消息、角色、滚动状态 |

此外，`src/cli-commands.ts` 中定义了三个命令处理结果接口（`HandleStartResult`、`HandleResumeListResult`、`HandleResumeResult`），它们依赖上述类型域中的类型，详见 [CLI 入口模块文档](./cli-entry.md)。

---

## Adapter Types (`types/adapter.ts`)

> 源自需求：FR-008 (AC-029, AC-030, AC-031, AC-032, AC-033-new)

定义了 Duo 插件架构的核心抽象，使得不同的 CLI 工具（claude-code、codex、gemini 等）可以通过统一接口接入。

### ExecOptions

CLI 执行时的选项配置。

```ts
interface ExecOptions {
  cwd: string;                          // 工作目录
  systemPrompt?: string;                // 系统提示词
  env?: Record<string, string>;         // 环境变量
  replaceEnv?: boolean;                 // true 时 env 完全替换 process.env，否则合并
  timeout?: number;                     // 超时时间（毫秒）
  permissionMode?: 'skip' | 'safe';    // 权限模式：skip 跳过确认，safe 安全模式
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cwd` | `string` | 是 | CLI 进程的工作目录 |
| `systemPrompt` | `string` | 否 | 传递给 CLI 的系统提示词 |
| `env` | `Record<string, string>` | 否 | 额外环境变量 |
| `replaceEnv` | `boolean` | 否 | 为 `true` 时 `env` 完全替换 `process.env`，默认为合并模式 |
| `timeout` | `number` | 否 | 执行超时（毫秒） |
| `permissionMode` | `'skip' \| 'safe'` | 否 | `skip` 跳过权限确认（yolo 模式），`safe` 需要用户确认 |

### OutputChunk

CLI 输出的流式数据块，是 adapter 向上层传递结果的最小单元。

```ts
interface OutputChunk {
  type: 'text' | 'code' | 'tool_use' | 'tool_result' | 'error' | 'status';
  content: string;                      // 文本内容
  metadata?: Record<string, unknown>;   // 附加元数据（工具名、token 数等）
  timestamp: number;                    // Unix 时间戳
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | 联合类型（见下表） | 是 | 数据块类型 |
| `content` | `string` | 是 | 文本内容 |
| `metadata` | `Record<string, unknown>` | 否 | 附加元数据 |
| `timestamp` | `number` | 是 | Unix 时间戳（毫秒） |

`type` 枚举值说明：

| 值 | 含义 |
|----|------|
| `text` | 普通文本输出 |
| `code` | 代码块 |
| `tool_use` | 工具调用请求 |
| `tool_result` | 工具调用结果 |
| `error` | 错误信息 |
| `status` | 状态更新（如"思考中..."） |

### CLIAdapter

核心适配器接口，每个 CLI 工具必须实现此接口。

```ts
interface CLIAdapter {
  readonly name: string;            // 内部标识名（如 'claude-code'）
  readonly displayName: string;     // 显示名称（如 'Claude Code'）
  readonly version: string;         // 版本号

  isInstalled(): Promise<boolean>;  // 检测是否已安装
  getVersion(): Promise<string>;    // 获取当前版本
  execute(prompt: string, opts: ExecOptions): AsyncIterable<OutputChunk>;
                                    // 执行提示词，返回流式输出
  kill(): Promise<void>;            // 终止运行中的进程
  isRunning(): boolean;             // 是否正在运行
}
```

| 成员 | 类型 | 说明 |
|------|------|------|
| `name` | `readonly string` | 内部标识名（如 `'claude-code'`） |
| `displayName` | `readonly string` | 用户可见的显示名称（如 `'Claude Code'`） |
| `version` | `readonly string` | 当前版本号 |
| `isInstalled()` | `Promise<boolean>` | 异步检测该 CLI 是否已安装在系统中 |
| `getVersion()` | `Promise<string>` | 异步获取已安装版本 |
| `execute(prompt, opts)` | `AsyncIterable<OutputChunk>` | 核心方法：执行提示词，返回流式 `OutputChunk` 迭代器 |
| `kill()` | `Promise<void>` | 终止当前运行中的 CLI 进程 |
| `isRunning()` | `boolean` | 同步检查 CLI 进程是否正在运行 |

关键设计：`execute()` 返回 `AsyncIterable<OutputChunk>`，支持逐块流式读取 CLI 输出，适配不同 CLI 的输出格式。

### ParserType

CLI 输出的解析策略类型。

```ts
type ParserType = 'stream-json' | 'jsonl' | 'text';
```

| 值 | 说明 |
|----|------|
| `stream-json` | 流式 JSON 解析（适用于 claude-code 等） |
| `jsonl` | 逐行 JSON 解析 |
| `text` | 纯文本解析 |

### CLIRegistryEntry

CLI 注册表条目，描述一个 CLI 工具的静态配置信息。

```ts
interface CLIRegistryEntry {
  name: string;           // 内部标识名
  displayName: string;    // 显示名称
  command: string;        // 基础命令（如 'claude'）
  detectCommand: string;  // 检测安装的命令（如 'claude --version'）
  execCommand: string;    // 执行命令模板
  outputFormat: string;   // 输出格式描述
  yoloFlag: string;       // 跳过确认的标志参数
  parserType: ParserType; // 输出解析器类型
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 内部标识名（与 `CLIAdapter.name` 对应） |
| `displayName` | `string` | 用户可见的显示名称 |
| `command` | `string` | 基础命令名（如 `'claude'`、`'codex'`） |
| `detectCommand` | `string` | 用于检测是否安装的命令（如 `'claude --version'`） |
| `execCommand` | `string` | 执行命令的模板字符串 |
| `outputFormat` | `string` | 输出格式描述（用于选择解析器） |
| `yoloFlag` | `string` | 跳过权限确认的命令行标志（对应 `ExecOptions.permissionMode: 'skip'`） |
| `parserType` | `ParserType` | 输出解析器类型 |

### CLIRegistry

注册表类型，键为 CLI 名称，值为 `CLIRegistryEntry`。

```ts
type CLIRegistry = Record<string, CLIRegistryEntry>;
```

---

## Session Types (`types/session.ts`)

> 源自需求：FR-001 (AC-001, AC-002, AC-003, AC-004)

定义会话的配置与启动流程中的数据结构。

### SessionConfig

一次协作会话的完整配置，是启动 TUI 所需的最小必要信息。

```ts
interface SessionConfig {
  projectDir: string;   // 项目目录路径
  coder: string;        // Coder 角色使用的 CLI 名称（如 'claude-code'）
  reviewer: string;     // Reviewer 角色使用的 CLI 名称（如 'codex'）
  task: string;         // 任务描述
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `projectDir` | `string` | 项目工作目录的绝对路径 |
| `coder` | `string` | 承担 Coder 角色的 CLI 标识名 |
| `reviewer` | `string` | 承担 Reviewer 角色的 CLI 标识名 |
| `task` | `string` | 用户定义的任务描述文本 |

### StartArgs

从命令行解析出的启动参数，所有字段可选（用户可能只提供部分参数）。

```ts
interface StartArgs {
  dir?: string;         // --dir 参数，项目目录
  coder?: string;       // --coder 参数
  reviewer?: string;    // --reviewer 参数
  task?: string;        // --task 参数
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `dir` | `string?` | 对应 `--dir` 参数，项目目录路径 |
| `coder` | `string?` | 对应 `--coder` 参数，Coder 角色 CLI |
| `reviewer` | `string?` | 对应 `--reviewer` 参数，Reviewer 角色 CLI |
| `task` | `string?` | 对应 `--task` 参数，任务描述 |

**`StartArgs` 与 `SessionConfig` 的关系**：`StartArgs` 是用户输入的原始形态（可选字段），经过验证和补全后转化为 `SessionConfig`（必选字段）。当 `dir` 未提供时，默认使用 `process.cwd()`。

### ValidationResult

参数验证结果。

```ts
interface ValidationResult {
  valid: boolean;       // 是否通过验证
  errors: string[];     // 错误列表（验证失败时非空）
  warnings: string[];   // 警告列表（不阻止启动，但需提示用户）
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `valid` | `boolean` | `true` 表示验证通过，`false` 表示存在阻断性错误 |
| `errors` | `string[]` | 错误消息列表，验证失败时非空 |
| `warnings` | `string[]` | 警告消息列表，不阻止启动但需提示用户 |

### StartResult

`createSessionConfig()` 的返回值，包含完整的启动信息。

```ts
interface StartResult {
  config: SessionConfig | null;   // 验证通过时为 SessionConfig，失败时为 null
  validation: ValidationResult;   // 验证结果
  detectedCLIs: string[];         // 系统中检测到的可用 CLI 列表
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `config` | `SessionConfig \| null` | 验证通过时为完整配置，失败时为 `null` |
| `validation` | `ValidationResult` | 验证结果详情 |
| `detectedCLIs` | `string[]` | 系统中检测到的所有可用 CLI 名称列表 |

---

## UI Types (`types/ui.ts`)

> 源自需求：FR-014 (AC-048, AC-049, AC-050, AC-051)

定义 TUI 层的消息展示、角色样式、滚动状态。

### RoleName

角色名称的联合类型，定义了 Duo 支持的所有角色标识。

```ts
type RoleName = 'claude-code' | 'codex' | 'gemini' | 'system' | 'user';
```

| 值 | 含义 |
|----|------|
| `claude-code` | Claude Code CLI |
| `codex` | OpenAI Codex CLI |
| `gemini` | Google Gemini CLI |
| `system` | 系统消息（路由事件、轮次摘要等） |
| `user` | 用户输入 |

### RoleStyle

角色的视觉样式定义。

```ts
interface RoleStyle {
  displayName: string;  // 显示名称
  color: string;        // 文字颜色（Ink 支持的颜色值）
  border: string;       // 消息边框字符
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `displayName` | `string` | 在 TUI 中显示的角色名称 |
| `color` | `string` | 文字颜色，支持 Ink 颜色名或十六进制值 |
| `border` | `string` | 消息左侧边框字符，用于视觉区分不同角色 |

### ROLE_STYLES（常量）

预定义的角色样式映射表。

```ts
const ROLE_STYLES: Record<RoleName, RoleStyle> = {
  'claude-code': { displayName: 'Claude',  color: 'blue',    border: '┃' },
  codex:         { displayName: 'Codex',   color: 'green',   border: '║' },
  gemini:        { displayName: 'Gemini',  color: '#FFA500', border: '│' },
  system:        { displayName: 'System',  color: 'yellow',  border: '·' },
  user:          { displayName: 'You',     color: 'white',   border: '>' },
};
```

每个角色使用不同的 `border` 字符和颜色，使用户在终端中可以快速区分消息来源。

### MessageMetadata

消息的附加元数据，用于控制不同显示模式下的行为。

```ts
interface MessageMetadata {
  cliCommand?: string;       // 调用 CLI 的命令（verbose 模式显示）
  tokenCount?: number;       // 该消息的 token 数（verbose 模式显示）
  isRoutingEvent?: boolean;  // 是否为路由/内部事件（minimal 模式隐藏）
  isRoundSummary?: boolean;  // 是否为轮次摘要分隔线
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `cliCommand` | `string?` | 调用 CLI 时使用的命令字符串，仅在 verbose 模式下展示 |
| `tokenCount` | `number?` | 该消息消耗的 token 数量，仅在 verbose 模式下展示 |
| `isRoutingEvent` | `boolean?` | 标记为路由/内部事件时，在 minimal 模式下隐藏 |
| `isRoundSummary` | `boolean?` | 标记为轮次摘要分隔线，用于在轮次之间添加视觉分隔 |

### Message

TUI 中显示的消息实体，是消息列表的基本单元。

```ts
interface Message {
  id: string;                    // 唯一标识
  role: RoleName;                // 角色名称
  roleLabel?: string;            // 角色标签（如 "Coder"、"Reviewer"）
  content: string;               // 消息内容
  timestamp: number;             // Unix 时间戳
  isStreaming?: boolean;         // 是否正在流式输出中
  metadata?: MessageMetadata;    // 附加元数据
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 消息唯一标识 |
| `role` | `RoleName` | 角色标识，决定视觉样式（通过 `ROLE_STYLES` 查找） |
| `roleLabel` | `string?` | 上下文角色标签（如 `"Coder"`、`"Reviewer"`），同一个 CLI 在不同会话中可能扮演不同角色 |
| `content` | `string` | 消息文本内容 |
| `timestamp` | `number` | Unix 时间戳（毫秒） |
| `isStreaming` | `boolean?` | `true` 表示该消息正在流式输出中，内容可能尚不完整 |
| `metadata` | `MessageMetadata?` | 附加元数据，控制不同显示模式下的行为 |

### ScrollState

终端消息区域的滚动状态。

```ts
interface ScrollState {
  offset: number;           // 滚动偏移量（行数）
  viewportHeight: number;   // 可视区域高度（行数）
  totalLines: number;       // 总行数
  autoFollow: boolean;      // 是否自动跟随最新消息
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `offset` | `number` | 当前滚动偏移量（从顶部算起的行数） |
| `viewportHeight` | `number` | 终端可视区域高度（行数） |
| `totalLines` | `number` | 消息区域的总行数 |
| `autoFollow` | `boolean` | 为 `true` 时自动滚动到最新消息，用户手动滚动时置为 `false` |

---

## 类型之间的关系

```
                    ┌──────────────────────────┐
                    │     CLI 入口 (cli.ts)      │
                    └───────┬──────────────────┘
                            │ 使用
                            ▼
               ┌─────────────────────────┐
               │   Session Types         │
               │                         │
               │  StartArgs              │
               │    │ 解析 & 验证         │
               │    ▼                    │
               │  StartResult            │
               │    ├── ValidationResult │
               │    └── SessionConfig ───┼──────────┐
               └─────────────────────────┘          │
                                                    │ 传入 App 组件
                                                    ▼
               ┌─────────────────────────┐   ┌─────────────────┐
               │   Adapter Types         │   │   UI Types       │
               │                         │   │                  │
               │  CLIRegistry            │   │  Message         │
               │    └── CLIRegistryEntry │   │    ├── RoleName  │
               │         └── ParserType  │   │    ├── roleLabel │
               │                         │   │    └── Metadata  │
               │  CLIAdapter             │   │                  │
               │    └── execute()        │   │  ROLE_STYLES     │
               │         ├── ExecOptions │   │    └── RoleStyle │
               │         └── OutputChunk─┼──→│                  │
               │                         │   │  ScrollState     │
               └─────────────────────────┘   └─────────────────┘

               ┌─────────────────────────────────────────────┐
               │   cli-commands.ts（命令处理结果类型）          │
               │                                             │
               │  HandleStartResult                          │
               │    └── config: SessionConfig ────────────┐  │
               │  HandleResumeListResult                  │  │
               │    └── sessions: SessionSummary[]        │  │
               │  HandleResumeResult                      │  │
               │    └── session: LoadedSession ───────────┼──┼──→ 传入 App 组件
               └─────────────────────────────────────────────┘
```

### 核心数据流向

1. **启动阶段**：`StartArgs` → 验证 → `SessionConfig` → 传入 `App`
2. **恢复阶段**：`HandleResumeResult.session`（`LoadedSession`）→ 重建 `SessionConfig` → 传入 `App`（附带 `resumeSession`）
3. **运行阶段**：`CLIAdapter.execute()` 产生 `OutputChunk` 流 → 转化为 `Message` 显示在 TUI
4. **展示阶段**：`Message.role`（`RoleName`）→ 查找 `ROLE_STYLES` 获取视觉样式；`ScrollState` 管理滚动

### 类型域间的桥接关系

- **Adapter Types → UI Types**：`OutputChunk` 通过协调层转化为 `Message`，是运行时的主要数据桥梁
- **Session Types → UI Types**：`SessionConfig` 在 `App` 组件中决定哪个 CLI 扮演 Coder/Reviewer，从而映射到 `Message.roleLabel`
- **Session Types → Adapter Types**：`SessionConfig.coder` / `SessionConfig.reviewer` 对应 `CLIAdapter.name`，用于选择正确的适配器实例
- **cli-commands 结果类型**：`HandleStartResult` 包含 `SessionConfig`，`HandleResumeResult` 包含 `LoadedSession`（含会话元数据和状态），它们是 CLI 命令层与 TUI 渲染层之间的数据传递载体

# 适配器层 (Adapter Layer)

## 模块职责

适配器层是 Duo 与外部 AI CLI 工具之间的统一抽象层。其核心职责：

- **统一接口**：将不同的 AI CLI 工具（Claude Code、Codex、Gemini CLI）封装为一致的 `CLIAdapter` 接口
- **进程生命周期管理**：通过 `ProcessManager` 管理子进程的 spawn、kill、超时和心跳检测
- **环境变量隔离**：通过 `buildAdapterEnv` 白名单机制为每个适配器构建最小化环境变量，避免泄露或干扰
- **插件化扩展**：通过注册表 + 工厂模式支持新增适配器，零侵入式扩展
- **输出流广播**：通过 `OutputStreamManager` 支持多消费者同时读取同一输出流
- **输出解析**：通过 `StreamJsonParser` / `JsonlParser` 将各 CLI 的原始输出统一解析为 `OutputChunk`

---

## 文件清单

### 基础设施

| 文件 | 职责 |
|------|------|
| `src/types/adapter.ts` | 核心类型定义：`CLIAdapter`、`ExecOptions`、`OutputChunk`、`CLIRegistryEntry` |
| `src/adapters/registry.ts` | CLI 工具的静态注册表 + `ModelOption` 类型 + `getAdapterModels()` 入口 |
| `src/adapters/model-discovery.ts` | 动态模型发现：从各 CLI 工具的真实数据源获取可用模型列表 |
| `src/adapters/detect.ts` | 并行自动检测已安装的 CLI 工具，加载用户自定义配置 |
| `src/adapters/factory.ts` | 适配器工厂，按名称创建 `CLIAdapter` 实例 |
| `src/adapters/process-manager.ts` | 子进程生命周期管理（spawn、kill、超时、心跳） |
| `src/adapters/env-builder.ts` | 环境变量白名单构建器 |
| `src/adapters/output-stream-manager.ts` | 多消费者输出流广播与缓冲 |

### 适配器实现

| 文件 | 工具 | 解析器 |
|------|------|--------|
| `src/adapters/claude-code/adapter.ts` | Claude Code | StreamJsonParser |
| `src/adapters/codex/adapter.ts` | Codex | JsonlParser |
| `src/adapters/gemini/adapter.ts` | Gemini CLI | StreamJsonParser |

---

## 核心类型定义

**文件**：`src/types/adapter.ts`

### CLIAdapter 接口

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

所有适配器实现此接口。`execute()` 返回 `AsyncIterable<OutputChunk>`，上层通过 `for await...of` 消费输出流。每个适配器内部组合 `ProcessManager`（进程管理）+ Parser（输出解析）来实现 `execute()`。

各方法的职责：

| 方法 | 说明 |
|------|------|
| `isInstalled()` | 检测 CLI 工具是否安装（通过 `execFile('xxx', ['--version'])` 判断） |
| `getVersion()` | 获取 CLI 工具版本号，从 stdout 中正则提取 `\d+\.\d+\.\d+`，失败返回 `'unknown'` |
| `execute(prompt, opts)` | 启动子进程执行 prompt，返回异步可迭代的输出流 |
| `kill()` | 终止当前运行的子进程（委托给 ProcessManager） |
| `isRunning()` | 检查子进程是否仍在运行 |

### ExecOptions

```typescript
interface ExecOptions {
  cwd: string;                          // 工作目录
  systemPrompt?: string;                // System Prompt
  env?: Record<string, string>;         // 额外环境变量
  replaceEnv?: boolean;                 // true 时 env 完全替换 process.env
  timeout?: number;                     // 超时时间（毫秒）
  permissionMode?: 'skip' | 'safe';     // 权限模式
  disableTools?: boolean;               // 禁用所有工具（Claude Code: --tools ""）
  model?: string;                       // 模型覆盖（如 'sonnet', 'gpt-5.4'）
}
```

- `permissionMode`：`'skip'` 或 `undefined` 时各适配器传递各自的 yolo 标志以自动跳过权限确认；`'safe'` 时不传递
- `disableTools`：仅 Claude Code 支持，用于 God orchestrator 的纯 JSON 调用场景
- `model`：通过各适配器的 `--model` 标志传递给底层 CLI 工具

### OutputChunk

```typescript
interface OutputChunk {
  type: 'text' | 'code' | 'tool_use' | 'tool_result' | 'error' | 'status';
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}
```

各 `type` 值的语义：

| type | 语义 | 典型来源 |
|------|------|----------|
| `text` | AI 生成的文本回复 | `assistant` 事件、`message`/`text` 事件 |
| `code` | 代码块（可携带 `metadata.language`） | `code`/`patch` 事件（JsonlParser） |
| `tool_use` | 工具调用请求（`content` 为 JSON 参数，`metadata.tool` 为工具名） | `tool_use`/`function_call`/`item.started` 事件 |
| `tool_result` | 工具执行结果 | `tool_result`/`function_result`/`item.completed` 事件 |
| `error` | 错误信息（`metadata.fatal` 指示是否致命） | `error` 事件、stderr 注入 |
| `status` | 状态/元数据事件（`metadata` 中携带完整原始事件） | `result`/`status`/`system`/`done`/`thread.started` 等 |

### CLIRegistryEntry

```typescript
interface CLIRegistryEntry {
  name: string;           // 适配器内部标识（如 'claude-code'）
  displayName: string;    // 展示名称（如 'Claude Code'）
  command: string;        // 可执行文件名（如 'claude'）
  detectCommand: string;  // 检测版本的完整命令（如 'claude --version'）
  execCommand: string;    // 执行提示词的命令模板（如 'claude -p'）
  outputFormat: string;   // 输出格式标识（'stream-json'、'--json'）
  yoloFlag: string;       // 跳过权限确认的标志
  parserType: ParserType; // 解析器类型：'stream-json' | 'jsonl' | 'text'
  modelFlag?: string;     // 模型指定标志（如 '--model'），undefined 表示不支持
}
```

### ParserType

```typescript
type ParserType = 'stream-json' | 'jsonl' | 'text';
```

---

## 注册表 (Registry)

**文件**：`src/adapters/registry.ts`

### CLI_REGISTRY

`CLI_REGISTRY` 是一个静态 `Record<string, CLIRegistryEntry>`，集中存储每个工具的元数据。当前注册了 3 个 CLI 工具：

| 名称 | displayName | command | execCommand | outputFormat | yoloFlag | parserType | modelFlag |
|------|-------------|---------|-------------|-------------|----------|------------|-----------|
| `claude-code` | Claude Code | `claude` | `claude -p` | `stream-json` | `--dangerously-skip-permissions` | `stream-json` | `--model` |
| `codex` | Codex | `codex` | `codex exec` | `--json` | `--yolo` | `jsonl` | `--model` |
| `gemini` | Gemini CLI | `gemini` | `gemini -p` | `stream-json` | `--yolo` | `stream-json` | `--model` |

### ModelOption 接口

```typescript
interface ModelOption {
  id: string;   // CLI 模型标识符（如 'sonnet', 'gpt-5.4'）
  label: string; // 人类可读名称（如 'Sonnet (latest)', 'gpt-5.4'）
}
```

### CUSTOM_MODEL_SENTINEL

常量 `'__custom__'`，作为 `ModelOption.id` 的哨兵值，在 ModelSelector UI 中触发自由文本输入的 fallback。

### 辅助函数

| 函数 | 说明 |
|------|------|
| `getRegistryEntries()` | 返回所有 `CLIRegistryEntry` 的数组 |
| `getRegistryEntry(name)` | 按名称查找单个条目，未找到返回 `undefined` |
| `getAdapterModels(adapterName)` | 委托给 `discoverModels()`，返回指定适配器的可选模型列表（详见下一节） |

---

## 动态模型发现 (Model Discovery)

**文件**：`src/adapters/model-discovery.ts`

### 设计理念

模型列表不再硬编码于注册表中。`model-discovery.ts` 从各 CLI 工具的真实数据源（缓存文件、已安装的 npm 包、CLI 验证的别名）动态发现可用模型。

注册表的 `getAdapterModels(adapterName)` 直接委托给本模块的 `discoverModels(adapterName)`，调用方无需感知底层发现机制。

### 核心函数

```typescript
function discoverModels(adapterName: string): ModelOption[]
```

根据 `adapterName` 分发到对应的发现函数（`discoverClaudeCodeModels` / `discoverCodexModels` / `discoverGeminiModels`）。未知的适配器名称返回空数组。**所有返回列表末尾均自动追加 `__custom__` 哨兵条目。**

### 缓存机制

发现结果通过模块作用域的 `Map<string, ModelOption[]>` 缓存。每个适配器最多执行一次发现逻辑，后续调用直接返回缓存。提供 `_resetModelCache()` 用于测试场景清除缓存。

所有发现逻辑均为**同步执行**（可从 React render path 安全调用）。

### 各适配器发现策略

#### Claude Code — CLI 验证的稳定别名

Claude Code CLI 没有程序化的模型枚举命令。模块暴露三个 CLI 验证的稳定别名，由 Claude 服务端解析到对应模型族的最新版本：

| id | label | 解析到（截至 2026-03） |
|----|-------|------------------------|
| `sonnet` | Sonnet (latest) | claude-sonnet-4-6 |
| `opus` | Opus (latest) | claude-opus-4-6 |
| `haiku` | Haiku (latest) | claude-haiku-4-5-20251001 |
| `__custom__` | Custom model... | 用户可通过此项输入完整模型 ID |

**发现函数**：`discoverClaudeCodeModels()` — 直接返回硬编码的别名数组，无外部 I/O。

#### Codex — 从本地缓存文件读取

Codex CLI 维护本地模型缓存文件 `~/.codex/models_cache.json`，格式为 `{ models: [...] }`。

**发现函数**：`discoverCodexModels()` 的处理流程：

1. 读取 `~/.codex/models_cache.json`（`fs.readFileSync`）
2. 过滤 `visibility === 'list'` 的条目
3. 按 `priority` 字段升序排序（`priority` 缺失时视为 999）
4. 按 `slug` 去重（保留首次出现的条目）
5. 以 `slug` 作为 `id`，`display_name`（fallback 到 `slug`）作为 `label`

**容错**：缓存文件不存在、损坏或不可读时，静默返回空数组（由调用方追加 `__custom__`）。

| 示例 id（实际来自缓存） | 示例 label |
|--------------------------|------------|
| `gpt-5.4` | gpt-5.4 |
| `gpt-5.3-codex` | gpt-5.3-codex |
| ... | ... |
| `__custom__` | Custom model... |

#### Gemini CLI — 从已安装 npm 包读取

**发现函数**：`discoverGeminiModels()` 的处理流程：

1. 通过 `execSync('command -v gemini')` 定位 gemini 二进制文件路径（5 秒超时）
2. 通过 `fs.realpathSync` 解析符号链接获取真实路径
3. 以 gemini 入口点为基础创建 `createRequire`，解析 `@google/gemini-cli-core/dist/src/config/models.js`
4. 同步 `require` 该模块，读取 `VALID_GEMINI_MODELS`（`Set<string>`）
5. 若模块导出 `getDisplayString()` 函数，用其生成 `label`；否则 `label` 直接使用模型 ID

**容错**：Gemini CLI 未安装、包结构变更或 require 失败时，静默返回空数组。

| 示例 id（实际来自安装包） | 示例 label |
|---------------------------|------------|
| `gemini-2.5-pro` | gemini-2.5-pro |
| `gemini-2.5-flash` | gemini-2.5-flash |
| `gemini-3-pro-preview` | gemini-3-pro-preview |
| ... | ... |
| `__custom__` | Custom model... |

### 测试辅助

| 函数 | 说明 |
|------|------|
| `_resetModelCache()` | 清除模块作用域的缓存 Map，仅用于测试 |

各适配器的发现函数（`discoverCodexModels`、`discoverGeminiModels`、`discoverClaudeCodeModels`）均独立导出，可单独测试。

---

## 工厂 (Factory)

**文件**：`src/adapters/factory.ts`

`createAdapter(name: string): CLIAdapter` 通过内部 `ADAPTER_CONSTRUCTORS` 映射表根据名称实例化对应适配器。当前注册了 3 个构造函数：

```typescript
const ADAPTER_CONSTRUCTORS: Record<string, () => CLIAdapter> = {
  'claude-code': () => new ClaudeCodeAdapter(),
  'codex': () => new CodexAdapter(),
  'gemini': () => new GeminiAdapter(),
};
```

传入未知名称时抛出 `Error`，错误信息中列出所有可用适配器名称。

---

## ProcessManager 详解

**文件**：`src/adapters/process-manager.ts`

ProcessManager 继承自 `EventEmitter`，管理 CLI 子进程的完整生命周期。每个适配器在构造函数中创建自己的 ProcessManager 实例。

### ProcessTimeoutError

当进程因超时被终止时抛出的自定义错误类。适配器通过此错误类型通知编排层分发 TIMEOUT 事件到状态机。

```typescript
class ProcessTimeoutError extends Error {
  name = 'ProcessTimeoutError';
}
```

### 常量配置

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `DEFAULT_TIMEOUT_MS` | 10 分钟（600,000ms） | 全局进程超时 |
| `SIGTERM_GRACE_MS` | 5,000ms | SIGTERM 后等待进程退出的宽限时间 |
| `SIGKILL_TIMEOUT_MS` | 3,000ms | SIGKILL 后的硬超时兜底 |
| `DEFAULT_HEARTBEAT_INTERVAL_MS` | 30,000ms | 心跳检查间隔 |
| `DEFAULT_HEARTBEAT_TIMEOUT_MS` | 60,000ms | 无输出超过此时间触发警告 |
| `DEFAULT_MAX_BUFFER_BYTES` | 50MB（52,428,800 bytes） | 输出缓冲区最大字节数 |

### spawn

```typescript
spawn(command, args, opts, heartbeatOpts?): ChildProcess
```

- 使用 `detached: true` 创建独立进程组，便于通过 `-pid` 向整个进程组发信号
- stdio 配置：`['ignore', 'pipe', 'pipe']`（stdin 忽略，stdout/stderr 管道捕获）
- 环境变量处理：若 `opts.replaceEnv === true` 且提供了 `opts.env`，则完全替换 `process.env`；否则合并
- 输出缓冲区上限 50MB（可通过构造函数 `ProcessManagerOptions.maxBufferBytes` 配置），超出时丢弃旧数据只保留最新的 50MB，并正确处理 UTF-8 多字节字符截断（跳过 continuation bytes `0x80-0xBF`）
- 注册 `process.on('exit')` 处理器，确保父进程退出时通过 `SIGKILL` 杀死子进程组

同一时刻只允许一个进程运行，重复调用 `spawn()` 会抛出异常。

### kill（优雅终止）

两阶段终止流程：

```
SIGTERM(-pid) -> 等待 5s (SIGTERM_GRACE_MS) -> SIGKILL(-pid) -> 等待 3s (SIGKILL_TIMEOUT_MS)
```

1. 向进程组发送 `SIGTERM`（`process.kill(-pid, 'SIGTERM')`），给子进程及其子进程树清理的机会
2. 通过 `Promise.race` 等待进程在 5 秒内自行退出
3. 若 5 秒后仍未退出，升级为 `SIGKILL`（不可忽略的强制终止信号）
4. SIGKILL 后再等待 3 秒作为硬超时兜底，防止无限挂起
5. 最终标记 `running = false`，清理 `parentExitHandler`

### close vs exit 事件

ProcessManager 监听子进程的 `close` 事件而非 `exit` 事件。两者的关键区别：

- `exit` -- 进程结束时立即触发，但此时 stdio 流可能尚未完全刷新
- `close` -- 在所有 stdio 流关闭之后才触发，确保不会丢失尾部输出数据

`close` 回调中的处理逻辑：
1. 标记 `running = false`，清除所有定时器
2. 若退出码非零，触发 `process-error` 事件（携带 `ProcessErrorInfo`）
3. 始终触发 `process-complete` 事件（携带 `{ exitCode, signal, timedOut }`）——适配器据此关闭 ReadableStream 的 controller
4. resolve `exitPromise`，唤醒所有 `waitForExit()` 调用者

此外，`error` 事件处理 spawn 失败（如命令不存在），同样触发 `process-error` + `process-complete`。

### dispose（异步清理）

```typescript
async dispose(): Promise<void>
```

完整清理 ProcessManager 实例，释放所有资源：

1. 清除定时器（timeout、heartbeat），但保留 `parentExitHandler` 直到进程确认终止
2. 若进程仍在运行，先调用 `kill()` 等待其终止
3. kill 完成后移除 `parentExitHandler`，防止内存泄漏
4. 移除 child 的 stdout/stderr 及自身的所有事件监听器
5. 调用 `this.removeAllListeners()` 清理 EventEmitter

### 超时与心跳

| 机制 | 默认值 | 行为 |
|------|--------|------|
| 全局超时 | 10 分钟 | 超时后标记 `timedOut = true`，触发 `timeout` 事件并自动调用 `kill()` |
| 心跳间隔 | 30 秒 | 定时检查最后输出时间 |
| 心跳超时 | 60 秒 | 无输出超过此时间触发 `heartbeat-warning` 事件（携带 `silentMs`） |

心跳不会自动 kill 进程，只是发出警告事件，由上层决定如何处理。心跳选项可通过 `spawn()` 的 `heartbeatOpts` 参数覆盖（`heartbeatIntervalMs` / `heartbeatTimeoutMs`）。

### 输出缓冲

ProcessManager 内部维护输出缓冲区，同时捕获 stdout 和 stderr 数据。提供两种访问方式：

| 方法 | 说明 |
|------|------|
| `collectOutput()` | 等待进程退出后返回完整输出（await `waitForExit()`） |
| `getBufferedOutput()` | 立即返回当前已缓冲的输出，无需等待 |

当缓冲区超过 `maxBufferBytes`（默认 50MB）时，自动淘汰旧数据，只保留最新的 50MB 内容。截断操作会正确处理 UTF-8 边界——跳过位于截断点的 continuation bytes（`0x80-0xBF`），避免产生非法字符。

### 其他查询方法

| 方法 | 说明 |
|------|------|
| `isRunning()` | 返回当前进程是否仍在运行 |
| `wasTimedOut()` | 返回上一个进程是否因超时被终止 |
| `waitForExit()` | 返回 `Promise<number | null>`，等待进程退出，返回退出码（signal 终止时返回 `null`） |

### 事件列表

| 事件 | 载荷 | 触发时机 |
|------|------|----------|
| `process-error` | `ProcessErrorInfo` (`exitCode`, `signal`, `message`) | 非零退出码或 spawn 失败 |
| `process-complete` | `{ exitCode, signal, timedOut }` | 进程结束（正常或异常均触发） |
| `timeout` | 无 | 全局超时触发 |
| `heartbeat-warning` | `{ silentMs }` | 无输出时间超过阈值 |

---

## EnvBuilder 详解

**文件**：`src/adapters/env-builder.ts`

### 设计理念

不盲目转发父进程的全量 `process.env`，而是通过白名单机制为每个适配器构建最小化、显式的环境变量集合。这样做的好处：

- 避免 API Key 泄露到不需要它的 CLI 工具
- 防止环境变量冲突（如 Duo 自身的变量干扰子进程）
- 每个适配器显式声明自己的依赖，便于审计

### BASE_ENV_VARS

所有适配器共享的系统变量白名单（13 个）：

```
PATH, HOME, SHELL, LANG, TERM, USER, LOGNAME,
TMPDIR, XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME,
LC_ALL, LC_CTYPE
```

这些是 CLI 工具正常运行所需的基础系统变量。

### buildAdapterEnv 函数

```typescript
function buildAdapterEnv(opts: BuildAdapterEnvOptions):
  { env: Record<string, string>; replaceEnv: true }
```

接受三个可选参数：

| 参数 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `requiredVars` | `string[]` | 精确变量名白名单 | -- |
| `requiredPrefixes` | `string[]` | 前缀模式匹配，遍历 `process.env` 中以该前缀开头的所有变量 | `'ANTHROPIC_'` 匹配 `ANTHROPIC_API_KEY` 等 |
| `extraEnv` | `Record<string, string>` | 适配器注入的额外变量（优先级最高，覆盖一切） | `{ GOOSE_MODE: 'auto' }` |

构建顺序（后者覆盖前者）：

```
BASE_ENV_VARS -> requiredVars -> requiredPrefixes -> extraEnv
```

返回值始终包含 `replaceEnv: true`，传递给 ProcessManager 的 `spawn()` 时完全替换 `process.env`，不会有意外的环境变量泄入。

### 各适配器环境变量契约

每个适配器在 `execute()` 中通过 `requiredPrefixes` 声明自己需要的环境变量前缀，形成明确的依赖契约：

| 适配器 | requiredPrefixes | 额外处理 |
|--------|------------------|----------|
| Claude Code | `ANTHROPIC_`, `CLAUDE_` | 额外 `delete env.CLAUDECODE`，防止嵌套检测 |
| Codex | `OPENAI_` | -- |
| Gemini | `GOOGLE_`, `GEMINI_` | -- |

所有适配器还通过 `extraEnv: opts.env` 将上层传入的额外环境变量合并进来。

---

## 自动检测机制

**文件**：`src/adapters/detect.ts`

### 检测流程

1. 从注册表获取全部条目，合并用户自定义条目（`additionalEntries`），排除 `disabledNames` 中指定的适配器
2. 使用 `Promise.all` 对每个条目并行检测：
   - 先通过 `which <command>` 判断命令是否存在
   - 若存在，解析并执行 `detectCommand`（如 `claude --version`）获取版本号
3. 所有检测受 `DETECT_TIMEOUT_MS = 3000`（3 秒）超时限制
4. 返回 `DetectedCLI[]`

### DetectedCLI 结构

```typescript
interface DetectedCLI {
  name: string;           // 适配器名称
  displayName: string;    // 展示名称
  command: string;        // 可执行文件名
  installed: boolean;     // 是否已安装
  version: string | null; // 版本号（未安装或获取失败时为 null）
}
```

### 用户自定义配置

通过 `loadAdaptersConfig(projectDir)` 从 `.duo/adapters.json` 加载：

```typescript
interface AdaptersConfig {
  custom: CLIRegistryEntry[];  // 自定义适配器条目，参与检测
  disabled: string[];          // 禁用的适配器名称，从检测中排除
}
```

支持两种格式：
- **对象格式**：`{ "custom": [...], "disabled": [...] }`
- **数组格式**（向后兼容）：`[...CLIRegistryEntry]`，视为全部是 `custom`

若文件不存在或解析失败，静默返回空配置 `{ custom: [], disabled: [] }`。

`loadCustomAdapters()` 已标记 `@deprecated`，请使用 `loadAdaptersConfig()`。

---

## 各适配器实现要点

每个适配器的 `execute()` 方法遵循统一模式：构建参数 -> 构建环境变量 -> spawn 子进程 -> 将 stdout 包装为 `ReadableStream<string>` -> 交给对应 Parser 解析 -> yield `OutputChunk`。以下记录各适配器的关键差异点。

### ReadableStream 包装模式

所有适配器将 Node.js 的 `child.stdout` Readable 流转换为 Web `ReadableStream<string>`。stream controller 的生命周期由 ProcessManager 的 `process-complete` 事件驱动：

- 正常结束时调用 `controller.close()`
- 超时（`timedOut === true`）时调用 `controller.error(new ProcessTimeoutError())`
- stderr 数据以 JSON 格式注入流中，由对应 Parser 解析
- 所有适配器在 `finally` 块中检查 `processManager.isRunning()` 并在进程仍在运行时调用 `kill()` 清理

### stderr 处理策略

| 策略 | 注入格式 | 适用适配器 |
|------|----------|------------|
| JSON error 包装 | `{ type: 'error', content: msg }` + `\n` | Claude Code, Gemini |
| JSON status 包装 | `{ type: 'status', content: msg, source: 'stderr' }` + `\n` | Codex |

Claude Code 和 Gemini 将 stderr 视为错误信息，Codex 将 stderr 视为状态信息（非错误），这反映了各 CLI 工具 stderr 输出语义的差异。

### Claude Code (`claude-code`)

**命令构建**：

```
claude -p <prompt> --output-format stream-json --verbose [flags]
```

**CLI 参数详解**：

| 参数 | 条件 | 说明 |
|------|------|------|
| `--dangerously-skip-permissions` | `permissionMode === 'skip'` 或 `undefined` | 跳过权限确认 |
| `--system-prompt <text>` | 有 `systemPrompt` 且非 resume 模式 | 设置 System Prompt |
| `--tools ''` | `disableTools === true` | 禁用所有工具（God orchestrator 用） |
| `--model <model>` | 有 `model` | 指定模型 |
| `--add-dir <cwd>` | 始终 | 指定项目目录（而非依赖子进程 cwd） |
| `--continue` | `sessionOpts.continue === true` | 继续上一次会话 |
| `--resume <id>` | 有 `resumeSessionId` | 恢复指定会话 |

**环境变量特殊处理**：调用 `buildAdapterEnv()` 后额外 `delete env.CLAUDECODE`，防止 Claude Code 检测到嵌套运行而拒绝启动。

**会话管理**（ClaudeCodeSessionOptions）：

- 从 result 事件的 `metadata.session_id` 中捕获 session ID（通过 `chunk.type === 'status' && chunk.metadata?.session_id` 检测）
- 后续调用自动使用 `--resume <session_id>` 恢复会话（不使用 `--continue` 以避免交叉污染）
- resume 模式下跳过 `--system-prompt`（会话中已包含）
- resume 失败时清除过期 session_id，下次从新会话开始
- 若 resume 成功但未获取到新 session_id，也清除旧 ID

**对外暴露的会话方法**：

| 方法 | 说明 |
|------|------|
| `hasActiveSession()` | 是否有已捕获的 session ID |
| `getLastSessionId()` | 获取最近的 session ID |
| `restoreSessionId(id)` | 从外部恢复 session ID（如 `duo resume` 命令） |

### Codex (`codex`)

**命令构建**：

```
codex exec <prompt> --json [flags]
# 恢复模式：
codex exec resume <thread_id> <prompt> --json [flags]
```

**CLI 参数详解**：

| 参数 | 条件 | 说明 |
|------|------|------|
| `--full-auto` | `permissionMode === 'skip'` 或 `undefined` | 沙盒化自动执行（替代已废弃的 `--yolo`） |
| `--skip-git-repo-check` | cwd 非 git 仓库 | 跳过 git 仓库检查 |
| `--model <model>` | 有 `model` | 指定模型 |

**Git 仓库检查**：执行前调用 `git rev-parse --is-inside-work-tree` 检测 cwd 是否为 git 仓库。非 git 仓库时 yield 一条 `type: 'status'` 的 warning chunk 并传递 `--skip-git-repo-check`。

**会话管理**（CodexSessionOptions）：

- 从 `thread.started` 事件中捕获 `thread_id`（通过 `chunk.type === 'status' && chunk.metadata?.thread_id` 检测）
- 自动 resume 逻辑与 Claude Code 类似（`sessionOpts.resumeSessionId` > `this.lastSessionId`）
- resume 失败清除、无新 ID 时清除的防护机制与 Claude Code 一致
- 对外暴露 `hasActiveSession()`、`getLastSessionId()`、`restoreSessionId(id)`

**角色支持**：`CodexSessionOptions.role` 支持 `'coder' | 'reviewer'` 两种角色（当前两种角色使用相同的命令格式）。

### Gemini (`gemini`)

**命令构建**：

```
gemini -p <prompt> --output-format stream-json --non-interactive [flags]
```

**CLI 参数详解**：

| 参数 | 条件 | 说明 |
|------|------|------|
| `--yolo` | `permissionMode === 'skip'` 或 `undefined` | 自动批准所有操作 |
| `--model <model>` | 有 `model` | 指定模型 |

**特点**：

- 最简单的适配器实现，无会话管理，无 git 依赖
- 使用 `--non-interactive` 标志禁止交互式输入
- 环境变量前缀：`GOOGLE_`、`GEMINI_`
- 解析器：与 Claude Code 共享 `StreamJsonParser`
- `execute()` 使用 `yield* this.parser.parse(stream)` 直接委托（无会话 ID 捕获逻辑）

---

## 输出解析（Parsers）

适配器层使用两种解析器将各 CLI 的原始 NDJSON/JSONL 输出转换为统一的 `OutputChunk`。

### StreamJsonParser

**文件**：`src/parsers/stream-json-parser.ts`
**使用者**：Claude Code, Gemini

解析 NDJSON 格式的 stream-json 输出。从 `ReadableStream<string>` 中按行读取并逐行 `JSON.parse`，通过 `mapToChunks()` 映射为 `OutputChunk`。

**事件类型映射**：

| 原始事件 type | 映射到 OutputChunk.type | 说明 |
|---------------|------------------------|------|
| `assistant` | `text` / `tool_use` / `tool_result` | 根据 `message.content` 数组中的 item type 分发 |
| `user` | `tool_result` | 提取 `message.content` 中的 `tool_result` 项 |
| `tool_use` | `tool_use` | 直接映射，`metadata.tool` 为工具名 |
| `tool_result` | `tool_result` | 直接映射 |
| `error` | `error` | 支持 `event.error` 为对象或字符串，提取 `message` 字段 |
| `result` / `status` / `system` / `rate_limit_event` | `status` | 将完整原始事件存入 `metadata` |
| 其他 | `text`（有 `content` 字段时） | fallback 处理 |

**assistant 事件的嵌套解析**：`assistant` 事件可能包含 `message.content` 数组，数组中的每个 item 按 `item.type` 分别映射：
- `text` -> `OutputChunk(type: 'text', content: item.text)`
- `tool_use` -> `OutputChunk(type: 'tool_use', metadata.tool: item.name)`
- `tool_result` -> `OutputChunk(type: 'tool_result')`

**user 事件的 tool_result 提取**：`user` 事件中的 `tool_result` 支持从 `item.content`、`tool_use_result.stdout`、`tool_use_result.stderr` 多处提取内容，并识别 `is_error` 标志。

**容错处理**：跳过 JSON 解析失败的行（`malformedLineCount++`），在流结束后统一输出一条 `status` 类型的汇总 chunk。

### JsonlParser

**文件**：`src/parsers/jsonl-parser.ts`
**使用者**：Codex

解析 JSONL 格式（`--json` 输出）。与 StreamJsonParser 共享相同的逐行解析框架，但映射规则不同。

**事件类型映射**：

| 原始事件 type | 映射到 OutputChunk.type | 说明 |
|---------------|------------------------|------|
| `message` / `text` | `text` | 文本回复 |
| `code` / `patch` | `code` | 代码块（可携带 `metadata.language`） |
| `function_call` / `tool_use` | `tool_use` | 工具调用，`metadata.tool` 从 `name` 或 `tool` 字段提取 |
| `tool_result` / `function_result` | `tool_result` | 工具结果 |
| `error` | `error` / `status` | 通过 `mapErrorLikeEvent()` 判断是否为瞬态传输问题 |
| `status` / `done` / `completion` / `thread.started` / `turn.started` / `turn.completed` | `status` | 状态事件，完整原始事件存入 `metadata` |
| `item.completed` | `text` / `tool_result` / `error` | Codex 特有格式，根据 `item.type` 分发 |
| `item.started` | `tool_use` | Codex 特有格式，`command_execution` 映射为 shell 工具调用 |
| 其他 | `text`（有 `content` 字段时） | fallback 处理 |

**Codex 特有的 item 事件格式**：

Codex CLI 的 `item.completed` / `item.started` 事件包含嵌套的 `event.item` 对象：

- `item.type === 'agent_message'`：映射为 `text`，内容取自 `item.text`
- `item.type === 'command_execution'`（started）：映射为 `tool_use`，`metadata.tool = 'shell'`
- `item.type === 'command_execution'`（completed）：映射为 `tool_result`，内容取自 `item.aggregated_output`，`metadata` 中包含 `tool: 'shell'` 和 `command`
- `item.type === 'error'`：映射为 `error`

**瞬态错误检测**（`mapErrorLikeEvent`）：JsonlParser 通过正则匹配检测瞬态传输问题，将其降级为 `status`（`metadata.transient: true`）而非 `error`：
- `Reconnecting... N/M`
- `Falling back from WebSockets to HTTPS transport`
- `in-process app-server event stream lagged`

---

## OutputStreamManager 多消费者广播

**文件**：`src/adapters/output-stream-manager.ts`

### 架构

OutputStreamManager 接收一个 `AsyncIterable<OutputChunk>` 作为数据源（通常来自 `adapter.execute()`），通过内部 `pump()` 循环将每个 chunk 广播给所有已注册的 Consumer。

### 核心 API

| 方法 | 说明 |
|------|------|
| `start(source)` | 开始从 source 读取并广播，启动内部 pump 循环 |
| `consume()` | 创建一个新的 `AsyncIterable<OutputChunk>` 消费者（可在 start 前后调用） |
| `interrupt()` | 请求中断流，已接收的输出保留在 buffer 中 |
| `getBuffer()` | 获取所有已缓冲 chunk 的副本（返回新数组） |
| `getBufferedText()` | 获取所有 chunk 的 `content` 以空格拼接的文本 |
| `isStreaming()` | 是否正在流式传输 |
| `isInterrupted()` | 是否被中断（包括手动中断和异常中断） |
| `reset()` | 重置所有状态（buffer、consumers、标志位），支持实例复用 |

### Consumer 机制

每个 `consume()` 调用创建一个独立的 `AsyncIterableIterator`，内部维护自己的 queue 和 `done` 标志。当 pump 推送新 chunk 时，通过 `consumer.push()` 写入各 queue 并唤醒等待中的 `next()` Promise。流结束时调用 `consumer.end()` 终止迭代。

**Late Consumer 支持**：在 `start()` 之后调用 `consume()` 创建的消费者，会先收到 buffer 中所有已有 chunk 的重放（replay），然后继续接收新 chunk。若流已结束（`started && !streaming`），late consumer 会立即收到 end 信号。

Consumer 的 `return()` 方法支持提前退出迭代（如 `break` 语句触发），会标记自身 done 并释放 Promise。

### 中断处理

调用 `interrupt()` 设置 `interruptRequested` 标志。pump 循环在下一次 `for await` 迭代时检测到标志后 break，标记 `interrupted = true`，然后在 `finally` 中正常结束所有 consumer。已经写入 buffer 的数据不丢失，可通过 `getBuffer()` / `getBufferedText()` 获取。

异常同样标记为 interrupted，走相同的 finally 清理路径。

---

## 完整数据流

一次典型的适配器调用数据流如下：

```
上层调用 adapter.execute(prompt, opts)
  |
  v
adapter.buildArgs(prompt, opts)           -- 构建 CLI 参数
  |
  v
buildAdapterEnv({ requiredPrefixes })     -- 构建最小化环境变量
  |
  v
processManager.spawn(cmd, args, opts)     -- 启动子进程（detached 进程组）
  |
  v
new ReadableStream<string>({ start })     -- 将 Node.js stdout Readable 包装为 Web ReadableStream
  |                                          stderr 以 JSON 格式注入同一流
  |                                          process-complete 事件驱动 close/error
  v
parser.parse(stream)                      -- StreamJsonParser / JsonlParser 逐行解析 NDJSON
  |
  v
yield OutputChunk                         -- 统一格式的输出块
  |
  v
OutputStreamManager.start(source)         -- （可选）多消费者广播
  |
  +-- consume() -> 消费者 A (UI 渲染)
  +-- consume() -> 消费者 B (日志记录)
  +-- consume() -> 消费者 C (编排层状态更新)
```

---

## 扩展方式

### 添加新适配器

1. **注册表**：在 `registry.ts` 的 `CLI_REGISTRY` 中添加条目，填写 `name`、`command`、`detectCommand`、`execCommand`、`outputFormat`、`yoloFlag`、`parserType`、`modelFlag`。若需支持模型选择，在 `model-discovery.ts` 的 `discoverModels()` switch 中添加对应的发现分支
2. **实现**：创建 `src/adapters/<name>/adapter.ts`，实现 `CLIAdapter` 接口
   - 构造函数中初始化 `ProcessManager` 和对应的 Parser（`StreamJsonParser` / `JsonlParser`）
   - `buildArgs()` 构建 CLI 参数（public 暴露以便单元测试）
   - `execute()` 中调用 `buildAdapterEnv({ requiredPrefixes })` -> `processManager.spawn()` -> 创建 `ReadableStream<string>` -> `parser.parse(stream)` -> yield chunks
   - 监听 ProcessManager 的 `process-complete` 事件来驱动 ReadableStream 的 close/error（超时时传递 `ProcessTimeoutError`）
   - `finally` 中检查并 kill 仍在运行的进程
3. **工厂注册**：在 `factory.ts` 的 `ADAPTER_CONSTRUCTORS` 中添加 `'<name>': () => new XxxAdapter()` 映射

### 禁用适配器

在项目目录的 `.duo/adapters.json` 中配置：

```json
{
  "disabled": ["adapter-name"]
}
```

该适配器将从自动检测结果中排除。

### 用户自定义适配器条目

通过 `.duo/adapters.json` 的 `custom` 字段添加工具条目（仅支持注册表级别元数据，参与自动检测；工厂仍需代码中注册构造函数才能使用 `createAdapter()`）：

```json
{
  "custom": [
    {
      "name": "my-tool",
      "displayName": "My Tool",
      "command": "mytool",
      "detectCommand": "mytool --version",
      "execCommand": "mytool run -p",
      "outputFormat": "text",
      "yoloFlag": "--yes",
      "parserType": "text"
    }
  ]
}
```

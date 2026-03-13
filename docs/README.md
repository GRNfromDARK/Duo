# Duo — 多 AI 编程助手协作平台

## 项目简介

Duo 是一个基于终端的 TUI（Text User Interface）应用，用于协调多个 AI 编程助手协同完成编码任务。核心理念是 **Coder-Reviewer 双角色迭代**：一个 AI 负责编写代码（Coder），另一个 AI 负责审查代码（Reviewer），两者自动循环迭代，直到代码通过审查或达到最大轮次。

单个 AI 编程助手容易产生盲点和错误。Duo 引入了"双人审查"模式，通过多轮结构化迭代（code -> review -> evaluate -> loop）显著提升代码质量。

Duo 内置了 12 种主流 AI CLI 工具的适配器，用户可以自由组合任意两个作为 Coder 和 Reviewer。

## 核心特性

- **双 Agent 协作** — Coder 编码、Reviewer 审查，自动多轮迭代直到收敛
- **12 种 AI 工具支持** — Claude Code、Codex、Gemini CLI、GitHub Copilot、Aider、Amazon Q、Cursor、Cline、Continue、Goose、Amp、Qwen
- **插件化 Adapter 架构** — 统一的 `CLIAdapter` 接口，支持自定义适配器（`.duo/adapters.json`）和禁用内置适配器
- **xstate v5 状态机** — 11 个状态、20+ 事件类型、7 个 guard，严格的串行执行保证同一时刻只有一个 LLM 进程运行
- **终端 TUI 界面** — 基于 Ink 6 + React 19，支持实时流式输出、滚动、搜索、快捷键、多种 Overlay 面板
- **会话持久化与恢复** — snapshot.json + history.jsonl 原子写入，支持 `duo resume` 恢复中断的会话，兼容 legacy 格式
- **智能收敛检测** — 基于 `[APPROVED]` 标记、soft approval 识别（LGTM/可以合并等）、循环检测（Jaccard 相似度）、问题数趋势分析（improving/stagnant）、diminishing issues 自动终止
- **上下文管理** — Token 预算控制（80% 窗口），最近 3 轮完整历史 + 历史轮次摘要压缩，结构化 key points 提取
- **选择题自动路由** — 当 LLM 提出选择题时（A/B/C、方案一/二、Option 1/2），自动路由给对方 LLM 作答
- **中断处理** — 单击 Ctrl+C 中断当前进程并保留输出，双击（<500ms）保存会话并退出，支持文本中断
- **环境隔离** — 通过 `env-builder` 为子进程构建最小化环境变量集（BASE_ENV_VARS + requiredVars + requiredPrefixes），避免泄露
- **进程生命周期管理** — detached 进程组、SIGTERM -> 5s -> SIGKILL 优雅退出、心跳检测（30s/60s）、超时控制（默认 10 分钟）、50MB 输出缓冲区上限
- **自定义 Prompt 模板** — 支持 `.duo/prompts/` 目录下的 `coder.md` / `reviewer.md` 自定义模板，`{{task}}`、`{{history}}` 等占位符
- **流式输出解析** — 三种解析器（StreamJsonParser、JsonlParser、TextStreamParser），支持畸形行计数和可观测性
- **Reviewer 结构化输出** — Progress Checklist、Blocking/Non-blocking 分类、`Blocking: N` 计数、`[APPROVED]`/`[CHANGES_REQUESTED]` verdict

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript（strict 模式） |
| 运行时 | Node.js >= 20 |
| TUI 框架 | Ink 6 + React 19 |
| 状态管理 | xstate v5 + @xstate/react |
| 构建工具 | tsup（ESM 格式输出） |
| 开发工具 | tsx |
| 测试框架 | vitest 4 |
| 代码检查 | ESLint 10 |
| 测试工具 | ink-testing-library |

## 完整项目结构

```
src/
├── index.ts                        # 版本号导出（VERSION = '1.0.0'）
├── cli.ts                          # CLI 入口，解析命令（start/resume/--version），渲染 Ink App
├── cli-commands.ts                 # CLI 命令处理器（handleStart, handleResume, handleResumeList）
│
├── types/
│   ├── adapter.ts                  # CLIAdapter 接口、ExecOptions、OutputChunk、CLIRegistryEntry、ParserType
│   ├── session.ts                  # SessionConfig、StartArgs、ValidationResult、StartResult
│   └── ui.ts                       # RoleName、RoleStyle、ROLE_STYLES、Message、ScrollState、MessageMetadata
│
├── adapters/
│   ├── registry.ts                 # 12 种 CLI 工具注册表（CLI_REGISTRY），含命令、检测方式、parser 类型
│   ├── detect.ts                   # 并行检测已安装的 CLI 工具（3s 超时）、自定义适配器加载（.duo/adapters.json）
│   ├── factory.ts                  # Adapter 工厂（createAdapter），按名称实例化
│   ├── output-stream-manager.ts    # 多消费者输出流广播、中断处理、缓冲区管理
│   ├── process-manager.ts          # [NEW] 子进程生命周期：detached spawn、SIGTERM/SIGKILL 优雅退出、心跳检测、超时、缓冲区限制
│   ├── env-builder.ts              # [NEW] 子进程环境隔离：BASE_ENV_VARS + requiredVars + requiredPrefixes + extraEnv
│   ├── claude-code/adapter.ts      # Claude Code 适配器（stream-json）
│   ├── codex/adapter.ts            # Codex 适配器（jsonl）
│   ├── gemini/adapter.ts           # Gemini CLI 适配器（stream-json）
│   ├── copilot/adapter.ts          # GitHub Copilot 适配器（jsonl）
│   ├── aider/adapter.ts            # Aider 适配器（text）
│   ├── amazon-q/adapter.ts         # Amazon Q 适配器（text）
│   ├── cursor/adapter.ts           # Cursor 适配器（jsonl）
│   ├── cline/adapter.ts            # Cline 适配器（jsonl）
│   ├── continue/adapter.ts         # Continue 适配器（jsonl）
│   ├── goose/adapter.ts            # Goose 适配器（text）
│   ├── amp/adapter.ts              # Amp 适配器（stream-json）
│   └── qwen/adapter.ts             # Qwen 适配器（stream-json）
│
├── parsers/
│   ├── index.ts                    # 统一解析器导出（StreamJsonParser, JsonlParser, TextStreamParser）
│   ├── text-stream-parser.ts       # 纯文本流解析，代码块提取 + 错误模式检测（Aider、Amazon Q、Goose）
│   ├── stream-json-parser.ts       # [NEW] NDJSON stream-json 解析，畸形行计数（Claude Code、Gemini、Amp、Qwen）
│   └── jsonl-parser.ts             # [NEW] JSONL 格式解析，畸形行计数（Codex、Cline、Copilot、Cursor、Continue）
│
├── session/
│   ├── session-starter.ts          # 会话创建：parseStartArgs、validateProjectDir、validateCLIChoices、createSessionConfig
│   ├── session-manager.ts          # [NEW] 会话持久化：SessionManager 类，snapshot.json 原子写入（tmp+rename），
│   │                               #   history.jsonl 追加写入，legacy 格式兼容（session.json + state.json + history.json），
│   │                               #   崩溃容错（最后一行截断跳过），类型守卫验证
│   └── context-manager.ts          # [NEW] Prompt 构建：ContextManager 类，Coder/Reviewer 模板（含中英双语指令），
│                                   #   历史摘要（最近 3 轮完整 + 旧轮摘要），Token 预算（80% context window），
│                                   #   自定义模板加载（.duo/prompts/），单次 pass 模板解析防注入，
│                                   #   结构化 key points 提取，Previous Feedback Checklist 生成
│
├── decision/
│   ├── choice-detector.ts          # 选择题检测（ABC、123、方案一/二、Option、Bullet），代码块过滤，
│   │                               #   buildForwardPrompt 生成对方 LLM 作答 prompt
│   └── convergence-service.ts      # [NEW] ConvergenceService 类：
│                                   #   classify（[APPROVED] > soft approval > changes_requested），
│                                   #   evaluate（终止条件：approved/soft_approved/max_rounds/loop_detected/diminishing_issues），
│                                   #   countBlockingIssues（优先 "Blocking: N" 行 > 启发式标记计数），
│                                   #   detectLoop（Jaccard 关键词相似度 >= 0.35），
│                                   #   detectProgressTrend（improving/stagnant/unknown），
│                                   #   CJK bigram + 英文关键词提取
│
├── engine/
│   ├── workflow-machine.ts         # xstate v5 状态机：11 states, 20+ events, 7 guards，
│   │                               #   WorkflowContext（round/maxRounds/taskPrompt/activeProcess/lastError/lastCoderOutput/lastReviewerOutput/sessionId），
│   │                               #   支持序列化/反序列化实现会话恢复（RESUMING -> RESTORED_TO_*）
│   └── interrupt-handler.ts        # 中断处理：单击 Ctrl+C 中断 + 保留输出，双击 Ctrl+C（<500ms）保存会话并退出，
│                                   #   文本中断（用户边打字边中断），handleUserInput 恢复
│
└── ui/
    ├── 状态文件：
    │   ├── scroll-state.ts         # 滚动状态管理（offset/viewportHeight/totalLines/autoFollow）
    │   ├── round-summary.ts        # 轮次摘要生成
    │   ├── display-mode.ts         # 显示模式切换
    │   ├── directory-picker-state.ts  # 目录选择器状态
    │   ├── keybindings.ts          # 快捷键绑定定义
    │   ├── overlay-state.ts        # Overlay 覆盖层状态管理
    │   ├── markdown-parser.ts      # Markdown 解析渲染
    │   ├── git-diff-stats.ts       # Git diff 统计信息
    │   ├── session-runner-state.ts # Session runner 状态
    │   └── message-lines.ts        # [NEW] 消息行处理
    │
    └── components/
        ├── App.tsx                 # 应用根组件，连接 xstate 状态机与 UI
        ├── MainLayout.tsx          # [NEW] 主布局组件
        ├── StatusBar.tsx           # 状态栏（当前状态、轮次、活跃进程）
        ├── CodeBlock.tsx           # 代码块语法高亮渲染
        ├── ScrollIndicator.tsx     # 滚动指示器
        ├── DirectoryPicker.tsx     # 目录选择器组件
        ├── HelpOverlay.tsx         # 帮助面板覆盖层
        ├── ContextOverlay.tsx      # 上下文面板覆盖层
        ├── TimelineOverlay.tsx     # 时间线面板覆盖层
        ├── SearchOverlay.tsx       # 搜索面板覆盖层
        ├── InputArea.tsx           # 用户输入区域
        ├── SystemMessage.tsx       # 系统消息显示
        ├── ConvergenceCard.tsx     # 收敛结果卡片
        ├── DisagreementCard.tsx    # 分歧展示卡片
        ├── MessageView.tsx         # 消息视图（Coder/Reviewer 输出）
        └── StreamRenderer.tsx      # 流式输出实时渲染器
```

## 模块文档导航

| 文档 | 内容 |
|------|------|
| [系统架构](./architecture.md) | 分层架构、数据流、状态机详解、设计决策 |
| [模块文档](./modules/) | 各模块的详细设计文档 |

## 快速开始

### 环境要求

- Node.js >= 20
- 至少安装两个支持的 AI CLI 工具（如 `claude`、`codex`、`gemini` 等）

### 安装与运行

```bash
# 安装依赖
npm install

# 开发模式运行
npm run dev
# 等价于: tsx src/cli.ts

# 构建
npm run build
# 等价于: tsup src/cli.ts --format esm
# 产物输出到 dist/

# 运行测试
npm test
# 等价于: vitest run
```

## CLI 命令

### `duo start` — 启动新会话

```bash
# 交互模式（引导式设置）
duo start

# 命令行模式（直接启动）
duo start --coder claude-code --reviewer codex --task "Add JWT auth"

# 指定项目目录
duo start --dir /path/to/project --coder gemini --reviewer claude-code --task "Fix login bug"
```

**参数说明：**

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--dir <path>` | 项目目录 | 当前目录（`process.cwd()`） |
| `--coder <cli>` | Coder 角色使用的 CLI 工具名 | 必填 |
| `--reviewer <cli>` | Reviewer 角色使用的 CLI 工具名 | 必填 |
| `--task <desc>` | 任务描述 | 必填 |

如果未提供必填参数，将进入交互模式引导用户完成设置。

### `duo resume` — 恢复会话

```bash
# 列出所有可恢复的会话
duo resume

# 恢复指定会话（支持短 ID，取前 8 位）
duo resume <session-id>
```

会话数据存储在 `.duo/sessions/<id>/` 目录，包含 `snapshot.json`（元数据+状态）和 `history.jsonl`（对话历史）。

### `duo --version` — 显示版本

```bash
duo --version    # 或 duo -v
```

## 依赖说明

### Runtime 依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `ink` | ^6.8.0 | React for CLI — 终端 TUI 渲染框架 |
| `react` | ^19.2.4 | UI 组件模型 |
| `xstate` | ^5.28.0 | 有限状态机引擎，驱动 Coder-Reviewer 工作流 |
| `@xstate/react` | ^6.1.0 | xstate 的 React hooks 绑定 |

### Dev 依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `typescript` | ^5.9.3 | TypeScript 编译器（strict 模式） |
| `tsup` | ^8.5.1 | TypeScript 打包工具（ESM 格式输出） |
| `tsx` | ^4.21.0 | TypeScript 即时执行（开发模式） |
| `vitest` | ^4.0.18 | 单元测试框架 |
| `eslint` | ^10.0.3 | 代码检查 |
| `ink-testing-library` | ^4.0.0 | Ink 组件测试工具 |
| `@types/node` | ^25.4.0 | Node.js 类型定义 |
| `@types/react` | ^19.2.14 | React 类型定义 |

## 支持的 AI CLI 工具

| 工具 | 命令 | 执行命令 | 输出格式 | Parser 类型 | YOLO 标志 |
|------|------|----------|----------|-------------|-----------|
| Claude Code | `claude` | `claude -p` | stream-json | StreamJsonParser | `--dangerously-skip-permissions` |
| Codex | `codex` | `codex exec` | --json | JsonlParser | `--yolo` |
| Gemini CLI | `gemini` | `gemini -p` | stream-json | StreamJsonParser | `--yolo` |
| GitHub Copilot | `copilot` | `copilot -p` | JSON | JsonlParser | `--allow-all-tools` |
| Aider | `aider` | `aider -m` | text | TextStreamParser | `--yes-always` |
| Amazon Q | `q` | `q chat --no-interactive` | text | TextStreamParser | `--trust-all-tools` |
| Cursor | `cursor` | `cursor agent -p` | JSON | JsonlParser | `--auto-approve` |
| Cline | `cline` | `cline -y` | --json | JsonlParser | `-y` |
| Continue | `cn` | `cn -p` | --format json | JsonlParser | `--allow` |
| Goose | `goose` | `goose run -t` | text | TextStreamParser | `GOOSE_MODE=auto` |
| Amp | `amp` | `amp -x` | stream-json | StreamJsonParser | (无) |
| Qwen | `qwen` | `qwen -p` | stream-json | StreamJsonParser | `--yolo` |

# Duo — 多 AI 编程助手协作平台需求文档

> **产品名称**：Duo
> **版本**：v1.0 需求定义
> **日期**：2026-03-09
> **状态**：已审批（v1.1 更新：OQ 解决）

---

## 1. Executive Summary

### 问题

当前 AI 编程助手（Claude Code、Codex、Gemini CLI 等）都是"单打独斗"模式。单一 AI 的盲区和偏见无法被自我发现，开发者需要手动在多个工具之间切换、复制粘贴上下文来获取"第二意见"，流程繁琐且上下文丢失严重。

### 解决方案

Duo 是一个 Mac 终端 TUI 应用，让多个 AI 编程助手在同一个项目上进行**结构化协作对话**。用户指定一个编码者和一个审查者，Duo 自动编排"编码 → 审查 → 评估 → 循环"的工作流，直到达成收敛或达到轮数上限。用户可以随时打断并注入自己的意见。

### 成功指标（KPI）

| 指标 | 目标 | 衡量方式 |
|------|------|----------|
| 协作完成率 | ≥80% 的会话正常完成（非异常退出） | 会话日志统计 |
| 平均收敛轮数 | ≤3 轮 | 会话元数据 |
| 用户打断率 | ≤30%（过高说明工作流有问题） | 会话日志 |
| 审查发现问题数 | ≥1 个/轮（说明审查有效） | LLM 输出分析 |
| 会话恢复成功率 | ≥95% | 恢复测试 |

---

## 2. Strategic Goals & Traceability

```
SG-1: 让多个 AI 编程助手在同一项目上进行结构化协作
  traces_to: 产品核心价值

SG-2: 提供清晰的协作过程可视化与用户控制
  traces_to: 用户体验与信任

SG-3: 支持可扩展的多 LLM CLI 工具生态
  traces_to: 产品竞争壁垒与长期价值
```

---

## 3. User Personas & Scenarios

### Persona 1: 资深全栈开发者（主要用户）

- **特征**：日常使用 Claude Code / Codex CLI，终端重度用户，关注代码质量
- **痛点**：单一 AI 容易遗漏边界情况，想要自动化的"第二视角"审查
- **场景**：用 Claude Code 实现新功能 → Codex 自动审查 → Claude Code 根据审查修改 → 直到审查通过

### Persona 2: 技术负责人

- **特征**：关注架构决策质量，希望看到多种技术观点的碰撞
- **痛点**：架构决策依赖个人经验，缺少系统性的挑战和验证
- **场景**：让两个 AI 讨论技术方案选型 → 观察各自论据 → 基于讨论做最终决策

### Persona 3: AI 工具爱好者

- **特征**：喜欢探索和对比不同 AI 工具的能力
- **痛点**：手动切换工具、复制上下文、对比输出非常繁琐
- **场景**：让 Claude Code 和 Gemini CLI 各自实现同一功能 → 对比输出质量

---

## 4. Capability Domains & Feature Hierarchy

### CD-1.1: 会话管理 [complexity: Standard]

> traces_to: SG-1
> priority: Must

#### FR-001: 创建新会话

- **描述**：用户通过 CLI 命令启动 Duo，指定项目目录和角色分配
- **启动方式**：`duo start --dir ~/projects/myapp --coder claude --reviewer codex`
- **也支持交互式启动**：`duo start`（进入引导流程）
- **角色分配**：用户选择哪个 LLM 担任 Coder、哪个担任 Reviewer
- **任务描述**：用户输入本次协作的任务描述
- **验收标准**：
  - AC-001: 支持命令行参数和交互式两种启动方式
  - AC-002: 启动前检测项目目录是否存在、是否为 git 仓库
  - AC-003: 启动前检测指定 CLI 工具是否已安装，未安装给出友好提示
  - AC-004: 角色分配支持所有已注册的 LLM CLI 工具
- depends_on: [FR-008]
- traces_to: [SG-1, CD-1.1]

#### FR-002: 会话历史持久化与恢复

- **描述**：会话数据存储在项目目录 `.duo/` 下，支持退出后恢复
- **存储内容**：会话元数据、对话历史、轮次信息、状态机快照
- **恢复方式**：`duo resume`（列出可恢复会话）或 `duo resume <session-id>`
- **验收标准**：
  - AC-005: 会话元数据在每次状态转换时自动持久化
  - AC-006: 恢复后能正确还原到退出时的状态（包括轮次、角色分配、对话历史）
  - AC-007: 恢复时检测项目目录是否仍然存在
  - AC-008: 支持列出历史会话，显示项目名、任务、轮次、状态、时间
- depends_on: [FR-004]
- traces_to: [SG-1, CD-1.1]

#### FR-003: 会话上下文管理

- **描述**：管理传递给每个 LLM 的上下文，确保协作质量
- **策略**：
  - 两个 LLM 都直接读项目文件（零额外成本）
  - 每轮结束生成 ≤200 token 的轮次摘要传递给下一轮
  - System prompt 中注入角色指令和协作规则
- **Prompt 模板**：
  - Coder prompt：包含任务描述 + 历史轮次摘要 + "不要向用户提问，自主决策" 指令
  - Reviewer prompt：包含任务描述 + 历史轮次摘要 + 审查指令 + "给出具体代码行级反馈"
- **验收标准**：
  - AC-009: Prompt 模板存储在 `.duo/prompts/` 下，用户可自定义
  - AC-010: 轮次摘要由轻量 LLM 自动生成（≤200 token）
  - AC-011: 上下文大小不超过目标 LLM 的 context window 限制
- depends_on: []
- traces_to: [SG-1, CD-1.1]

---

### CD-1.2: 协作工作流引擎 [complexity: Deep]

> traces_to: SG-1, SG-2
> priority: Must

#### FR-004: 轮流工作流编排

- **描述**：使用 xstate v5 状态机编排"编码 → 审查 → 评估 → 循环"的核心工作流
- **状态定义**：

```
States:
  IDLE          — 初始状态，等待用户输入任务
  CODING        — Coder LLM 正在工作
  ROUTING_POST_CODE — 路由判断编码输出（选择题检测等）
  REVIEWING     — Reviewer LLM 正在审查
  ROUTING_POST_REVIEW — 路由判断审查输出
  EVALUATING    — 评估是否收敛
  WAITING_USER  — 等待用户决策（打断后 / 达到轮数上限 / 收敛确认）
  INTERRUPTED   — 用户打断，进程已终止
  RESUMING      — 恢复会话中
  DONE          — 协作完成
  ERROR         — 异常状态

Events:
  START_TASK        — 用户输入任务描述
  CODE_COMPLETE     — Coder 输出完成
  REVIEW_COMPLETE   — Reviewer 输出完成
  CONVERGED         — 判定已收敛
  NOT_CONVERGED     — 判定未收敛，需继续
  USER_INTERRUPT    — 用户打断（Ctrl+C）
  USER_INPUT        — 用户输入新指令
  USER_CONFIRM      — 用户确认继续/结束
  PROCESS_ERROR     — 子进程异常
  TIMEOUT           — 超时
  RESUME_SESSION    — 恢复会话
```

- **验收标准**：
  - AC-012: 使用 xstate v5 实现，所有状态转换有明确的 guard 条件
  - AC-013: 状态机支持序列化/反序列化（配合会话恢复）
  - AC-014: 同一时刻只有 1 个 LLM 子进程在运行（严格串行）
  - AC-015: 每次状态转换时自动持久化状态快照
- depends_on: [FR-008, FR-009, FR-010]
- traces_to: [SG-1, CD-1.2]

#### FR-005: 收敛判定与终止条件

- **描述**：判定两个 LLM 是否已达成收敛，决定是否继续下一轮
- **判定规则**：

```
终止条件（满足任一即终止）：
  1. Reviewer 明确表示 "approved" / "没有更多意见"（LLM 判定）
  2. 达到最大轮数限制（用户可配置，默认 5 轮）
  3. 用户手动终止
  4. 连续 2 轮 Reviewer 未提出新问题（循环检测）

继续条件：
  - Reviewer 提出了具体的修改建议（changes_requested）
  - 当前轮数 < 最大轮数
```

- **验收标准**：
  - AC-016: 使用轻量 LLM（如 Haiku）对 Reviewer 输出进行分类：approved / changes_requested / questions
  - AC-017: 最大轮数可在创建会话时配置，默认 5 轮
  - AC-018: 达到轮数上限时自动进入 WAITING_USER 状态，由用户决定继续或结束
  - AC-019: 检测循环模式（连续 2 轮相同反馈主题），提醒用户
- depends_on: [FR-004, FR-010]
- traces_to: [SG-1, CD-1.2]

#### FR-006: 选择题检测与自动路由

- **描述**：当 LLM 输出包含选择题时，自动路由给对方 LLM 或用户决策
- **实现策略**：
  - **首选**：通过 system prompt 明确指示 LLM 不要提出选择题，自主决策
  - **兜底**：简单正则检测（问号结尾 + 编号列表/A/B/C 模式），触发时路由
- **路由规则**：
  - 检测到选择题 → 将问题转发给对方 LLM 自动选择
  - 对方 LLM 选择后 → 原 LLM 继续工作
- **验收标准**：
  - AC-020: System prompt 包含明确的"不要提问，自主决策"指令
  - AC-021: 正则检测覆盖常见选择题模式（A/B/C、1/2/3、方案一/方案二）
  - AC-022: 路由判断在 ≤2 秒内完成
  - AC-023: 误判时用户可手动覆盖路由决策
- depends_on: [FR-004, FR-003]
- traces_to: [SG-1, CD-1.2]
- priority: Should

#### FR-007: 用户打断与重新决策流程

- **描述**：用户可随时通过 Ctrl+C 打断当前 LLM 工作，输入新指令后继续
- **流程**：

```
1. 用户按 Ctrl+C（或在输入框输入文字并回车）
2. 系统立即 kill 当前 LLM 子进程（SIGTERM → 5s → SIGKILL）
3. 保留已有的流式输出内容
4. 进入 INTERRUPTED 状态，显示："已停止，请输入指令"
5. 用户输入新指令
6. 系统将用户指令 + 已有上下文构建新的 prompt
7. 按当前轮次继续（不计入新轮次）
```

- **双击 Ctrl+C（<500ms 间隔）**：退出应用（保存会话状态）
- **验收标准**：
  - AC-024: Ctrl+C 在 ≤1 秒内终止当前 LLM 进程
  - AC-025: 已有的流式输出保留在消息流中，标记为 `(interrupted)`
  - AC-026: 打断后用户输入的指令作为追加上下文传给 LLM
  - AC-027: 支持在 LLM 运行中直接输入文字并回车，等同于"带指令的打断"
  - AC-028: 双击 Ctrl+C 退出应用前自动保存会话状态
- depends_on: [FR-004, FR-011, FR-002]
- traces_to: [SG-1, SG-2, CD-1.2]

---

### CD-1.3: CLI 适配层 [complexity: Deep]

> traces_to: SG-1, SG-3
> priority: Must

#### FR-008: CLIAdapter 插件化架构

- **描述**：设计统一的 CLIAdapter 接口，支持多种 LLM CLI 工具的即插即用
- **接口定义**：

```typescript
interface CLIAdapter {
  readonly name: string              // 如 "claude-code", "codex", "gemini"
  readonly displayName: string       // 如 "Claude Code", "Codex", "Gemini CLI"
  readonly version: string           // CLI 版本

  isInstalled(): Promise<boolean>
  getVersion(): Promise<string>
  execute(prompt: string, opts: ExecOptions): AsyncIterable<OutputChunk>
  kill(): Promise<void>
  isRunning(): boolean
}

interface ExecOptions {
  cwd: string                        // 项目目录
  systemPrompt?: string              // 系统提示
  env?: Record<string, string>       // 环境变量覆盖
  timeout?: number                   // 超时毫秒数
  permissionMode?: 'skip' | 'safe'   // 权限模式
}

interface OutputChunk {
  type: 'text' | 'code' | 'tool_use' | 'tool_result' | 'error' | 'status'
  content: string
  metadata?: Record<string, unknown>
  timestamp: number
}
```

- **v1 内置适配器注册表**（12 个主流工具）：

| # | 适配器 | CLI 命令 | 检测命令 | 非交互调用 | 输出格式 | YOLO 模式 |
|---|--------|---------|---------|-----------|---------|-----------|
| 1 | ClaudeCodeAdapter | `claude` | `claude --version` | `claude -p` | stream-json | `--dangerously-skip-permissions` |
| 2 | CodexAdapter | `codex` | `codex --version` | `codex exec` | `--json` (JSONL) | `--yolo` |
| 3 | GeminiAdapter | `gemini` | `gemini --version` | `gemini -p` | stream-json | `--yolo` |
| 4 | CopilotAdapter | `copilot` | `copilot --version` | `copilot -p` | JSON | `--allow-all-tools` |
| 5 | AiderAdapter | `aider` | `aider --version` | `aider -m` | 纯文本 | `--yes-always` |
| 6 | AmazonQAdapter | `q` | `q version` | `q chat --no-interactive` | text | `--trust-all-tools` |
| 7 | CursorAdapter | `cursor` | `cursor --version` | `cursor agent -p` | JSON | `--auto-approve` |
| 8 | ClineAdapter | `cline` | `cline --version` | `cline -y` | `--json` (JSONL) | `-y` |
| 9 | ContinueAdapter | `cn` | `cn --version` | `cn -p` | `--format json` | `--allow` |
| 10 | GooseAdapter | `goose` | `goose --version` | `goose run -t` | text | `GOOSE_MODE=auto` |
| 11 | AmpAdapter | `amp` | `amp --version` | `amp -x` | stream-json | 内置 |
| 12 | QwenAdapter | `qwen` | `qwen --version` | `qwen -p` | stream-json | `--yolo` |

- **自动检测机制**：启动时扫描所有注册表中的 CLI 工具（`which` + `--version`），自动发现已安装的工具并展示给用户选择
- **输出解析器复用**：按输出格式分类，共 3 类解析器：
  - `StreamJsonParser` — 用于 stream-json 格式（Claude Code、Gemini、Amp、Qwen）
  - `JsonlParser` — 用于 JSONL/--json 格式（Codex、Cline）
  - `TextStreamParser` — 用于纯文本格式（Aider、Amazon Q、Goose）
  - JSON 格式（Copilot、Cursor、Continue）可由 JsonlParser 适配

- **验收标准**：
  - AC-029: CLIAdapter 接口定义清晰，新增适配器只需实现接口
  - AC-030: 启动时自动检测所有 12 个注册表中的 CLI 工具（并行检测，≤3 秒）
  - AC-031: 适配器目录：`src/adapters/<name>/`，每个适配器可独立测试
  - AC-032: 适配器注册表支持用户自定义扩展（`.duo/adapters.json`）
  - AC-033-new: 按输出格式复用解析器，避免为每个 CLI 重复编写解析逻辑
- depends_on: []
- traces_to: [SG-3, CD-1.3]

#### FR-009: Claude Code 适配器实现

- **描述**：Claude Code CLI 的具体适配实现
- **关键实现细节**：
  - 必须 `delete env.CLAUDECODE` 解除嵌套会话限制
  - 使用 `--print --output-format stream-json` 获取结构化流式输出
  - 使用 `--system-prompt` 注入角色指令
  - 使用 `--dangerously-skip-permissions` 跳过权限检查
  - 使用 `--add-dir` 指定项目目录
  - 解析 NDJSON 事件：text、tool_use、tool_result、error、result
- **验收标准**：
  - AC-033: 正确解析所有 stream-json 事件类型
  - AC-034: 环境变量隔离，不影响宿主进程
  - AC-035: 支持 `--continue` / `--resume` 进行原生会话恢复
- depends_on: [FR-008]
- traces_to: [SG-1, CD-1.3]

#### FR-010: Codex 适配器实现

- **描述**：Codex CLI 的具体适配实现
- **关键实现细节**：
  - 使用 `codex exec <prompt>` 进行非交互执行
  - `codex review` 可用于 Reviewer 角色（天然适配）
  - 使用 `--yolo` 跳过审批和沙盒限制
  - **已确认支持 `--json` 标志**：输出换行分隔的 JSON 事件（JSONL），可结构化解析
  - `-o / --output-last-message` 可将最终消息写入文件
  - 推荐在 git 仓库中运行
- **验收标准**：
  - AC-036: 支持 exec 和 review 两种调用模式
  - AC-037: 使用 `--json` 标志获取 JSONL 输出，复用 JsonlParser 解析
  - AC-038: 启动前检测当前目录是否为 git 仓库，非 git 仓库给出警告
- depends_on: [FR-008]
- traces_to: [SG-1, CD-1.3]

#### FR-011: Gemini CLI 适配器实现

- **描述**：Google Gemini CLI 的适配实现
- **关键实现细节**：
  - 使用 `gemini -p <prompt>` 进行非交互执行
  - `--non-interactive` 阻止交互式提示
  - **已确认支持 `--output-format stream-json`**：与 Claude Code 完全相同的流式 JSON 格式
  - 使用 `--yolo` 自动批准命令执行
  - 不强制要求 git 仓库
  - 复用 StreamJsonParser（与 Claude Code 共用）
- **验收标准**：
  - AC-039: 实现 CLIAdapter 接口
  - AC-040: 使用 stream-json 格式，复用 StreamJsonParser
  - AC-041-new: 支持 `--yolo` 模式自动批准
- depends_on: [FR-008]
- traces_to: [SG-3, CD-1.3]

#### FR-011b: 其余 9 个适配器实现

- **描述**：Copilot、Aider、Amazon Q、Cursor、Cline、Continue、Goose、Amp、Qwen 的适配实现
- **实现策略**：
  - 按优先级分批实现：第一批（Copilot、Aider）→ 第二批（Amp、Cline、Qwen）→ 第三批（其余）
  - 每个适配器复用对应的解析器（StreamJson / JSONL / Text）
  - 适配器之间独立，可以增量交付
- **验收标准**：
  - AC-042-new: 每个适配器通过 CLIAdapter 接口合规测试
  - AC-043-new: 每个适配器有独立的单元测试
  - AC-044-new: 用户可通过 `.duo/adapters.json` 禁用不需要的适配器
- depends_on: [FR-008]
- traces_to: [SG-3, CD-1.3]

#### FR-012: 进程生命周期管理

- **描述**：管理 CLI 子进程的完整生命周期
- **关键行为**：
  - **启动**：`child_process.spawn` with detached process group，独立环境变量
  - **终止**：SIGTERM → 等待 5 秒 → SIGKILL，使用 `process.kill(-pid)` 杀整个进程组
  - **超时**：可配置最大执行时间（默认 10 分钟），超时自动终止
  - **异常**：进程崩溃、非零退出码 → 进入 ERROR 状态，通知用户
  - **心跳**：每 30 秒检测进程是否仍在运行，无输出超过 60 秒发出警告
- **验收标准**：
  - AC-041: 子进程使用独立环境变量和 CWD
  - AC-042: kill 使用进程组信号，确保子子进程也被终止
  - AC-043: 超时、崩溃、挂起三种异常都有对应处理逻辑
  - AC-044: 不产生僵尸进程
- depends_on: []
- traces_to: [SG-1, CD-1.3]

#### FR-013: 流式输出捕获与解析

- **描述**：实时捕获 CLI 子进程的输出流并解析为统一格式
- **解析策略**：
  - Claude Code（stream-json）：逐行 JSON.parse → 提取 text/tool_use/error 事件
  - Codex / Gemini（文本流）：逐行读取 → 正则提取代码块 → 映射为 OutputChunk
- **统一输出流**：所有适配器输出 `AsyncIterable<OutputChunk>`，上层无需关心 CLI 差异
- **验收标准**：
  - AC-045: 流式输出延迟 ≤100ms（从 CLI 产出到 TUI 渲染）
  - AC-046: 支持 Markdown 内容（代码块、列表、表格）的正确识别
  - AC-047: 输出中断（进程被 kill）时保留已接收的部分输出
- depends_on: [FR-008]
- traces_to: [SG-1, SG-2, CD-1.3]

---

### CD-1.4: 终端 UI (TUI) [complexity: Deep]

> traces_to: SG-2
> priority: Must

#### FR-014: 群聊式消息展示窗口

- **描述**：主界面采用群聊式消息流布局，清晰展示多方对话

**主界面布局**：
```
┌─────────────────────────────────────────────────────────┐
│ Duo    my-app/    Round 3/5    Claude:Coder ◆ Active    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┃ [Claude · Coder] 14:32                               │
│  ┃ I've implemented the JWT middleware...               │
│  ┃ ```typescript                                        │
│  ┃ // src/middleware/auth.ts (collapsed, 48 lines)      │
│  ┃ ```                                                  │
│  ┃ [▶ Expand · 48 lines]                                │
│  ┃                                                      │
│  ═══════ Round 3 · Summary: Auth added, needs review ══ │
│                                                         │
│  ║ [Codex · Reviewer] 14:35                             │
│  ║ Missing error handling for malformed tokens...       │
│  ║ ▌ (streaming)                                        │
│                                                         │
├─ Input ─────────────────────────────────────────────────┤
│ > Type to interrupt, or wait for completion...          │
├─────────────────────────────────────────────────────────┤
│ ^C Interrupt │ ^I Context │ ^L Clear │ ? Help           │
└─────────────────────────────────────────────────────────┘
```

- **消息样式区分**：

| 角色 | 颜色 | 边界标记 | 名称格式 |
|------|------|----------|----------|
| Claude Code | 蓝色 | `┃` | **[Claude · Coder]** |
| Codex | 绿色 | `║` | **[Codex · Reviewer]** |
| Gemini | 橙色 | `│` | **[Gemini · Coder]** |
| System | 黄色 | `·` | **[System]** |
| User | 白色 | `>` | **[You]** |

- **验收标准**：
  - AC-048: 每条消息包含角色标识（颜色+边界标记）、角色名+职责、时间戳、内容
  - AC-049: 消息流支持滚动浏览（j/k 或 ↑/↓ 逐行，PgUp/PgDn 翻页，G 跳到最新）
  - AC-050: 颜色方案色盲友好（颜色+形状双重编码）
  - AC-051: 最小终端尺寸：80 列 x 24 行
- depends_on: [FR-013]
- traces_to: [SG-2, CD-1.4]

#### FR-015: 代码块折叠

- **描述**：超过 10 行的代码块默认折叠，显示前 5 行 + 展开按钮
- **交互**：光标移到折叠块，按 Enter 展开/收起
- **验收标准**：
  - AC-052: 超过 10 行的代码块自动折叠
  - AC-053: 折叠状态显示前 5 行 + 文件名 + 总行数
  - AC-054: 展开/收起状态在滚动时保持
- depends_on: [FR-014]
- traces_to: [SG-2, CD-1.4]

#### FR-016: Smart Scroll Lock

- **描述**：智能滚动锁定机制，平衡自动跟随和手动浏览
- **行为**：
  - 默认自动跟随最新输出（auto-scroll）
  - 用户手动上滚 → 立即锁定视口，停止自动跟随
  - 底部显示浮动提示：`↓ New output (press G to follow)`
  - 按 G 重新跟随
- **验收标准**：
  - AC-055: 用户上滚一行即停止自动跟随
  - AC-056: 有新输出但视口已锁定时，显示浮动提示
  - AC-057: 按 G 立即跳到最新输出并重新启用自动跟随
- depends_on: [FR-014]
- traces_to: [SG-2, CD-1.4]

#### FR-017: 用户输入区域

- **描述**：底部固定的输入区域，始终可见可输入
- **行为**：
  - LLM 运行中：灰色提示 "Type to interrupt, or wait for completion..."
  - 等待用户输入：光标闪烁，白色
  - 输入文字并回车 = "带指令的打断"（kill 当前进程 → 用用户输入作为新指令）
  - 支持多行输入（Shift+Enter 或 Alt+Enter 换行）
  - 输入区域最多扩展到 5 行高度
- **验收标准**：
  - AC-058: 输入区域始终可见，即使 LLM 正在运行
  - AC-059: LLM 运行中输入文字并回车，触发打断并将文字作为新指令
  - AC-060: 支持多行输入
- depends_on: [FR-007]
- traces_to: [SG-2, CD-1.4]

#### FR-018: 状态指示

- **描述**：顶部状态栏实时显示协作状态

```
┌─────────────────────────────────────────────────────────┐
│ Duo    my-app/    Round 3/5    Claude:Coder ◆ Active    │
└─────────────────────────────────────────────────────────┘
  ↑ App   ↑ 项目    ↑ 轮次       ↑ 当前活跃 Agent + 状态
```

- **状态图标**：
  - `◆ Active` — 正在工作（绿色 + spinner 动画）
  - `◇ Idle` — 空闲
  - `⚠ Error` — 出错（红色）
  - `◈ Routing` — 路由判断中（黄色）
  - `⏸ Interrupted` — 已打断（白色）

- **额外信息**：当前会话累计 token 估算

- **验收标准**：
  - AC-061: 状态栏始终显示，1 行高度
  - AC-062: spinner 动画在 LLM 工作时持续显示
  - AC-063: 显示当前轮次 / 最大轮次
  - AC-064: 显示累计 token 估算
- depends_on: [FR-004]
- traces_to: [SG-2, CD-1.4]

#### FR-019: 项目目录选择器

- **描述**：交互式启动时的目录选择 TUI 组件
- **功能**：
  - 路径输入 + Tab 补全
  - 最近使用目录列表（MRU）
  - 自动扫描常见位置（`~/Projects`, `~/Developer`, `~/code`）发现 git 仓库

```
┌─ Select Project Directory ──────────────────────────┐
│  Path: ~/Projects/my-app█                           │
│  (Tab to autocomplete, ↑↓ to browse)                │
│                                                     │
│  Recent:                                            │
│  > ~/Projects/my-app                                │
│    ~/Projects/api-server                            │
│                                                     │
│  Discovered (git repos):                            │
│    ~/Projects/dashboard                             │
│    ~/code/backend                                   │
└─────────────────────────────────────────────────────┘
```

- **验收标准**：
  - AC-065: Tab 键路径补全功能正常
  - AC-066: MRU 列表持久化存储（`~/.duo/recent.json`）
  - AC-067: 选择非 git 仓库目录时给出警告（Codex 需要 git 仓库）
- depends_on: []
- traces_to: [SG-2, CD-1.4]

#### FR-020: 轮次摘要展示

- **描述**：每轮结束时在消息流中插入自动生成的摘要分隔线
- **格式**：

```
═══ Round 3→4 · Summary: Auth middleware added, reviewer requests error handling ═══
```

- **验收标准**：
  - AC-068: 摘要由轻量 LLM 自动生成（≤1 行，≤100 字符）
  - AC-069: 摘要在轮次分隔线中内嵌显示
- depends_on: [FR-003, FR-014]
- traces_to: [SG-2, CD-1.4]

#### FR-021: Minimal/Verbose Mode 切换

- **描述**：支持两种信息密度模式
- **Minimal Mode**（默认）：隐藏路由过程，只展示 LLM 对话和关键系统事件
- **Verbose Mode**（Ctrl+V 切换）：展示路由判断过程、时间戳、token 计数、CLI 命令详情
- **验收标准**：
  - AC-070: Ctrl+V 实时切换模式
  - AC-071: Verbose 模式展示每次 CLI 调用的完整命令和参数
- depends_on: [FR-014]
- traces_to: [SG-2, CD-1.4]

#### FR-022: 快捷键体系

- **描述**：完整的键盘快捷键系统

| 快捷键 | 功能 | 上下文 |
|--------|------|--------|
| `Ctrl+C` | 打断当前 LLM（单击）/ 退出（双击） | 全局 |
| `Ctrl+N` | 新建会话 | 全局 |
| `Ctrl+I` | 查看上下文摘要（overlay） | 会话中 |
| `Ctrl+V` | 切换 Minimal/Verbose 模式 | 会话中 |
| `Ctrl+T` | 查看事件时间线 | 会话中 |
| `Ctrl+L` | 清屏（不清历史） | 会话中 |
| `j/k` 或 `↑/↓` | 滚动消息 | 消息区域 |
| `G` | 跳到最新消息 | 消息区域 |
| `Enter` | 展开/收起代码块 | 消息区域 |
| `Tab` | 路径补全 | 输入框 |
| `?` | 帮助/快捷键列表 | 全局 |
| `/` | 搜索消息历史 | 会话中 |
| `Esc` | 关闭 overlay / 返回上层 | overlay 中 |

- **验收标准**：
  - AC-072: 所有快捷键功能正常
  - AC-073: `?` 键显示完整快捷键列表
  - AC-074: 快捷键不与终端默认行为冲突
- depends_on: [FR-014]
- traces_to: [SG-2, CD-1.4]

---

### CD-2.1: 实时输出展示 [complexity: Standard]

> traces_to: SG-2
> priority: Must

#### FR-023: 流式渲染 LLM 输出

- **描述**：实时渲染 LLM 的流式输出
- **渲染策略**：
  - 逐行渲染（非逐字符），每 100ms 批量刷新
  - Markdown 实时解析（代码块语法高亮、列表格式化）
  - 流式中的代码块用不同背景色标记
- **验收标准**：
  - AC-075: 从 CLI 输出到 TUI 渲染延迟 ≤100ms
  - AC-076: 代码块在 ` ``` ` 关闭前就开始高亮渲染
  - AC-077: 长输出时不出现 TUI 卡顿或闪烁
- depends_on: [FR-013, FR-014]
- traces_to: [SG-2, CD-2.1]

---

### CD-2.2: 决策过程可视化 [complexity: Standard]

> traces_to: SG-2
> priority: Should

#### FR-024: 选择题检测过程展示

- **描述**：当选择题被检测到并路由时，在消息流中展示系统决策卡片
- **展示格式**（Verbose 模式下完整展示，Minimal 模式简化）：

```
· [Router] Choice detected → Forwarding to Codex for selection
```

- **验收标准**：
  - AC-078: Minimal 模式下一行展示路由结果
  - AC-079: Verbose 模式下展示检测原因和路由逻辑
- depends_on: [FR-006, FR-021]
- traces_to: [SG-2, CD-2.2]

#### FR-025: 打断→重新决策过程展示

- **描述**：用户打断后展示状态变化时间线
- **展示格式**：

```
⚠ INTERRUPTED - Claude process terminated (output: 847 chars)
> Waiting for your instructions...
```

- **验收标准**：
  - AC-080: 打断时显示已输出内容量
  - AC-081: 明确指示系统正在等待用户输入
- depends_on: [FR-007, FR-014]
- traces_to: [SG-2, CD-2.2]

#### FR-026: 收敛/分歧状态展示

- **描述**：当检测到收敛或分歧时，展示可视化卡片

**收敛卡片**：
```
┌─────────────────────────────────────────────────────┐
│  ✓ CONVERGED after 4 rounds                         │
│  Both agents agree on the implementation.           │
│  Files modified: 4  Lines changed: +182 / -23       │
│                                                     │
│  [A] Accept  [C] Continue  [R] Review Changes       │
└─────────────────────────────────────────────────────┘
```

**分歧卡片**：
```
┌─────────────────────────────────────────────────────┐
│  ⚡ DISAGREEMENT · Round 6                           │
│  Agreed: 1/3    Disputed: 2/3                       │
│                                                     │
│  [C] Continue  [D] Decide manually                  │
│  [A] Accept Coder's  [B] Accept Reviewer's          │
└─────────────────────────────────────────────────────┘
```

- **验收标准**：
  - AC-082: 收敛时展示修改文件数和变更行数统计
  - AC-083: 分歧时列出同意/争议点概要
  - AC-084: 用户可通过快捷键选择后续操作
- depends_on: [FR-005, FR-014]
- traces_to: [SG-2, CD-2.2]

---

## 5. Non-Functional Requirements

### NFR-001: 性能

- 流式输出渲染延迟 ≤100ms
- 打断响应时间 ≤1 秒
- TUI 在 80x24 终端中无卡顿
- 支持单次会话 ≥10 轮协作（上下文管理不崩溃）

### NFR-002: 可靠性

- 进程 kill 不产生僵尸进程
- 异常退出后会话可恢复
- CLI 工具崩溃不导致 Duo 崩溃（优雅降级）
- 网络断连时给出明确错误提示

### NFR-003: 安全性

- v1 采用跳过权限检查模式（用户已知悉风险）
- 不存储 API 密钥（依赖各 CLI 工具自身的认证机制）
- `.duo/` 目录不包含敏感信息

### NFR-004: 可维护性

- TypeScript 严格模式
- 单元测试覆盖率 ≥70%（核心模块：状态机、CLI 适配器、上下文管理）
- CLI 适配器可独立更新，不影响核心逻辑

### NFR-005: 技术架构

```
┌─────────────────────────────────────┐
│        TUI Layer (Ink/React)        │  ← 纯展示，组件化
├─────────────────────────────────────┤
│    Workflow Engine (xstate v5)      │  ← 状态机，编排协作流程
├─────────────────────────────────────┤
│      Context Manager                │  ← 上下文构建、摘要、Prompt 模板
├─────────────────────────────────────┤
│      CLI Adapter Layer              │  ← 插件化，CLIAdapter 接口
│   ┌──────┬───────┬────────┐        │
│   │Claude│ Codex │ Gemini │ ...    │
│   └──────┴───────┴────────┘        │
├─────────────────────────────────────┤
│   Session & Persistence Layer       │  ← .duo/ 本地存储
├─────────────────────────────────────┤
│   Decision Service                  │  ← 收敛判定、选择题检测
└─────────────────────────────────────┘
```

- **语言**：TypeScript（严格模式）
- **运行时**：Node.js ≥20
- **TUI 框架**：Ink (React for CLI)
- **状态管理**：xstate v5
- **进程管理**：Node.js child_process
- **存储**：本地 JSON 文件（`.duo/`）

---

## 6. Scope & Boundaries

### In-Scope (v1)

- 可配置主从协作模式（用户选择谁编码谁审查）
- 内置 12 个主流 LLM CLI 工具适配器注册表，启动时自动检测
- 完整 TUI 体验（折叠、Smart Scroll、摘要、模式切换、快捷键）
- 会话持久化与恢复
- 用户打断与指令注入
- 收敛判定与轮数控制
- 选择题检测与路由
- 流式输出与 Markdown 渲染

### Out-of-Scope (v1) — Non-Goals

| 非目标 | 理由 |
|--------|------|
| GUI / Electron / Web 界面 | 用户明确选择 TUI |
| 对等协作模式（两个都编码） | v1 聚焦主从模式，对等模式文件冲突复杂 |
| 自定义 LLM API 调用（非 CLI） | Duo 编排的是 CLI 工具，不是 API |
| 代码合并/冲突解决 | 串行执行避免冲突，超出 v1 范围 |
| 云同步/团队协作 | 个人工具，不做云端 |
| Prompt marketplace | v1 prompt 模板本地管理 |
| 费用计算（美元估算） | v1 只显示 token 估算，不做费用换算 |

---

## 7. Dependency Summary

```
FR-001 (创建会话) ← FR-008 (CLIAdapter 架构)
FR-002 (持久化) ← FR-004 (工作流引擎)
FR-004 (工作流) ← FR-008, FR-009, FR-010, FR-013
FR-005 (收敛判定) ← FR-004, FR-013
FR-006 (选择题) ← FR-004, FR-003
FR-007 (打断) ← FR-004, FR-012, FR-002
FR-009 (Claude Adapter) ← FR-008
FR-010 (Codex Adapter) ← FR-008
FR-011 (Gemini Adapter) ← FR-008
FR-014 (消息窗口) ← FR-013
FR-015-022 (TUI 组件) ← FR-014
FR-023 (流式渲染) ← FR-013, FR-014
FR-024-026 (可视化) ← FR-005/006/007, FR-014
```

**关键路径**：FR-008 → FR-009/010 → FR-013 → FR-004 → FR-014 → 其余 TUI 组件

---

## 8. Risks & Mitigations

### RSK-001: 核心价值假设未验证 [高]

- **描述**：两个 LLM 协作不一定比单个 LLM 产出更好。可能出现"礼貌性同意"（reviewer 总说好）或无效循环。
- **影响**：产品核心价值不成立
- **缓解**：
  - 精心设计 Reviewer prompt，要求给出具体代码行级反馈，不允许泛泛肯定
  - 内置协作效果度量（审查发现问题数、轮次收敛速度）
  - 如早期用户反馈不佳，快速 pivot 为"代码审查工具"而非"协作工具"
- traces_to: [SG-1]

### RSK-002: CLI 版本兼容性 [高]

- **描述**：Claude Code CLI 和 Codex CLI 都处于快速迭代期，输出格式和命令参数可能随时变化
- **影响**：适配器失效，产品不可用
- **缓解**：
  - CLIAdapter 抽象层隔离变化
  - 启动时版本检测，不兼容版本给出警告
  - 适配器独立更新，不影响核心
  - 关注 CLI 工具的 changelog
- traces_to: [CD-1.3]

### RSK-003: 上下文窗口溢出 [中]

- **描述**：多轮协作后，传递给 LLM 的上下文过大，超出 token 限制或导致质量下降
- **影响**：后期轮次 LLM 响应质量下降
- **缓解**：
  - 轮次摘要压缩（每轮 ≤200 token）
  - 只传递最近 3 轮完整历史 + 更早轮次的摘要
  - 监控 token 使用量，接近限制时警告用户
- traces_to: [CD-1.1, FR-003]

### RSK-004: 进程管理稳定性 [中]

- **描述**：子进程崩溃、挂起、产生异常输出
- **影响**：用户体验不稳定
- **缓解**：
  - 超时机制 + 心跳检测
  - kill 整个进程组
  - 优雅降级（一个 CLI 挂了提示用户，不崩溃整个 app）
- traces_to: [CD-1.3, FR-012]

### RSK-005: TUI 复杂度 [中]

- **描述**：完整 UX 方案（折叠、Smart Scroll、模式切换等）在终端环境中实现难度高
- **影响**：开发周期延长
- **缓解**：
  - 利用 Ink 生态的现有组件
  - 优先实现核心交互（消息流+打断），增强功能逐步迭代
  - 完善的组件测试（ink-testing-library）
- traces_to: [CD-1.4]

### RSK-006: Codex 输出解析不可靠 [中]

- **描述**：Codex CLI 输出为非结构化文本，解析可能不准确
- **影响**：代码块识别、选择题检测可能误判
- **缓解**：
  - 解析失败时将整段文本作为 text 类型输出（降级而非报错）
  - 持续优化正则规则
  - 关注 Codex CLI 是否会增加结构化输出选项
- traces_to: [CD-1.3, FR-010]

---

## 9. Open Questions

| # | 问题 | 影响 | 状态 | 解决方案 |
|---|------|------|------|----------|
| OQ-001 | v1 还需要支持哪些 LLM CLI？ | 开发范围 | **已解决** | 内置 12 个主流 CLI 工具的适配器注册表，启动时自动检测已安装工具 |
| OQ-002 | Gemini CLI 的具体输出格式和调用方式 | FR-011 | **已解决** | 支持 `--output-format stream-json`，与 Claude Code 相同，复用 StreamJsonParser |
| OQ-003 | Codex CLI 是否有结构化输出选项？ | FR-010 | **已解决** | 支持 `--json` 标志输出 JSONL 格式，使用 JsonlParser 解析 |
| OQ-004 | Claude Code `--continue` + `-p` 组合？ | FR-009 | **待实际验证** | CLI 帮助文档显示两者为独立选项，理论上可组合，需在非嵌套环境中验证 |
| OQ-005 | 首次启动的 Onboarding 引导 | UX | **已解决** | 融入自动检测流程：扫描 12 个 CLI → 展示检测结果 → Quick tips → 开始 |

---

## 10. Appendix

### A. Decision Log

| 日期 | 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|------|
| 2026-03-09 | 技术栈 | Electron/Tauri/Swift/TUI | 纯终端 TUI | 用户偏好 |
| 2026-03-09 | 协作模式 | 固定/可配置/完全自由 | 可配置主从 | 灵活性与复杂度平衡 |
| 2026-03-09 | 选择题检测 | 关键词匹配/LLM判断/手动 | Prompt指令+正则兜底 | 零成本方案优先 |
| 2026-03-09 | 打断机制 | 立即终止/等待完成/用户文字 | Ctrl+C停止→用户输入 | 简单直觉 |
| 2026-03-09 | 状态机 | xstate/自实现/无状态机 | xstate v5 | 可视化调试+持久化 |
| 2026-03-09 | 存储位置 | 项目内/用户目录/两者 | 项目目录 .duo/ | 数据跟项目走 |
| 2026-03-09 | 会话恢复 | v1必须/推迟 | v1必须 | AI协作耗时长，需要恢复 |
| 2026-03-09 | 权限策略 | 跳过/受限/可配置 | 跳过权限检查 | 流畅性优先 |
| 2026-03-09 | LLM 支持 | 仅两个/插件化/立即多种 | v1支持多种 | 用户需求 |
| 2026-03-09 | 假设验证 | Phase 0/跳过/边做边验 | 跳过，直接开发 | 用户选择 |
| 2026-03-09 | TUI 范围 | 最小/完整UX/纯文本 | 完整UX方案 | 用户选择 |
| 2026-03-09 | 轮数上限 | 3/5/10/可配置 | 用户可配置，默认5 | 灵活性 |
| 2026-03-09 | 产品命名 | ccvscodex/duo/aipair | duo | 用户选择 |
| 2026-03-09 | CLI 工具支持范围 | 3个/插件化/Top12 | 内置 Top 12 自动检测 | 调研确认 12 个主流工具接口趋同 |
| 2026-03-09 | 输出解析策略 | 每个CLI独立/按格式分类 | 3 类解析器复用 | StreamJson/JSONL/Text 覆盖全部 12 个 |
| 2026-03-09 | Codex 输出格式 | 纯文本/--json | --json (JSONL) | 调研确认 Codex 支持 --json 标志 |
| 2026-03-09 | Gemini 输出格式 | 未知/stream-json | stream-json | 调研确认与 Claude Code 相同 |

### B. Glossary

| 术语 | 定义 |
|------|------|
| Duo | 本产品名称 |
| Coder | 负责编写代码的 LLM 角色 |
| Reviewer | 负责审查代码的 LLM 角色 |
| Round | 一个完整的 编码→审查 周期 |
| Convergence | 两个 LLM 对实现方案达成一致（Reviewer 不再提出新问题） |
| CLIAdapter | 统一的 CLI 工具适配器接口 |
| OutputChunk | 流式输出的最小单元 |

### C. 工作流状态机详细定义

```
stateDiagram-v2
    [*] --> IDLE
    IDLE --> CODING : START_TASK
    CODING --> ROUTING_POST_CODE : CODE_COMPLETE
    CODING --> INTERRUPTED : USER_INTERRUPT
    CODING --> ERROR : PROCESS_ERROR / TIMEOUT
    ROUTING_POST_CODE --> REVIEWING : route_to_review
    ROUTING_POST_CODE --> WAITING_USER : choice_detected_for_user
    REVIEWING --> ROUTING_POST_REVIEW : REVIEW_COMPLETE
    REVIEWING --> INTERRUPTED : USER_INTERRUPT
    REVIEWING --> ERROR : PROCESS_ERROR / TIMEOUT
    ROUTING_POST_REVIEW --> EVALUATING : route_to_evaluate
    ROUTING_POST_REVIEW --> CODING : choice_for_coder
    EVALUATING --> CODING : NOT_CONVERGED [round < maxRounds]
    EVALUATING --> WAITING_USER : CONVERGED / MAX_ROUNDS_REACHED
    INTERRUPTED --> CODING : USER_INPUT [resume_as_coder]
    INTERRUPTED --> REVIEWING : USER_INPUT [resume_as_reviewer]
    INTERRUPTED --> WAITING_USER : USER_INPUT [need_decision]
    WAITING_USER --> CODING : USER_CONFIRM [continue]
    WAITING_USER --> DONE : USER_CONFIRM [accept]
    ERROR --> WAITING_USER : recovery
    DONE --> [*]

    IDLE --> RESUMING : RESUME_SESSION
    RESUMING --> CODING : restored_to_coding
    RESUMING --> REVIEWING : restored_to_reviewing
    RESUMING --> WAITING_USER : restored_to_waiting
```

### D. 上下文构建规则

```
构建 Coder Prompt:
  1. System prompt（角色定义 + "不要提问" 指令）
  2. 任务描述（用户原始输入）
  3. 最近 3 轮完整对话历史
  4. 更早轮次的摘要
  5. 如果是打断后重试：用户的打断指令
  6. 如果有 Reviewer 反馈：上一轮 Review 的完整内容

构建 Reviewer Prompt:
  1. System prompt（角色定义 + "给出具体行级反馈" 指令）
  2. 任务描述（用户原始输入）
  3. 最近 3 轮完整对话历史
  4. 更早轮次的摘要
  5. 当前轮次 Coder 的完整输出

Token 预算:
  - 摘要区域：≤200 token/轮 × 历史轮数
  - 完整历史：最近 3 轮
  - 总上下文：不超过目标 LLM context window 的 80%
```

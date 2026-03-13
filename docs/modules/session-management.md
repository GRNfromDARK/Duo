# 会话管理模块

> 来源需求：FR-001 (AC-001 ~ AC-004), FR-002 (AC-005 ~ AC-008), FR-003 (AC-009 ~ AC-011)

## 模块职责

会话管理模块负责 Duo 会话的**完整生命周期**——从创建、验证，到持久化存储、状态恢复，再到 Prompt 构建与上下文窗口管理。模块由三个文件组成：

- **session-starter** — 会话创建与参数验证
- **session-manager** — 会话持久化、原子写入、恢复与列表
- **context-manager** — Prompt 模板管理、历史摘要、上下文窗口控制

## 涉及文件

| 文件 | 说明 |
|------|------|
| `src/session/session-starter.ts` | 会话启动核心逻辑（参数解析、验证、配置生成） |
| `src/session/session-manager.ts` | **NEW** — 会话持久化引擎（原子写入、snapshot、JSONL history） |
| `src/session/context-manager.ts` | **NEW** — Prompt 模板管理、轮次摘要、上下文窗口管理 |
| `src/types/session.ts` | 会话相关的 TypeScript 类型定义 |

---

## session-starter.ts — 会话创建与验证

### `parseStartArgs(argv: string[]): StartArgs`

解析 CLI 命令行参数，将 `argv` 数组转换为结构化的 `StartArgs` 对象。

支持的参数：

| 参数 | 字段 | 说明 |
|------|------|------|
| `--dir` | `dir` | 项目目录路径 |
| `--coder` | `coder` | 编码者 CLI 工具名称 |
| `--reviewer` | `reviewer` | 审查者 CLI 工具名称 |
| `--task` | `task` | 任务描述 |

所有字段均为可选（`StartArgs` 各属性类型为 `string | undefined`），缺失的必填字段会在后续 `createSessionConfig()` 中被捕获。

### `validateProjectDir(dir: string): Promise<ValidationResult>`

异步验证项目目录，检查两个维度：

1. **存在性与可访问性** — 使用 `fs/promises.access()` 检查 `R_OK` 权限。若目录不存在或不可读，立即返回 `valid: false`。
2. **Git 仓库状态** — 通过 `git rev-parse --is-inside-work-tree` 判断。非 Git 目录不会阻止会话创建，但会产生 warning。

### `validateCLIChoices(coder, reviewer, detected): ValidationResult`

验证 coder 和 reviewer CLI 工具选择的合法性。检查三条规则：

| 规则 | 错误信息 |
|------|----------|
| coder 和 reviewer 不能是同一个工具 | `Coder and reviewer cannot be the same CLI tool.` |
| 工具必须存在于已注册的 CLI 列表中 | `{Role} CLI '{name}' not found in registry.` |
| 工具必须已安装 | `{Role} CLI '{displayName}' is not installed.` |

当 coder 与 reviewer 相同时，函数立即返回，不再检查后续规则。

### `createSessionConfig(args, detected): Promise<StartResult>`

编排整个验证流程的入口函数，依次执行：

1. **必填字段检查** — `--coder`、`--reviewer`、`--task` 缺一不可
2. **目录验证** — 调用 `validateProjectDir()`，未提供 `--dir` 时默认使用 `process.cwd()`
3. **CLI 工具验证** — 仅在 coder 和 reviewer 都已提供时调用
4. **汇总结果** — 收集所有 errors/warnings，返回 `StartResult`

返回值包含 `config`（成功时为 `SessionConfig`，失败时为 `null`）、`validation` 和 `detectedCLIs`。

---

## session-manager.ts — 会话持久化引擎（NEW）

> 来源需求：FR-002 (AC-005, AC-006, AC-007, AC-008)

### 核心设计

SessionManager 管理 `.duo/sessions/<id>/` 目录下的会话数据，提供**崩溃安全**的持久化能力。

#### 数据接口

| 接口 | 说明 |
|------|------|
| `SessionMetadata` | 会话元数据：`id`, `projectDir`, `coder`, `reviewer`, `task`, `createdAt`, `updatedAt` |
| `SessionState` | 运行时状态：`round`, `status`, `currentRole`, `coderSessionId?`, `reviewerSessionId?` |
| `SessionSnapshot` | 合并快照：`{ metadata, state }`，是 snapshot.json 的完整结构 |
| `HistoryEntry` | 历史条目：`round`, `role`, `content`, `timestamp` |
| `LoadedSession` | 加载结果：`{ metadata, state, history }` |
| `SessionSummary` | 列表摘要：用于 `listSessions()` 返回值 |

#### 错误类型

| 类 | 触发场景 |
|----|----------|
| `SessionNotFoundError` | 会话目录不存在 |
| `SessionCorruptedError` | 会话文件存在但数据结构无效（JSON 解析失败、字段缺失等） |

### 原子写入策略（write-tmp-rename）

`atomicWriteSync(filePath, data)` 实现了经典的**先写临时文件再重命名**策略：

1. 将数据写入 `{filePath}.tmp`
2. 调用 `fs.renameSync()` 原子替换目标文件
3. Windows 兼容：若 rename 失败，先 unlink 目标文件再重试

这确保了在写入过程中崩溃时，目标文件要么是旧版本完整数据，要么是新版本完整数据，不会出现半写状态。

### 核心方法

#### `createSession(config: SessionConfig): { id: string }`

创建新会话：

1. 生成 UUID 作为会话 ID
2. 创建 `.duo/sessions/<id>/` 目录
3. 原子写入 snapshot.json（metadata + 初始 state `{ round: 0, status: 'created', currentRole: 'coder' }`）
4. 创建空的 history.jsonl
5. 同时写入旧格式文件（session.json, state.json, history.json）保持向后兼容

#### `saveState(sessionId: string, state: SessionState): void`

保存会话状态：

1. 加载当前 snapshot
2. 更新 `state` 和 `metadata.updatedAt`（使用 `Math.max(now, updatedAt) + 1` 保证单调递增）
3. **单次原子写入** snapshot.json 同时更新 metadata 和 state
4. 同步更新旧格式文件

#### `addHistoryEntry(sessionId: string, entry: HistoryEntry): void`

追加历史条目：

1. 若 history.jsonl 不存在但 history.json 存在，先执行**迁移**（逐行转换）
2. 使用 `fs.appendFileSync()` 追加一行 JSON（**仅追加，无 read-modify-write 竞态**）
3. 同步更新旧格式 history.json

#### `loadSession(sessionId: string): LoadedSession`

加载完整会话：

1. 检查会话目录是否存在，不存在则抛出 `SessionNotFoundError`
2. 加载 snapshot（优先 snapshot.json，回退到 session.json + state.json）
3. 加载 history（优先 history.jsonl，回退到 history.json）
4. 任何非 `SessionNotFoundError` 的异常包装为 `SessionCorruptedError`

#### `listSessions(): SessionSummary[]`

列出所有会话，按 `updatedAt` 降序排列。跳过损坏或不完整的会话目录。

#### `validateSessionRestore(sessionId: string): RestoreValidation`

验证会话是否可恢复——检查 `projectDir` 是否仍然存在。

### 文件格式与兼容

**新格式（权威）：**

| 文件 | 格式 | 说明 |
|------|------|------|
| `snapshot.json` | JSON | metadata + state 合并快照，原子写入 |
| `history.jsonl` | JSONL（每行一条 JSON） | 仅追加的历史记录，崩溃容忍最后一行截断 |

**旧格式（向后兼容，只读回退）：**

| 文件 | 格式 | 说明 |
|------|------|------|
| `session.json` | JSON | 仅 metadata |
| `state.json` | JSON | 仅 state |
| `history.json` | JSON Array | 完整历史数组 |

加载时优先读取新格式；新格式不存在时回退到旧格式。写入时同时更新两种格式，确保过渡期兼容。

### 数据完整性验证

- `isValidSnapshot()` — 类型守卫，检查 snapshot 对象的完整字段结构
- `isValidHistoryEntry()` — 类型守卫，检查单条历史条目的字段
- JSONL 加载时，**最后一行**的截断/损坏会被容忍并跳过（视为崩溃产物），中间行损坏则抛出异常

---

## context-manager.ts — Prompt 模板管理（NEW）

> 来源需求：FR-003 (AC-009, AC-010, AC-011)

### 核心设计

ContextManager 负责为 Coder 和 Reviewer LLM 构建结构化的 Prompt，管理轮次历史的摘要与裁剪，确保 Prompt 始终在上下文窗口预算内。

#### 配置接口

| 接口 | 说明 |
|------|------|
| `ContextManagerOptions` | `contextWindowSize`（上下文窗口大小）、`promptsDir?`（自定义模板目录） |
| `RoundRecord` | 轮次记录：`index`, `coderOutput`, `reviewerOutput`, `summary?`, `timestamp` |
| `CoderPromptOptions` | 可选参数：`reviewerFeedback?`, `interruptInstruction?`, `skipHistory?` |
| `ReviewerPromptOptions` | 可选参数：`interruptInstruction?`, `skipHistory?`, `roundNumber?`, `previousReviewerOutput?` |

#### 常量

| 常量 | 值 | 说明 |
|------|------|------|
| `CHARS_PER_TOKEN` | 4 | 近似 token 估算比例 |
| `MAX_SUMMARY_TOKENS` | 200 | 单轮摘要最大 token 数 |
| `RECENT_ROUNDS_COUNT` | 3 | 保留完整内容的最近轮次数 |
| `BUDGET_RATIO` | 0.8 | 上下文窗口利用率上限（80%） |

### Prompt 模板系统

#### 模板加载

构造时从 `promptsDir`（默认 `.duo/prompts/`）加载自定义模板：

- `coder.md` — Coder Prompt 模板
- `reviewer.md` — Reviewer Prompt 模板

文件不存在时回退到内置默认模板。

#### `resolveTemplate(template, vars)` — 单次遍历占位符替换

使用 `template.replace(/\{\{(\w+)\}\}/g, ...)` 进行**单次遍历**替换。关键设计：替换值中包含的 `{{...}}` 标记**不会被二次解析**，避免了注入风险。这是 P0-1 修复的核心改进。

支持的占位符：`{{task}}`、`{{history}}`、`{{reviewerFeedback}}`、`{{interruptInstruction}}`、`{{coderOutput}}`、`{{roundNumber}}`、`{{previousFeedbackChecklist}}`。未匹配的占位符保持原样。

### 核心方法

#### `buildCoderPrompt(task, rounds, opts?): string`

构建 Coder Prompt：

1. 构建历史区段（可通过 `skipHistory` 跳过）
2. 组装 reviewer 反馈区段和中断指令区段
3. 通过 `resolveTemplate()` 填充模板
4. 通过 `enforceTokenBudget()` 裁剪超限内容

默认模板核心指令：
- 不要提问，自主决策，直接实现
- 只关注任务，不修改无关代码
- 逐一解决 Reviewer 反馈并简要说明修复内容

#### `buildReviewerPrompt(task, rounds, coderOutput, opts?): string`

构建 Reviewer Prompt：

1. 构建历史区段
2. 构建中断指令区段
3. 如有上轮 Reviewer 输出，通过 `buildPreviousFeedbackChecklist()` 生成逐项验证清单
4. 填充模板并裁剪

默认模板的审查输出格式要求：
- **Progress Checklist** — 逐项标注上轮问题修复状态（`[x] Fixed` / `[ ] Still open`）
- **New Issues** — 新发现的问题，标注 Location / Problem / Fix，分类为 Blocking 或 Non-blocking
- **Blocking Issue Count** — 明确写出 `Blocking: N`
- **Verdict** — `[APPROVED]` 或 `[CHANGES_REQUESTED]`

#### `generateSummary(text: string): string`

生成轮次摘要（≤200 tokens）：

1. 文本长度在限制内则原样返回
2. 尝试 `extractKeyPoints()` 提取结构化关键信息（verdict 标记、Blocking/Non-blocking 分类、编号列表项）
3. 回退到字符截断（使用 `Array.from()` 避免截断多字节字符）

#### `buildHistorySection(rounds: RoundRecord[]): string`

构建历史区段，采用**近详远略**策略：

- **最近 3 轮** — 完整内容（Coder 输出 + Reviewer 输出）
- **更早的轮次** — 仅保留摘要（已有 `summary` 字段或即时生成）

#### `enforceTokenBudget(prompt: string): string`

上下文窗口控制：按 `contextWindowSize × 0.8` 计算最大字符数，超限时截断。使用 `Array.from()` 按完整字符截断以保护多字节序列。

### 上轮反馈清单构建

`buildPreviousFeedbackChecklist(previousOutput)` 解析上轮 Reviewer 输出中的结构化问题：

1. `extractGroupedIssues()` 将多行问题（Location / Problem / Fix）合并为单条摘要
2. 支持编号格式（`1. **Location**: ...`）和 bullet 格式（`- **Blocking**: ...`）
3. 生成编号清单，指示 Reviewer 逐项验证修复状态

---

## `.duo/` 目录结构详解

```
.duo/
├── sessions/
│   └── <uuid>/
│       ├── snapshot.json    # 权威源：metadata + state 合并快照
│       ├── history.jsonl    # 仅追加的历史记录（每行一条 JSON）
│       ├── session.json     # [旧格式] 仅 metadata
│       ├── state.json       # [旧格式] 仅 state
│       └── history.json     # [旧格式] 完整历史数组
└── prompts/                 # 自定义 Prompt 模板（可选）
    ├── coder.md
    └── reviewer.md
```

`.duo/` 目录通常应被加入 `.gitignore`。

---

## 验证规则总表

| 阶段 | 规则 | 级别 | 影响 |
|------|------|------|------|
| 必填字段 | `--coder` 未提供 | Error | 阻止会话创建 |
| 必填字段 | `--reviewer` 未提供 | Error | 阻止会话创建 |
| 必填字段 | `--task` 未提供 | Error | 阻止会话创建 |
| 目录验证 | 目录不存在或不可读 | Error | 阻止会话创建 |
| 目录验证 | 目录不是 Git 仓库 | Warning | 允许继续，但提醒用户 |
| CLI 验证 | coder 与 reviewer 相同 | Error | 阻止会话创建 |
| CLI 验证 | 工具未在注册表中 | Error | 阻止会话创建 |
| CLI 验证 | 工具未安装 | Error | 阻止会话创建 |
| 会话恢复 | 项目目录不再存在 | Error | 阻止恢复 |
| Snapshot 加载 | JSON 解析失败或字段缺失 | Error | 抛出 `SessionCorruptedError` |
| History 加载 | 中间行损坏 | Error | 抛出 `SessionCorruptedError` |
| History 加载 | 最后一行截断 | Warning | 跳过该行，正常加载 |

---

## 崩溃一致性策略

Duo 采用 **snapshot 为权威源** 的崩溃恢复策略：

1. **snapshot.json 是唯一权威** — metadata 和 state 合并存储在一个文件中，通过 write-tmp-rename 原子写入。崩溃时 snapshot.json 要么是旧版本（完整），要么是新版本（完整）。
2. **history.jsonl 仅追加** — 使用 `appendFileSync` 逐行追加，不存在 read-modify-write 竞态。崩溃可能导致最后一行截断，加载时自动跳过。
3. **旧格式为冗余备份** — 过渡期同时维护旧格式文件，但加载优先读取新格式。即使旧格式文件损坏，只要新格式完整即可正常恢复。
4. **updatedAt 单调递增** — `saveState()` 使用 `Math.max(now, updatedAt) + 1` 确保时间戳严格递增，避免时钟回拨导致的排序异常。

---

## 数据流向

```
CLI argv
  │
  ▼
parseStartArgs() → StartArgs
  │
  ▼
createSessionConfig() → SessionConfig
  │
  ▼
SessionManager.createSession() → session ID + snapshot.json + history.jsonl
  │
  ▼
ContextManager.buildCoderPrompt() → Coder Prompt（含历史摘要）
  │                                        │
  │                                        ▼
  │                                  LLM 执行 → 输出
  │                                        │
  │                                        ▼
  │                           SessionManager.addHistoryEntry()
  │                           SessionManager.saveState()
  │                                        │
  │                                        ▼
  └──────────────── ContextManager.buildReviewerPrompt() → Reviewer Prompt
                                           │
                                           ▼
                                     LLM 审查 → 输出
                                           │
                                           ▼
                              下一轮循环或收敛终止
```

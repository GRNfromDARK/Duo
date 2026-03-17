# 会话管理模块

> 源文件: `src/session/session-starter.ts` | `src/session/session-manager.ts` | `src/session/context-manager.ts` | `src/session/prompt-log.ts`
>
> 需求追溯: FR-001 (AC-001 ~ AC-004), FR-002 (AC-005 ~ AC-008), FR-003 (AC-009 ~ AC-011)

---

## 1. 模块概览

会话管理模块负责 Duo 会话的完整生命周期：**创建与校验** (`session-starter`) -> **持久化与恢复** (`session-manager`) -> **Prompt 构建** (`context-manager`) -> **Prompt 审计日志** (`prompt-log`)。

四个子模块协作确保：
- 会话状态在进程崩溃后仍可安全恢复
- Coder / Reviewer LLM 始终收到结构化、预算可控的 prompt
- 所有发送给 LLM 的 prompt 都被完整记录，用于调试与审计

---

## 2. Session Starter (`session-starter.ts`)

Session Starter 负责会话创建前的参数解析与多层校验，确保用户输入合法、CLI 工具可用、项目目录有效。

### 2.1 CLI 参数解析

`parseStartArgs(argv)` 从命令行 argv 中提取 `StartArgs` 结构体：

| 参数 | 字段 | 说明 |
|------|------|------|
| `--dir` | `dir` | 项目目录路径（默认 `process.cwd()`） |
| `--coder` | `coder` | Coder CLI 名称（必填） |
| `--reviewer` | `reviewer` | Reviewer CLI 名称（必填） |
| `--god` | `god` | God adapter 名称（可选） |
| `--task` | `task` | 任务描述（必填） |
| `--coder-model` | `coderModel` | Coder 模型覆盖（可选） |
| `--reviewer-model` | `reviewerModel` | Reviewer 模型覆盖（可选） |
| `--god-model` | `godModel` | God 模型覆盖（可选） |

解析采用简单的 switch-case 遍历，每个参数消耗 argv 中的下一个元素作为值。

### 2.2 项目目录校验

`validateProjectDir(dir)` 执行两级检查，返回 `ValidationResult`：

1. **可访问性检查** — 通过 `fs.access(R_OK)` 验证目录存在且可读。不通过时返回 `valid: false` 并附带错误信息。
2. **Git 仓库检查** — 调用 `git rev-parse --is-inside-work-tree`。非 Git 目录不会导致校验失败，但会产生 warning（部分 CLI 如 Codex 要求项目位于 Git 仓库中）。

### 2.3 CLI 选择校验

`validateCLIChoices(coder, reviewer, detected, god?)` 保证角色分配的合法性：

- **互斥性**：Coder 和 Reviewer 不能是同一个 CLI 工具
- **可用性**：每个角色对应的 CLI 必须在 `DetectedCLI[]` 注册表中存在且已安装
- **God adapter 校验**：若指定 `--god`，通过 `isSupportedGodAdapterName()` 验证其为受支持的 God adapter（当前支持 `claude-code`、`codex`、`gemini`）

### 2.4 SessionConfig 创建

`createSessionConfig(args, detected)` 是 Session Starter 的入口函数，串联上述所有校验，返回 `StartResult`：

```typescript
interface StartResult {
  config: SessionConfig | null;   // 校验通过时包含完整配置
  validation: ValidationResult;   // errors + warnings
  detectedCLIs: string[];         // 已安装的 CLI 名称列表
}
```

处理流程：
1. 验证必填参数（`--coder`、`--reviewer`、`--task`）
2. 验证项目目录
3. 验证 CLI 选择
4. 解析 God adapter（通过 `resolveGodAdapterForStart`）
5. 汇总所有错误和警告

校验通过时 `config` 包含完整的 `SessionConfig`（projectDir / coder / reviewer / god / task 及可选的 model 覆盖）。校验失败时 `config` 为 `null`。无论是否通过，都返回 `detectedCLIs` 供 UI 层展示可用工具。

---

## 3. Session Manager (`session-manager.ts`)

Session Manager 负责会话的持久化存储与恢复，是 Duo 崩溃恢复能力的核心保障。

### 3.1 目录结构

```
.duo/
├── sessions/
│   └── <uuid>/
│       ├── snapshot.json      ← 权威源：metadata + state 合并快照
│       ├── history.jsonl      ← 对话历史（append-only JSONL）
│       ├── prompt-log.jsonl   ← Prompt 审计日志（append-only JSONL）
│       ├── session.json       ← Legacy：仅 metadata
│       ├── state.json         ← Legacy：仅 state
│       └── history.json       ← Legacy：JSON 数组格式
└── prompts/                   ← 自定义 Prompt 模板（可选）
    ├── coder.md
    └── reviewer.md
```

**新会话同时写入新格式和 Legacy 文件**，以保证过渡期的向后兼容。读取时优先使用 `snapshot.json` / `history.jsonl`，不存在时自动 fallback 到 Legacy 文件。

### 3.2 核心数据模型

#### SessionMetadata — 不可变元信息

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | UUID（`crypto.randomUUID()` 生成） |
| `projectDir` | `string` | 项目目录路径 |
| `coder` | `string` | Coder CLI 名称 |
| `reviewer` | `string` | Reviewer CLI 名称 |
| `god` | `string?` | God adapter 名称 |
| `task` | `string` | 任务描述 |
| `coderModel` | `string?` | Coder 模型覆盖 |
| `reviewerModel` | `string?` | Reviewer 模型覆盖 |
| `godModel` | `string?` | God 模型覆盖 |
| `createdAt` | `number` | 创建时间戳 |
| `updatedAt` | `number` | 最后更新时间戳 |

#### SessionState — 可变运行状态

| 字段 | 类型 | 说明 |
|------|------|------|
| `round` | `number` | 当前轮次 |
| `status` | `string` | 会话状态（如 `created`、`running`、`completed`） |
| `currentRole` | `string` | 当前执行角色 |
| `coderSessionId` | `string?` | Coder adapter 的 CLI session ID（如 Claude Code session_id） |
| `reviewerSessionId` | `string?` | Reviewer adapter 的 CLI session ID |
| `godSessionId` | `string?` | Legacy God session ID（运行时恢复已禁用） |
| `godAdapter` | `string?` | Legacy God adapter 名称（旧版会话兼容） |
| `godTaskAnalysis` | `GodTaskAnalysis?` | God 任务分析结果（仅首轮写入，FR-011） |
| `godConvergenceLog` | `ConvergenceLogEntry[]?` | God 收敛日志（每轮追加，摘要限 200 字符，NFR-007） |
| `degradationState` | `DegradationState?` | God 降级状态（用于 `duo resume`） |
| `currentPhaseId` | `string \| null?` | 复合任务当前阶段 ID |
| `clarification` | `object?` | Card E.2 clarification 上下文：`frozenActiveProcess` 和 `clarificationRound` |

#### HistoryEntry — 单条对话记录

| 字段 | 类型 | 说明 |
|------|------|------|
| `round` | `number` | 所属轮次 |
| `role` | `string` | 角色标识 |
| `content` | `string` | 内容文本 |
| `timestamp` | `number` | 时间戳 |

#### SessionSnapshot — 持久化快照

```typescript
interface SessionSnapshot {
  metadata: SessionMetadata;
  state: SessionState;
}
```

`snapshot.json` 将 metadata 和 state 合并到一个文件中，减少 I/O 操作次数并确保两者的一致性。

### 3.3 原子写入 (Atomic Writes)

`atomicWriteSync(filePath, data)` 是所有写入操作的基础保障：

1. 先写入 `<filePath>.tmp` 临时文件
2. 调用 `fs.renameSync` 将 `.tmp` 原子替换目标文件
3. Windows 兼容：`rename` 失败时先 `unlink` 目标文件再重试 `rename`

所有 `saveState` 调用和 `addHistoryEntry` 的 Legacy 同步写入都通过此函数，确保即使进程在写入过程中崩溃，文件也不会处于半写的损坏状态。

### 3.4 单调时间戳 (Monotonic Timestamp)

`monotonicNow()` 保证同一 SessionManager 实例内的时间戳严格递增：

```typescript
private monotonicNow(): number {
  const now = Date.now();
  this._lastTs = Math.max(now, this._lastTs + 1);
  return this._lastTs;
}
```

当同一毫秒内多次调用时自动 +1，防止多个会话在快速创建/更新时出现时间戳排序冲突。

### 3.5 会话创建

`createSession(config)` 流程：

1. 通过 `crypto.randomUUID()` 生成 session ID
2. 创建 `.duo/sessions/<id>/` 目录（`recursive: true`）
3. 原子写入 `snapshot.json`（metadata + 初始 state）
4. 初始化空的 `history.jsonl` 和 `prompt-log.jsonl`
5. 同时写入 Legacy 文件（`session.json` / `state.json` / `history.json`）保持向后兼容
6. 初始状态：`round=0, status='created', currentRole='coder'`

### 3.6 状态更新

`saveState(sessionId, partialState)` 采用浅合并语义：

1. 加载当前 snapshot
2. 将传入的 `Partial<SessionState>` 浅合并到现有 `state`
3. 更新 `metadata.updatedAt` 为单调时间戳
4. 原子写入 `snapshot.json` 和 Legacy 文件

### 3.7 历史追加

`addHistoryEntry(sessionId, entry)` 使用 **append-only** 策略：

- **JSONL 主存储**：直接 `fs.appendFileSync` 追加一行 JSON，天然避免 read-modify-write 竞态
- **Legacy 迁移**：如果 `history.jsonl` 不存在但 `history.json` 存在，首次追加时自动将 Legacy 数据迁移到 JSONL 格式
- **Legacy 同步**：同时通过原子写入更新 `history.json`（读取 -> 追加 -> 写回），保持向后兼容

### 3.8 会话加载与恢复

`loadSession(sessionId)` 返回完整的 `LoadedSession`（metadata + state + history）。

**Snapshot 加载优先级**：
1. `snapshot.json`（新格式，通过 `isValidSnapshot` type guard 校验结构）
2. `session.json` + `state.json`（Legacy fallback，同样做结构校验）

**History 加载优先级**：
1. `history.jsonl`（逐行解析，通过 `isValidHistoryEntry` type guard 校验每条记录）
2. `history.json`（Legacy JSON 数组格式）

**History JSONL 容错策略**：
- **最后一行**损坏（JSON 解析失败或结构不合法）：视为崩溃残留，跳过并输出 warning
- **中间行**损坏：不容忍，抛出异常（由调用方包装为 `SessionCorruptedError`）

**恢复校验**：`validateSessionRestore(sessionId)` 加载会话后检查项目目录是否仍然存在。

### 3.9 会话列表

`listSessions()` 扫描 sessions 目录下的所有子目录，对每个目录尝试加载 snapshot。损坏或不完整的目录会被静默跳过。返回结果按 `updatedAt` 降序排列（最近更新的排在最前）。

### 3.10 错误类型

| 错误类 | 触发条件 |
|--------|---------|
| `SessionNotFoundError` | session 目录不存在 |
| `SessionCorruptedError` | snapshot 或 history 数据损坏（原始异常保存在 `cause` 属性中） |

---

## 4. Context Manager (`context-manager.ts`)

Context Manager 负责为 Coder 和 Reviewer LLM 构建结构化 prompt，管理历史上下文的压缩策略，并强制执行 token 预算限制。

### 4.1 Prompt 模板系统

初始化时加载两套 prompt 模板：

- **Coder 模板** — 从 `.duo/prompts/coder.md` 加载，不存在时使用内置默认模板
- **Reviewer 模板** — 从 `.duo/prompts/reviewer.md` 加载，同上

模板目录路径通过 `ContextManagerOptions.promptsDir` 配置，默认值由静态方法 `getDefaultTemplatesDir()` 返回（`.duo/prompts`）。

### 4.2 模板占位符替换

`resolveTemplate(template, vars)` 采用**单次正则替换**策略：

```typescript
template.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match)
```

核心设计：一次遍历完成所有 `{{key}}` 占位符替换。替换值中若包含 `{{...}}` 文本**不会被二次解析**，从而避免模板注入风险。未匹配的占位符保持原样。

支持的占位符：

| Coder 模板 | Reviewer 模板 |
|------------|---------------|
| `{{task}}` | `{{task}}` |
| `{{history}}` | `{{history}}` |
| `{{reviewerFeedback}}` | `{{coderOutput}}` |
| `{{interruptInstruction}}` | `{{interruptInstruction}}` |
| — | `{{roundNumber}}` |
| — | `{{previousFeedbackChecklist}}` |

### 4.3 Coder Prompt 构建

`buildCoderPrompt(task, rounds, opts?)` 生成 Coder 的系统 prompt。核心指令（中英双语）：

- **不要提问，自主决策，直接实现**
- 只关注任务描述中的需求，不修改无关代码
- 逐一处理 Reviewer 指出的每个问题，并简要说明修复内容
- 产出可运行的代码，注释保持精简

可选参数：
- `reviewerFeedback`：注入上一轮 Reviewer 的反馈内容
- `interruptInstruction`：注入中断指令
- `skipHistory`：跳过历史区段注入

### 4.4 Reviewer Prompt 构建

`buildReviewerPrompt(task, rounds, coderOutput, opts?)` 生成 Reviewer 的系统 prompt。要求产出固定四段结构：

1. **Progress Checklist**（Round 2+ 必须）— 对上轮每个问题逐项打勾确认修复状态
2. **New Issues** — 每个新问题包含 Location / Problem / Fix，分类为 Blocking 或 Non-blocking
3. **Blocking Issue Count** — 明确写出 `Blocking: N`
4. **Verdict** — 基于决策树：Blocking = 0 则 `[APPROVED]`，否则 `[CHANGES_REQUESTED]`

关键约束（中英双语）：
- 只针对任务要求审查，不审查无关的已有代码
- 不重复提出已修复的问题
- 阻塞性问题为 0 时**必须**给出 `[APPROVED]`，不得因非阻塞性建议而拒绝通过

### 4.5 Previous Feedback Checklist

当存在上一轮 Reviewer 输出时，`buildPreviousFeedbackChecklist()` 从中提取结构化问题列表并注入到新一轮 Reviewer prompt 中：

1. `extractGroupedIssues()` 解析 Reviewer 输出，识别三种格式：
   - 编号问题组（`1. **Location**: ...` + `**Problem**: ...` + `**Fix**: ...`）
   - 续行字段（`**Problem**: ...` 等独立行）
   - Bullet 问题项（`- **Blocking**: description`）
2. 解析过程中跳过代码块、heading、verdict marker、`Blocking: N` 计数行
3. 多行问题组合并为 `[classification] location — problem` 格式
4. 注入为编号清单，要求 Reviewer 在新一轮逐项标注 `[x] Fixed` 或 `[ ] Still open`

### 4.6 历史区段构建

`buildHistorySection(rounds)` 实现 **sliding window** 压缩策略：

- **最近 3 轮**（`RECENT_ROUNDS_COUNT = 3`）：保留完整内容（Coder 输出 + Reviewer 输出原文）
- **更早轮次**：使用 summary 压缩（优先使用已有的 `round.summary` 字段，否则即时调用 `generateSummary()` 生成）

### 4.7 Summary 生成

`generateSummary(text)` 在文本超过 200 token（约 800 字符，按 1 token 约等于 4 字符估算）时进行压缩：

1. **优先**：`extractKeyPoints()` — 提取 verdict marker（`[APPROVED]` / `[CHANGES_REQUESTED]`）、blocking/non-blocking 分类行、编号问题项、修复状态 header 等结构化关键信息
2. **Fallback**：若提取结果仍然超长，按完整字符截断（`Array.from()` 避免断裂多字节 CJK 字符）并追加 `...`

### 4.8 Token 预算控制

`enforceTokenBudget(prompt)` 确保最终 prompt 不超过 context window 的 80%：

```
maxChars = contextWindowSize * 4 (chars/token) * 0.8 (budget ratio)
```

- `contextWindowSize` 通过 `ContextManagerOptions` 传入
- 超出时按完整字符截断（`Array.from()` 保护多字节序列）
- 预留 20% 空间给 LLM 回复和系统开销

---

## 5. Prompt Log (`prompt-log.ts`)

Prompt Log 提供 prompt 级别的审计日志，完整记录每一次发送给 LLM（Coder / Reviewer / God）的 prompt 内容，用于调试 prompt 质量、回溯对话行为以及排查异常输出的根因。

### 5.1 数据模型

每条日志为一个 `PromptLogEntry`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `seq` | `number` | 自增序号（单 session 内全局唯一） |
| `timestamp` | `string` | ISO 8601 时间戳 |
| `round` | `number` | 所属轮次 |
| `agent` | `'coder' \| 'reviewer' \| 'god'` | 目标 agent 角色 |
| `adapter` | `string` | 使用的 CLI adapter 名称 |
| `kind` | `string` | prompt 类型标识（自由格式，由调用方定义） |
| `prompt` | `string` | 完整 prompt 文本 |
| `systemPrompt` | `string \| null` | system prompt（不适用时为 `null`） |
| `meta` | `Record<string, unknown>?` | 可选的扩展元数据 |

写入时使用 `PromptLogEntryInput` 类型，与 `PromptLogEntry` 相比省略 `seq`（自动分配）且 `timestamp` 可选（默认取当前时间的 ISO 8601 字符串）。

### 5.2 存储格式

- 文件名：`prompt-log.jsonl`（常量 `PROMPT_LOG_FILENAME` 导出）
- 路径：`.duo/sessions/<id>/prompt-log.jsonl`
- 格式：JSONL，每行一条 JSON，通过 `appendFileSync` 逐行追加
- 与 `history.jsonl` 一致的 append-only 策略

### 5.3 PromptLogger 类

`PromptLogger` 是核心类，管理单个 session 的 prompt 日志：

**构造函数** — `new PromptLogger(sessionDir)`：
- 读取现有日志文件最后一行的 `seq` 值以恢复序号计数器
- 文件不存在、为空或最后一行解析失败时，从 0 开始计数
- 确保进程崩溃重启后序号不会重复

**`append(entry)`** — 写入一条日志：
1. 若 session 目录不存在，自动创建（`mkdirSync({ recursive: true })`）
2. `seq` 自增 +1，自动填充 `timestamp`（若未提供）
3. 通过 `appendFileSync` 追加到 `prompt-log.jsonl`
4. 返回包含分配后 `seq` 的完整 `PromptLogEntry`

**`getEntries()`** — 读取所有日志条目：解析 JSONL 文件，返回 `PromptLogEntry[]`。文件不存在或为空时返回空数组。

### 5.4 便捷函数

`appendPromptLog(sessionDir, entry)` 是无需手动管理 `PromptLogger` 实例的快捷方法，内部每次调用创建新的 `PromptLogger` 实例（会自动恢复 seq）。适用于散落在不同模块中的单次写入场景。

### 5.5 与 SessionManager 的集成

`SessionManager.createSession()` 在创建新会话时同时初始化空的 `prompt-log.jsonl` 文件。`PROMPT_LOG_FILENAME` 常量由 `prompt-log.ts` 导出、由 `session-manager.ts` 导入使用，保证文件名的一致性。

---

## 6. Crash Consistency 策略

Duo 采用 **snapshot 为权威源** 的崩溃恢复策略，通过多层机制保证数据一致性：

| 机制 | 说明 |
|------|------|
| **Atomic write (write-tmp-rename)** | `snapshot.json` 崩溃时要么是旧版本完整数据，要么是新版本完整数据，不会处于半写状态 |
| **JSONL append-only** | `history.jsonl` 和 `prompt-log.jsonl` 使用 `appendFileSync` 逐行追加，不存在 read-modify-write 竞态 |
| **最后一行容错** | JSONL 最后一行若 JSON 解析失败或结构不合法，视为崩溃残留，仅跳过并打印 warning |
| **中间行严格** | 文件中间行出现损坏则抛出 `SessionCorruptedError`，不容忍非尾部数据损坏 |
| **Legacy 双写** | 过渡期同时维护旧格式文件，但加载优先读取新格式；即使旧格式文件损坏，新格式完整即可恢复 |
| **Monotonic timestamp** | `monotonicNow()` 确保时间戳严格递增，避免时钟回拨导致的排序异常 |
| **Type guard 校验** | `isValidSnapshot` / `isValidHistoryEntry` 在加载时验证数据结构完整性 |
| **Prompt log 序号恢复** | `PromptLogger` 构造时从日志尾行恢复 `seq`，崩溃后不会产生重复序号 |

---

## 7. 关键设计决策

| 决策 | 理由 |
|------|------|
| Atomic write + rename | 防止进程崩溃导致文件半写损坏 |
| JSONL append-only history / prompt log | 避免 read-modify-write 竞态，对长会话友好 |
| 单次 `resolveTemplate` 替换 | 防止模板注入，替换值中的 `{{}}` 不被二次解析 |
| Legacy 双写 | 过渡期向后兼容，读取优先新格式 |
| 多字节安全截断 (`Array.from`) | 按 code point 截断，保护 CJK 字符不被断裂 |
| 最近 3 轮完整 + 更早轮次摘要 | 平衡上下文信息量与 token 预算 |
| 80% budget ratio | 为 LLM 回复和系统开销预留 20% 空间 |
| Prompt log 独立文件 | 与 history 分离，避免历史文件膨胀；prompt 内容通常远大于 history entry |
| Prompt log seq 自增 | 全局唯一序号便于跨 agent 排序和关联分析 |
| Snapshot 合并 metadata + state | 单次 I/O 写入两类数据，保证一致性 |
| `monotonicNow()` | 防止快速连续操作产生时间戳冲突 |

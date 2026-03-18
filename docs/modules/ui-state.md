# UI 状态管理模块

> 路径：`src/ui/*.ts`（不含 `components/`）

## 设计理念

Duo 的 UI 状态层遵循 **纯函数提取** 原则：

1. **所有状态计算都是纯函数** — 接受当前状态 + 事件参数，返回新状态，无副作用
2. **组件只做胶水** — React 组件通过 `useState` 持有状态，调用纯函数计算下一个状态
3. **可独立单测** — 每个模块均可脱离 Ink/React 运行测试，无需 DOM 或 TUI 环境

这一设计与 `InputArea.processInput`、`DirectoryPicker.processPickerInput` 等组件级纯函数保持一致，形成统一的 "state -> pure fn -> new state" 模式。

整个 UI 状态层共 **19 个模块**，分为三组：
- **Core UI 状态**（10 个）— 通用 UI 逻辑：Alternate Screen、滚动、显示模式、快捷键、Overlay、Markdown 解析、鼠标输入、流式聚合、消息行计算
- **God LLM UI 状态**（6 个）— God 决策层的 UI 状态：retry 包装、消息样式、阶段切换、重分类、任务分析
- **Runtime/Lifecycle 状态**（3 个）— 运行时生命周期管理：任务完成流、全局 Ctrl+C 处理、安全退出

---

## 模块总览

### Core UI 状态（10 个）

| # | 文件 | 职责 | FR 来源 |
|---|------|------|---------|
| 1 | `alternate-screen.ts` | Alternate Screen Buffer 管理 | — |
| 2 | `scroll-state.ts` | Smart Scroll Lock | FR-016 |
| 3 | `display-mode.ts` | Minimal/Verbose 切换 | FR-021 |
| 4 | `directory-picker-state.ts` | 目录选择器逻辑 | FR-019 |
| 5 | `keybindings.ts` | 快捷键映射 | FR-022 |
| 6 | `overlay-state.ts` | Overlay 生命周期 | FR-022 |
| 7 | `markdown-parser.ts` | Markdown 解析 | FR-023 |
| 8 | `mouse-input.ts` | 鼠标输入过滤与 wheel 转换 | — |
| 9 | `git-diff-stats.ts` | Git diff 统计 | FR-026 |
| 10 | `session-runner-state.ts` | 流式聚合与路由决策 | 多 FR |

### God LLM UI 状态（6 个）

| # | 文件 | 职责 | FR 来源 |
|---|------|------|---------|
| 11 | `god-fallback.ts` | God 调用 retry + backoff 包装 | FR-G01 |
| 12 | `god-message-style.ts` | God 消息视觉样式 | FR-014 |
| 13 | `phase-transition-banner.ts` | 阶段切换 banner 状态 | FR-010 |
| 14 | `reclassify-overlay.ts` | 运行时任务重分类 overlay 状态 | FR-002a |
| 15 | `task-analysis-card.ts` | 任务分析卡片状态 | FR-001a |
| 16 | `message-lines.ts` | 消息行计算与渲染 | — |

### Runtime/Lifecycle 状态（3 个）

| # | 文件 | 职责 | 说明 |
|---|------|------|------|
| 17 | `completion-flow.ts` | 任务完成后续流 | 构建追加任务的 prompt |
| 18 | `global-ctrl-c.ts` | 全局 Ctrl+C 双击检测 | 区分 interrupt 与 safe_exit |
| 19 | `safe-shutdown.ts` | 安全退出流程 | 协调 adapter 终止与进程退出 |

---

## Core UI 状态

### 1. alternate-screen.ts — Alternate Screen Buffer 管理

进入终端 alternate screen buffer，为 TUI 提供干净的全屏画布。同时启用 SGR 鼠标报告模式（`\x1b[?1000h` + `\x1b[?1006h`），并在退出时清理所有终端状态。

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `enterAlternateScreen(stdout?)` | 可选的 `stdout` 写入目标（默认 `process.stdout`） | `() => void`（cleanup 函数） | 1. 写入 `\x1b[?1049h` 进入 alternate screen；2. 写入 `\x1b[?1000h` + `\x1b[?1006h` 启用 SGR 鼠标跟踪；3. 注册 SIGINT/SIGTERM/SIGHUP signal handler 和 `exit` 事件处理；4. 返回 cleanup 函数（幂等，通过 `cleaned` flag 防止重复执行） |

#### Signal 处理模式

使用标准 Unix re-raise 模式确保正确的退出状态码：
1. 执行 cleanup（离开 alternate screen + 禁用鼠标跟踪）
2. 移除自定义 handler 以恢复默认行为
3. 使用 `process.kill(process.pid, signal)` 重新发送 signal

cleanup 时依次禁用：legacy mouse wheel mode (`\x1b[?1007l`)、基础鼠标跟踪 (`\x1b[?1000l`)、SGR 扩展 (`\x1b[?1006l`)、alternate screen (`\x1b[?1049l`)。额外禁用 `\x1b[?1007l` 作为 last-resort recovery，防止先前 session 或 crashed build 残留的模式。

---

### 2. scroll-state.ts — Smart Scroll Lock

**来源**: FR-016

智能滚动锁定状态管理。当用户向上滚动阅读历史消息时，自动锁定视口；当新消息到达时显示提示条而非强制滚到底部。

#### 核心类型

```ts
interface ScrollState {
  scrollOffset: number;     // 当前滚动偏移量
  autoFollow: boolean;      // 是否自动跟随新消息
  lockedAtCount: number;    // 锁定时的消息数（-1 表示正在跟随）
}

interface ScrollView {
  effectiveOffset: number;  // 实际渲染偏移
  visibleSlots: number;     // 可见行槽位数
  showIndicator: boolean;   // 是否显示 "新输出" 提示条
  newMessageCount: number;  // 锁定后新增的消息数
}
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `computeScrollView(state, totalMessages, messageAreaHeight)` | `ScrollState` + 消息总数 + 视口高度 | `ScrollView` | 当 `!autoFollow` 且 `totalMessages > lockedAtCount` 时显示提示条；提示条占 1 行，`visibleSlots` 相应减 1；计算 `newMessageCount = totalMessages - lockedAtCount` |
| `scrollUp(state, lines, totalMessages, messageAreaHeight)` | 当前状态 + 滚动行数 + 布局参数 | `ScrollState` | 关闭 `autoFollow`，首次锁定时记录 `lockedAtCount`；偏移量向 0 方向移动 |
| `scrollDown(state, lines, totalMessages, messageAreaHeight)` | 同上 | `ScrollState` | 到达底部（`next >= maxOffset`）时自动重新启用 `autoFollow`，清除 `lockedAtCount` |
| `jumpToEnd(totalMessages, messageAreaHeight)` | 消息总数 + 视口高度 | `ScrollState` | 立即跳到底部，重新启用 `autoFollow`，`lockedAtCount` 重置为 -1 |

**初始状态**: `INITIAL_SCROLL_STATE` — `autoFollow: true, scrollOffset: 0, lockedAtCount: -1`

**与 MainLayout 的集成**: MainLayout 通过 `useState` 持有 `ScrollState`，在 `handleAction` 中调用 `scrollUp`/`scrollDown`/`jumpToEnd` 更新状态；`computeScrollView` 在每次渲染时计算可见窗口，驱动消息切片和 ScrollIndicator 的显示。

---

### 3. display-mode.ts — Minimal/Verbose 模式切换

**来源**: FR-021 (AC-070, AC-071)

两种显示模式的定义和消息过滤逻辑。

#### 核心类型

```ts
type DisplayMode = 'minimal' | 'verbose';
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `toggleDisplayMode(current)` | `DisplayMode` | `DisplayMode` | `'minimal'` <-> `'verbose'` 切换 |
| `filterMessages(messages, mode)` | `Message[]` + `DisplayMode` | `Message[]` | verbose 模式返回全部；minimal 模式过滤掉 `metadata.isRoutingEvent` 为 true 的消息 |

#### 两种模式对比

| 特性 | Minimal (默认) | Verbose (Ctrl+V) |
|------|---------------|------------------|
| 路由事件 | 隐藏 | 显示 |
| 时间戳 | HH:MM | HH:MM:SS |
| Token 计数 | 隐藏 | 显示 |
| CLI 命令详情 | 隐藏 | 显示 |
| Activity block | 折叠为单行摘要 | 展开详情 |

---

### 4. directory-picker-state.ts — 目录选择器逻辑

**来源**: FR-019 (AC-065, AC-066, AC-067)

为 Setup 阶段的目录选择器提供纯逻辑，与 `scroll-state.ts` 和 `InputArea.processInput` 保持相同的提取模式。

#### 核心类型

```ts
interface PickerState {
  inputValue: string;
  selectedIndex: number;
  items: string[];         // MRU + discovered 合并列表
  mru: string[];
  discovered: string[];
  completions: string[];
  warning: string | null;
}

type PickerAction =
  | { type: 'update_input'; value: string }
  | { type: 'tab_complete' }
  | { type: 'submit'; value: string }
  | { type: 'select'; index: number }
  | { type: 'cancel' }
  | { type: 'noop' };
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `completePath(partial)` | 部分路径字符串 | `string[]` | 展开 `~` 到 `$HOME`，列出匹配的子目录（绝对路径）；对目录和文件名使用 `fs.readdirSync` + `fs.statSync` 过滤 |
| `isGitRepo(dir)` | 目录路径 | `boolean` | 检查 `path.join(dir, '.git')` 是否存在 |
| `discoverGitRepos(scanDirs)` | 扫描目录列表 | `string[]` | 对 `scanDirs` 中每个目录做单层扫描，返回含 `.git` 的子目录；不存在或无权限的目录静默跳过 |
| `loadMRU(filePath)` | JSON 文件路径 | `string[]` | 读取 MRU 列表，文件不存在或 JSON 无效时返回空数组 |
| `saveMRU(filePath, dirs)` | 文件路径 + 目录列表 | `void` | 使用 `fs.mkdirSync(recursive: true)` 自动创建父目录后写入 JSON |
| `addToMRU(current, newDir, maxItems?)` | 当前列表 + 新目录 | `string[]` | 纯函数，先过滤已存在项，移至列表头部，上限 `MRU_MAX_ITEMS = 10` |
| `processPickerInput(state, input, key)` | 选择器状态 + 键盘输入 | `PickerAction` | Tab -> `tab_complete`；Escape -> `cancel`；Enter -> 若有输入值则 submit 输入值，否则 submit 列表当前选中项；上下箭头 -> `select` 导航（带边界检查）；Backspace -> 删末字符 `update_input`；普通字符 -> 追加 `update_input` |

#### 常量

- `DEFAULT_SCAN_DIRS`: `~/Projects`, `~/Developer`, `~/code`
- `MRU_MAX_ITEMS = 10`

---

### 5. keybindings.ts — 快捷键映射

**来源**: FR-022 (AC-072, AC-073, AC-074)

将键盘输入映射为语义化的 `KeyAction`，根据上下文（Overlay 是否打开、输入框是否为空）决定不同行为。

#### 核心类型

```ts
type OverlayType = 'help' | 'context' | 'timeline' | 'search';

type KeyAction =
  | { type: 'scroll_up'; amount: number }
  | { type: 'scroll_down'; amount: number }
  | { type: 'jump_to_end' }
  | { type: 'toggle_display_mode' }
  | { type: 'open_overlay'; overlay: OverlayType }
  | { type: 'close_overlay' }
  | { type: 'clear_screen' }
  | { type: 'new_session' }
  | { type: 'interrupt' }
  | { type: 'reclassify' }
  | { type: 'toggle_code_block' }
  | { type: 'tab_complete' }
  | { type: 'noop' };

interface KeyContext {
  overlayOpen: OverlayType | null;
  inputEmpty: boolean;
  pageSize: number;
}
```

#### `processKeybinding(input, key, ctx)` — 优先级顺序

| 优先级 | 条件 | 快捷键 | 动作 |
|--------|------|--------|------|
| 1 | `key.ctrl` — 始终激活 | Ctrl+C | `interrupt` |
| 1 | | Ctrl+N | `new_session` |
| 1 | | Ctrl+I | toggle `context` overlay |
| 1 | | Ctrl+V | `toggle_display_mode` |
| 1 | | Ctrl+T | toggle `timeline` overlay |
| 1 | | Ctrl+R | `reclassify` |
| 1 | | Ctrl+L | `clear_screen` |
| 2 | `key.escape` | Esc | `close_overlay`（有 overlay 时）/ `noop` |
| 3 | 输入字符 | `?` | 输入为空时打开 `help` overlay；已在 help 时关闭 |
| 3 | | `/` | 输入为空时打开 `search` overlay |
| 4 | 无 overlay 且输入为空 | `j`/`↓` | `scroll_down` 1 行 |
| 4 | | `k`/`↑` | `scroll_up` 1 行 |
| 4 | | `G` | `jump_to_end` |
| 4 | 无 overlay（不论输入） | PageDown | `scroll_down` pageSize 行 |
| 4 | | PageUp | `scroll_up` pageSize 行 |
| 5 | Enter 且输入为空且无 overlay | Enter | `toggle_code_block` |
| 5 | | Tab | `tab_complete` |

#### 快捷键参考列表 (`KEYBINDING_LIST`)

供 HelpOverlay 使用的完整列表，包含 15 项 `KeybindingEntry`（`shortcut` + `description`）：

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+C` | 中断 LLM（单次）/ 退出（双击） |
| `Ctrl+N` | 新会话 |
| `Ctrl+I` | Context 摘要 Overlay |
| `Ctrl+V` | 切换 Minimal/Verbose |
| `Ctrl+T` | 事件时间线 Overlay |
| `Ctrl+R` | 重分类任务类型 |
| `Ctrl+L` | 清屏（保留历史） |
| `j/k` 或 `↑/↓` 或 wheel | 滚动消息 |
| `Shift+drag` | 选中/复制文本 |
| `G` | 跳至最新消息 |
| `Enter` | 展开/折叠代码块 |
| `Tab` | 路径自动补全 |
| `?` | 帮助 / 快捷键列表 |
| `/` | 搜索消息历史 |
| `Esc` | 关闭 Overlay / 返回 |

---

### 6. overlay-state.ts — Overlay 生命周期

**来源**: FR-022 (AC-072, AC-073, AC-074)

管理四种 Overlay 的打开/关闭状态和搜索查询。

#### 核心类型

```ts
type OverlayType = 'help' | 'context' | 'timeline' | 'search';

interface OverlayState {
  activeOverlay: OverlayType | null;
  searchQuery: string;
}
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `openOverlay(state, overlay)` | 当前状态 + 要打开的 overlay | `OverlayState` | 打开 search 时清空 `searchQuery` |
| `closeOverlay(state)` | 当前状态 | `OverlayState` | 关闭 overlay 并清空 `searchQuery`；若已无 overlay 则返回原状态引用 |
| `updateSearchQuery(state, query)` | 当前状态 + 新查询 | `OverlayState` | 仅更新 `searchQuery`，保留其余字段 |
| `computeSearchResults(messages, query)` | 消息列表 + 查询字符串 | `Message[]` | 大小写不敏感的子串匹配（`content.toLowerCase().includes(lower)`）；空查询返回空数组 |

**初始状态**: `INITIAL_OVERLAY_STATE` — `activeOverlay: null, searchQuery: ''`

#### 关键约束

- 任一时刻只能有一个 Overlay 处于打开状态
- 搜索查询在 Overlay 关闭时自动清空
- MainLayout 在 search overlay 打开时将文本输入路由到 `updateSearchQuery`，Backspace 删除末字符

---

### 7. markdown-parser.ts — Markdown 解析

**来源**: FR-023 (AC-076, AC-077)

将 Markdown 文本解析为类型化的 segment 数组，供 `StreamRenderer` 和 `message-lines.ts` 渲染。支持流式场景下未闭合的代码块。

#### 输出类型 `MarkdownSegment`

| type | 字段 | 说明 |
|------|------|------|
| `text` | `content` | 普通文本段落 |
| `code_block` | `content`, `language?` | 围栏代码块（`` ``` ``）；未闭合时也会输出 |
| `activity_block` | `kind`, `title`, `content` | `:::activity`/`:::result`/`:::error` 活动块 |
| `inline_code` | `content` | 行内代码 `` `code` `` |
| `bold` | `content` | `**bold**` |
| `italic` | `content` | `*italic*` |
| `list_item` | `content`, `marker` | 有序 (`1.`) / 无序 (`*`, `-`) 列表项 |
| `table` | `headers`, `rows` | Markdown 表格（需 >=2 行且第二行为分隔符） |

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `parseMarkdown(text)` | Markdown 字符串 | `MarkdownSegment[]` | 逐行状态机：先检测 activity block（`:::` 语法），再检测围栏代码块，再检测表格、列表项，最后收集连续纯文本并做 inline 解析；空字符串返回空数组 |

#### 解析规则

- **Activity block**: 匹配 `/^:::(activity|result|error)\s*(.*)$/`，`:::` 单独一行闭合；kind 决定语义（activity=操作、result=结果、error=错误）
- **围栏代码块**: 匹配 `/^```(\w*)\s*$/`，闭合匹配 `/^```\s*$/`；未闭合的块视为仍在流式输出，content 为已收集的行
- **表格**: 要求第二行匹配 `/^\|[\s-:|]+\|$/`（分隔行），否则作为普通文本处理；`parseCells` 按 `|` 分割并 trim 每个单元格
- **列表**: 无序 `/^([*-]) (.+)$/`，有序 `/^(\d+)\. (.+)$/`
- **内联格式**: 正则 `/(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+?)`)/g` 解析 bold、italic、inline_code；嵌套在连续文本行的 `parseInline` 中处理

---

### 8. mouse-input.ts — 鼠标输入过滤与 Wheel 转换

拦截终端 SGR 鼠标跟踪序列，将滚轮事件转换为箭头键序列（供 Ink 的 `useInput` 消费），丢弃非滚轮鼠标事件（点击、移动等）。通过 Node.js `Transform` stream 实现 stdin 代理。

#### 核心类型

```ts
interface MouseInputFilterResult {
  output: string;    // 过滤后的输出（滚轮转为箭头键，其余保留）
  pending: string;   // 未完成的 SGR 序列（等待更多数据）
}

interface TerminalInputHandle {
  stdin: NodeJS.ReadStream;  // 代理后的 stdin（可直接传给 Ink）
  cleanup: () => void;       // 清理函数（解除 pipe + 结束 stream）
}
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `filterMouseTrackingInput(chunk, pending?, wheelLines?)` | 输入文本块 + 待处理缓冲 + 每次滚轮行数 | `MouseInputFilterResult` | 扫描 `\x1b[<` 前缀的 SGR 鼠标序列；滚轮上（buttonCode bit6=1, bit0-1=00）-> 生成 `wheelLines` 个 `\x1b[A`（上箭头）；滚轮下（bit0-1=01）-> 生成 `\x1b[B`（下箭头）；非滚轮鼠标事件静默丢弃；畸形序列丢弃；不完整序列暂存到 `pending` |
| `createTerminalInput(source?)` | 可选的源 `ReadStream`（默认 `process.stdin`） | `TerminalInputHandle` | 创建 `MouseCaptureInputStream`（Transform stream），pipe 源 stdin 通过过滤器，返回代理 stdin + cleanup 函数 |

#### 内部类 `MouseCaptureInputStream`

继承 `Transform`，在 `_transform` 中调用 `filterMouseTrackingInput` 过滤每个 chunk。`dispose()` 方法幂等地解除 pipe 并结束 stream。

#### 代理 stdin 的属性复制

`attachReadStreamMethods` 将源 stdin 的 `isTTY`、`setRawMode`、`ref`、`unref`、`pause`、`resume` 等方法绑定到代理对象上，确保 Ink 框架能正常检测终端能力。

#### 常量

- `DEFAULT_WHEEL_LINES = 3` — 每次滚轮事件转换为 3 个箭头键
- `SGR_MOUSE_PATTERN = /^\x1b\[<(\d+);(\d+);(\d+)([mM])/` — SGR 鼠标序列正则

---

### 9. git-diff-stats.ts — Git 变更统计

**来源**: FR-026 (AC-082)

解析 `git diff --stat` 输出的摘要行。

#### 核心类型

```ts
interface GitDiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `parseGitDiffStat(output)` | `git diff --stat` 的输出字符串 | `GitDiffStats` | 正则提取 `N files changed`（`/(\d+)\s+files?\s+changed/`）、`N insertions(+)`（`/(\d+)\s+insertions?\(\+\)/`）、`N deletions(-)`（`/(\d+)\s+deletions?\(-\)/`）；无 filesMatch 时返回全零对象 |

---

### 10. session-runner-state.ts — 流式聚合与用户决策

**来源**: 多个 FR，是 App 组件中 SessionRunner 的核心状态逻辑提取。

这是最复杂的状态模块，包含三大职责：

1. **流式聚合** — 将 adapter 输出的 `OutputChunk` 流逐步聚合为最终文本
2. **用户决策解析** — 将用户输入映射为工作流 action
3. **会话恢复** — 从持久化的 `LoadedSession` 重建运行时状态

#### 流式聚合

```ts
interface StreamAggregation {
  fullText: string;          // 完整历史文本（含 tool use 记录）
  llmText: string;           // 纯 LLM 文本输出（仅 text + code chunk，不含工具标记和状态元数据）
  displayText: string;       // UI 显示文本（含工具摘要头）
  displayBodyText: string;   // 纯正文部分（不含工具摘要头）
  errorMessages: string[];   // 累积的错误消息
  activeToolName: string | null;  // 当前活跃的工具名
  toolUpdateCount: number;   // 工具调用累计次数
  toolWarningCount: number;  // 工具警告累计次数
  latestToolSummary: string | null;  // 最新工具摘要文本
}

type StreamOutcome =
  | { kind: 'success'; fullText: string; llmText: string; displayText: string }
  | { kind: 'error'; fullText: string; llmText: string; displayText: string; errorMessage: string }
  | { kind: 'no_output'; fullText: string; llmText: string; displayText: string };
```

| 函数 | 说明 |
|------|------|
| `createStreamAggregation()` | 创建初始聚合状态，所有字段为空/零 |
| `applyOutputChunk(state, chunk)` | 处理一个 chunk：text/code 追加到 fullText、llmText 和 displayBodyText；tool_use 格式化为摘要行；tool_result 记录行数或错误；error 追加到 errorMessages（`metadata.fatal !== false` 时）；status chunk 仅追加到 fullText（信息性，防止 stderr-only 运行产生 `no_output`） |
| `finalizeStreamAggregation(state)` | 根据 errorMessages 和文本内容决定 outcome 类型：有 error -> `'error'`；全空 -> `'no_output'`；否则 `'success'` |

**工具格式化特殊逻辑** (`formatToolUse`):
- `Bash` -> 提取 `input.description` 字段，`historyLine: "[Bash] description"`，`displaySummary: "Bash: description"`
- `Read` -> 提取 `input.file_path` 或 `input.path` 并取文件名，`"Read: Read filename"`
- `Explore` -> 提取 `input.description` 字段
- 其他工具 -> `summarizeStructuredValue` 将 input 做 `JSON.stringify(value, null, 2)`

**displayText 构建** (`buildDisplayText`): 在 bodyText 前添加工具统计摘要行，格式 `⏺ N tool updates · M warnings · latest <summary>`

**内容拼接逻辑** (`appendContent`): 两段内容之间的拼接规则——若前文以 `:::` 结尾而后文不以 `\n` 开头，插入 `\n`；否则若前文不以 `\n` 结尾且后文不以 `\n` 开头，插入 `\n`；其余直接拼接。

#### 用户决策

```ts
type UserDecision =
  | { type: 'confirm'; action: 'accept' | 'continue'; pendingInstruction?: string }
  | { type: 'resume'; input: string; resumeAs: 'coder' | 'reviewer' };
```

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `resolveUserDecision(stateValue, text, lastInterruptedRole)` | 状态机状态值 + 用户输入文本 + 上次中断角色 | `UserDecision \| null` | `WAITING_USER`/`PAUSED` 状态：`a`/`accept` -> accept，`c`/`continue` -> continue，其他非空文本 -> continue + pendingInstruction；`INTERRUPTED` 状态：有文本 -> resume（resumeAs 取 lastInterruptedRole，fallback 到 `'coder'`）；其余返回 null |

#### 会话恢复

```ts
interface RestoredSessionRuntime {
  workflowInput: Partial<WorkflowContext>;
  restoreEvent: RestoreEventType;
  messages: Message[];
  reviewerOutputs: string[];
  tokenCount: number;
  coderSessionId?: string;
  reviewerSessionId?: string;
  godSessionId?: string;
  godTaskAnalysis?: GodTaskAnalysis;
  currentPhaseId?: string | null;
}

type RestoreEventType =
  | 'RESTORED_TO_CODING'
  | 'RESTORED_TO_REVIEWING'
  | 'RESTORED_TO_WAITING'
  | 'RESTORED_TO_INTERRUPTED'
  | 'RESTORED_TO_CLARIFYING';
```

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `buildRestoredSessionRuntime(loaded, config)` | `LoadedSession` + `SessionConfig` | `RestoredSessionRuntime` | 按时间排序历史记录，通过 `toMessage` 转换为 Message（id 格式 `restored-{role}-{timestamp}`），估算 token（`CHARS_PER_TOKEN = 4`），提取 CLI session ID 用于 adapter resume，恢复 God 相关状态，支持 BUG-16 fix（CLARIFYING 状态恢复 `frozenActiveProcess` 和 `clarificationRound`） |

**状态恢复映射** (`mapRestoreEvent`):

| 原始 status | RestoreEventType |
|-------------|------------------|
| `created`, `coding` | `RESTORED_TO_CODING` |
| `reviewing`, `routing_post_code` | `RESTORED_TO_REVIEWING` |
| `interrupted` | `RESTORED_TO_INTERRUPTED` |
| `clarifying` | `RESTORED_TO_CLARIFYING` |
| `god_deciding`, `manual_fallback`, `routing_post_review`, `evaluating`, `waiting_user`, `error`, `done`, 其他 | `RESTORED_TO_WAITING` |

---

## God LLM UI 状态

### 11. god-fallback.ts — God 调用 Retry + Backoff 包装

简洁的 God 调用重试包装器，提供 Watchdog 驱动的 retry + exponential backoff 机制。核心原则：最多重试 3 次（由 Watchdog 控制），然后暂停。无 fallback 模式，无 degradation。

#### 核心类型

```ts
interface RetryResult<T> {
  result: T;
  retryCount: number;
}

interface PausedResult {
  paused: true;
  retryCount: number;
}
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `withRetry<T>(fn, watchdog)` | 异步操作函数 + `WatchdogService` | `Promise<RetryResult<T> \| PausedResult>` | 循环调用 `fn()`：成功 -> `watchdog.handleSuccess()` -> 返回 `{ result, retryCount }`；失败 -> 检查 `watchdog.shouldRetry()`，若否则返回 `{ paused: true, retryCount }`；若是则 `retryCount++`，等待 `watchdog.getBackoffMs()` 后重试 |
| `isPaused<T>(r)` | `RetryResult<T> \| PausedResult` | `boolean` (type guard) | 检查 `'paused' in r && r.paused === true` |

#### 设计要点

- 无 fallback / degradation 逻辑，重试耗尽后简单暂停
- 依赖注入式设计，通过 `WatchdogService` 接口控制重试策略和 backoff 时间
- exponential backoff 由 `watchdog.getBackoffMs()` 提供

---

### 12. god-message-style.ts — God 消息视觉样式

**来源**: FR-014 (AC-041)

God 消息使用 `╔═╗` 双边框 + Cyan/Magenta 颜色，与 Coder/Reviewer 的单边框视觉区分。仅在关键决策点显示，避免视觉噪音。

#### 核心类型

```ts
interface GodMessageStyle {
  borderChar: string;     // ║ 侧边框
  topBorder: string;      // ╔═...═╗
  bottomBorder: string;   // ╚═...═╝
  borderColor: string;    // cyan
  textColor: string;      // magenta
}

type GodMessageType =
  | 'task_analysis'       // 任务分析
  | 'phase_transition'    // 阶段切换
  | 'auto_decision'       // 代理决策
  | 'anomaly_detection'   // 异常检测
  | 'clarification';      // God 澄清提问
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `shouldShowGodMessage(type)` | `GodMessageType` | `boolean` | 五种类型均为可见（`VISIBLE_TYPES` Set 包含所有五种） |
| `formatGodMessage(content, type)` | 内容 + 消息类型 | `string[]` | 生成 `╔═╗` / `║ content ║` / `╚═╝` 格式的行数组；内容按行 pad 到 `BOX_WIDTH(50) - 2` 宽度；header 行显示 `TYPE_LABELS` 中的标签 |

#### 辅助函数

- `getVisualWidth(text)` — 计算文本视觉宽度，CJK 字符计为宽度 2（检测范围与 `message-lines.ts` 相同）
- `truncateToWidth(text, maxWidth)` — 按视觉宽度截断文本，逐字符累加宽度直到超出 maxWidth
- `padLine(text, innerWidth)` — 先截断到 innerWidth，再用空格 pad 到 innerWidth，最后添加 `║` 边框

#### 常量

- `BOX_WIDTH = 50`
- `GOD_STYLE` — 预定义的样式对象（`borderChar: '║'`, `borderColor: 'cyan'`, `textColor: 'magenta'`）
- `TYPE_LABELS` — 各消息类型的标签映射：`'God · Task Analysis'`、`'God · Phase Transition'`、`'God · Auto Decision'`、`'God · Anomaly Detection'`、`'God · Clarification'`

---

### 13. phase-transition-banner.ts — 阶段切换 Banner 状态

**来源**: FR-010 (AC-033, AC-034)

compound 任务阶段切换时的 2 秒 escape window 状态管理。用户可确认或取消阶段切换。

#### 核心类型

```ts
interface PhaseTransitionBannerState {
  nextPhaseId: string;
  previousPhaseSummary: string;
  countdown: number;       // 毫秒，初始 2000
  cancelled: boolean;
  confirmed: boolean;
}
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `createPhaseTransitionBannerState(nextPhaseId, previousPhaseSummary)` | 下一阶段 ID + 上一阶段摘要 | `PhaseTransitionBannerState` | `countdown: 2000, cancelled: false, confirmed: false` |
| `handlePhaseTransitionKeyPress(state, key)` | 当前状态 + `'space'`/`'escape'` | `PhaseTransitionBannerState` | 已 cancelled/confirmed 时返回原状态；space -> confirmed; escape -> cancelled |
| `tickPhaseTransitionCountdown(state)` | 当前状态 | `PhaseTransitionBannerState` | 已 cancelled/confirmed 或 countdown <= 0 时返回原状态；每 tick 减 `PHASE_TICK_INTERVAL_MS(100)`；减至 0 时 confirmed（自动确认） |

#### 常量

- `PHASE_ESCAPE_WINDOW_MS = 2000` — 2 秒等待窗口
- `PHASE_TICK_INTERVAL_MS = 100`

---

### 14. reclassify-overlay.ts — 运行时任务重分类 Overlay 状态

**来源**: FR-002a (AC-010, AC-011, AC-012)

Ctrl+R 触发的全屏 overlay，允许用户在 session 运行中更改任务类型。

#### 核心类型

```ts
interface ReclassifyOverlayState {
  visible: boolean;
  currentType: TaskType;
  selectedType: TaskType;
  availableTypes: TaskType[];  // ['explore', 'code', 'review', 'debug']，不含 compound 和 discuss
}
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `canTriggerReclassify(workflowState)` | 状态机当前状态字符串 | `boolean` | 仅允许在 `RECLASSIFY_ALLOWED_STATES` 中的状态下触发 |
| `createReclassifyState(currentType)` | 当前任务类型 | `ReclassifyOverlayState` | `visible: true`，`selectedType` 初始化为 currentType（若在可用列表中）或列表第一项 |
| `handleReclassifyKey(state, key)` | 当前状态 + 按键字符串 | `{ state, action? }` | 数字 1-N -> 直接选择并 `confirm`（`visible: false`）；`arrow_down`/`arrow_up` -> 循环移动选择；`enter` -> `confirm`；`escape` -> `cancel` 并恢复 `selectedType` 为 `currentType` |
| `writeReclassifyAudit(sessionDir, opts)` | session 目录 + `{ seq, fromType, toType }` | `void` | 将重分类事件写入 audit log，`decisionType: 'RECLASSIFY'`，`inputSummary` 和 `outputSummary` 记录类型变更 |

#### 允许触发的状态

```ts
const RECLASSIFY_ALLOWED_STATES = ['CODING', 'REVIEWING', 'GOD_DECIDING', 'PAUSED'];
```

---

### 15. task-analysis-card.ts — 任务分析卡片状态

**来源**: FR-001a (AC-004, AC-005, AC-006, AC-007)

God 任务分析结果的 intent echo 卡片状态管理。用户可在 8 秒倒计时内选择/确认任务类型，超时自动确认推荐类型。

#### 核心类型

```ts
type TaskType = 'explore' | 'code' | 'discuss' | 'review' | 'debug' | 'compound';

const TASK_TYPE_LIST: TaskType[] = [
  'explore', 'code', 'discuss', 'review', 'debug', 'compound',
];

interface TaskAnalysisCardState {
  analysis: GodTaskAnalysis;
  selectedType: TaskType;
  countdown: number;          // 8 秒倒计时
  countdownPaused: boolean;   // 箭头键导航时暂停
  confirmed: boolean;
}
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `createTaskAnalysisCardState(analysis)` | `GodTaskAnalysis` | `TaskAnalysisCardState` | `selectedType` 初始为 `analysis.taskType`（强制转换为 TaskType），`countdown: 8`（`INITIAL_COUNTDOWN`），`countdownPaused: false`，`confirmed: false` |
| `handleKeyPress(state, key)` | 当前状态 + 按键字符串 | `TaskAnalysisCardState` | 已 confirmed 时返回原状态；数字 1-6 -> 直接选择并 confirm；`arrow_down`/`arrow_up` -> 循环移动选择并 `countdownPaused: true`；`enter` -> confirm；`space` -> 重置 selectedType 为推荐类型并 confirm |
| `tickCountdown(state)` | 当前状态 | `TaskAnalysisCardState` | 已 confirmed 或 paused 或 countdown <= 0 时返回原状态；每秒减 1；减至 0 时自动 confirm |

#### 常量

- `TASK_TYPE_LIST`: 6 种任务类型的有序列表（数字键 1-6 映射到此顺序）
- `INITIAL_COUNTDOWN = 8` — 8 秒自动确认

#### 交互逻辑

- 数字键 `1-6`：直接选中对应 `TASK_TYPE_LIST` 元素并确认
- 上下箭头：在列表中循环移动选择（使用模运算 `%`），同时暂停倒计时
- Enter：确认当前选中
- Space：确认 God 推荐的类型（重置 selectedType 后 confirm）
- 倒计时到 0：自动确认当前选中类型

---

### 16. message-lines.ts — 消息行计算与渲染

连接数据层（`Message`）和视图层（MainLayout 行级渲染）的桥梁模块。将 `Message[]` 数组转换为扁平的 `RenderedMessageLine[]` 数组，供 MainLayout 进行滚动窗口切片和逐行渲染。

#### 核心类型

```ts
interface LineSpan {
  text: string;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
}

interface RenderedMessageLine {
  key: string;          // 唯一 key，格式 `${messageId}-header` / `${messageId}-body-N` / `${messageId}-spacer`
  spans: LineSpan[];    // 一行内的多个样式片段
}
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `buildRenderedMessageLines(messages, displayMode, columns)` | `Message[]` + `DisplayMode` + 终端列宽 | `RenderedMessageLine[]` | 核心入口：遍历消息列表，每条消息生成 header 行 + 可选 CLI command 行 + body 行 + spacer 行 |
| `wrapText(text, width)` | 文本 + 列宽 | `string[]` | 按终端列宽自动折行，支持 CJK 宽字符；优先在空格和 CJK 字符边界断行，无合适断点时硬断 |

#### 每条消息的行结构

每条 `Message` 被转换为以下行序列：

1. **Header 行** — `${border} [RoleName · RoleLabel] HH:MM`，Verbose 模式下追加 `[Nk tokens]`
2. **CLI Command 行**（可选）— 仅 Verbose 模式下存在 `metadata.cliCommand` 时显示，前缀 `$ `，`dimColor: true`
3. **Body 行** — 消息内容经以下管线处理：
   - `parseMarkdown(content)` -> `MarkdownSegment[]`
   - `segmentsToBlocks(segments, displayMode)` -> `{ lines, style }[]`
   - `wrapText(line, bodyWidth)` -> 折行后的字符串数组
4. **Spacer 行** — 空行（`spans: [{ text: '' }]`），作为消息间分隔

#### 内部函数 `segmentsToBlocks`

将 `MarkdownSegment[]` 转换为带样式的文本块：

| Segment 类型 | 转换规则 |
|-------------|---------|
| `text` / `bold` / `italic` | 合并到当前段落（paragraph），flush 时按 `\n` 分行，`style: {}` |
| `inline_code` | 追加到段落，保留反引号包裹（`` ` ``） |
| `list_item` | flush 段落后，`-`/`*` 替换为 `•`，有序列表保留数字标记，`style: {}` |
| `code_block` | flush 段落后，`style: { color: 'cyan' }`，language 存在时在首行添加 `[lang]` |
| `table` | flush 段落后，`style: { dimColor: true }`，headers 和 rows 以 ` \| ` 连接 |
| `activity_block` | flush 段落后，根据 kind 选择图标（`⏺`/`⎿`/`⚠`）和颜色（cyan/gray/red）；Minimal 模式折叠为 `icon title: firstLine`；Verbose 模式展开所有内容行（`slice(1)` 显示后续行） |

#### 辅助函数

| 函数 | 说明 |
|------|------|
| `getCharWidth(char)` | 检测 CJK 字符范围（U+1100-U+115F、U+2E80-U+A4CF（排除 U+303F）、U+AC00-U+D7A3、U+F900-U+FAFF、U+FE10-U+FE19、U+FE30-U+FE6F、U+FF00-U+FF60、U+FFE0-U+FFE6），返回宽度 2；其他字符返回 1 |
| `computeStringWidth(s)` | 计算字符串的终端显示宽度，逐字符累加 `getCharWidth`；被 `TaskBanner` 等组件复用 |
| `formatTime(timestamp, verbose)` | 非 verbose 返回 `HH:MM`，verbose 返回 `HH:MM:SS` |
| `formatTokenCount(count)` | `< 1000` 返回原数字字符串，`>= 1000` 返回 `N.Mk` 格式（如 `1.5k`） |

#### 关键设计决策

- `bodyWidth = max(16, columns - 2)` — 最小宽度 16 字符（`MIN_BODY_WIDTH`），预留边框空间
- 颜色和边框字符从 `getRoleStyle(role)` 获取，按角色（user / system / claude 等）区分
- 空消息体会生成一个空文本行（`{ text: '', style: {} }`），保证渲染一致性
- 该模块取代了之前 MainLayout 直接渲染 `MessageView` 组件的方式，将行计算前置到纯数据层，使滚动切片可以精确到行级别
- `wrapText` 的折行算法追踪 `lastBreakPos` 和 `lastBreakWidth`，在空格和 CJK 字符之后标记断行点；无断行点时直接硬断

---

## Runtime/Lifecycle 状态

### 17. completion-flow.ts — 任务完成后续流

任务完成后支持用户追加需求的 prompt 构建逻辑。

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `buildContinuedTaskPrompt(currentTask, followUpRequirement)` | 当前任务描述 + 追加需求 | `string` | 将原始任务与追加需求拼接，格式：`currentTask + 空行 + "Additional user requirement:" + followUpRequirement.trim()`，使用 `\n` 连接 |

#### 使用场景

当用户在 CompletionScreen 中选择 "Continue current task" 时，调用此函数生成合并后的任务 prompt，传递给新一轮 Duo session。

---

### 18. global-ctrl-c.ts — 全局 Ctrl+C 双击检测

全局级别的 Ctrl+C 行为管理。单次 Ctrl+C 中断当前 LLM 执行；500ms 内双击 Ctrl+C 触发安全退出。

#### 核心类型

```ts
type GlobalCtrlCAction = 'interrupt' | 'safe_exit';
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `resolveGlobalCtrlCAction(now, lastCtrlCAt, thresholdMs?)` | 当前时间戳 + 上次 Ctrl+C 时间戳 + 阈值（默认 500ms） | `{ action: GlobalCtrlCAction; nextLastCtrlCAt: number }` | 若 `lastCtrlCAt > 0` 且两次按键间隔 `<= thresholdMs` 则返回 `safe_exit` 并重置 `nextLastCtrlCAt` 为 0；否则返回 `interrupt` 并设置 `nextLastCtrlCAt` 为当前时间戳 |

#### 常量

- `DOUBLE_CTRL_C_THRESHOLD_MS = 500` — 双击判定窗口 500 毫秒

#### 使用场景

App 组件在根级 `useInput` 中使用此函数，配合 `lastCtrlCRef` 维护上次按键时间。`interrupt` action 分发给 SessionRunner 中断当前 adapter；`safe_exit` action 触发 `performSafeShutdown` 安全退出。

---

### 19. safe-shutdown.ts — 安全退出流程

协调 adapter 终止、输出中断和进程退出的安全关机流程。确保所有子进程在退出前被正确清理。

#### 核心类型

```ts
interface KillableAdapter {
  kill(): Promise<void>;
}

interface InterruptibleOutputManager {
  interrupt(): void;
}

interface SafeShutdownOptions {
  adapters: KillableAdapter[];           // 需要 kill 的 adapter 列表
  outputManager?: InterruptibleOutputManager;  // 可选的输出流管理器
  beforeExit?: () => void;               // 退出前回调（如持久化状态）
  onExit: () => void;                    // 最终退出回调（通常是 process.exit 或 ink exit）
}
```

#### 核心函数

| 函数 | 输入 | 输出 | 关键逻辑 |
|------|------|------|----------|
| `performSafeShutdown(options)` | `SafeShutdownOptions` | `Promise<void>` | 1. 中断输出流（`outputManager?.interrupt()`）；2. 并行 kill 所有 adapter（`Promise.allSettled`，容错不阻塞）；3. 执行 `beforeExit?.()` 回调（try/catch 包裹，best-effort）；4. 调用 `onExit()` 完成退出 |

#### 设计要点

- 使用 `Promise.allSettled` 而非 `Promise.all`，确保某个 adapter kill 失败不会阻止其他 adapter 的清理
- `beforeExit` 回调被 try/catch 包裹，退出流程不依赖持久化是否成功
- 依赖注入式设计（duck typing），adapter 只需实现 `kill(): Promise<void>` 接口
- 执行顺序严格：先中断输出 -> 再终止适配器 -> 再持久化 -> 最后退出

---

## 模块间依赖关系

```
Core UI 依赖:
  alternate-screen.ts ──> (无外部依赖，纯终端 escape 序列)

  mouse-input.ts ──> node:stream (Transform)

  message-lines.ts ──> markdown-parser.ts (parseMarkdown)
                   ──> display-mode.ts (DisplayMode 类型)
                   ──> types/ui.ts (Message, getRoleStyle, RoleName)

  keybindings.ts ──> ink (Key 类型)

  overlay-state.ts ──> types/ui.ts (Message)

  directory-picker-state.ts ──> node:fs, node:path
                             ──> ink (Key 类型)

  session-runner-state.ts ──> types/adapter.ts (OutputChunk)
                           ──> session/session-manager.ts (LoadedSession, SessionState)
                           ──> engine/workflow-machine.ts (WorkflowContext)
                           ──> types/god-schemas.ts (GodTaskAnalysis)
                           ──> types/session.ts (SessionConfig)
                           ──> types/ui.ts (Message, RoleName)

God LLM UI 依赖:
  god-fallback.ts ──> god/watchdog.ts (WatchdogService)

  god-message-style.ts ──> (无外部依赖，纯样式定义)

  phase-transition-banner.ts ──> (无外部依赖)

  reclassify-overlay.ts ──> task-analysis-card.ts (TaskType)
                         ──> god/god-audit.ts (GodAuditEntry, appendAuditLog)

  task-analysis-card.ts ──> types/god-schemas.ts (GodTaskAnalysis)

Runtime/Lifecycle 依赖:
  completion-flow.ts ──> (无外部依赖，纯字符串拼接)

  global-ctrl-c.ts ──> (无外部依赖，纯时间戳计算)

  safe-shutdown.ts ──> (无外部依赖，duck typing 接口)

MainLayout 组件消费:
  scroll-state.ts, display-mode.ts, keybindings.ts,
  overlay-state.ts, message-lines.ts

App/SessionRunner 组件消费:
  alternate-screen.ts, mouse-input.ts,
  session-runner-state.ts, god-fallback.ts,
  phase-transition-banner.ts, reclassify-overlay.ts,
  task-analysis-card.ts, completion-flow.ts,
  global-ctrl-c.ts, safe-shutdown.ts
```

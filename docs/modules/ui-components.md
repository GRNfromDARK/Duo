# UI 组件

> 路径: `src/ui/components/*.tsx`

## 技术框架

Duo 的终端 UI 基于以下技术栈：

- **Ink** (React for CLI) — 使用 React 组件模型渲染终端界面，提供 `Box`, `Text`, `useInput`, `useApp`, `useStdout` 等原语
- **@xstate/react** — 通过 `useMachine` hook 驱动工作流状态机 (`workflowMachine`)，实现 CODING -> ROUTING -> REVIEWING -> EVALUATING 等状态转换
- **纯函数状态层** — 所有复杂逻辑提取到 `src/ui/*.ts`（见 `ui-state.md`），组件仅负责渲染和事件绑定

## 组件树结构

```
App (根组件)
├── [Setup 阶段]
│   ├── DirectoryPicker         — 项目目录选择
│   ├── CLISelector (内部组件)  — Coder/Reviewer 选择
│   └── TaskInput (内部组件)    — 任务描述输入
│
└── [Session 阶段] SessionRunner (内部组件)
    └── MainLayout (NEW)
        ├── StatusBar 区域       — 顶部状态栏（内联 <Text inverse bold>）
        ├── RenderedLineView[]   — 消息行列表（基于 message-lines.ts 输出）
        │   └── LineSpan 渲染    — 逐 span 着色
        ├── ScrollIndicator      — 新输出提示条
        ├── InputArea            — 用户输入区域
        └── [Overlay 层]（全屏替换布局）
            ├── HelpOverlay      — 快捷键帮助
            ├── ContextOverlay   — 会话上下文
            ├── TimelineOverlay  — 事件时间线
            └── SearchOverlay    — 消息搜索

其他组件（由 StreamRenderer / MainLayout 外部使用）：
  ├── MessageView          — 单条消息渲染（含 StreamRenderer）
  ├── StreamRenderer       — Markdown 流式渲染
  │   └── CodeBlock        — 可折叠代码块
  ├── SystemMessage        — 系统消息（routing/interrupt/waiting）
  ├── ConvergenceCard      — 收敛卡片
  └── DisagreementCard     — 分歧卡片
```

## 两个阶段

### Setup 阶段 — 交互式引导

当启动参数不完整时，App 进入 Setup 阶段，依次经历 4 个 phase：

1. **select-dir** -> 渲染 `DirectoryPicker`，选择项目目录
2. **select-coder** -> 渲染 `CLISelector`，选择 Coder CLI 工具
3. **select-reviewer** -> 渲染 `CLISelector`（排除已选 Coder），选择 Reviewer
4. **enter-task** -> 渲染 `TaskInput`，输入任务描述

每个 phase 完成后将结果写入 `setupConfig`，最后进入 `running` phase。

### Session 阶段 — 运行态

配置完整后渲染 `SessionRunner`，通过 xstate 状态机驱动整个工作流。`SessionRunner` 内部使用大量 `useEffect` 监听状态变化，自动触发 adapter 执行、路由决策、收敛评估等副作用。SessionRunner 将消息列表和状态文本传给 `MainLayout` 进行布局渲染。

---

## 组件详细说明

### 1. App.tsx — 根组件

**Props**:

```ts
interface AppProps {
  initialConfig?: SessionConfig;   // 命令行传入的初始配置
  detected: DetectedCLI[];         // 检测到的 CLI 工具列表
  resumeSession?: LoadedSession;   // 要恢复的会话（可选）
}
```

**职责**:
- 判断配置是否完整（`projectDir` + `coder` + `reviewer` + `task` 均存在），决定进入 Setup 还是 Session 阶段
- Setup 阶段：管理 `SetupPhase` 状态（`select-dir` -> `select-coder` -> `select-reviewer` -> `enter-task`）
- Session 阶段：实例化 `SessionRunner`，传入最终 `SessionConfig`

**关键行为**:
- 内部包含 `CLISelector` 和 `TaskInput` 两个私有子组件
- `CLISelector` 过滤已安装的 CLI（`d.installed === true`）并支持上下箭头选择、Enter 确认；可通过 `exclude` 排除已选的 CLI
- `TaskInput` 支持文本输入、Backspace 删除、Enter 提交

**SessionRunner — App 内部的 Session 阶段核心组件**:

```ts
interface SessionRunnerProps {
  config: SessionConfig;
  detected: DetectedCLI[];
  columns: number;
  rows: number;
  resumeSession?: LoadedSession;
}
```

SessionRunner 的职责包括：
- 通过 `useMachine(workflowMachine)` 创建 xstate actor，`MAX_ROUNDS = 20`
- 持有 adapter、ContextManager、ConvergenceService、ChoiceDetector、SessionManager、OutputStreamManager 等服务的 `useRef`
- 管理 `messages`（`Message[]`）、`tokenCount`、`timelineEvents` 等 UI 状态
- 监听 `CODING` 状态：启动 coder adapter 流式执行，通过 `createStreamAggregation` + `applyOutputChunk` 聚合输出，实时 `updateMessage` 更新流式消息，完成后 `finalizeStreamAggregation` 决定 outcome
- 监听 `REVIEWING` 状态：与 CODING 对称，启动 reviewer adapter
- 监听 `ROUTING_POST_CODE` / `ROUTING_POST_REVIEW`：调用 `decidePostCodeRoute` / `decidePostReviewRoute` 触发路由决策
- 监听 `EVALUATING`：执行 `convergenceRef.current.evaluate()` 进行收敛检查，插入 `createRoundSummaryMessage` 分隔线
- 处理用户输入（`handleInputSubmit`）：CODING/REVIEWING 状态下中断当前进程并附带指令；WAITING_USER 状态下通过 `resolveUserDecision` 解析用户意图
- 处理 Ctrl+C（`handleInterrupt`）：单次中断当前进程（kill adapter + interrupt OutputStreamManager），500ms 内双击退出应用（退出前保存会话状态）
- 会话持久化：创建/保存/恢复会话状态，均为 best-effort（try-catch 忽略错误）
- 支持 Adapter session resume：恢复会话时通过 `isSessionCapable` 检测 adapter 是否支持 `restoreSessionId`

**副作用管理模式**: 每个 xstate 状态对应一个 `useEffect`，依赖 `stateValue` 变化。CODING 和 REVIEWING 的 effect 包含 cleanup 函数（`cancelled = true; osm.interrupt()`），确保组件卸载或状态切换时中断进程。

**statusText 构建**: SessionRunner 将状态信息组装为单个字符串传给 MainLayout：`Duo  <projectName>  Round N/Max  <Agent> <icon> <status>  <tokens>tok`

---

### 2. MainLayout.tsx (NEW) — 主布局组件

**Props**:

```ts
interface MainLayoutProps {
  messages: Message[];
  statusText: string;
  columns: number;
  rows: number;
  isLLMRunning?: boolean;
  onInputSubmit?: (text: string) => void;
  onNewSession?: () => void;
  onInterrupt?: () => void;
  onClearScreen?: () => void;
  contextData?: {
    roundNumber: number;
    coderName: string;
    reviewerName: string;
    taskSummary: string;
    tokenEstimate: number;
  };
  timelineEvents?: TimelineEvent[];
}
```

**职责**: Session 阶段的核心布局组件，整合所有 UI 状态模块，管理消息区滚动、显示模式、Overlay 和输入。

**布局结构**（从上到下）:

| 区域 | 高度 | 内容 |
|------|------|------|
| Status Bar | 1 行 | `<Text inverse bold> statusText </Text>` |
| 分隔线 | 1 行 | `─` 重复 `columns` 次 |
| 消息区 | `rows - 6` 行（动态） | 滚动窗口内的 `RenderedLineView` 列表 + ScrollIndicator |
| 分隔线 | 1 行 | `─` 重复 `columns` 次 |
| InputArea | 3 行 | 用户输入区域 |

高度计算: `messageAreaHeight = max(1, rows - STATUS_BAR_HEIGHT(1) - INPUT_AREA_HEIGHT(3) - SEPARATOR_LINES(2))`

**关键行为**:

- **消息渲染管线**: `messages` -> `filterMessages(displayMode)` -> `.slice(clearedCount)` -> `buildRenderedMessageLines(columns)` -> `renderedLines[effectiveOffset..effectiveOffset+visibleSlots]` -> `RenderedLineView` 组件
- **滚动状态**: 持有 `ScrollState`（来自 `scroll-state.ts`），通过 `computeScrollView` 计算可见窗口
- **显示模式**: 持有 `DisplayMode`（默认 `'minimal'`），通过 `toggleDisplayMode` 切换
- **Overlay 状态**: 持有 `OverlayState`（来自 `overlay-state.ts`），有 overlay 时全屏替换正常布局
- **清屏功能**: `Ctrl+L` 记录 `clearedCount`（当前已过滤消息数），后续只显示新消息，不删除历史
- **键盘处理**: `useInput` -> `processKeybinding(input, key, ctx)` -> `handleAction(action)`，分发到各状态更新函数
- **Search overlay 输入**: 当 search overlay 打开时，额外将文本输入路由到 `updateSearchQuery`（Backspace 删字符，其他字符追加）
- **InputArea 集成**: 受控模式（`value` + `onValueChange`），`disabled` 在 overlay 打开时为 true
- **InputArea 特殊键**: `?` 和 `/` 在输入为空时通过 `onSpecialKey` 回调打开对应 overlay

**RenderedLineView 内部组件**: 将 `RenderedMessageLine` 的 `spans[]` 数组渲染为多个带样式的 `<Text>` 元素。

---

### 3. StatusBar.tsx — 状态栏

**Props**:

```ts
interface StatusBarProps {
  projectPath: string;
  round: number;
  maxRounds: number;
  status: WorkflowStatus;    // 'idle' | 'active' | 'error' | 'routing' | 'interrupted' | 'done'
  activeAgent: string | null;
  tokenCount: number;
  columns: number;
}
```

**职责**: 渲染顶部 1 行状态栏，固定高度。

**注意**: 当前 MainLayout 中状态栏由 SessionRunner 预先组装为 `statusText` 字符串，使用内联 `<Text inverse bold>` 渲染，并未直接使用 StatusBar 组件。StatusBar 组件作为独立的可复用组件存在。

**布局**: ` Duo  <项目路径>  Round N/Max  <Agent> <icon> <status>  <tokens>tok`

**关键行为**:
- 状态图标和颜色由 `STATUS_CONFIG` 映射：active=绿色 `◆`，idle=白色 `◇`，error=红色 `⚠`，routing=黄色 `◈`，interrupted=白色 `⏸`，done=绿色 `◇`
- token 计数 >= 1000 时显示为 `Nk` 格式（如 `1.5k`）
- 项目路径根据可用宽度自动截断，末尾添加 `...`
- 使用 `<Text inverse bold>` 实现反色高亮背景

---

### 4. CodeBlock.tsx — 可折叠代码块

**Props**:

```ts
interface CodeBlockProps {
  content: string;
  language?: string;
  expanded?: boolean;         // 受控展开状态（undefined 时根据行数自动决定）
  onToggle?: () => void;      // 展开/折叠切换回调
}
```

**职责**: 渲染带语法提示的代码块，超长时自动折叠。

**关键行为**:
- **折叠阈值**: `FOLD_THRESHOLD = 10` 行
- **预览行数**: `PREVIEW_LINES = 5` 行
- 超过 10 行时默认折叠，显示前 5 行 + `[▶ Expand · N lines]` 提示
- 展开状态下显示 `[▼ Collapse · N lines]`
- 代码行以 `backgroundColor="gray" color="white"` 渲染
- 语言标签以 dim 颜色显示在代码块上方

---

### 5. ScrollIndicator.tsx — 新输出提示条

**Props**:

```ts
interface ScrollIndicatorProps {
  visible: boolean;
  columns: number;
  newMessageCount?: number;
}
```

**职责**: 当用户向上滚动且有新消息到达时，在消息区底部显示提示。

**关键行为**:
- `visible` 为 false 时返回 `null`（不渲染）
- 提示文本: `↓ New output (N new) (press G to follow)`，居中显示，cyan 加粗
- `newMessageCount` 大于 0 时显示 `(N new)` 计数
- 固定高度 1 行

---

### 6. DirectoryPicker.tsx — 目录选择器

**Props**:

```ts
interface DirectoryPickerProps {
  onSelect: (dir: string) => void;
  onCancel: () => void;
  mruFile?: string;       // 默认 ~/.duo/recent.json
  scanDirs?: string[];    // 默认 ~/Projects, ~/Developer, ~/code
}
```

**职责**: Setup 阶段的项目目录选择器。

**关键行为**:
- **路径输入** — 用户可直接输入路径，Tab 键触发自动补全
- **Tab 补全** — 单个匹配直接填入（末尾加 `/`），多个匹配显示补全列表
- **MRU 列表** — 从 `~/.duo/recent.json` 加载最近使用的目录，选择后更新
- **Git 仓库发现** — 扫描 `DEFAULT_SCAN_DIRS` 下的一级子目录，发现含 `.git` 的目录
- **非 Git 警告** — 选择非 Git 仓库时显示黄色警告 `Warning: Selected directory is not a git repository (Codex requires git)`
- **导航** — 上下箭头在 MRU + discovered 合并列表中切换，Enter 选择，Esc 取消
- 外框 `borderStyle="single"`，标题 `Select Project Directory`
- 路径中的 `$HOME` 显示为 `~`
- 列表去重：discovered 中已在 MRU 的条目不重复显示

---

### 7. HelpOverlay.tsx — 快捷键帮助

**Props**:

```ts
interface HelpOverlayProps {
  columns: number;
  rows: number;
}
```

**职责**: 显示完整的快捷键列表。

**关键行为**:
- 数据源为 `keybindings.ts` 的 `KEYBINDING_LIST`（13 项）
- 圆角边框 (`borderStyle="round"`)，cyan 边框色
- 快捷键列宽 18 字符，黄色加粗；描述为默认颜色
- 根据终端行数限制可见条目数 (`rows - 6`)
- 底部提示 `Press Esc to close`

---

### 8. ContextOverlay.tsx — 会话上下文信息

**Props**:

```ts
interface ContextOverlayProps {
  columns: number;
  rows: number;
  roundNumber: number;
  coderName: string;
  reviewerName: string;
  taskSummary: string;
  tokenEstimate: number;
}
```

**职责**: 显示当前会话的上下文摘要信息。

**关键行为**:
- 标签列宽 16 字符，显示 5 项信息：Round、Coder（蓝色）、Reviewer（绿色）、Task、Tokens
- 圆角边框，cyan 边框色
- 底部提示 `Press Esc to close`

---

### 9. TimelineOverlay.tsx — 事件时间线

**Props**:

```ts
interface TimelineOverlayProps {
  columns: number;
  rows: number;
  events: TimelineEvent[];  // { timestamp, type, description }
}
```

**`TimelineEvent.type`**: `'task_start'` | `'coding'` | `'reviewing'` | `'converged'` | `'interrupted'` | `'error'`

**职责**: 按时间顺序展示工作流事件历史。

**关键行为**:
- 每个事件类型有对应颜色：task_start=白色，coding=蓝色，reviewing=绿色，converged=青色，interrupted=黄色，error=红色
- 时间列宽 12 字符，显示 `toLocaleTimeString()` 格式
- 只显示最近 `rows - 6` 条事件（从尾部截取）
- 无事件时显示 `No events yet`
- 圆角边框，cyan 边框色

---

### 10. SearchOverlay.tsx — 消息搜索

**Props**:

```ts
interface SearchOverlayProps {
  columns: number;
  rows: number;
  query: string;
  results: Message[];
}
```

**职责**: 搜索消息历史并展示匹配结果。

**关键行为**:
- 搜索栏前缀 `/ `（黄色加粗），空查询时显示占位符 `Type to search...`
- 结果列表：左侧 10 字符宽显示角色名（使用 `ROLE_STYLES` 配色），右侧显示消息预览
- 消息预览根据终端宽度截断（`columns - 20`），超长时末尾添加 `...`
- 最大结果数 `rows - 7`
- 搜索逻辑在 `overlay-state.ts` 的 `computeSearchResults` 中实现（大小写不敏感子串匹配）
- 圆角边框，cyan 边框色

---

### 11. InputArea.tsx — 用户输入区域

**Props**:

```ts
interface InputAreaProps {
  isLLMRunning: boolean;
  onSubmit: (text: string) => void;
  maxLines?: number;                      // 默认 5
  value?: string;                         // 受控模式
  onValueChange?: (value: string) => void;
  onSpecialKey?: (key: string) => void;   // 空输入时按 ? 或 / 的回调
  disabled?: boolean;                     // overlay 打开时禁用
}
```

**职责**: 用户文本输入区域，支持多行输入和中断输入。

**关键行为**:
- 支持**受控**和**非受控**两种模式（通过 `value` prop 是否为 `undefined` 判断）
- **提交**: Enter 提交（非空时），提交后清空输入
- **多行**: Alt+Enter / Ctrl+Enter / Shift+Enter 插入换行，最多 `maxLines` 行
- **特殊键**: 输入为空时按 `?` 或 `/` 触发 `onSpecialKey` 回调（用于打开 overlay）
- **占位符**: LLM 运行中且输入为空时显示 `Type to interrupt, or wait for completion...`
- 输入提示符: `> `（白色加粗），光标用 dim 的 `█` 表示
- `disabled` 为 true 时忽略所有输入事件
- 忽略方向键、PageUp/PageDown、Tab、Escape 等控制键

**纯函数 `processInput(currentValue, input, key, maxLines)`**:
- 提取为独立纯函数以便测试
- 返回 `InputAction`: `submit` | `update` | `special` | `noop`

**辅助函数 `getDisplayLines(value, maxLines)`**: 按 `\n` 分割并截取前 `maxLines` 行用于渲染。

---

### 12. SystemMessage.tsx — 系统消息

**Props**:

```ts
interface SystemMessageProps {
  type: 'routing' | 'interrupt' | 'waiting';
  agentName?: string;
  displayMode?: DisplayMode;
  routingDetails?: RoutingDetails;  // { question: string, choices: string[] }
  outputChars?: number;
}
```

**职责**: 渲染三种系统级消息。

**关键行为**:

| type | Minimal 模式 | Verbose 模式 |
|------|-------------|-------------|
| `routing` | `· [Router] Choice detected → Forwarding to <Agent>` | 额外显示 question 和 choices 列表（缩进 + 编号） |
| `interrupt` | `⚠ INTERRUPTED - <Agent> process terminated (output: N chars)` | 同上 |
| `waiting` | `> Waiting for your instructions...` | 同上 |

- routing 消息全部为黄色
- interrupt 消息为黄色 `⚠` 标记
- waiting 消息为白色 `>` 前缀

---

### 13. ConvergenceCard.tsx — 收敛卡片

**Props**:

```ts
interface ConvergenceCardProps {
  roundCount: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
  onAction: (action: ConvergenceAction) => void;  // 'accept' | 'continue' | 'review'
}
```

**职责**: 当 Coder 和 Reviewer 达成一致时显示收敛信息和操作选项。

**关键行为**:
- 绿色圆角边框，标题 `✓ CONVERGED after N rounds`
- 显示变更统计：`Files modified: N  Lines changed: +N / -N`（insertions 绿色，deletions 红色）
- 三个操作按钮：`[A] Accept`、`[C] Continue`、`[R] Review Changes`
- 键盘 `a`/`c`/`r`（不区分大小写）触发对应 action

---

### 14. DisagreementCard.tsx — 分歧卡片

**Props**:

```ts
interface DisagreementCardProps {
  currentRound: number;
  agreedPoints: number;
  totalPoints: number;
  onAction: (action: DisagreementAction) => void;  // 'continue' | 'decide' | 'accept_coder' | 'accept_reviewer'
}
```

**职责**: 当 Coder 和 Reviewer 存在分歧时显示分歧信息和操作选项。

**关键行为**:
- 黄色圆角边框，标题 `⚡ DISAGREEMENT · Round N`
- 显示一致度统计：`Agreed: M/N    Disputed: K/N`（K = totalPoints - agreedPoints）
- 四个操作按钮分两行：`[C] Continue` `[D] Decide manually` / `[A] Accept Coder's` `[B] Accept Reviewer's`
- 键盘 `c`/`d`/`a`/`b`（不区分大小写）触发对应 action

---

### 15. MessageView.tsx — 消息渲染

**Props**:

```ts
interface MessageViewProps {
  message: Message;
  displayMode?: DisplayMode;  // 默认 'minimal'
}
```

**职责**: 渲染单条消息，包含角色头、时间戳和内容。

**注意**: 在当前架构中，MainLayout 使用 `message-lines.ts` 的 `buildRenderedMessageLines` 进行行级渲染，而非直接使用 MessageView 组件。MessageView 作为独立的可复用消息渲染组件存在。

**关键行为**:
- **角色头**: 使用 `ROLE_STYLES[message.role]` 获取颜色和边框字符，格式 `<border> [<displayName> · <roleLabel>] HH:MM`
- **Verbose 模式额外信息**:
  - 时间戳精确到秒 (`HH:MM:SS`)
  - 显示 token 计数 `[Nk tokens]`
  - 显示 CLI 命令 `$ <command>`（若 `metadata.cliCommand` 存在）
- **内容委托**: 将 `message.content` 和 `message.isStreaming` 传递给 `StreamRenderer` 渲染
- 底部 `marginBottom={1}` 实现消息间距
- `roleLabel` 存在时显示为 `displayName · roleLabel` 格式（如 `Claude · Coder`）

---

### 16. StreamRenderer.tsx — Markdown 流式渲染

**Props**:

```ts
interface StreamRendererProps {
  content: string;
  isStreaming: boolean;
  displayMode?: DisplayMode;  // 默认 'minimal'
}
```

**职责**: 将 Markdown 内容解析为 segment 并渲染为终端 UI，支持流式输出。

**关键行为**:
- 通过 `useMemo` 调用 `parseMarkdown(content)` 并做 `compactSegments` 处理
- **Activity block 压缩** (Minimal 模式): 连续的 `activity_block` 在 minimal 模式下压缩为单个 `activity_summary`，格式 `⏺ N actions · M results · K errors · latest <title>: <summary>`；单个 activity 不显示统计计数
- **代码块状态管理**: 使用 `expandedBlocks` (`Record<number, boolean>`) 追踪每个代码块的展开/折叠状态，通过稳定的 `codeBlockIndex` 跨渲染持久化
- **流式指示器**: `isStreaming` 为 true 时在内容末尾显示旋转 spinner（`⣾⣽⣻⢿⡿⣟⣯⣷`），字符基于 `content.length % 8` 选择（确保测试输出确定性）
- **Segment 渲染映射**:

| Segment 类型 | 渲染方式 |
|-------------|---------|
| `text` | 按 `\n` 分行，每行一个 `<Text>` |
| `code_block` | 委托给 `<CodeBlock>`，传入 `expanded` 和 `onToggle` |
| `activity_block` | 根据 kind 显示图标（`⏺`/`⎿`/`⚠`）+ 标题摘要；verbose 模式下展开内容为 CodeBlock（`language="text"`） |
| `activity_summary` | 单行摘要 `<Text color={color}>{icon} {summary}</Text>` |
| `inline_code` | 灰底白字 `<Text backgroundColor="gray" color="white">` |
| `bold` | `<Text bold>` |
| `italic` | `<Text italic>` |
| `list_item` | `*`/`-` 显示为 `  •`，有序列表保留 `  N.` 标记 |
| `table` | 动态列宽（取表头和数据最大值 + 2），`-+-` 分隔线 |

---

## App.tsx 中的副作用管理

SessionRunner 使用以下 `useEffect` 管理副作用：

| 监听条件 | 触发时机 | 副作用 |
|----------|---------|--------|
| `[]`（mount） | 组件挂载 | 创建/恢复会话，添加初始系统消息，发送 `START_TASK` 或恢复事件 |
| `stateValue, ctx.round` | 状态转换 | best-effort 保存会话状态（包含 adapter session ID） |
| `CODING` | 进入编码状态 | 创建流式消息、启动 coder adapter、聚合输出、完成后发送 `CODE_COMPLETE`；cleanup 中断进程 |
| `ROUTING_POST_CODE` | 编码完成路由 | 调用 `decidePostCodeRoute`，处理 Choice 检测和路由转发 |
| `REVIEWING` | 进入审查状态 | 与 CODING 对称；额外追踪 `reviewerOutputsRef` |
| `ROUTING_POST_REVIEW` | 审查完成路由 | 调用 `decidePostReviewRoute`，处理 Choice 检测 |
| `EVALUATING` | 评估收敛 | 调用 `convergenceRef.evaluate()`，记录轮次，插入 round summary，发送 `CONVERGED` 或 `NOT_CONVERGED` |
| `DONE` | 会话完成 | 添加完成消息，3 秒后调用 `exit()` |
| `ERROR` | 错误状态 | 添加错误消息，自动发送 `RECOVERY` 转到 `WAITING_USER` |
| `WAITING_USER` | 等待用户 | 添加等待提示消息 |

**useEffect 依赖键技巧**: CODING 和 REVIEWING 的 effect 使用 `` stateValue === 'CODING' ? `CODING-${ctx.round}` : stateValue `` 作为依赖，确保同一状态的不同轮次能重新触发 effect。

---

## 快捷键体系完整列表

| 快捷键 | 说明 | 上下文要求 |
|--------|------|-----------|
| `Ctrl+C` | 中断 LLM（单次）/ 退出（500ms 内双击） | 始终可用 |
| `Ctrl+N` | 新建会话 | 始终可用 |
| `Ctrl+I` | 打开/关闭 Context 上下文摘要 overlay | 始终可用 |
| `Ctrl+V` | 切换 Minimal/Verbose 显示模式 | 始终可用 |
| `Ctrl+T` | 打开/关闭 Timeline 事件时间线 overlay | 始终可用 |
| `Ctrl+L` | 清屏（保留历史，记录 clearedCount） | 始终可用 |
| `j` / `↓` | 向下滚动 1 行 | 无 overlay 且输入为空 |
| `k` / `↑` | 向上滚动 1 行 | 无 overlay 且输入为空 |
| `G` | 跳到最新消息（重新启用 auto-follow） | 无 overlay 且输入为空 |
| `PageDown` | 向下滚动一页（pageSize = messageAreaHeight） | 无 overlay |
| `PageUp` | 向上滚动一页 | 无 overlay |
| `Enter` | 展开/折叠代码块 | 无 overlay 且输入为空 |
| `Enter` | 提交输入 | 输入非空 |
| `Alt+Enter` / `Ctrl+Enter` / `Shift+Enter` | 插入换行（多行输入） | 输入区域 |
| `Tab` | 路径自动补全 | 任何时候 |
| `?` | 打开/关闭 Help 快捷键帮助 overlay | 输入为空 |
| `/` | 打开 Search 消息搜索 overlay | 输入为空 |
| `Esc` | 关闭当前 overlay | 有 overlay 时 |
| `a` | Accept（接受） | ConvergenceCard / WAITING_USER |
| `c` | Continue（继续） | ConvergenceCard / DisagreementCard / WAITING_USER |
| `r` | Review Changes（查看变更） | ConvergenceCard |
| `d` | Decide manually（手动决策） | DisagreementCard |
| `b` | Accept Reviewer's（接受 Reviewer 方案） | DisagreementCard |

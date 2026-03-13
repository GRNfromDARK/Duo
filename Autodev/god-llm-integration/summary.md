# God LLM Integration — Pipeline 完成总结

## 实现概要

本次 Pipeline 为 Duo 项目完成了 God LLM 全流程集成，共交付 13 张 Card（A.1–D.2）、通过 4 个 Gate（A–D）。实现内容涵盖：God LLM 在 Setup Wizard 中的选择与 StatusBar 展示、XState 状态机新增 TASK_INIT 状态及 Task 分析卡片、所有路由决策点（Post-Code / Post-Review / Evaluating / Coding / Reviewing）的 God 异步替换与 v1 降级回退、2 秒逃逸窗口（GodDecisionBanner / PhaseTransitionBanner）、运行时任务重分类（Ctrl+R ReclassifyOverlay）、会话保存/恢复中 God 状态的持久化，以及端到端集成测试与审计覆盖验证。

## 变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| src/ui/overlay-state.ts | 修改 | 新增 god overlay 状态管理，扩展 overlay 开关逻辑 |
| src/ui/round-summary.ts | 修改 | 格式化 round 分隔线与摘要消息 |
| src/ui/scroll-state.ts | 修改 | 智能滚动锁定的纯函数实现 |
| src/ui/god-fallback.ts | 新增 | God LLM 调用的降级感知重试包装器，含同步/异步版本与自动故障记录 |
| src/ui/escape-window.ts | 新增 | 2 秒逃逸窗口 UI 状态管理（Space 执行 / Esc 取消 / 超时自动确认） |
| src/ui/session-runner-state.ts | 修改 | 聚合流式输出与工具追踪，处理恢复会话的消息格式化 |
| src/ui/message-lines.ts | 修改 | 消息渲染为终端行，支持角色样式与 CJK 宽字符 |
| src/ui/resume-summary.ts | 新增 | 从审计日志中提取 God 关键决策事件，用于 resume 后展示 |
| src/ui/directory-picker-state.ts | 修改 | 目录选择器纯函数（路径补全、git 仓库发现、MRU） |
| src/ui/display-mode.ts | 修改 | minimal/verbose 显示模式切换 |
| src/ui/keybindings.ts | 修改 | 新增 Ctrl+R（reclassify）和 Ctrl+G（god overlay）键绑定 |
| src/ui/god-overlay.ts | 新增 | God 控制面板状态管理（Ctrl+G），支持手动干预操作（R/S/F/P） |
| src/ui/god-message-style.ts | 新增 | God 消息的双线边框视觉样式（青色/品红色），支持 CJK 宽度 |
| src/ui/god-decision-banner.ts | 新增 | God 自动决策 2 秒逃逸窗口的纯状态逻辑 |
| src/ui/reclassify-overlay.ts | 新增 | 运行时任务重分类 overlay 状态管理（Ctrl+R 触发） |
| src/ui/task-analysis-card.ts | 新增 | 初始任务类型选择卡片状态管理（8 秒倒计时、数字快捷键选择） |
| src/ui/markdown-parser.ts | 修改 | Markdown 解析器，支持流式未闭合代码块 |
| src/ui/phase-transition-banner.ts | 新增 | 复合任务阶段转换 2 秒逃逸窗口的纯状态逻辑 |
| src/ui/git-diff-stats.ts | 修改 | 解析 git diff --stat 输出提取变更统计 |
| src/ui/components/DisagreementCard.tsx | 修改 | Coder/Reviewer 分歧卡片，展示共识点与争议点 |
| src/ui/components/App.tsx | 修改 | **核心变更**：集成 God LLM 到所有 workflow 状态（TASK_INIT、CODING、REVIEWING、ROUTING_POST_CODE、ROUTING_POST_REVIEW、EVALUATING），含异步 IIFE 模式、降级回退、banner 渲染、会话保存/恢复 |
| src/ui/components/HelpOverlay.tsx | 修改 | 帮助 overlay，展示键绑定列表 |
| src/ui/components/ContextOverlay.tsx | 修改 | 会话上下文信息 overlay |
| src/ui/components/MessageView.tsx | 修改 | 单条消息渲染，含角色样式与流式内容 |
| src/ui/components/SearchOverlay.tsx | 修改 | 消息搜索 overlay |
| src/ui/components/TaskAnalysisCard.tsx | 新增 | God 初始任务分析卡片组件（任务类型选择、倒计时、置信度/轮次/标准） |
| src/ui/components/SetupWizard.tsx | 修改 | 新增 God 选择阶段（select-god phase），修复 god 字段赋值 bug |
| src/ui/components/DirectoryPicker.tsx | 修改 | 交互式目录选择器，Tab 补全与 MRU 历史 |
| src/ui/components/MainLayout.tsx | 修改 | 新增 onReclassify 回调支持 Ctrl+R 路由 |
| src/ui/components/GodDecisionBanner.tsx | 新增 | God 自动决策 2 秒逃逸窗口组件（Space 执行 / Esc 取消） |
| src/ui/components/StreamRenderer.tsx | 修改 | 流式 Markdown 渲染，含语法高亮与代码块折叠 |
| src/ui/components/ScrollIndicator.tsx | 修改 | 新消息到达时的滚动指示器 |
| src/ui/components/PhaseTransitionBanner.tsx | 新增 | 阶段转换 2 秒逃逸窗口组件（品红色边框，阶段专属文案） |
| src/ui/components/StatusBar.tsx | 修改 | 新增 God adapter 名称显示、任务类型/阶段/降级等级展示 |
| src/ui/components/ConvergenceCard.tsx | 修改 | Coder/Reviewer 收敛卡片 |
| src/ui/components/InputArea.tsx | 修改 | 多行输入组件，支持特殊键检测 |
| src/ui/components/ReclassifyOverlay.tsx | 新增 | 运行时任务类型重分类全屏 overlay 组件 |
| src/ui/components/SystemMessage.tsx | 修改 | 系统消息渲染（路由决策、中断、等待状态） |
| src/ui/components/CodeBlock.tsx | 修改 | 可折叠代码块，语法高亮与行计数 |
| src/ui/components/TimelineOverlay.tsx | 修改 | Workflow 事件时间线 overlay |
| src/parsers/text-stream-parser.ts | 修改 | 纯文本流解析器（Aider/Amazon Q） |
| src/parsers/stream-json-parser.ts | 修改 | NDJSON 流式 JSON 解析器（Claude Code/Gemini） |
| src/parsers/jsonl-parser.ts | 修改 | JSONL 格式解析器（Codex/Cline/Copilot） |
| src/parsers/index.ts | 修改 | 新增 god-json-extractor 导出 |
| src/parsers/god-json-extractor.ts | 新增 | 从 CLI 文本输出提取 JSON 代码块并用 Zod schema 校验 |
| src/cli-commands.ts | 修改 | CLI 命令处理（start/resume/log），支持 God 会话配置 |
| src/types/god-schemas.ts | 新增 | God LLM 决策输出的 Zod schema 定义（task analysis、routing、convergence、auto-decision） |
| src/types/session.ts | 修改 | 新增 God 相关字段（godAdapter、godTaskAnalysis、godConvergenceLog、degradationState） |
| src/types/adapter.ts | 修改 | CLIAdapter 接口与插件架构类型 |
| src/types/ui.ts | 修改 | UI 类型定义，新增 God 相关角色与消息类型 |

## 关键决策

1. **SetupWizard God 字段 bug 修复**（A.1）：原代码 onConfirm 始终将 god 设为 reviewer，忽略用户在 GodSelector 的选择。修复为使用 config.god。

2. **TASK_INIT 状态机设计**（A.2）：在 XState 中新增 TASK_INIT 状态（IDLE → TASK_INIT → CODING），遵循 AR-003（XState 保留，God 作为异步 effect handler）。使用 DegradationManager 处理 TASK_INIT 失败降级。

3. **TaskAnalysisCard 渲染策略**（A.3）：采用全屏替换 MainLayout 而非 overlay，避免 useInput 键盘冲突。TASK_INIT_COMPLETE 延迟到用户确认后发送，语义上保持"初始化未完成"。

4. **统一异步 IIFE 模式**（B.1–B.3）：所有路由决策点（ROUTING_POST_CODE、ROUTING_POST_REVIEW、EVALUATING）采用一致的异步 IIFE 模式，含取消支持。God 失败时在同一 useEffect 内回退到 v1，对状态机透明。

5. **God 替换 ContextManager prompt**（B.4）：God 可用时完全替换 ContextManager.buildCoderPrompt/buildReviewerPrompt，而非仅补充。choiceRoute 仍优先用于 interrupt/choice 路径。

6. **GodDecisionBanner 100ms 倒计时精度**（C.1）：2 秒逃逸窗口使用 100ms tick（而非 1s），提供平滑视觉反馈。request_human 决策跳过 banner 直接进入手动模式。

7. **withGodFallback 统一包装器**（C.2）：所有 God 调用点统一使用 withGodFallback/withGodFallbackSync 包装，替代各 useEffect 中的临时降级处理。degradationState 在两个保存点（状态转换 + Ctrl+C 退出）均持久化。

8. **PhaseTransitionBanner 独立组件**（C.3）：未复用 GodDecisionBanner，因 props 和视觉处理不同（品红色边框、阶段专属文案）。Ctrl+R 重分类时先中断 LLM 再显示 overlay。

9. **会话恢复完整性**（C.4）：godAdapter、godTaskAnalysis、godConvergenceLog 从快照恢复，不重新运行 TASK_INIT。ConvergenceLog 条目是 God 专属元数据，无法从 history.jsonl 推导。

10. **集成测试架构**（D.1）：在 XState + God 模块级别测试（非 React 渲染），验证状态机与 God 模块的交互。React 级别连接在已有 ui/ 测试中覆盖。

## 测试结果

- 集成测试（D.1）：覆盖 God workflow 全流程（task-init → routing → convergence → auto-decision → phase-transition → degradation）
- StatusBar 单元测试（D.2）：验证 God adapter 展示、任务类型/阶段/降级等级渲染
- 审计覆盖验证（D.2）：确认所有 God 模块内部成功路径已调用 appendAuditLog，App.tsx 仅需处理失败/降级审计条目
- 所有 4 个 Gate（A–D）通过

## 注意事项

1. **残余风险 — 公共 API 表面扩大**：SetupWizard 导出了 GodSelector 和 ConfirmScreen 子组件用于单元测试，略微增加了公共 API 表面。
2. **残余风险 — Banner 期间消息不可见**：TaskAnalysisCard、GodDecisionBanner、PhaseTransitionBanner、ReclassifyOverlay 显示期间，新增的消息不可见，需等待 banner 关闭后才会显示。
3. **残余风险 — Ctrl+R 中断丢失**：在 CODING/REVIEWING 状态下按 Ctrl+R 会先中断 LLM 再显示 overlay，进行中的 LLM 工作会丢失。
4. **残余风险 — PhaseTransitionBanner 代码重复**：倒计时/进度条逻辑与 GodDecisionBanner 存在轻微重复，未来可考虑抽取共享 hook。
5. **类型断言**：withGodFallback 返回值在 God 与 v1 类型不同时需要类型断言进行窄化。
6. **无 git 变更统计**：本次报告未提供 git diff 数据，建议后续补充 insertions/deletions 统计。

## Bug Hunt 结果
- 扫描轮次: 1
- 发现并修复的 bug 数量: 0
- 剩余未修复: 4
- 新增回归测试: 0 个

### 修复的 Bug 列表
| Bug ID | 优先级 | 描述 | 状态 |
|--------|--------|------|------|
| BUG-1 | P1 | PhaseTransitionBanner 取消后 pendingPhaseId 未从 XState context 清除，导致后续 continue 误触阶段转换 | 未修复 |
| BUG-2 | P1 | WAITING_USER 自动决策与 PhaseTransitionBanner 存在竞争条件，phase transition 等待期间不应启动 auto-decision | 未修复 |
| BUG-3 | P2 | WAITING_USER 消息去重使用 stale closure 中的 messages，可能导致重复系统消息 | 未修复 |
| BUG-4 | P2 | Ctrl+R 中断后取消 ReclassifyOverlay，状态停留在 INTERRUPTED 无恢复机制 | 未修复 |



## Bug Hunt 结果
- 扫描轮次: 8
- 发现并修复的 bug 数量: 21
- 剩余未修复: 0
- 新增回归测试: 待确认

### 修复的 Bug 列表
| Bug ID | 优先级 | 描述 | 状态 |
|--------|--------|------|------|
| BUG-1 | P1 | PhaseTransitionBanner 取消后 pendingPhaseId 未从 XState context 清除 | ✅ 已修复 |
| BUG-2 | P1 | WAITING_USER 自动决策与 PhaseTransitionBanner 的竞争条件 | ✅ 已修复 |
| BUG-3 | P2 | WAITING_USER 消息去重使用 stale closure 中的 messages | ✅ 已修复 |
| BUG-4 | P2 | Ctrl+R 中断后 ReclassifyOverlay 取消，用户停留在 INTERRUPTED 无提示 | ✅ 已修复 |
| BUG-5 | P1 | BUG-3 fix 中 setMessages 创建的 Message 缺少必需的 `id` 字段 | ✅ 已修复 |
| BUG-6 | P1 | compound 任务的 `currentPhaseId` 未持久化，`duo resume` 后丢失 | ✅ 已修复 |
| BUG-7 | P2 | Ctrl+R 重分类后过期的 God 自动决策 Banner 仍会显示 | ✅ 已修复 |
| BUG-8 | P1 | TaskAnalysisCard 用户选择的 taskType 未更新到 taskAnalysis state | ✅ 已修复 |
| BUG-9 | P1 | God auto-decision `continue_with_instruction` 的 instruction 在 God prompt 路径下丢失 | ✅ 已修复 |
| BUG-10 | P2 | EVALUATING God 路径未更新 godLatency 导致 StatusBar 显示过期延迟 | ✅ 已修复 |
| BUG-11 | P1 | CODING useEffect 中 God prompt 路径读取已清空的 `pendingInstructionRef` | ✅ 已修复 |
| BUG-12 | P1 | EVALUATING useEffect 从未向 `convergenceLogRef` 追加条目 | ✅ 已修复 |
| BUG-13 | P2 | ReclassifyOverlay 对 `discuss`/`compound` 类型无高亮选中项 | ✅ 已修复 |
| BUG-14 | P1 | compound 任务的 `phaseId`/`phaseType` 未传递给 God prompt 生成 | ✅ 已修复 |
| BUG-15 | P1 | WAITING_USER auto-decision 的 `auditSeqRef` 使用 post-increment 导致 seq 冲突 | ✅ 已修复 |
| BUG-16 | P2 | `handlePhaseTransitionConfirm` 中 `taskPrompt` 更新语义不一致 | ✅ 已修复 |
| BUG-17 | P1 | REVIEWING useEffect 中 God prompt 路径丢弃用户中断指令 | ✅ 已修复 |
| BUG-18 | P2 | XState `taskPrompt` 在多次阶段转换后累积 `[Phase: ...]` 前缀 | ✅ 已修复 |
| BUG-19 | P2 | `handleInterrupt` 和 state-save 中 `taskAnalysis` 的 stale closure | ✅ 已修复 |
| BUG-20 | P2 | XState `confirmContinueWithPhase` guard 未排除 `undefined` | ✅ 已修复 |
| BUG-21 | P2 | WAITING_USER 重分类后 God auto-decision 不会重新触发 | ✅ 已修复 |

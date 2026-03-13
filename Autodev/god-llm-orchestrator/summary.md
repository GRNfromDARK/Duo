# God LLM Orchestrator — Pipeline 完成总结

## 实现概要

本次 Pipeline 完成了 God LLM Orchestrator 的全部核心实现，涵盖 6 个 Gate（A-F）共 21 张 Card。系统引入了一个 "God" 层级的 LLM 编排器，用于协调 Coder 和 Reviewer 两个 AI Agent 的三方会话（Tri-Party Session），实现任务意图解析、智能路由、收敛判断、循环检测、降级容错和审计追踪等完整编排能力。同时构建了 12 个主流 AI CLI 工具的适配器层、基于 XState 的工作流状态机、以及丰富的 TUI 交互界面。

## 变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| src/types/god-schemas.ts | 新增 | 定义 God LLM 输出的 Zod 校验 schema（任务分析、路由决策、收敛判断、自动决策） |
| src/types/adapter.ts | 新增 | 定义 CLIAdapter 插件接口、OutputChunk 流式输出结构、CLI 注册表类型 |
| src/types/session.ts | 新增 | 定义 SessionConfig、StartArgs、ValidationResult 等会话配置类型 |
| src/types/ui.ts | 新增 | 定义 TUI 层消息角色样式、Message 结构、ScrollState 等 UI 类型 |
| src/index.ts | 新增 | 包入口，导出 VERSION 常量 |
| src/parsers/index.ts | 新增 | 统一解析器模块聚合导出 |
| src/parsers/god-json-extractor.ts | 新增 | 从 God 输出中提取 JSON 并通过 Zod schema 校验，支持重试 |
| src/parsers/jsonl-parser.ts | 新增 | JSONL 格式解析器，适配 Codex/Cline/Copilot/Cursor/Continue 输出 |
| src/parsers/stream-json-parser.ts | 新增 | Stream-JSON (NDJSON) 解析器，适配 Claude Code/Gemini/Amp/Qwen 输出 |
| src/parsers/text-stream-parser.ts | 新增 | 纯文本流解析器，支持代码块和错误模式检测，适配 Aider/Goose |
| src/adapters/aider/adapter.ts | 新增 | Aider CLI 适配器实现 |
| src/adapters/amazon-q/adapter.ts | 新增 | Amazon Q CLI 适配器实现 |
| src/adapters/amp/adapter.ts | 新增 | Amp CLI 适配器实现 |
| src/adapters/claude-code/adapter.ts | 新增 | Claude Code CLI 适配器实现，含会话 ID 捕获与恢复 |
| src/adapters/cline/adapter.ts | 新增 | Cline CLI 适配器实现 |
| src/adapters/codex/adapter.ts | 新增 | Codex CLI 适配器实现，含 thread_id 会话恢复 |
| src/adapters/continue/adapter.ts | 新增 | Continue CLI 适配器实现 |
| src/adapters/copilot/adapter.ts | 新增 | GitHub Copilot CLI 适配器实现 |
| src/adapters/cursor/adapter.ts | 新增 | Cursor CLI 适配器实现 |
| src/adapters/gemini/adapter.ts | 新增 | Gemini CLI 适配器实现 |
| src/adapters/goose/adapter.ts | 新增 | Goose CLI 适配器实现（YOLO 模式通过环境变量配置） |
| src/adapters/qwen/adapter.ts | 新增 | Qwen CLI 适配器实现 |
| src/adapters/detect.ts | 新增 | 并行 CLI 工具检测，3 秒超时，支持自定义适配器配置 |
| src/adapters/env-builder.ts | 新增 | 构建适配器子进程的最小化显式环境变量 |
| src/adapters/factory.ts | 新增 | 适配器工厂，按名称创建 12 种 CLIAdapter 实例 |
| src/adapters/output-stream-manager.ts | 新增 | 统一输出流管理，支持多消费者广播、缓冲、中断 |
| src/adapters/process-manager.ts | 新增 | CLI 子进程生命周期管理（优雅终止、超时、心跳监控） |
| src/adapters/registry.ts | 新增 | 12 款 AI CLI 工具注册表元数据定义 |
| src/god/god-prompt-generator.ts | 新增 | 按任务类型动态生成 Coder/Reviewer/God 决策 prompt，优先级排序 |
| src/god/god-router.ts | 新增 | God 路由决策（PostCoder/PostReviewer），含 JSON 提取与 fallback |
| src/god/god-convergence.ts | 新增 | 任务收敛评估，基于 blockingIssueCount 和 criteriaProgress |
| src/god/god-context-manager.ts | 新增 | God 会话上下文窗口管理，增量更新与 90% 阈值重建 |
| src/god/god-session-persistence.ts | 新增 | God 会话持久化与恢复 |
| src/god/god-audit.ts | 新增 | God 决策 JSONL 审计日志，50MB 自动清理 |
| src/god/god-system-prompt.ts | 新增 | 构建 God 编排器系统提示词 |
| src/god/rule-engine.ts | 新增 | 同步规则引擎（<5ms），阻止非授权文件写入和可疑网络模式 |
| src/god/task-init.ts | 新增 | God TASK_INIT 意图解析与任务分类，含轮次范围校验 |
| src/god/tri-party-session.ts | 新增 | 三方会话协调，独立恢复每方会话，容错处理 |
| src/god/loop-detector.ts | 新增 | 死循环检测（3 轮停滞 + 语义重复），提供干预建议 |
| src/god/phase-transition.ts | 新增 | 复合任务阶段转换管理，保留跨阶段上下文 |
| src/god/auto-decision.ts | 新增 | WAITING_USER 状态自动决策，规则引擎前置检查 |
| src/god/consistency-checker.ts | 新增 | God 输出逻辑一致性校验（纯规则 <1ms），自动纠正可计数字段 |
| src/god/drift-detector.ts | 新增 | God 渐进漂移检测（过度宽容/信心下降），触发降级回退 |
| src/god/degradation-manager.ts | 新增 | 四级降级管理（正常→重试→纠正重试→禁用），3 次连续失败后禁用 God |
| src/god/alert-manager.ts | 新增 | 异常告警（延迟/停滞/错误），Critical 级别阻塞工作流 |
| src/engine/workflow-machine.ts | 新增 | XState v5 状态机，11 状态 22+ 事件，支持序列化恢复 |
| src/engine/interrupt-handler.ts | 新增 | Ctrl+C 单击中断 / 双击退出处理，保留部分输出 |
| src/decision/choice-detector.ts | 新增 | LLM 输出中选择/问题模式检测，构建自动选择 prompt |
| src/decision/convergence-service.ts | 新增 | Reviewer 输出收敛分析（审批/循环/趋势），本地判定服务 |
| src/session/context-manager.ts | 新增 | Coder/Reviewer 系统提示词构建，含 token 预算控制 |
| src/session/session-manager.ts | 新增 | 会话持久化（snapshot.json + history.jsonl），原子写入 |
| src/session/session-starter.ts | 新增 | 会话创建与校验（参数解析、目录/CLI 验证） |
| src/cli.ts | 新增 | CLI 主入口（duo start/resume/log），基于 Ink 渲染 TUI |
| src/cli-commands.ts | 新增 | CLI 命令处理函数（start/resume/log 逻辑实现） |
| src/ui/directory-picker-state.ts | 新增 | 目录选择器状态，路径补全与 git 仓库发现 |
| src/ui/display-mode.ts | 新增 | 显示模式切换（minimal/verbose），消息过滤 |
| src/ui/escape-window.ts | 新增 | 2 秒逃逸窗口 UI（God 自动决策时用户可取消） |
| src/ui/git-diff-stats.ts | 新增 | Git diff --stat 输出解析为结构化统计 |
| src/ui/god-message-style.ts | 新增 | God 消息固定 50 字符宽度边框样式 |
| src/ui/god-overlay.ts | 新增 | God 控制面板（Ctrl+G），支持重分类/跳过/强制/暂停操作 |
| src/ui/keybindings.ts | 新增 | 键盘绑定映射（Ctrl/Esc/方向键/Vim 键），含 Ctrl+G for God |
| src/ui/markdown-parser.ts | 新增 | Markdown 文本解析为类型化段落（代码块/粗体/列表/表格等） |
| src/ui/message-lines.ts | 新增 | 消息转 TUI 渲染行，含角色边框、时间戳、自动换行 |
| src/ui/overlay-state.ts | 新增 | Overlay 开关/搜索状态管理，扩展支持 god 类型 |
| src/ui/reclassify-overlay.ts | 新增 | 运行时任务重分类（4 种类型：code/explore/review/debug） |
| src/ui/resume-summary.ts | 新增 | duo resume 命令的会话摘要构建 |
| src/ui/round-summary.ts | 新增 | 轮次分隔线格式化 |
| src/ui/scroll-state.ts | 新增 | 智能滚动锁定状态管理 |
| src/ui/session-runner-state.ts | 新增 | 会话运行时状态聚合与路由决策 |
| src/ui/task-analysis-card.ts | 新增 | 任务意图确认卡片（8 秒自动确认倒计时） |
| src/__tests__/\*\* (62 个测试文件) | 新增 | 覆盖所有模块的单元测试 |

## 关键决策

- **【Card A.1】Schema 字段对齐** — 选择了 Card A.1 spec 精炼版字段而非设计文档的复杂接口，后续 Card 可按需扩展 schema
- **【Card A.2】god 字段可选性** — SessionMetadata 中 god 字段设为 optional，确保已有会话的向后兼容性
- **【Card A.4】路径解析策略** — 相对路径解析到 cwd 再与 ~/Documents 比较，符合 spec AC-028 要求
- **【Card A.4】可疑模式范围** — 仅阻止 `curl -d @file` 数据外泄模式，避免误杀合法 API 调用
- **【Card B.1】Prompt 策略** — 采用基于 Section 的构建器而非模板占位符，更简洁且天然支持优先级排序
- **【Card B.2】PostCoder 提取失败回退** — 安全默认值（continue_to_review）维持工作流连续性
- **【Card B.2】空 unresolvedIssues 处理** — 注入通用 issue 继续推进，避免重新查询 God 的延迟
- **【Card B.2】POST_REVIEW→CODING 轮次递增** — 绕过 EVALUATING 时仍需递增轮次，防止无限循环
- **【Card B.3】收敛日志定义** — 在 god-convergence.ts 中定义更丰富的 ConvergenceLogEntry，保留旧版兼容
- **【Card B.3】一致性违规处理** — 检测到不一致时覆写 shouldTerminate 为 false（保守路径），而非重新查询 God
- **【Card B.4】阶段转换事件** — 新增专用 PHASE_TRANSITION 事件（携带 nextPhaseId+summary），保留 RECLASSIFY 兼容
- **【Card B.4】循环检测信号组合** — 要求多重信号佐证（停滞趋势 + 非递减 blockingIssueCount），降低误报
- **【Card C.1】L2/L3 重试计数** — 单一 consecutiveFailures 计数器，奇数重试/偶数回退，3 次后升级 L4
- **【Card C.2】一致性检查输入类型** — 联合类型 + 运行时类型守卫，同时支持 ConvergenceJudgment 和 PostReviewerDecision
- **【Card C.3】god_too_permissive 严重度** — 3 次连续分歧归类为 severe，触发 2 轮回退
- **【Card C.3】confidence_declining 阈值** — 最终分数 <0.5 为 severe，≥0.5 为 mild，比例响应
- **【Card D.1】God 状态存放位置** — 扩展 SessionState 添加可选 God 字段，复用现有原子写入基础设施
- **【Card D.2】增量 Prompt 截断策略** — 按 section 分别限制（各 15k 字符），再总体 40k 上限
- **【Card D.2】会话重建阈值** — 90% 上下文窗口时触发重建，预防质量退化
- **【Card D.3】三方会话恢复接口** — 解耦接口仅需 session ID 和 adapter 名称，不依赖 SessionState 内部结构
- **【Card E.1】latencyMs 可选** — 向后兼容已有调用方
- **【Card E.2】GOD_ERROR 告警级别** — Critical 级别阻塞工作流，符合设计文档 FR-021 要求
- **【Card F.1】任务类型排序** — 按使用频率排序（explore/code/discuss/review/debug/compound），而非字母序
- **【Card F.2】重分类可用类型** — 仅 4 种（code/explore/review/debug），排除 compound 和 discuss
- **【Card F.3】God 输出解析失败回退** — 默认 request_human，最安全的延迟策略
- **【Card F.4】God 消息框宽度** — 固定 50 字符宽度，确保跨终端一致性
- **【Card F.5】God overlay 类型扩展** — 扩展现有 OverlayType 联合类型添加 god，复用单 overlay 管理模式

## 测试结果

所有 21 张 Card（A.1-F.5）均已实现并配套单元测试，共计 62 个测试文件覆盖：
- **Gate A (类型与基础)**: 4 Cards — god-schemas、adapter types、session types、rule-engine
- **Gate B (核心编排)**: 4 Cards — prompt-generator、god-router + workflow-machine、god-convergence、loop-detector + phase-transition
- **Gate C (容错与监控)**: 3 Cards — degradation-manager、consistency-checker、drift-detector
- **Gate D (持久化与上下文)**: 3 Cards — god-session-persistence + session-manager、god-context-manager、tri-party-session
- **Gate E (审计与告警)**: 2 Cards — god-audit-logger、alert-manager
- **Gate F (UI 交互)**: 5 Cards — task-analysis-card、reclassify-overlay、auto-decision + escape-window、god-message-style、god-overlay + keybindings

所有 Gate 均已通过。

## 注意事项

1. **残余风险 — Schema 演进**: 设计文档中较丰富的类型（如 reviewerVerdict 对象类型）在当前 schema 中被简化，后续 Card 可能需要扩展
2. **残余风险 — 符号链接绕过**: rule-engine 的路径检查不处理 symlink，v1 可接受
3. **残余风险 — 双重类型定义**: ConvergenceLogEntry 和 OverlayType 各存在两处定义，调用方需使用正确版本
4. **残余风险 — 循环检测保守性**: 要求多信号佐证可能遗漏 issue 内容变化但数量不变的边缘循环
5. **残余风险 — 旧会话兼容**: 缺少 god 字段的旧会话恢复时默认使用 reviewer 角色
6. **非 Git 仓库**: 当前项目目录非 git 仓库，无法提供 git 变更统计
7. **建议后续**: 考虑集成测试覆盖三方会话端到端流程、增加 symlink 安全检查、统一 ConvergenceLogEntry 类型定义

## Bug Hunt 结果
- 扫描轮次: 15
- 发现并修复的 bug 数量: 70
- 剩余未修复: 3（均为 P2，最后两轮发现，未经后续轮次验证）
- 新增回归测试: 依各轮修复同步添加（未单独统计）

### 修复的 Bug 列表
| Bug ID | 优先级 | 描述 | 状态 |
|--------|--------|------|------|
| R1-BUG-1 | P0 | `ConvergenceLogEntry` 类型双重定义，`god-prompt-generator.ts` 与 `god-convergence.ts` 不兼容 | ✅ 已修复 |
| R1-BUG-2 | P1 | `godActionToEvent` PHASE_TRANSITION 分支返回空数据 | ✅ 已修复 |
| R1-BUG-3 | P1 | `auto-decision` rule engine 合成命令永远不匹配，安全检查形同虚设 | ✅ 已修复 |
| R1-BUG-4 | P1 | `DriftDetector` seq 与 `GodAuditLogger` seq 冲突，审计日志乱序 | ✅ 已修复 |
| R1-BUG-5 | P1 | `WAITING_USER→CODING` 不递增 round，与 `ROUTING_POST_REVIEW→ROUTE_TO_CODER` 行为不一致 | ✅ 已修复 |
| R1-BUG-6 | P1 | `rule-engine` 路径边界使用 `path.resolve()` 而非 `realpathSync()`，符号链接可逃逸 | ✅ 已修复 |
| R1-BUG-7 | P1 | `validateCLIChoices` 不校验 god adapter，无效名称不报错 | ✅ 已修复 |
| R1-BUG-8 | P1 | Soft approval 逻辑未排除 `[CHANGES_REQUESTED]` 标记 | ✅ 已修复 |
| R1-BUG-9 | P2 | L4 `godDisabled` 状态仅存内存，`duo resume` 后丢失 | ✅ 已修复 |
| R1-BUG-10 | P2 | audit 文件名字典序排序，seq>999 时清理逻辑删错文件 | ✅ 已修复 |
| R1-BUG-11 | P2 | Zod schema 缺少 `.refine()` 约束 | ✅ 已修复 |
| R1-BUG-12 | P2 | `GodAutoDecisionSchema` reasoning 字段无长度限制 | ✅ 已修复 |
| R2-BUG-1 | P1 | God 系统提示词包含错误的 action 名称 | ✅ 已修复 |
| R2-BUG-2 | P1 | God 会话 ID 在 `duo resume` 时从未恢复 | ✅ 已修复 |
| R2-BUG-3 | P1 | Zod `.parse()` 剥离 `nextPhaseId`，PHASE_TRANSITION 无法携带目标阶段 | ✅ 已修复 |
| R2-BUG-4 | P2 | `DriftDetector` 无 `seqProvider` 时 seq 冲突无强制保障 | ✅ 已修复 |
| R2-BUG-5 | P2 | God overlay 始终显示第一个阶段而非当前阶段 | ✅ 已修复 |
| R3-BUG-1 | P1 | `DriftDetector` consecutivePermissive 检测后不重置，无限降级循环 | ✅ 已修复 |
| R3-BUG-2 | P1 | `evaluatePhaseTransition` 忽略 God 指定的 `nextPhaseId`，始终顺序过渡 | ✅ 已修复 |
| R3-BUG-3 | P1 | God 调用全部使用 `process.cwd()` 而非配置的 `projectDir` | ✅ 已修复 |
| R3-BUG-4 | P2 | `DegradationManager` activateFallback 三元表达式两分支消息相同 | ✅ 已修复 |
| R3-BUG-5 | P2 | `god-convergence.ts` 对同一 judgment 执行双重一致性检查 | ✅ 已修复 |
| R4-BUG-1 | P1 | `hasNoImprovement` 全 0 时仍返回 true，成功任务被强制终止 | ✅ 已修复 |
| R4-BUG-2 | P1 | `enforceTokenBudget` token 数当字符数，prompt 被过度截断 4 倍 | ✅ 已修复 |
| R4-BUG-3 | P1 | `auto-decision` 将 accept/request_human 以 config_modify 类型送入 rule engine 被误杀 | ✅ 已修复 |
| R4-BUG-4 | P1 | `InterruptHandler.dispose()` 设标志但不检查，dispose 后仍发事件 | ✅ 已修复 |
| R4-BUG-5 | P1 | markdown-parser 无法识别空 fenced code block，后续内容被吞入 | ✅ 已修复 |
| R5-BUG-1 | P0 | `ROLE_STYLES` 仅 5 种适配器，其余 9 种 TUI 崩溃 TypeError | ✅ 已修复 |
| R5-BUG-2 | P1 | ProcessManager 非零退出码触发 process-error 导致 ReadableStream 抛错 | ✅ 已修复 |
| R5-BUG-3 | P1 | `kill()` 等待子进程退出前移除 parentExitHandler，留下孤儿进程窗口 | ✅ 已修复 |
| R5-BUG-4 | P1 | `GodAuditLogger.append` spread 顺序允许运行时 seq 被覆盖 | ✅ 已修复 |
| R5-BUG-5 | P1 | `appendOutput` 字节数偏移 slice 字符串，多字节字符下缓冲区永不收敛 | ✅ 已修复 |
| R5-BUG-6 | P1 | `task-init.ts` 的 `collectAdapterOutput` 仍硬编码 `process.cwd()` | ✅ 已修复 |
| R5-BUG-7 | P2 | God overlay `handleGodOverlayKey` 缺少 Escape 键处理 | ✅ 已修复 |
| R5-BUG-8 | P2 | `parseStartArgs` 未检查 flag 后是否有值，末尾 flag 导致 undefined | ✅ 已修复 |
| R6-BUG-1 | P1 | ClaudeCode/Codex 适配器 CLI 复用 session_id 时错误清除，断裂会话连续性 | ✅ 已修复 |
| R6-BUG-2 | P1 | R-002 command_exec 子字符串匹配检测系统目录，合法命令误报 | ✅ 已修复 |
| R6-BUG-3 | P2 | `DegradationManager.enterL4` 审计条目 seq/round 硬编码为 0 | ✅ 已修复 |
| R6-BUG-4 | P2 | `session-manager.ts` updatedAt 公式始终产生 +1ms 漂移 | ✅ 已修复 |
| R7-BUG-1 | P1 | 12 个适配器 `controller.enqueue()` 缺 try-catch，stream 出错后崩溃 | ✅ 已修复 |
| R7-BUG-2 | P1 | god-convergence/god-router 单次评估中多次使用同一 seq，审计日志 seq 重复 | ✅ 已修复 |
| R7-BUG-3 | P2 | 所有适配器缺少 stderr error 事件处理器 | ✅ 已修复 |
| R7-BUG-4 | P2 | R-002 command_exec token 检查被引号包裹路径绕过 | ✅ 已修复 |
| R7-BUG-5 | P2 | `godActionToEvent` default 静默返回 ROUTE_TO_REVIEW 掩盖 bug | ✅ 已修复 |
| R8-BUG-1 | P1 | `InterruptHandler.saveAndExit` 部分 state 覆盖完整 SessionState，丢失 God 数据 | ✅ 已修复 |
| R8-BUG-2 | P1 | `BLOCKING_ISSUE_PATTERNS` 将 `[CHANGES_REQUESTED]` 计入 blocking issue 数 | ✅ 已修复 |
| R8-BUG-3 | P1 | `auto-decision` 使用 `extractGodJson` 而非 `extractWithRetry` | ✅ 已修复 |
| R8-BUG-4 | P1 | FENCE_OPEN/FENCE_CLOSE 正则 `$` 锚点不允许尾随空格 | ✅ 已修复 |
| R8-BUG-5 | P2 | `god-message-style.ts` padLine 使用 string.length 而非视觉宽度，CJK 溢出 | ✅ 已修复 |
| R8-BUG-6 | P2 | `checkGodError` 返回类型声称 `Alert | null` 但从不返回 null | ✅ 已修复 |
| R8-BUG-7 | P2 | `classifyTrend` 对振荡模式 `[5,3,5]` 返回 "unchanged" 而非 "stagnant" | ✅ 已修复 |
| R9-BUG-1 | P1 | `ROUTING_POST_CODE→ROUTE_TO_CODER` 不递增 round，无限重试循环 | ✅ 已修复 |
| R9-BUG-2 | P2 | `phase-transition.ts` 阻止从最后阶段向前的反向转换 | ✅ 已修复 |
| R9-BUG-3 | P2 | `collectAdapterOutput` 静默丢弃 error 类型 chunk | ✅ 已修复 |
| R10-BUG-1 | P1 | `AlertManager.checkProgress` 对 blockingIssueCount 全 0 的已收敛任务误报 STAGNANT | ✅ 已修复 |
| R10-BUG-2 | P1 | POST_REVIEWER prompt 未提及 `nextPhaseId`，God 永远不输出该字段 | ✅ 已修复 |
| R10-BUG-3 | P1 | `ROUTING_POST_CODE→ROUTE_TO_CODER` 缺 `canContinueRounds` guard，可超越 maxRounds | ✅ 已修复 |
| R10-BUG-4 | P2 | convergence-service `SIMILARITY_THRESHOLD` 0.35 过于宽松导致误报 | ✅ 已修复 |
| R11-BUG-1 | P1 | `ROUTING_POST_REVIEW→ROUTE_TO_CODER` 缺 `canContinueRounds` guard（R10 修复遗漏） | ✅ 已修复 |
| R11-BUG-2 | P2 | `ProcessManager.dispose()` 在 `kill()` 完成前移除 parentExitHandler | ✅ 已修复 |
| R11-BUG-3 | P2 | `needs_discussion` + `shouldTerminate: true` 语义矛盾未检测 | ✅ 已修复 |
| R12-BUG-1 | P1 | `task-init.ts` collectAdapterOutput 仍丢弃 error chunk（R9 修复遗漏） | ✅ 已修复 |
| R12-BUG-2 | P1 | `detectLoop` Check 2 扫描全部历史输出，长会话大量误报 | ✅ 已修复 |
| R12-BUG-3 | P2 | DegradationState (L4) 未持久化到 SessionState | ✅ 已修复 |
| R12-BUG-4 | P2 | PHASE_TRANSITION 事件的 nextPhaseId/summary 未存入 WorkflowContext | ✅ 已修复 |
| R13-BUG-1 | P1 | ProcessManager `timeout` 事件无人监听，TIMEOUT 转换是死代码 | ✅ 已修复 |
| R13-BUG-2 | P2 | `evaluatePhaseTransition` 允许自转换（nextPhaseId === currentPhase.id） | ✅ 已修复 |
| R13-BUG-3 | P2 | `classifyTrend` 仅比较首尾值，振荡模式误判为 stagnant | ✅ 已修复 |
| R14-BUG-1 | P1 | `pendingPhaseId`/`pendingPhaseSummary` 存储但从未消费，阶段转换被丢弃 | ✅ 已修复 |
| R14-BUG-2 | P2 | `outputBufferBytes` 计数字符而非字节，多字节内容下缓冲区超限 | ✅ 已修复 |
| R14-BUG-3 | P2 | `cleanupOldDecisions` 删除文件后 JSONL 中 `outputRef` 成为悬空引用 | ⚠️ 未修复 |
| R15-BUG-1 | P2 | `extractWithRetry` 重试成功后 rawOutput 仍为首次调用的错误输出 | ⚠️ 未修复 |
| R15-BUG-2 | P2 | Buffer 字节级截断可能切断 UTF-8 多字节字符产生乱码 | ⚠️ 未修复 |

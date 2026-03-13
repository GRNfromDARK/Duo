# God LLM Integration — 执行任务清单

> 唯一需求来源：`docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md`
> Generated: 2026-03-12 by auto-todo
> Tech Stack: TypeScript strict + Node.js + Ink (React CLI) + xstate v5 | vitest
> Tasks: 13 | Phases: 4 | Critical Path: A-1 → A-2 → B-1 → B-2 → B-3 → C-1 → C-2 → D-1
>
> 背景：God LLM 的 17 个模块（task-init, god-router, god-convergence, god-prompt-generator, auto-decision, degradation-manager, rule-engine, loop-detector, drift-detector, alert-manager, phase-transition, tri-party-session, god-system-prompt, god-audit, god-session-persistence, god-context-manager, consistency-checker）已全部实现并通过单元测试（1246 tests passing）。但这些模块完全未接入 App.tsx 运行时工作流——App.tsx 仍使用 v1 的 ChoiceDetector + ConvergenceService + ContextManager。本 todolist 专注于将已实现的 God 模块接入运行时。

---

## 设计文档

| 文件 | 路径 | 用途 |
|------|------|------|
| 需求文档 | `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` | 产品需求与验收标准的唯一来源 |
| 原始任务清单 | `docs/requirements/god-llm-todolist.md` | God 模块实现任务清单（已完成） |
| v1 任务清单 | `todolist.md` | duo v1 基础版任务清单（已完成） |

## 测试命令

```bash
npx vitest run
```

## 约束

- God 通过 CLI adapter 调用（同 Coder/Reviewer），不绑定特定 SDK（AR-001）
- God 输出通过 JSON 代码块提取 + Zod schema 校验，非 tool_use（AR-002）
- XState 保留，God 作为异步 effect handler 注入（AR-003）
- 旧组件（ContextManager/ConvergenceService/ChoiceDetector）保留为 fallback，不删除（AR-004）
- God session ID + convergenceLog 存入 snapshot.json（AR-005）
- 规则引擎 block 不可被 God 覆盖（NFR-009）
- Reviewer 是收敛的唯一权威，converged 只能在 Reviewer 输出后产生
- 所有集成接入必须支持降级：God 失败时回退到 v1 组件

---

## Phase A：基础接入层

### A-1：SetupWizard 添加 God 角色选择步骤
- 在 SetupWizard 的 PHASE_ORDER 中添加 `select-god` 步骤，位于 `select-reviewer` 之后
- 复用 CLISelector 组件，label 为 "Select God (orchestrator):"
- 添加 "Use same as Reviewer (default)" 选项作为第一项
- 确认页面（ConfirmScreen）展示 God 选择
- StatusBar 中展示当前 God adapter 名称
- 依赖：none
- 来源：FR-006 (AC-021, AC-022), FR-001a
- 验证：
  - [ ] SetupWizard 新增 God 选择步骤，ProgressStepper 显示 6 步
  - [ ] 选择 "Use same as Reviewer" 时 god 字段跟随 reviewer
  - [ ] 确认页面显示 God 角色
  - [ ] 现有测试不受影响

### A-2：TASK_INIT 入口 — 启动时调用 God 意图解析
- 在 App.tsx SessionRunner 的初始化 useEffect 中，`send({ type: 'START_TASK' })` 之前，调用 `runTaskInit()` 获取 GodTaskAnalysis
- 使用已实现的 `src/god/task-init.ts` 的 `runTaskInit()` 函数
- 使用已实现的 `src/god/god-system-prompt.ts` 生成 God system prompt
- 将 GodTaskAnalysis 结果存入 React state（taskAnalysis），供后续路由和 prompt 生成使用
- 用 DegradationManager 包裹：God TASK_INIT 失败时，fallback 到直接 START_TASK（v1 行为）
- 将 `suggestedMaxRounds` 注入 xstate context 替代硬编码 `MAX_ROUNDS = 20`
- 添加 God 状态到 workflow-machine：新增 `TASK_INIT` state（START_TASK → TASK_INIT → CODING）
- 依赖：A-1
- 来源：FR-001 (AC-001, AC-002, AC-003), FR-002 (AC-008, AC-009), FR-007 (AC-023, AC-024)
- 验证：
  - [ ] 启动 session 时先调用 God TASK_INIT，再进入 CODING
  - [ ] GodTaskAnalysis 结果正确存入 state
  - [ ] suggestedMaxRounds 替代硬编码 MAX_ROUNDS
  - [ ] God TASK_INIT 失败时降级到直接 CODING（v1 行为）
  - [ ] TASK_INIT 结果写入 God audit log

### A-3：TaskAnalysisCard UI + 自动确认机制
- 新增 Ink 组件 `TaskAnalysisCard`，展示 God 的任务分类结果
- 显示内容：任务类型、预估轮次、terminationCriteria、confidence
- 8 秒自动确认倒计时（AC-005），用户操作时暂停倒计时（AC-006）
- 数字键 1-4 直接选择任务类型（AC-007）
- 用户选择不同类型时，调用 God 重新规划
- 在 TASK_INIT 和 CODING 状态之间插入短暂的 UI 展示
- 依赖：A-2
- 来源：FR-001a (AC-004, AC-005, AC-006, AC-007)
- 验证：
  - [ ] TaskAnalysisCard 在 God 分析完成后 < 200ms 内显示
  - [ ] 8 秒倒计时后自动以推荐类型开始
  - [ ] 用户按 ↑↓ 时暂停倒计时
  - [ ] 数字键直接选择并确认

---

## Phase B：核心路由替换

### B-1：ROUTING_POST_CODE 替换 — ChoiceDetector → GodRouter
- 修改 App.tsx 的 `ROUTING_POST_CODE` useEffect
- 当 God 未降级时：调用 `src/god/god-router.ts` 的 `routePostCoder()` 替代 `decidePostCodeRoute()`
- 使用 `src/god/god-prompt-generator.ts` 的 `generateGodDecisionPrompt()` 生成 God prompt
- God 返回 `GodPostCoderDecision`，映射到 XState event（continue_to_review → ROUTE_TO_REVIEW, retry_coder → ROUTE_TO_CODER, request_user_input → NEEDS_USER_INPUT）
- DegradationManager 包裹：God 失败时回退到 v1 的 `decidePostCodeRoute()`
- 路由决策写入 God audit log
- 依赖：A-2
- 来源：FR-004 (AC-016, AC-017, AC-018a)
- 验证：
  - [ ] God 在 Coder 完成后做路由决策
  - [ ] God 决策正确映射到 XState event
  - [ ] God 失败时降级到 v1 ChoiceDetector
  - [ ] converged 不会在 POST_CODE 产生（AC-018a）
  - [ ] 路由决策写入 audit log

### B-2：ROUTING_POST_REVIEW 替换 — ChoiceDetector → GodRouter
- 修改 App.tsx 的 `ROUTING_POST_REVIEW` useEffect
- 当 God 未降级时：调用 `src/god/god-router.ts` 的 `routePostReviewer()` 替代 `decidePostReviewRoute()`
- God 返回 `GodPostReviewerDecision`，映射到 XState event（route_to_coder → ROUTE_TO_CODER, converged → CONVERGED, phase_transition → PHASE_TRANSITION, loop_detected → LOOP_DETECTED, request_user_input → NEEDS_USER_INPUT）
- `route_to_coder` 必须携带 `unresolvedIssues`（AC-018b）
- DegradationManager 包裹：God 失败时回退到 v1 的 `decidePostReviewRoute()`
- 依赖：B-1
- 来源：FR-004 (AC-016, AC-017, AC-018, AC-018b)
- 验证：
  - [ ] God 在 Reviewer 完成后做路由决策
  - [ ] route_to_coder 携带非空 unresolvedIssues
  - [ ] converged 只在 POST_REVIEW 产生
  - [ ] God 失败时降级到 v1 ChoiceDetector + ConvergenceService
  - [ ] 所有决策写入 audit log

### B-3：EVALUATING 替换 — ConvergenceService → GodConvergence
- 修改 App.tsx 的 `EVALUATING` useEffect
- 当 God 未降级时：调用 `src/god/god-convergence.ts` 的 `evaluateConvergence()` 替代 `convergenceRef.current.evaluate()`
- God 返回 `GodConvergenceJudgment`，执行一致性校验（consistency-checker）
- shouldTerminate 时 blockingIssueCount 必须为 0（AC-019）
- shouldTerminate 时所有 criteriaProgress.satisfied 必须为 true（AC-019a，max_rounds/loop_detected 例外）
- convergenceLog 追加本轮结果
- DegradationManager 包裹：God 失败时回退到 v1 ConvergenceService
- 依赖：B-2
- 来源：FR-005 (AC-019, AC-019a, AC-019b, AC-020)
- 验证：
  - [ ] God 做收敛判断替代 ConvergenceService
  - [ ] shouldTerminate=true 时 blockingIssueCount===0
  - [ ] criteriaProgress 全部 satisfied 才允许终止
  - [ ] convergenceLog 正确追加
  - [ ] God 失败时降级到 v1 ConvergenceService

### B-4：God 动态 Prompt 生成替代 ContextManager
- 修改 App.tsx 的 CODING/REVIEWING useEffect 中的 prompt 构建逻辑
- 当 God 未降级时：调用 `src/god/god-prompt-generator.ts` 的 `generateCoderPrompt()` / `generateReviewerPrompt()` 替代 `contextManagerRef.current.buildCoderPrompt()` / `buildReviewerPrompt()`
- God prompt 包含：任务类型策略（FR-003a）、Reviewer unresolvedIssues 作为 Coder 必做清单（FR-003b）、质量检查（FR-003c）
- explore 型 prompt 不包含执行动词（AC-013）
- prompt 长度检查 ≤ context window（AC-014）
- prompt 摘要写入 audit log（AC-015）
- DegradationManager 包裹：God 失败时回退到 v1 ContextManager
- 依赖：B-1
- 来源：FR-003 (AC-013, AC-014, AC-015), FR-003a, FR-003b, FR-003c
- 验证：
  - [ ] God 动态生成 Coder/Reviewer prompt
  - [ ] explore 型 prompt 不含执行动词
  - [ ] Reviewer unresolvedIssues 作为 Coder prompt 的必做清单
  - [ ] God 失败时降级到 v1 ContextManager prompt

---

## Phase C：高级功能集成

### C-1：WAITING_USER 代理决策 + 2s 逃生窗口
- 修改 App.tsx 的 `WAITING_USER` useEffect
- 当 God 未降级时：调用 `src/god/auto-decision.ts` 的 `makeAutoDecision()` 获取 GodAutoDecision
- 先通过 `src/god/rule-engine.ts` 检查是否被 block（AC-025）
- 未被 block 时：显示 2 秒逃生窗口 UI（GodDecisionBanner 组件）
- 用户按 Space 立即执行、Esc 取消进入手动模式（AC-026）
- accept → send CONVERGED, continue_with_instruction → 设置 pendingInstruction + send USER_CONFIRM continue
- request_human → 保持 WAITING_USER
- reasoning 写入 audit log（AC-027）
- DegradationManager 包裹：God 失败时保持 v1 行为（等待用户输入）
- 依赖：B-3
- 来源：FR-008 (AC-025, AC-026, AC-027), FR-008a (AC-028, AC-029, AC-030)
- 验证：
  - [ ] God 在 WAITING_USER 时自主决策
  - [ ] 规则引擎 block 时不执行代理决策
  - [ ] 2 秒逃生窗口正常显示和交互
  - [ ] Esc 进入手动模式
  - [ ] 决策 reasoning 写入 audit log

### C-2：DegradationManager 接入 — 4 级降级切换
- 在 SessionRunner 中创建 DegradationManager 实例（useRef）
- 初始化时注入 FallbackServices：contextManager, convergenceService, choiceDetector
- 所有 God 调用点（A-2, B-1, B-2, B-3, B-4, C-1）使用 DegradationManager 包裹
- L1: 正常 God 调用
- L2: process_exit/timeout → 重试 1 次 → fallback
- L3: parse_failure/schema_validation → 附带纠错提示重试 1 次 → fallback
- L4: 连续 3 次失败 → 禁用 God，全量 fallback 到 v1 组件
- 降级通知在消息流中显示（DegradationNotification）
- 降级状态持久化到 session state（duo resume 时恢复）
- 依赖：B-3
- 来源：FR-G01 (AC-055, AC-056, AC-057), FR-G04 (AC-062, AC-063)
- 验证：
  - [ ] God 单次失败时自动重试
  - [ ] 连续 3 次失败后禁用 God 使用 v1 组件
  - [ ] 降级通知在 UI 中展示
  - [ ] 降级状态跨 session 持久化
  - [ ] 降级后所有路由/收敛/prompt 回退到 v1

### C-3：重分类 Overlay (Ctrl+R) + 阶段转换
- 新增 ReclassifyOverlay Ink 组件（FR-002a）
- Ctrl+R 在 CODING/REVIEWING/WAITING_USER 状态触发（AC-010）
- 展示当前类型 + 可选类型列表，确认后调用 God 重新规划
- 重分类事件写入 audit log（AC-012）
- 阶段转换（FR-010）：compound 型任务中 God 输出 phase_transition → 触发 2 秒逃生窗口 → 保留 RoundRecord → 下一阶段 prompt 携带上阶段结论摘要
- 使用 `src/god/phase-transition.ts` 处理阶段切换逻辑
- StatusBar 更新当前任务类型和阶段
- 依赖：A-3
- 来源：FR-002a (AC-010, AC-011, AC-012), FR-010 (AC-033, AC-034)
- 验证：
  - [ ] Ctrl+R 正确触发 ReclassifyOverlay
  - [ ] 重分类后 God 在 < 3s 内生成新 prompt
  - [ ] 阶段转换通知横幅显示 2 秒
  - [ ] 转换前后 RoundRecord 均保留

### C-4：God 会话持久化 + duo resume 恢复
- 修改 SessionManager.saveState() 扩展 SessionState，存入：
  - godAdapter: string（God adapter 名称）
  - godSessionId: string（God CLI session ID）
  - taskAnalysis: GodTaskAnalysis（意图分析结果）
  - convergenceLog: ConvergenceLogEntry[]
  - degradationState: DegradationState
- 修改 duo resume 流程（cli.ts + App.tsx）：
  - 使用 `src/god/god-session-persistence.ts` 的 `restoreGodSession()` 恢复 God adapter
  - 恢复 convergenceLog 和 taskAnalysis 到 React state
  - 恢复 degradationState（如果 God 已降级则保持降级）
- God audit log 在 resume 后继续追加（seq 递增）
- 依赖：C-2
- 来源：FR-011 (AC-035, AC-036), AR-005
- 验证：
  - [ ] duo resume 后 God session 正确恢复
  - [ ] convergenceLog 和 taskAnalysis 恢复完整
  - [ ] 降级状态正确恢复
  - [ ] God audit log 的 seq 在 resume 后正确递增

---

## Phase D：端到端验证

### D-1：集成测试 — God 完整工作流端到端
- 编写集成测试覆盖 God 完整工作流：
  - TASK_INIT → CODING → ROUTING_POST_CODE(God) → REVIEWING → ROUTING_POST_REVIEW(God) → EVALUATING(God) → CONVERGED
  - God 降级场景：God 失败 → v1 fallback → 工作流正常完成
  - 代理决策场景：WAITING_USER → God auto-decision → 继续
  - compound 型：explore → code 阶段转换
  - duo resume 场景：session 持久化 → 恢复 → God 继续工作
- 使用 mock adapter 模拟 God/Coder/Reviewer 的 CLI 输出
- 依赖：C-4
- 来源：FR-001 ~ FR-011, FR-G01, FR-G04
- 验证：
  - [ ] 正常路径端到端通过
  - [ ] God 降级路径端到端通过
  - [ ] 代理决策路径通过
  - [ ] 阶段转换路径通过
  - [ ] resume 路径通过
  - [ ] 所有现有 1246 个测试不受影响

### D-2：StatusBar God 信息展示 + Audit Log 完善
- StatusBar 展示：God adapter 名称、当前任务类型、当前阶段（compound）、降级状态
- StatusBar 展示 God 决策延迟（P95 目标 < 10s）
- God audit log CLI 命令（`duo log`）确认可读取所有 God 决策
- 清理未使用的 v1 引用（但不删除 v1 组件本身，保留为 fallback）
- 依赖：D-1
- 来源：FR-006, FR-012 (AC-037, AC-038), FR-020
- 验证：
  - [ ] StatusBar 展示 God 信息
  - [ ] `duo log` 正确展示 God audit 记录
  - [ ] 所有测试通过

---

## 可追溯性矩阵

| FR | Task(s) | Status |
|----|---------|--------|
| FR-001 意图解析 | A-2 | ✅ Covered |
| FR-001a 意图回显+确认 | A-3 | ✅ Covered |
| FR-002 任务分类 | A-2 | ✅ Covered |
| FR-002a 运行中重分类 | C-3 | ✅ Covered |
| FR-003 动态 Prompt | B-4 | ✅ Covered |
| FR-004 输出分析与路由 | B-1, B-2 | ✅ Covered |
| FR-005 收敛判断 | B-3 | ✅ Covered |
| FR-006 God Adapter 配置 | A-1 | ✅ Covered |
| FR-007 动态轮次控制 | A-2 | ✅ Covered |
| FR-008 WAITING_USER 代理决策 | C-1 | ✅ Covered |
| FR-008a 规则引擎 | C-1 | ✅ Covered |
| FR-009 异常/死循环检测 | B-2 | ✅ Covered |
| FR-010 阶段转换 | C-3 | ✅ Covered |
| FR-011 God 会话持久化 | C-4 | ✅ Covered |
| FR-012 审计日志 | D-2 | ✅ Covered |
| FR-G01 降级 | C-2 | ✅ Covered |
| FR-G04 极端 fallback | C-2 | ✅ Covered |

Coverage: 100% (17/17 Must+Should FRs)

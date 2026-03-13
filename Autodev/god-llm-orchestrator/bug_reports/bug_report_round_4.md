综合所有 agent 结果并逐一验证源代码后，以下是第 4 轮审计报告。

---

## Bug 审计报告（第 4 轮）

首先确认前几轮的修复状态：
- Round 3 BUG-1 (DriftDetector consecutivePermissive 不重置): **已修复**，`drift-detector.ts:206-207` 在 `handleDrift` 中重置为 0
- Round 3 BUG-2 (evaluatePhaseTransition 忽略 nextPhaseId): **已修复**，`phase-transition.ts:59-61` 现在优先使用 God 指定的 nextPhaseId
- Round 3 BUG-3 (God 调用使用 process.cwd()): **已部分修复**，`auto-decision.ts:57` 使用 `projectDir ?? process.cwd()`，但仍存在 fallback 问题（见 BUG-3）
- Round 3 BUG-4 (DegradationManager 三元表达式): 仍然存在但降级为 P2
- Round 3 BUG-5 (god-convergence 双重一致性检查): **已修复**，`god-convergence.ts:177` 传入 `consistencyAlreadyChecked = true`

---

### BUG-1 [P1] hasNoImprovement 在所有 blockingIssueCount 为 0 时仍返回 true，导致成功任务被强制终止
- 文件: `src/god/god-convergence.ts:240-248`
- 问题: `hasNoImprovement` 检查最近 N 轮的 `blockingIssueCount` 是否全部相同。当连续 3 轮 blockingIssueCount 均为 0 时（任务已收敛），该函数返回 `true`。在 line 206 结合 `judgment.reason === 'loop_detected'` 条件，如果 God 误判为 loop_detected（当 blocking issues 已清零但仍输出 loop_detected reason），将强制终止一个实际已成功收敛的任务。
- 预期: `hasNoImprovement` 应排除所有计数为 0 的情况，即 `return counts.every(c => c === counts[0]) && counts[0] > 0`。
- 建议修复: 在 line 247 添加 `&& counts[0] > 0` 条件。

### BUG-2 [P1] enforceTokenBudget 将 token 数直接当作字符数使用，导致 prompt 被过度截断 4 倍
- 文件: `src/session/context-manager.ts:404-405`
- 问题: `enforceTokenBudget` 计算 `maxChars = contextWindowSize * BUDGET_RATIO`。生产环境传入 `contextWindowSize: 200000`（App.tsx:346），这是 token 数。函数名为 `enforceTokenBudget`，且同文件定义了 `CHARS_PER_TOKEN = 4`（line 43）但未在此使用。实际 `maxChars = 200000 * 0.8 = 160,000` 字符（约 40K tokens），而正确值应为 `200000 * 4 * 0.8 = 640,000` 字符（约 160K tokens）。Prompt 被截断得比预期严格 4 倍。
- 预期: `const maxChars = Math.floor(this.contextWindowSize * CHARS_PER_TOKEN * BUDGET_RATIO)`。
- 建议修复: 在 line 405 乘以 `CHARS_PER_TOKEN`。

### BUG-3 [P1] auto-decision 将 accept/request_human 操作以 config_modify 类型送入规则引擎，导致非 ~/Documents 项目的合法决策被误杀
- 文件: `src/god/auto-decision.ts:128-133`
- 问题: 当 God 自动决策 action 为 `accept` 或 `request_human` 时，代码创建 `type: 'config_modify'` 的规则检查，`path` 设为项目目录。R-001（`rule-engine.ts:76-96`）会检查 `config_modify` 类型的路径是否在 `~/Documents` 内。对于 `~/Documents` 之外的项目，这些纯工作流控制决策（"接受当前结果"或"请求人类介入"）会被 R-001 错误地 block，尽管它们不涉及任何文件写入或配置修改。
- 预期: `accept` 和 `request_human` 不应经过路径相关的规则检查，或应使用不触发 R-001 的 action type。
- 建议修复: 对非 `continue_with_instruction` 的 action，跳过规则引擎检查或返回一个空的 `RuleEngineResult`。

### BUG-4 [P1] InterruptHandler.dispose() 设置标志但从不检查，dispose 后仍可向已停止的 actor 发送事件
- 文件: `src/engine/interrupt-handler.ts:50, 61-117, 123-125`
- 问题: `dispose()` 在 line 124 设置 `this.disposed = true`，但 `handleSigint()`（line 61）、`handleTextInterrupt()`（line 81）和 `handleUserInput()`（line 112）均不检查 `disposed` 标志。dispose 后如果 SIGINT 触发或调用方仍持有引用，handler 会继续向可能已停止的 XState actor 发送事件（如 `USER_INTERRUPT`、`USER_INPUT`），可能导致运行时异常。
- 预期: 所有公开方法应在入口处检查 `if (this.disposed) return;`。
- 建议修复: 在 `handleSigint`、`handleTextInterrupt`、`handleUserInput` 开头添加 disposed 守卫。

### BUG-5 [P1] markdown-parser 无法识别空的 fenced code block，导致后续内容被错误吞入代码块
- 文件: `src/ui/markdown-parser.ts:77`
- 问题: 关闭 fence 的条件为 `FENCE_CLOSE.test(lines[i]) && codeLines.length > 0`，要求代码块内至少有一行内容才能关闭。当输入包含空代码块（开 fence 紧接闭 fence，如 ` ```\n``` `）时，闭 fence 不被识别，而是被推入 `codeLines` 作为内容。之后的所有行继续被当作代码块内容消耗，直到文件末尾。这会破坏所有后续 markdown 解析。
- 预期: 移除 `codeLines.length > 0` 条件，闭 fence 应无条件匹配。
- 建议修复: Line 77 改为 `if (FENCE_CLOSE.test(lines[i]))`。

### BUG-6 [P2] OutputStreamManager 的 late consumer 丢失已 pump 的 chunks，与文档承诺不符
- 文件: `src/adapters/output-stream-manager.ts:29-34, 41-93`
- 问题: `start()` 异步启动 `pump()`，注释 line 27 说 "Call consume() to create consumer iterators before or after start()"。但 `consume()` 创建的新 consumer 只能收到注册后 pump 的 chunk。`this.buffer` 存储了所有已 pump 的 chunk，但在 `consume()` 中从未回放给新 consumer。如果 `consume()` 在 `start()` 之后调用，late consumer 静默丢失已发出的数据。
- 预期: late consumer 应从 `buffer` 回放之前的 chunks，或文档应明确要求 `consume()` 必须在 `start()` 之前调用。
- 建议修复: 在 `consume()` 中，将 `this.buffer` 中已有的 chunks 推入新 consumer 的 queue。

### BUG-7 [P2] consistency-checker 使用 if/if 而非 if/else if，两个类型守卫可能同时匹配
- 文件: `src/god/consistency-checker.ts:69-81`
- 问题: `checkConsistency` 对 `isConvergenceJudgment` 和 `isPostReviewerDecision` 使用两个独立的 `if`。`isConvergenceJudgment` 检查 `classification + shouldTerminate + blockingIssueCount`，`isPostReviewerDecision` 检查 `action + confidenceScore + progressTrend`。如果 God 输出的 JSON 包含两组属性的超集（LLM 可能输出额外字段），且 Zod 使用了 `.passthrough()` 或数据未经 Zod 清洗，两个分支都会执行，第二个分支的 `applyPostReviewerCorrections` 会覆盖第一个分支的修正结果。
- 预期: 使用 `else if` 使两个分支互斥。
- 建议修复: Line 76 改为 `} else if (isPostReviewerDecision(decision))`。

---

VERDICT: BUGS_FOUND | P0:0 P1:5 P2:2

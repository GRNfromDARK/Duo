现在我已经完成了对所有关键源文件的独立审查。以下是第 8 轮 Bug 审计报告。

---

## Bug 审计报告（第 8 轮）

### 前几轮修复状态确认

经逐一验证源代码，前 7 轮报告的所有 bug 均已修复：
- Round 5 BUG-2 (ProcessManager 非零退出码): **已修复**，`process-manager.ts:111-126` 使用 `close` 事件统一处理，process-error 先于 process-complete emit，适配器 `claude-code/adapter.ts:156-160` 仅监听 `process-complete`
- Round 5 BUG-5 (ProcessManager appendOutput 字节/字符): **已修复**，`process-manager.ts:325` 使用 `text.length`
- Round 6 BUG-1 (ClaudeCode/Codex sessionId 清除): **已修复**，`claude-code/adapter.ts:182,200` 使用 `sessionIdUpdated` 标志
- Round 6 BUG-2 (R-002 子字符串匹配): **已修复**，`rule-engine.ts:112-122` 使用 token split + `startsWith('/')`
- Round 7 BUG-2 (seq 重复): **已修复**，`god-router.ts:204` 调用 `context.seq++`
- Round 7 BUG-1 (适配器 controller.enqueue try-catch): **已修复**，`claude-code/adapter.ts:163,168` 包裹 try-catch
- Round 7 BUG-3 (stderr error handler): **已修复**，`claude-code/adapter.ts:175` 添加 `stderr?.on('error')`
- Round 7 BUG-5 (godActionToEvent default): **已修复**，`god-router.ts:87` 抛出错误
- consistency-checker if/else if: **已修复**，`consistency-checker.ts:76` 使用 `else if`

---

### BUG-1 [P1] InterruptHandler.saveAndExit 传入部分 state 对象覆盖完整 SessionState，丢失 God 会话数据
- 文件: `src/engine/interrupt-handler.ts:164-168` + `src/session/session-manager.ts:190,195`
- 问题: `saveAndExit()` 调用 `saveState(sessionId, { round, status: 'interrupted', currentRole })` 传入仅 3 个字段的对象。`SessionManager.saveState()`（line 195）执行 `snapshot.state = state` 直接替换整个 `SessionState`。这意味着 `coderSessionId`、`reviewerSessionId`、`godSessionId`、`godTaskAnalysis`、`godConvergenceLog` 等持久化字段在双击 Ctrl+C 退出时被**全部清除**。下次 `duo resume` 恢复时，所有三方 CLI session ID 丢失，God 分析结果和收敛日志也丢失，导致会话无法恢复上下文连续性。
- 预期: `saveAndExit` 应先加载当前 state，仅覆盖 `round`、`status`、`currentRole` 三个字段，保留其余持久化字段。
- 建议修复: 在 `saveState` 中改为 `snapshot.state = { ...snapshot.state, ...state }`（合并而非替换），或在 `InterruptHandler` 中传入完整的 state。

### BUG-2 [P1] convergence-service.ts 的 BLOCKING_ISSUE_PATTERNS 将 [CHANGES_REQUESTED] 标记计入 blocking issue 数，膨胀 issue 计数
- 文件: `src/decision/convergence-service.ts:59`
- 问题: `BLOCKING_ISSUE_PATTERNS` 数组包含 `/\[CHANGES_REQUESTED\]/g`，这是 reviewer 的verdict 标记而非具体的 blocking issue。当 reviewer 输出包含 `[CHANGES_REQUESTED]` 标记加上 2 个 `**Blocking**` 标记时，`countBlockingIssues` 返回 3 而非 2。此膨胀的计数传入 `detectProgressTrend` 和 `ConvergenceResult.issueCount`，间接影响 God 的 `ConvergenceContext`。虽然 `classify()` 在 line 92 的 soft-approval 路径正确排除了 `[CHANGES_REQUESTED]`（通过 `!output.includes('[CHANGES_REQUESTED]')`），但 **issue 计数**本身仍然是膨胀的。这导致 convergence 趋势判断不准确（本应 `issueCount=0` 但因标记被计为 1），可能误触发 stagnation 检测。
- 预期: `[CHANGES_REQUESTED]` 是 verdict 标记，不应参与 blocking issue 计数。
- 建议修复: 从 `BLOCKING_ISSUE_PATTERNS` 数组中移除 `/\[CHANGES_REQUESTED\]/g`。

### BUG-3 [P1] auto-decision.ts 使用 extractGodJson 单次提取而非 extractWithRetry，与其他所有 God 调用点不一致
- 文件: `src/god/auto-decision.ts:110`
- 问题: `makeAutoDecision` 使用 `extractGodJson`（单次提取）而非 `extractWithRetry`，但 `god-router.ts:135`、`god-convergence.ts:140`、`task-init.ts:85` 都使用 `extractWithRetry`（含格式纠错重试）。当 God LLM 返回格式略有偏差的 JSON（如缺少引号），其他调用点会重试一次带纠错提示的请求，但 `makeAutoDecision` 直接 fallback 到 `request_human`。对于 `accept` 或 `continue_with_instruction` 类型的决策，这意味着一次可修复的格式错误就会导致不必要的人工介入，中断自动化流程。
- 预期: 应与其他模块一致使用 `extractWithRetry`。
- 建议修复: 将 line 110 替换为 `const result = await extractWithRetry(rawOutput, GodAutoDecisionSchema, async (hint) => collectAdapterOutput(godAdapter, ..., hint))`。

### BUG-4 [P1] FENCE_OPEN 和 FENCE_CLOSE 正则的 $ 锚点不允许尾随空格，导致含尾随空格的代码块无法被正确解析
- 文件: `src/ui/markdown-parser.ts:20-21`
- 问题: `FENCE_OPEN = /^```(\w*)$/` 和 `FENCE_CLOSE = /^```$/` 都使用 `$` 锚点要求行尾精确匹配。当 LLM 输出的代码 fence 含尾随空格（如 `` ```python  `` 或 `` ```  ``）时，正则不匹配。`FENCE_CLOSE` 不匹配时，代码块永远不会关闭，后续所有行被吞入代码块内容，破坏整个 markdown 解析。同样的问题存在于 `text-stream-parser.ts:19-20` 的 `CODE_FENCE_OPEN` 和 `CODE_FENCE_CLOSE`。LLM 输出常包含尾随空格，这是一个高频触发的边界条件。
- 预期: 正则应允许尾随空格：`/^```(\w*)\s*$/` 和 `/^```\s*$/`。
- 建议修复: 更新两个文件中的正则表达式，在 `$` 前添加 `\s*`。

### BUG-5 [P2] god-message-style.ts 的 padLine 使用 string.length 而非视觉宽度，CJK 字符导致 God 消息框溢出
- 文件: `src/ui/god-message-style.ts:86-90`
- 问题: `padLine` 使用 `text.length` 进行截断和填充计算。CJK 字符（如中文）的 `.length` 为 1 但视觉宽度为 2。当 God 消息包含中文内容时（系统明确面向中文用户），每个中文字符占 2 个视觉列但只被计为 1 列，导致实际渲染宽度超过 `BOX_WIDTH`，`║...║` 边框对不齐。`message-lines.ts:245-266` 已实现了正确的 `getCharWidth` 函数处理 CJK 范围，但 `padLine` 未使用。
- 预期: 应使用视觉宽度计算，复用或参考 `message-lines.ts` 的 `getCharWidth`。
- 建议修复: 在 `god-message-style.ts` 中引入视觉宽度计算函数，替换 `text.length` 为视觉宽度。

### BUG-6 [P2] alert-manager.ts 的 checkGodError 始终返回 Alert 对象，签名声称 `Alert | null` 但从不返回 null
- 文件: `src/god/alert-manager.ts:86-94`
- 问题: `checkGodError` 的返回类型声明为 `Alert | null`，但函数体无条件返回 `Alert` 对象，永远不返回 `null`。这导致签名具有误导性——调用方可能以为 null 表示"该错误不需要告警"，但实际上所有 God 错误都会生成 Critical 级别告警。如果某些错误应该被降级管理器（L2 瞬时重试）处理而不产生告警，当前实现无法区分。
- 预期: 如果确实所有错误都需要告警，返回类型应改为 `Alert`；否则应添加过滤逻辑。
- 建议修复: 将返回类型改为 `Alert`，或针对 `L2` 级瞬时错误返回 `null`。

### BUG-7 [P2] god-context-manager.ts 的 classifyTrend 对 `[5, 3, 5]` 返回 "unchanged" 而非 "oscillating"
- 文件: `src/god/god-context-manager.ts:152-164`
- 问题: `classifyTrend` 在 `first === last` 时返回 `"unchanged"`，但如 `[5, 3, 5]` 这样的振荡模式中间值有改善后又回升，趋势应为振荡或停滞而非"未变化"。这个趋势摘要会被 God 的增量 prompt 引用（line 86），可能误导 God 认为情况稳定。实际上 `"unchanged"` 分支是死代码——只有当 `first === last` 且并非所有值相同时才能到达（如 `[5, 3, 5]`），语义上应该是振荡。
- 预期: 对 first === last 但中间值不同的情况返回 "oscillating" 或 "stagnant"。
- 建议修复: 将 `return 'unchanged'` 改为 `return 'stagnant'`。

---

VERDICT: BUGS_FOUND | P0:0 P1:4 P2:3

**修复优先级建议**：BUG-1（P1）最先修复——双击 Ctrl+C 退出导致所有 God 会话数据和 session ID 丢失，直接破坏 `duo resume` 的完整性。其次是 BUG-2（issue 计数膨胀影响收敛判断准确性）和 BUG-4（代码块解析失败影响 TUI 渲染）。

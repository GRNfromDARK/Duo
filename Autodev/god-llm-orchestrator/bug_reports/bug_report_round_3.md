现在我已经完成了所有关键源文件的独立审查。以下是第 3 轮 Bug 审计报告。

---

## Bug 审计报告（第 3 轮）

首先确认：前两轮报告的多数 Bug 已修复：
- Round 1 BUG-1 (ConvergenceLogEntry 双重定义): 已修复，`god-prompt-generator.ts:9` 现在从 `god-convergence.ts` 导入
- Round 1 BUG-4 (DriftDetector seq 冲突): 已修复，构造函数现在强制要求 `seqProvider`（`drift-detector.ts:101-105`）
- Round 1 BUG-7 (god adapter 未校验): 已修复，`validateCLIChoices` 现在接受并校验 `god` 参数（`session-starter.ts:78-89`）
- Round 1 BUG-10 (audit sort 顺序): 已修复，`cleanupOldDecisions` 使用数字排序（`god-audit.ts:167-169`）
- Round 1 BUG-11/12 (schema 缺 refine/长度限制): 已修复，`god-schemas.ts` 已添加 `.refine()` 和 `.max()`
- Round 2 BUG-1 (system prompt 错误 action): 已修复，`god-system-prompt.ts:32` 现在使用正确的 action 名称
- Round 2 BUG-2 (God session ID 未恢复): 已修复，`session-runner-state.ts:278` 现在读取 `godSessionId`
- Round 2 BUG-3 (Zod 剥离 nextPhaseId): 已修复，`god-schemas.ts:43` 添加 `nextPhaseId: z.string().optional()`
- Round 2 BUG-5 (overlay 显示首阶段): 已修复，`god-overlay.ts:67-81` 现在搜索 PHASE_TRANSITION audit entry

---

### BUG-1 [P1] DriftDetector consecutivePermissive 检测后不重置，导致无限降级循环
- 文件: `src/god/drift-detector.ts:119-131, 138-148, 194-198`
- 问题: `recordDecision()` 在 line 122 递增 `consecutivePermissive`，但 `checkDrift()` 在 line 140 检测到 `god_too_permissive`（≥3 次连续）后从未重置计数器。当 severe 漂移触发 2 轮 fallback（line 207, `fallbackRoundsRemaining = 2`）后，`tickFallbackRound()` 将其减至 0。此时 `isFallbackActive()` 返回 false，God 恢复使用。但下一次 `checkDrift()` 调用时，`consecutivePermissive` 仍然 ≥ 3，立即再次触发 `god_too_permissive` → 又进入 2 轮 fallback → 恢复 → 再次触发... 形成无限循环。
- 预期: 检测到漂移后，应重置 `consecutivePermissive = 0`（在 `handleDrift` 方法中），使恢复后的 God 有干净的起点。
- 建议修复: 在 `handleDrift()` (line 202) 中添加 `this.consecutivePermissive = 0;`

### BUG-2 [P1] evaluatePhaseTransition 忽略 God 指定的 nextPhaseId
- 文件: `src/god/phase-transition.ts:40-66`
- 问题: `evaluatePhaseTransition` 接收 `godDecision: GodPostReviewerDecision` 参数，但 line 58 始终使用 `phases[currentIndex + 1]`（顺序下一阶段），完全忽略 `godDecision.nextPhaseId`。与此同时，`god-schemas.ts:43` 已定义 `nextPhaseId: z.string().optional()`，`god-router.ts:77` 也提取并传递了 `nextPhaseId`。这意味着如果 God 指定跳过某阶段（如从 phase-1 跳到 phase-3），该指令被忽略，系统始终按顺序过渡到 phase-2。
- 预期: 当 `godDecision.nextPhaseId` 存在时，应在 phases 数组中查找匹配的阶段 ID，仅在找不到时 fallback 到顺序下一阶段。
- 建议修复: 在 line 58 前添加：如果 `godDecision.nextPhaseId` 存在，则 `phases.find(p => p.id === godDecision.nextPhaseId)`；找不到则 fallback 到 `phases[currentIndex + 1]`。

### BUG-3 [P1] God 调用全部使用 process.cwd() 而非配置的 projectDir
- 文件: `src/god/god-convergence.ts:338-339`, `src/god/god-router.ts:99-100`, `src/god/auto-decision.ts:54-55`
- 问题: 三个模块的 `collectAdapterOutput` 函数都使用 `process.cwd()` 作为 adapter 的 `cwd` 参数。然而用户可能从非项目目录启动 `duo`（如 `cd / && duo start --dir ~/myproject`），此时 `process.cwd()` 为 `/` 而非项目目录。SessionConfig 中有 `projectDir` 字段，但这些函数的调用上下文（`ConvergenceContext`、`RoutingContext`、`AutoDecisionContext`）中只有 `sessionDir` 而无 `projectDir`，导致无法传递正确的工作目录。God CLI 子进程将在错误的目录下运行，可能无法正确分析项目代码。
- 预期: 应从会话配置中传递 `projectDir`，用作 adapter execute 的 `cwd`。
- 建议修复: 在 `ConvergenceContext`、`RoutingContext`、`AutoDecisionContext` 类型中添加 `projectDir: string` 字段，并在 `collectAdapterOutput` 中使用该字段替代 `process.cwd()`。

### BUG-4 [P2] DegradationManager activateFallback 三元表达式两分支相同
- 文件: `src/god/degradation-manager.ts:175-177`
- 问题: `hasNotifiedFallback` 三元表达式的 true/false 两个分支返回完全相同的消息 `'[System] God orchestrator unavailable. Using local analysis.'`。`hasNotifiedFallback` 标志的设计目的是区分首次通知和后续通知（如首次显示详细提示，后续简化），但实际效果被 copy-paste 错误消除。
- 预期: 两个分支应有不同的消息内容（例如首次通知包含更多上下文，后续通知简化）；或者如果消息确实相同，则去掉无意义的三元表达式和 `hasNotifiedFallback` 标志。
- 建议修复: 更新其中一个分支的消息内容，或简化为直接返回消息。

### BUG-5 [P2] god-convergence.ts 对同一 judgment 执行双重一致性检查
- 文件: `src/god/god-convergence.ts:156` 和 `src/god/god-convergence.ts:203`
- 问题: `evaluateConvergence` 在 line 156 调用 `checkConsistency(judgment)` (来自 `consistency-checker.ts`)，可能自动修正 judgment（如将 classification 从 approved 改为 changes_requested）。然后在 line 166 调用 `applyDecisionTree`，其内部在 line 203 再次调用 `validateConvergenceConsistency(judgment)` 检查相同的规则（如 approved + blockingIssueCount > 0）。如果第一次检查自动修正了 classification，第二次检查将检测不到这个违规（已修正），但仍然增加了不必要的计算开销和代码维护复杂度。更重要的是，如果第一次修正引入了新的不一致（虽然当前逻辑不太可能），第二次检查会覆盖 `shouldTerminate` 为 false，可能与第一次修正冲突。
- 预期: 统一使用一处一致性检查，或在 `applyDecisionTree` 中跳过已被 `checkConsistency` 处理过的判断。
- 建议修复: 在 `applyDecisionTree` 中检查是否已执行过一致性校验（可通过参数传递 `consistency.valid` 结果），避免重复执行。

---

VERDICT: BUGS_FOUND | P0:0 P1:3 P2:2

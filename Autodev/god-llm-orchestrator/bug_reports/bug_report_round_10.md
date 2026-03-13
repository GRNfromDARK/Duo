现在我已经全面审查了所有关键源代码。以下是 Round 10 的完整 Bug 审计报告。

---

## Bug 审计报告（第 10 轮）

### 前几轮修复状态确认

经逐一验证源代码，前 9 轮报告的所有 bug 均已修复：
- Round 9 BUG-1 (ROUTING_POST_CODE→ROUTE_TO_CODER 无 round 递增): **已修复**，`workflow-machine.ts:170` 添加 `round: ({ context }) => context.round + 1`
- Round 9 BUG-2 (phase-transition 最后阶段反向转换): **已修复**，`phase-transition.ts:53-55` 分离 `currentIndex === -1` 检查
- Round 9 BUG-3 (collectAdapterOutput 丢弃 error chunk): **已修复**，全部 4 个模块包含 `chunk.type === 'error'`
- Round 8 BUG-1 (InterruptHandler saveAndExit 覆盖 state): **已修复**，`session-manager.ts:206` 使用 `{ ...snapshot.state, ...state }` 合并
- Round 8 BUG-2 (convergence-service BLOCKING_ISSUE_PATTERNS 含 CHANGES_REQUESTED): **已修复**，已移除
- Round 8 BUG-3 (auto-decision extractGodJson→extractWithRetry): **已修复**，`auto-decision.ts:110` 使用 `extractWithRetry`
- Round 8 BUG-4 (FENCE_OPEN/CLOSE 尾随空格): **已修复**，`markdown-parser.ts:20-21` 正则包含 `\s*`
- Round 8 BUG-5 (god-message-style CJK 宽度): **已修复**，`god-message-style.ts:86-146` 使用 `getVisualWidth` 和 `truncateToWidth`
- Round 8 BUG-6 (alert-manager checkGodError 返回类型): **已修复**，返回类型改为 `Alert`
- Round 8 BUG-7 (classifyTrend unchanged→stagnant): **已修复**，`god-context-manager.ts:163` 返回 `'stagnant'`
- 其他 Round 1-7 修复也已确认

---

### BUG-1 [P1] AlertManager.checkProgress 对 blockingIssueCount 全为 0 的已收敛任务误报 STAGNANT_PROGRESS

- **文件**: `src/god/alert-manager.ts:60-79`
- **问题**: `checkProgress` 检查最近 3 轮的 `blockingIssueCount` 是否非递减。当连续 3 轮 blockingIssueCount 均为 0（任务已成功收敛）时，每对 `0 < 0` 均为 false，循环正常完成，函数返回 `STAGNANT_PROGRESS` Warning。这与 `god-convergence.ts:248` 的 `hasNoImprovement` 函数已修复的同类问题（Round 4 BUG-1）完全一致——后者添加了 `&& counts[0] > 0` 排除全 0 情况，但 `alert-manager.ts` 未做相同修正。已收敛的任务会收到虚假的 "No progress" 告警。
- **预期**: 当所有 blockingIssueCount 为 0 时，不应触发 STAGNANT_PROGRESS（任务已收敛，不是停滞）。
- **建议修复**: 在循环后、返回 Alert 前添加检查：
  ```typescript
  if (recent.every(e => e.blockingIssueCount === 0)) {
    return null; // Converged, not stagnant
  }
  ```

### BUG-2 [P1] buildRoutingSystemPrompt POST_REVIEWER 未提及 nextPhaseId 字段，导致 God 永远不输出该字段

- **文件**: `src/god/god-router.ts:250-268`（system prompt）+ `src/god/god-prompt-generator.ts:211-238`（decision prompt）
- **问题**: 前几轮修复了大量 `nextPhaseId` 相关基础设施（Round 2 BUG-3 添加 Zod 字段、Round 3 BUG-2 修复 `evaluatePhaseTransition`），但 God 的 POST_REVIEWER 系统提示词（`god-router.ts:253-261`）中展示的 JSON schema 示例完全未包含 `nextPhaseId` 字段。`generateGodDecisionPrompt`（`god-prompt-generator.ts:211-238`）也未提及。LLM 遵循 prompt 中展示的 JSON 结构输出，不会自发输出未被要求的字段。因此：
  1. God 输出的 JSON 永远不包含 `nextPhaseId`
  2. `god-router.ts:78` 的 `d.nextPhaseId` 始终为 `undefined`，fallback 到 `'next'`
  3. `phase-transition.ts:59-61` 的 `godDecision.nextPhaseId` 查找永远不触发
  4. 复合任务的阶段转换永远只能顺序进行，无法跳过或回退阶段
- **预期**: POST_REVIEWER 系统提示词应在 JSON schema 示例中包含 `nextPhaseId` 字段（如 `"nextPhaseId": "phase-id" // optional, for phase_transition`），使 God 知道可以输出该字段。
- **建议修复**: 在 `buildRoutingSystemPrompt('POST_REVIEWER')` 的 JSON 示例中添加 `"nextPhaseId": "..."  // optional, specify target phase for phase_transition`。

### BUG-3 [P1] ROUTING_POST_CODE→ROUTE_TO_CODER 路径无 maxRounds 安全阈值守卫，可超越 maxRounds 上限

- **文件**: `src/engine/workflow-machine.ts:167-172`
- **问题**: `ROUTING_POST_CODE→ROUTE_TO_CODER` 转换虽然在 Round 9 修复后正确递增 round，但该转换没有 `canContinueRounds` guard。对比 `EVALUATING→CODING`（line 264-271）有 `guard: 'canContinueRounds'` 且 maxRounds 达到时转向 WAITING_USER。如果 God 持续返回 `retry_coder`（如 God adapter 失败导致 fallback `DEFAULT_POST_CODER` 为 `continue_to_review` 可以逃逸，但如果 schema 解析成功但 God 判断错误持续返回 `retry_coder`），round 会递增但永远不会被 maxRounds 拦截，因为 `ROUTING_POST_CODE` 状态没有 maxRounds 检查。流程为 `CODING → ROUTING_POST_CODE → ROUTE_TO_CODER → CODING → ...`，此循环中无任何节点检查 `round >= maxRounds`。
- **预期**: `ROUTING_POST_CODE→ROUTE_TO_CODER` 转换应添加 `guard: 'canContinueRounds'`，maxRounds 达到时转向 WAITING_USER。
- **建议修复**: 
  ```typescript
  ROUTE_TO_CODER: [
    {
      guard: 'canContinueRounds',
      target: 'CODING',
      actions: assign({ round: ({ context }) => context.round + 1, activeProcess: () => 'coder' as const }),
    },
    { target: 'WAITING_USER' }, // maxRounds reached
  ],
  ```

### BUG-4 [P2] convergence-service isSimilar 的 SIMILARITY_THRESHOLD 0.35 导致同主题不同轮次输出被误判为循环

- **文件**: `src/decision/convergence-service.ts:66,227`
- **问题**: `SIMILARITY_THRESHOLD = 0.35`（35% Jaccard 相似度）对于基于关键词的相似性检测过于宽松。当 reviewer 持续审查同一项目的不同方面（如修复 bug A 后继续检查 bug B），两轮输出共享大量项目/文件名关键词（如 `session`, `manager`, `adapter`, `convergence` 等），即使讨论的具体问题完全不同，关键词 Jaccard 相似度也容易超过 35%。`detectLoop` 在 line 196 的 `recentOutputs.some` 只要有一轮匹配就返回 `true`，触发 `loopDetected`。这导致正常的多轮修复被误判为循环，通过 `evaluate` 返回 `shouldTerminate: true, reason: 'loop_detected'` 过早终止任务。
- **预期**: 阈值应提高（如 0.55-0.65），或改用更精细的语义相似度方法（如比较 issue 列表而非全文关键词）。
- **建议修复**: 将 `SIMILARITY_THRESHOLD` 提高到 `0.55`，或在 `isSimilar` 中增加对 blocking issue 描述的权重，减少通用代码术语的影响。

---

VERDICT: BUGS_FOUND | P0:0 P1:3 P2:1

**修复优先级建议**：BUG-1（P1）和 BUG-3（P1）最先修复——前者导致已收敛任务收到虚假告警，后者是 maxRounds 安全阈值的绕过路径。BUG-2（P1）影响复合任务的阶段跳转能力，是一个功能残缺。BUG-4（P2）影响循环检测的精确度，需要实际测试数据校准阈值。

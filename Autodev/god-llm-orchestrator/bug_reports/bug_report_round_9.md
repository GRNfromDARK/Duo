确认完毕。以下是 Round 9 的完整 Bug 审计报告。

---

# Round 9 — Bug Audit Report

## BUG-1 [P1] ROUTING_POST_CODE → ROUTE_TO_CODER 无限重试循环

- **文件**: `src/engine/workflow-machine.ts:167-171`
- **问题**: 当 God 对 PostCoder 输出做出 `retry_coder` 决策时，映射为 `ROUTE_TO_CODER` 事件。在 `ROUTING_POST_CODE` 状态下，该事件转换回 `CODING` **但不增加 round 计数器**：
  ```typescript
  // ROUTING_POST_CODE → ROUTE_TO_CODER (line 167-171)
  ROUTE_TO_CODER: {
    target: 'CODING',
    actions: assign({
      activeProcess: () => 'coder' as const,
      // ← 缺少 round 递增！
    }),
  },
  ```
  对比 `ROUTING_POST_REVIEW → ROUTE_TO_CODER`（line 226-231）正确地增加了 round：
  ```typescript
  ROUTE_TO_CODER: {
    target: 'CODING',
    actions: assign({
      round: ({ context }) => context.round + 1,  // ✓ 有递增
      activeProcess: () => 'coder' as const,
    }),
  },
  ```
  且 `ROUTING_POST_CODE` 的 `ROUTE_TO_CODER` 转换也没有 `canContinueRounds` guard（该 guard 仅用于 `EVALUATING` 状态 line 265）。如果 Coder 反复产出空/无效输出，God 会持续决策 `retry_coder`，round 永远不递增，`maxRounds` 安全阈值永远无法触发，形成无限循环。
- **预期**: `ROUTING_POST_CODE → ROUTE_TO_CODER` 应递增 round（或设置独立的 retry 计数器/上限），确保有界退出。
- **建议修复**:
  ```typescript
  ROUTE_TO_CODER: {
    target: 'CODING',
    actions: assign({
      round: ({ context }) => context.round + 1,
      activeProcess: () => 'coder' as const,
    }),
  },
  ```

---

## BUG-2 [P2] phase-transition.ts 阻止从最后阶段向前阶段的反向转换

- **文件**: `src/god/phase-transition.ts:52-56`
- **问题**: 当 `currentPhase` 是 phases 数组中的最后一个阶段时，line 53 的守卫条件提前返回 `shouldTransition: false`：
  ```typescript
  const currentIndex = phases.findIndex(p => p.id === currentPhase.id);
  if (currentIndex === -1 || currentIndex >= phases.length - 1) {
    return { shouldTransition: false };  // ← 最后阶段一律阻止
  }
  ```
  这在 God 通过 `nextPhaseId` 指定回退到较早阶段时（如调试阶段需要回退到编码阶段），会导致有效的反向转换被错误阻止。guard 在到达 line 59 的 `phases.find(p => p.id === godDecision.nextPhaseId)` 查找之前就退出了。
- **预期**: 当 God 指定了有效的 `nextPhaseId` 时，即使当前处于最后阶段，也应允许转换到该目标阶段。
- **建议修复**:
  ```typescript
  if (currentIndex === -1) {
    return { shouldTransition: false };
  }
  // 允许 God 指定回退到任意阶段
  const nextPhase = (godDecision.nextPhaseId
    ? phases.find(p => p.id === godDecision.nextPhaseId)
    : undefined) ?? phases[currentIndex + 1];
  if (!nextPhase) {
    return { shouldTransition: false };
  }
  ```

---

## BUG-3 [P2] collectAdapterOutput 静默丢弃 error 类型 chunk

- **文件**: `src/god/god-router.ts:93-109`, `src/god/auto-decision.ts:49-65`, `src/god/god-convergence.ts:346-362`
- **问题**: 三个文件中重复存在的 `collectAdapterOutput` 函数仅收集 `type === 'text'` 和 `type === 'code'` 的 chunk：
  ```typescript
  if (chunk.type === 'text' || chunk.type === 'code') {
    chunks.push(chunk.content);
  }
  // type === 'error' 被静默忽略
  ```
  当使用 `TextStreamParser` 的适配器（Aider, Amazon Q, Goose）作为 God adapter 时，God 输出中匹配 ERROR_PATTERNS 的行（如 `"Error: the implementation has a fundamental flaw"` 这类以 Error:/fatal:/exception: 开头的推理文本）会被 TextStreamParser 分类为 `type: 'error'` 并被 collectAdapterOutput 丢弃。虽然 JSON 代码块（在 code fence 内）不受影响（作为 `type: 'code'` 收集），但 God 的推理文本部分丢失会导致审计日志中的 `rawOutput` 不完整。
- **预期**: `collectAdapterOutput` 应同时收集 `type === 'error'` 的 chunk 内容，因为这些在 God 输出上下文中是有效文本，不是真正的错误。
- **建议修复**:
  ```typescript
  if (chunk.type === 'text' || chunk.type === 'code' || chunk.type === 'error') {
    chunks.push(chunk.content);
  }
  ```

---

## VERDICT: BUGS_FOUND | P0:0 P1:1 P2:2

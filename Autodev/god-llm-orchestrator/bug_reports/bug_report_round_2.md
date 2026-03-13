现在我已经全面审查了源代码。以下是审计报告。

---

## Bug 审计报告（第 2 轮）

### BUG-1 [P1] God 系统提示词包含错误的 action 名称
- 文件: `src/god/god-system-prompt.ts:32-33`
- 问题: 系统提示词中 POST_CODER 列出了 `request_change`（不存在）和 `converged`（PostCoder 不允许），POST_REVIEWER 列出了 `send_back_to_coder`（应为 `route_to_coder`）和 `needs_user_input`（应为 `request_user_input`），且缺失 `phase_transition` 和 `loop_detected`。此系统提示通过 `--resume` 会话持久化保留，后续所有 God 调用都会受到错误上下文的影响。
- 预期: action 名称应与 `god-schemas.ts` 中 Zod schema 定义完全一致。
- 建议修复: 更新 `buildGodSystemPrompt` 中的 Decision Points 部分，POST_CODER 改为 `continue_to_review/retry_coder/request_user_input`，POST_REVIEWER 改为 `route_to_coder/converged/phase_transition/loop_detected/request_user_input`。

### BUG-2 [P1] God 会话 ID 在 duo resume 时从未恢复
- 文件: `src/ui/session-runner-state.ts:47-58`（`RestoredSessionRuntime` 缺少 `godSessionId`）+ `src/ui/components/App.tsx:434-445`（仅恢复 coder/reviewer，忽略 god）
- 问题: `buildRestoredSessionRuntime`（`session-runner-state.ts:274-275`）读取 `loaded.state.coderSessionId` 和 `loaded.state.reviewerSessionId`，但完全忽略 `loaded.state.godSessionId`。`App.tsx` 中的 resume 流程仅对 coder 和 reviewer 调用 `restoreSessionId`。Card D.1/D.3 实现的 God 持久化基础设施（`god-session-persistence.ts`、`tri-party-session.ts`、`SessionState.godSessionId`）全部未接入 UI 层。
- 预期: `duo resume` 应同时恢复 God adapter 的 CLI session，使 God 能通过 `--resume` 保持上下文连续性。
- 建议修复: 在 `RestoredSessionRuntime` 中添加 `godSessionId` 字段；在 `buildRestoredSessionRuntime` 中读取 `loaded.state.godSessionId`；在 `App.tsx` resume 流程中对 God adapter 调用 `restoreSessionId`。

### BUG-3 [P1] Zod 解析丢弃 PHASE_TRANSITION 的 nextPhaseId
- 文件: `src/types/god-schemas.ts:37-46` + `src/god/god-router.ts:73-79`
- 问题: `GodPostReviewerDecisionSchema` 未定义 `nextPhaseId` 字段。Zod 的 `.parse()` 默认剥离未知属性，因此即使 God 输出 JSON 中包含 `nextPhaseId`，经过 schema 解析后该字段被丢弃。`god-router.ts:74` 的类型断言 `as GodPostReviewerDecision & { nextPhaseId?: string }` 无法恢复已被剥离的数据，`d.nextPhaseId` 永远为 `undefined`，fallback `'next'` 永远被使用。
- 预期: `PHASE_TRANSITION` 事件应携带 God 指定的实际 phase ID。
- 建议修复: 在 `GodPostReviewerDecisionSchema` 中添加 `nextPhaseId: z.string().optional()` 字段；或使用 `.passthrough()` 保留未知字段。

### BUG-4 [P2] DriftDetector 无 seqProvider 时 seq 与 GodAuditLogger 冲突
- 文件: `src/god/drift-detector.ts:210`
- 问题: 当构造 `DriftDetector` 时未提供 `seqProvider`，`writeAuditEntry` 使用独立的 `this.seq++` 计数器。如果 `DriftDetector` 和 `GodAuditLogger` 写入同一 JSONL 文件，seq 编号会冲突/乱序，破坏审计日志的完整性。虽然添加了 `seqProvider` 选项，但无强制保障——调用方忘记传入 `seqProvider` 时 bug 静默发生。
- 预期: `DriftDetector` 应强制要求共享序列号源，或使用独立的审计文件。
- 建议修复: 将 `seqProvider` 设为必填参数；或在构造时校验若同时提供 `sessionDir` 则必须提供 `seqProvider`。

### BUG-5 [P2] God overlay 始终显示第一个阶段而非当前阶段
- 文件: `src/ui/god-overlay.ts:65-67`
- 问题: `createGodOverlayState` 中 `currentPhase` 始终取 `analysis.phases[0].id`（第一个阶段），无视实际进展。在 compound 类型任务经过多个阶段后，overlay 仍显示初始阶段。函数接收 `convergenceLog` 和 `auditEntries` 参数，本可从 `PHASE_TRANSITION` 类型的 audit entry 中提取当前阶段，但未使用。
- 预期: overlay 应显示实际当前阶段。
- 建议修复: 遍历 `auditEntries` 查找最近的 `PHASE_TRANSITION` 记录提取 `phaseId`，fallback 到 `phases[0].id`。

---

VERDICT: BUGS_FOUND | P0:0 P1:3 P2:2

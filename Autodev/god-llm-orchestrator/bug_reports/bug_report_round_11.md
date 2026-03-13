已完成全部关键源代码审查。以下是第 11 轮 Bug 审计报告。

---

## Bug 审计报告（第 11 轮）

### 前几轮修复状态确认

经逐一验证源代码，前 10 轮报告的所有 bug 均已修复：
- Round 10 BUG-1 (AlertManager checkProgress 全 0 误报): **已修复**，`alert-manager.ts:74-77` 添加 `every(e => e.blockingIssueCount === 0)` 排除
- Round 10 BUG-2 (POST_REVIEWER prompt 缺 nextPhaseId): **已修复**，`god-router.ts:260` 包含 `"nextPhaseId": "..."`
- Round 10 BUG-3 (ROUTING_POST_CODE maxRounds guard): **已修复**，`workflow-machine.ts:167-180` 添加 `canContinueRounds` guard 数组
- Round 10 BUG-4 (convergence-service SIMILARITY_THRESHOLD): **已修复**，`convergence-service.ts:66` 从 0.35 提高到 0.45
- Round 9 全部修复确认通过
- Round 8 BUG-1 (saveAndExit 覆盖 state): **已修复**，`session-manager.ts:206` 使用 `{ ...snapshot.state, ...state }` 合并
- Round 7, 6, 5, 4, 3, 2, 1 全部已修复

---

### BUG-1 [P1] ROUTING_POST_REVIEW → ROUTE_TO_CODER 转换缺少 canContinueRounds guard，God 路由可超越 maxRounds 上限

- **文件**: `src/engine/workflow-machine.ts:234-239`
- **问题**: `ROUTING_POST_REVIEW → ROUTE_TO_CODER` 转换递增 round 但没有 `canContinueRounds` guard。Round 10 BUG-3 的修复仅覆盖了 `ROUTING_POST_CODE → ROUTE_TO_CODER`（line 167-180，已添加 guard 数组），但 `ROUTING_POST_REVIEW` 是 God 编排的**主路径**（Reviewer 完成后 God 直接路由，绕过 EVALUATING），这条路径被遗漏。对比：
  - `ROUTING_POST_CODE → ROUTE_TO_CODER`（line 167-180）：**有** `canContinueRounds` guard ✓
  - `EVALUATING → NOT_CONVERGED`（line 271-283）：**有** `canContinueRounds` guard ✓
  - `ROUTING_POST_REVIEW → ROUTE_TO_CODER`（line 234-239）：**无** guard ✗
  
  当 God 在 reviewer 完成后决策 `route_to_coder` 时，如果 round 已达到 maxRounds，状态机仍会无条件转换到 CODING 并递增 round。`routePostReviewer`（god-router.ts）不检查 maxRounds，`evaluateConvergence` 虽然检查但是独立服务，不一定在此路径调用。
- **预期**: `ROUTING_POST_REVIEW → ROUTE_TO_CODER` 应与 `ROUTING_POST_CODE` 保持一致，添加 `canContinueRounds` guard。
- **建议修复**:
  ```typescript
  ROUTE_TO_CODER: [
    {
      guard: 'canContinueRounds',
      target: 'CODING',
      actions: assign({
        round: ({ context }) => context.round + 1,
        activeProcess: () => 'coder' as const,
      }),
    },
    {
      target: 'WAITING_USER', // maxRounds reached
    },
  ],
  ```

### BUG-2 [P2] ProcessManager.dispose() 在 kill() 完成前移除 parentExitHandler，留下孤儿进程窗口

- **文件**: `src/adapters/process-manager.ts:270-282`
- **问题**: `dispose()` 在 line 271 调用 `this.clearTimers()`，该方法（line 284-287）调用 `clearTimeoutAndHeartbeat()` 和 `clearParentExitHandler()`。parentExitHandler 在此刻被移除。随后 line 272-273 检查进程运行状态并调用 `await this.kill()`。Round 5 BUG-3 修复了 `kill()` 方法本身（改用 `clearTimeoutAndHeartbeat()` 保留 parentExitHandler 直到子进程确认退出），但 `dispose()` 在调用 `kill()` 之前已经通过 `clearTimers()` 移除了 parentExitHandler，使 `kill()` 的保护失效。在 `kill()` 等待子进程退出的 5 秒 SIGTERM 窗口内，如果父进程退出，子进程组不会收到 SIGKILL（因为 exit handler 已不存在），成为孤儿进程。
- **预期**: `dispose()` 应在 `kill()` 完成后才移除 parentExitHandler。
- **建议修复**:
  ```typescript
  async dispose(): Promise<void> {
    this.clearTimeoutAndHeartbeat(); // 仅清除 timeout/heartbeat
    if (this.running && this.child?.pid) {
      await this.kill(); // kill() 内部保留 parentExitHandler 直到子进程退出
    }
    this.clearParentExitHandler(); // kill 完成后再清除
    if (this.child) {
      this.child.stdout?.removeAllListeners();
      this.child.stderr?.removeAllListeners();
      this.child.removeAllListeners();
    }
    this.removeAllListeners();
    this.running = false;
  }
  ```

### BUG-3 [P2] consistency-checker 未检测 `needs_discussion` + `shouldTerminate: true` 的语义矛盾

- **文件**: `src/god/consistency-checker.ts:92-113` + `src/types/god-schemas.ts:51`
- **问题**: `GodConvergenceJudgmentSchema`（god-schemas.ts:51）定义 classification 可为 `'approved' | 'changes_requested' | 'needs_discussion'`。`checkConvergenceConsistency` 仅检查 `classification === 'approved' && blockingIssueCount > 0` 的矛盾（line 98），以及 `shouldTerminate` 与 criteria 的一致性。但未检查 `classification === 'needs_discussion' && shouldTerminate === true` 的语义矛盾——"需要讨论"与"应该终止"在语义上互相矛盾。如果 God 输出 `{ classification: 'needs_discussion', shouldTerminate: true, blockingIssueCount: 0, criteriaProgress: [all satisfied], reason: 'approved' }`，该判断通过所有一致性检查和 `evaluateConvergence` 的 enforcement 逻辑（line 170-175），导致任务在"需要讨论"时被终止。
- **预期**: `needs_discussion` + `shouldTerminate: true` 应被标记为 `semantic` 类型违规，与 `approved + blockingIssueCount > 0` 相同处理模式。
- **建议修复**: 在 `checkConvergenceConsistency` 中添加：
  ```typescript
  // Rule 4: classification: needs_discussion + shouldTerminate: true → semantic contradiction
  if (judgment.classification === 'needs_discussion' && judgment.shouldTerminate) {
    violations.push({
      type: 'semantic',
      description: 'classification is needs_discussion but shouldTerminate is true (contradiction)',
      autoFix: { shouldTerminate: false },
    });
  }
  ```

---

VERDICT: BUGS_FOUND | P0:0 P1:1 P2:2

**修复优先级建议**: BUG-1（P1）最先修复——这是 God 编排的主路径（ROUTING_POST_REVIEW），与 Round 10 BUG-3 属于同类遗漏，maxRounds 安全阈值可被完全绕过。BUG-2 和 BUG-3 按 P2 优先级处理。

# Card D.2: God Context 管理 增量 Prompt

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-012: God Context 管理 (AC-037, AC-038)
- AR-006: God context 由 CLI session + 增量 prompt 管理

从 `docs/requirements/god-llm-todolist.md` 读取：
- D-2 任务描述和验证标准

## 读取已有代码
- `src/god/god-prompt-generator.ts` — 动态 prompt 生成（Card B.1）
- `src/god/god-convergence.ts` — ConvergenceLogEntry（Card B.3）
- `src/god/god-session-persistence.ts` 或相关模块（Card D.1）
- `src/session/context-manager.ts` — 旧 ContextManager（参考）

## 任务

### 1. 实现增量 Prompt 管理
创建 `src/god/god-context-manager.ts`：

```typescript
export class GodContextManager {
  buildIncrementalPrompt(params: {
    latestCoderOutput: string;
    latestReviewerOutput?: string;
    convergenceLog: ConvergenceLogEntry[];
    round: number;
  }): string

  buildTrendSummary(convergenceLog: ConvergenceLogEntry[]): string
  shouldRebuildSession(tokenEstimate: number, limit: number): boolean
  buildSessionRebuildPrompt(convergenceLog: ConvergenceLogEntry[]): string
}
```

### 2. 增量信息策略
- God CLI 通过 `--resume` 维持对话历史
- 每轮 God prompt 只含增量信息：最新 Coder/Reviewer 输出 + convergenceLog 趋势摘要
- 不重复发送完整历史

### 3. 趋势摘要
长任务时 prompt 含趋势摘要（如 "issue 数从 5→3→2，趋势收敛"）而非完整历史

### 4. Session 重建
context 窗口耗尽时：
- 清除旧 session
- 以 convergenceLog 摘要开启新 session
- 保持决策连续性

### 5. 编写测试
在 `src/__tests__/god/god-context-manager.test.ts` 中：
- 单次 God prompt 大小 < 10k tokens（估算）
- 增量 prompt 不重复发送完整历史
- 趋势摘要正确生成
- session 重建后基于 convergenceLog 恢复决策连续性

## 验收标准
- [ ] AC-1: 单次 God prompt 大小合理（不含完整历史）
- [ ] AC-2: God session 重建后基于 convergenceLog 恢复决策连续性
- [ ] AC-3: 增量 prompt 不重复发送完整历史
- [ ] AC-4: 趋势摘要正确反映 convergenceLog 趋势
- [ ] AC-5: 所有测试通过: `npx vitest run`
- [ ] AC-6: 现有测试不受影响

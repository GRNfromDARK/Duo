# Card D.1: God 会话持久化 CLI Session ID

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-011: God 会话持久化 (AC-035, AC-036)
- AR-005: God session ID + convergenceLog 存入 snapshot.json
- NFR-007: God 持久化数据 < 10KB per session

从 `docs/requirements/god-llm-todolist.md` 读取：
- D-1 任务描述和验证标准

## 读取已有代码
- `src/session/session-manager.ts` — SessionManager, snapshot.json 读写
- `src/types/session.ts` — SessionConfig
- `src/god/task-init.ts` — GodTaskAnalysis（Card A.3）
- `src/god/god-convergence.ts` — ConvergenceLogEntry（Card B.3）
- `src/god/god-audit.ts` — GodAuditEntry
- `src/__tests__/session/session-manager.test.ts` — 现有测试模式

## 任务

### 1. 扩展 SessionState 接口
在会话状态中新增 God 相关字段：
```typescript
export interface GodSessionState {
  godSessionId: string | null;
  godAdapter: string | null;
  godTaskAnalysis: GodTaskAnalysis | null;  // 仅首轮写入
  godConvergenceLog: ConvergenceLogEntry[];  // 每轮追加
}
```

### 2. 持久化到 snapshot.json
- godSessionId + godAdapter 持久化到 snapshot.json（利用已有原子写入机制）
- godTaskAnalysis 仅首轮写入
- godConvergenceLog 每轮追加（轮次摘要 ≤ 200 chars）
- 持久化数据大小 < 10KB（NFR-007）

### 3. duo resume 恢复流程
```typescript
export async function restoreGodSession(
  snapshot: GodSessionState,
  adapterFactory: AdapterFactory,
): Promise<{ adapter: CLIAdapter; sessionId: string } | null>
```
- 读取 godSessionId → 实例化 God adapter → restoreSessionId → CLI `--resume` 恢复
- session 丢失时优雅降级（清除 ID，从头开始）

### 4. 编写测试
在 `src/__tests__/god/god-session-persistence.test.ts` 中：
- GodSessionState 正确写入 snapshot.json
- duo resume 后正确恢复 God session
- 持久化数据 < 10KB（20 轮长任务模拟）
- godTaskAnalysis 仅首轮写入
- godConvergenceLog 每轮追加
- session 丢失时优雅降级

## 验收标准
- [ ] AC-1: duo resume 后 God 通过 CLI session 恢复对话上下文
- [ ] AC-2: 持久化数据 < 10KB（20 轮长任务）
- [ ] AC-3: godTaskAnalysis 正确写入和读取
- [ ] AC-4: godConvergenceLog 每轮追加
- [ ] AC-5: session 丢失时优雅降级
- [ ] AC-6: 所有测试通过: `npx vitest run`
- [ ] AC-7: 现有测试不受影响

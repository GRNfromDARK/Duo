# Card D.3: 三方会话协调

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-013: 三方会话协调 (AC-039, AC-040, AC-041a)

从 `docs/requirements/god-llm-todolist.md` 读取：
- D-3 任务描述和验证标准

## 读取已有代码
- `src/session/session-manager.ts` — SessionManager（现有 coderSessionId, reviewerSessionId）
- `src/god/god-session-persistence.ts` 或相关模块（Card D.1）
- `src/types/session.ts` — SessionConfig
- `src/__tests__/session/session-manager.test.ts` — 现有测试
- `src/__tests__/session/session-resume.test.ts` — 现有恢复测试

## 任务

### 1. 扩展 SessionState 三方 session ID
```typescript
export interface TriPartySessionState {
  coderSessionId: string | null;
  reviewerSessionId: string | null;
  godSessionId: string | null;
}
```

### 2. 原子提交三方 session ID
三方 session ID 在 snapshot.json 中原子提交（利用已有原子写入）

### 3. duo resume 恢复三方
```typescript
export async function restoreTriPartySession(
  snapshot: TriPartySessionState,
  config: SessionConfig,
): Promise<{
  coder: CLIAdapter;
  reviewer: CLIAdapter;
  god: CLIAdapter;
}>
```
- 读取 session ID → 各自实例化 adapter → restoreSessionId → `--resume`

### 4. 容错处理
- 任一方 session 丢失时该方从头开始（清除 ID），不影响其他方
- God 与 Coder/Reviewer 使用同一 CLI 工具时 session 完全隔离

### 5. 编写测试
在 `src/__tests__/god/tri-party-session.test.ts` 中：
- 三方 session ID 原子提交
- 任一方 session 丢失不影响其他方
- God 与 Coder 使用同一 CLI 时 session 隔离
- duo resume 三方均正确恢复

## 验收标准
- [ ] AC-1: 三方 session ID 原子提交到 snapshot.json
- [ ] AC-2: 任一方 session 丢失不影响其他方
- [ ] AC-3: God 与 Coder 使用同一 CLI 时 session 隔离
- [ ] AC-4: duo resume 三方均正确恢复
- [ ] AC-5: 所有测试通过: `npx vitest run`
- [ ] AC-6: 现有测试不受影响

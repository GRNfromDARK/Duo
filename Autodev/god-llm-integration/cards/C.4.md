# Card C.4: God 会话持久化 + duo resume 恢复

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-011: God 会话持久化（AC-035, AC-036）
- AR-005: God session ID + convergenceLog 存入 snapshot.json

从 `docs/requirements/god-llm-integration-todolist.md` 读取：
- Phase C > C-4

## 读取已有代码
- `src/session/session-manager.ts` — SessionManager, SessionState 类型
- `src/ui/components/App.tsx` — session 保存和恢复逻辑
- `src/cli.ts` — duo resume 流程
- `src/god/god-session-persistence.ts` — restoreGodSession()
- `src/ui/session-runner-state.ts` — buildRestoredSessionRuntime()

## 任务

### 1. 扩展 SessionState 类型
在 `src/session/session-manager.ts` 中扩展 SessionState：
```typescript
interface SessionState {
  // ...existing fields...
  godAdapter?: string;           // God adapter 名称
  taskAnalysis?: GodTaskAnalysis; // 意图分析结果
  convergenceLog?: ConvergenceLogEntry[];
  degradationState?: DegradationState;
}
```

### 2. 修改 session 保存逻辑
在 `App.tsx` 的 saveState useEffect 中：
- 添加 godAdapter: config.god
- 添加 taskAnalysis: taskAnalysis state
- 添加 convergenceLog: convergenceLogRef.current
- 添加 degradationState: degradationManagerRef.current.getState()

### 3. 修改 duo resume 恢复逻辑
在 `App.tsx` 的 resume useEffect 中：
- 使用 `restoreGodSession()` 恢复 God adapter
- 恢复 taskAnalysis 到 React state
- 恢复 convergenceLog 到 ref
- 恢复 degradationState 到 DegradationManager
- 如果 God 已降级（L4），保持降级状态

### 4. buildRestoredSessionRuntime 扩展
在 `src/ui/session-runner-state.ts` 中：
- RestoredSessionRuntime 添加 taskAnalysis, convergenceLog, degradationState 字段

### 5. God audit log 在 resume 后继续
- 恢复后 audit log 的 seq 从上次保存的最大值 +1 开始递增

## 验收标准
- [ ] AC-1: SessionState 包含 God 相关字段
- [ ] AC-2: session 保存时包含 taskAnalysis, convergenceLog, degradationState
- [ ] AC-3: duo resume 后 God session 正确恢复
- [ ] AC-4: convergenceLog 和 taskAnalysis 恢复完整
- [ ] AC-5: 降级状态正确恢复
- [ ] AC-6: God audit log 的 seq 在 resume 后正确递增
- [ ] AC-7: 所有测试通过: `npx vitest run`

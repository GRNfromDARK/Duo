# Card C.2: DegradationManager 接入 — 4 级降级切换

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-G01: God CLI 降级（AC-055, AC-056, AC-057）
- FR-G04: 极端 fallback（AC-062, AC-063）

从 `docs/requirements/god-llm-integration-todolist.md` 读取：
- Phase C > C-2

## 读取已有代码
- `src/ui/components/App.tsx` — SessionRunner 中所有 God 调用点
- `src/god/degradation-manager.ts` — DegradationManager 完整实现
- `src/session/context-manager.ts` — v1 ContextManager
- `src/decision/convergence-service.ts` — v1 ConvergenceService
- `src/decision/choice-detector.ts` — v1 ChoiceDetector

## 任务

### 1. 在 SessionRunner 中创建 DegradationManager 实例
```typescript
const degradationManagerRef = useRef(
  new DegradationManager({
    fallbackServices: {
      contextManager: contextManagerRef.current,
      convergenceService: convergenceRef.current,
      choiceDetector: choiceDetectorRef.current,
    },
    restoredState: resumeSession?.state.degradationState,
  })
);
```

### 2. 统一包裹所有 God 调用点
创建 helper 函数：
```typescript
async function withGodFallback<T>(
  godCall: () => Promise<T>,
  fallbackCall: () => T,
  errorKind: GodErrorKind,
): Promise<{ result: T; usedGod: boolean }> {
  const dm = degradationManagerRef.current;
  if (dm.isGodDisabled()) {
    return { result: fallbackCall(), usedGod: false };
  }
  try {
    const result = await godCall();
    dm.recordSuccess();
    return { result, usedGod: true };
  } catch (err) {
    const action = dm.handleError({ kind: errorKind, message: String(err) });
    if (action.type === 'retry' || action.type === 'retry_with_correction') {
      // 重试一次
      try {
        const result = await godCall();
        dm.recordSuccess();
        return { result, usedGod: true };
      } catch {
        // 重试失败 → fallback
      }
    }
    // 显示降级通知
    if (action.notification) {
      addMessage({ role: 'system', content: action.notification.message, timestamp: Date.now() });
    }
    return { result: fallbackCall(), usedGod: false };
  }
}
```

### 3. 应用到所有 God 调用点
回顾并确保以下调用点使用 `withGodFallback`：
- TASK_INIT（A.2）
- ROUTING_POST_CODE（B.1）
- ROUTING_POST_REVIEW（B.2）
- EVALUATING（B.3）
- Prompt 生成（B.4）
- WAITING_USER 代理决策（C.1）

### 4. 降级通知 UI
- L2/L3 降级：在消息流中显示 "God retrying..." / "God fallback activated"
- L4 降级：显示 "God disabled for this session, using v1 components"

### 5. 降级状态持久化
- 在 session state 保存时包含 degradationState
- duo resume 时恢复 degradationState

## 验收标准
- [ ] AC-1: DegradationManager 在 SessionRunner 中正确初始化
- [ ] AC-2: 所有 God 调用点使用 withGodFallback 包裹
- [ ] AC-3: God 单次失败时自动重试（L2/L3）
- [ ] AC-4: 连续 3 次失败后禁用 God，全量 fallback 到 v1 组件（L4）
- [ ] AC-5: 降级通知在 UI 消息流中展示
- [ ] AC-6: 降级状态在 session state 中持久化
- [ ] AC-7: duo resume 时降级状态正确恢复
- [ ] AC-8: 所有测试通过: `npx vitest run`

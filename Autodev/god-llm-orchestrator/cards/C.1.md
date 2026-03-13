# Card C.1: God CLI 降级 + 极端兜底

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-G01: God CLI 降级 (AC-055, AC-056, AC-057)
- FR-G04: 极端兜底 (AC-062, AC-063)
- AR-004: 旧组件保留为 fallback

从 `docs/requirements/god-llm-todolist.md` 读取：
- C-1 任务描述和验证标准

## 读取已有代码
- `src/decision/convergence-service.ts` — 旧 ConvergenceService（fallback 目标）
- `src/decision/choice-detector.ts` — 旧 ChoiceDetector（fallback 目标）
- `src/session/context-manager.ts` — 旧 ContextManager（fallback 目标）
- `src/god/god-router.ts` — God 路由（Card B.2 已创建）
- `src/god/god-convergence.ts` — God 收敛判断（Card B.3 已创建）
- `src/engine/workflow-machine.ts` — XState 状态机
- `src/god/god-audit.ts` — appendAuditLog

## 任务

### 1. 创建降级管理器
创建 `src/god/degradation-manager.ts`：

```typescript
export type DegradationLevel = 'L1' | 'L2' | 'L3' | 'L4';

export interface DegradationState {
  level: DegradationLevel;
  consecutiveFailures: number;
  godDisabled: boolean;      // L4 时为 true
  fallbackActive: boolean;
  lastError?: string;
}

export class DegradationManager {
  handleGodFailure(error: GodError): DegradationAction
  handleGodSuccess(): void
  isGodAvailable(): boolean
  getState(): DegradationState
}
```

### 2. 四级降级策略
- **L1 瞬时**：正常处理，无降级
- **L2 可重试**：重试 1 次 → 失败则 fallback
- **L3 不可重试**：纠错重试 → 失败则 fallback
- **L4 持续失败**：本会话禁用 God，全程 fallback

### 3. Fallback 切换
```typescript
export interface FallbackServices {
  contextManager: ContextManager;
  convergenceService: ConvergenceService;
  choiceDetector: ChoiceDetector;
}

export function switchToFallback(services: FallbackServices): void
```
- 切换到旧组件 < 100ms
- L4 本会话不恢复，下一轮自动尝试（非 L4）

### 4. 三层兜底
God 失败 → fallback → ERROR → WAITING_USER → duo resume
- God 失败不导致 Coder 已写入磁盘的代码丢失
- 任何失败组合最终都进入 WAITING_USER 而非无提示退出

### 5. 降级通知
- L2: StatusBar retrying 指示
- 首次 fallback: 系统消息通知
- L4: 持续 Fallback mode 指示

### 6. 编写测试
在 `src/__tests__/god/degradation-manager.test.ts` 中：
- 降级切换 < 100ms
- 降级后工作流不中断
- L4 降级事件写入 audit log
- God 失败不丢失 Coder 已写入的代码
- 任何失败组合进入 WAITING_USER
- L2/L3 重试机制正常

## 验收标准
- [ ] AC-1: 降级切换 < 100ms
- [ ] AC-2: 降级后工作流不中断（fallback 正常运行）
- [ ] AC-3: L4 降级事件写入 audit log
- [ ] AC-4: God 失败不丢失 Coder 已写入的代码
- [ ] AC-5: 任何失败组合进入 WAITING_USER 而非无提示退出
- [ ] AC-6: L2/L3 重试机制正常（含格式纠错提示）
- [ ] AC-7: 所有测试通过: `npx vitest run`
- [ ] AC-8: 现有测试不受影响

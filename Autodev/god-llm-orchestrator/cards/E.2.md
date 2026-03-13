# Card E.2: 异常告警

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-021: 异常告警 (AC-053, AC-054)

从 `docs/requirements/god-llm-todolist.md` 读取：
- E-2 任务描述和验证标准

## 读取已有代码
- `src/god/god-audit.ts` — GodAuditLogger（Card E.1 已完善）
- `src/god/loop-detector.ts` — LoopDetectionResult（Card B.4）
- `src/god/degradation-manager.ts` — DegradationManager（Card C.1）
- `src/types/ui.ts` — UI 类型定义
- `src/ui/` — 现有 UI 组件

## 任务

### 1. 创建告警管理器
创建 `src/god/alert-manager.ts`：

```typescript
export type AlertLevel = 'Warning' | 'Critical';
export type AlertType = 'GOD_LATENCY' | 'STAGNANT_PROGRESS' | 'GOD_ERROR';

export interface Alert {
  type: AlertType;
  level: AlertLevel;
  message: string;
  timestamp: string;
  data?: unknown;
}

export class AlertManager {
  checkLatency(latencyMs: number): Alert | null
  checkProgress(convergenceLog: ConvergenceLogEntry[]): Alert | null
  checkGodError(error: GodError): Alert | null
}
```

### 2. 三条告警规则
- **GOD_LATENCY**: God 调用 > 30s → Warning → StatusBar spinner
- **STAGNANT_PROGRESS**: 连续 3 轮停滞 → Warning → 阻断式卡片
- **GOD_ERROR**: God API 失败 → Critical → 系统消息

### 3. 告警行为
- Warning 级：不打断工作流，在 StatusBar 显示
- Critical 级：暂停工作流等待用户确认

### 4. 编写测试
在 `src/__tests__/god/alert-manager.test.ts` 中：
- God 调用 > 30s 产生 GOD_LATENCY Warning
- 连续 3 轮停滞产生 STAGNANT_PROGRESS Warning
- God 失败产生 GOD_ERROR Critical
- Warning 级不阻断工作流
- Critical 级暂停工作流

## 验收标准
- [ ] AC-1: God 调用 > 30s 产生 latency warning
- [ ] AC-2: 连续 3 轮停滞产生 stagnant progress warning
- [ ] AC-3: God 失败产生 Critical 告警
- [ ] AC-4: Warning 级不阻断工作流
- [ ] AC-5: Critical 级暂停工作流等待确认
- [ ] AC-6: 所有测试通过: `npx vitest run`
- [ ] AC-7: 现有测试不受影响

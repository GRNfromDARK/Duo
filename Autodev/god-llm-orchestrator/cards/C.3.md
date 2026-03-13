# Card C.3: God 渐进漂移检测

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-G03: 渐进漂移检测 (AC-060, AC-061)

从 `docs/requirements/god-llm-todolist.md` 读取：
- C-3 任务描述和验证标准

## 读取已有代码
- `src/god/consistency-checker.ts` — 一致性校验（Card C.2）
- `src/god/degradation-manager.ts` — 降级管理（Card C.1）
- `src/decision/convergence-service.ts` — 旧 ConvergenceService
- `src/god/god-audit.ts` — appendAuditLog

## 任务

### 1. 创建漂移检测器
创建 `src/god/drift-detector.ts`：

```typescript
export type DriftType = 'god_too_permissive' | 'confidence_declining';
export type DriftSeverity = 'mild' | 'severe';

export interface DriftDetectionResult {
  detected: boolean;
  type?: DriftType;
  severity?: DriftSeverity;
  details?: string;
}

export class DriftDetector {
  recordDecision(godDecision: GodDecision, localDecision: string): void
  checkDrift(): DriftDetectionResult
}
```

### 2. 检测信号
- **god_too_permissive**: God 连续 3 次 approved 但 ConvergenceService 判定 changes_requested
- **confidence_declining**: God 置信度连续 4 轮递减

### 3. 处理策略
- 轻度漂移（mild）：记录告警到 audit log
- 严重漂移（severe）：临时切换 fallback 2 轮后恢复

### 4. 自动恢复
```typescript
export interface DriftRecovery {
  fallbackRoundsRemaining: number;
  autoRecover(): boolean;  // 2 轮后自动恢复
}
```

### 5. 编写测试
在 `src/__tests__/god/drift-detector.test.ts` 中：
- 连续 3 次 approved 与本地分歧触发 god_too_permissive
- 置信度连续 4 轮递减触发 confidence_declining
- 严重漂移切换 fallback 2 轮后自动恢复
- 漂移事件写入 audit log
- 非漂移场景不触发

## 验收标准
- [ ] AC-1: 连续 3 次 approved 与本地分歧触发 god_too_permissive
- [ ] AC-2: 置信度连续 4 轮递减触发 confidence_declining
- [ ] AC-3: 严重漂移切换 fallback 2 轮后自动恢复
- [ ] AC-4: 漂移事件写入 audit log
- [ ] AC-5: 所有测试通过: `npx vitest run`
- [ ] AC-6: 现有测试不受影响

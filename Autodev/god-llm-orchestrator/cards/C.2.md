# Card C.2: God 输出一致性校验

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-G02: God 输出一致性校验 (AC-058, AC-059)

从 `docs/requirements/god-llm-todolist.md` 读取：
- C-2 任务描述和验证标准

## 读取已有代码
- `src/god/god-router.ts` — God 路由决策（Card B.2）
- `src/god/god-convergence.ts` — God 收敛判断（Card B.3）
- `src/types/god-schemas.ts` — God schema 定义
- `src/decision/convergence-service.ts` — 旧 ConvergenceService（同向验证）
- `src/god/degradation-manager.ts` — 降级管理（Card C.1）
- `src/god/god-audit.ts` — appendAuditLog

## 任务

### 1. 创建一致性校验器
创建 `src/god/consistency-checker.ts`：

```typescript
export interface ConsistencyViolation {
  type: 'structural' | 'semantic' | 'low_confidence';
  description: string;
  autoFix?: unknown;  // 自动修正值
}

export interface ConsistencyResult {
  valid: boolean;
  violations: ConsistencyViolation[];
  corrected?: unknown;  // 修正后的决策
}

export function checkConsistency(decision: GodDecision): ConsistencyResult
```

### 2. 纯规则检测（< 1ms，无 LLM）
- `classification: approved` 且 `blockingIssueCount > 0` → 矛盾
- `shouldTerminate: true` 且 `reason: null` → 缺少原因
- `confidenceScore < 0.5` 且 `shouldTerminate: true` → 低置信度终止

### 3. 处理策略
- 结构矛盾：重试 → fallback
- 语义矛盾：自动修正（以可计数字段为权威）
- 低置信度终止：偏保守（不终止）

### 4. 同向验证
```typescript
export function crossValidate(
  godClassification: string,
  localClassification: string,
): { agree: boolean; source: 'god' | 'local' }
```
- God classification 与旧 ConvergenceService.classify() 交叉验证
- 分歧时以本地为准

### 5. 编写测试
在 `src/__tests__/god/consistency-checker.test.ts` 中：
- 一致性校验 < 1ms
- 检测 approved + blockingIssueCount > 0 矛盾
- 低置信度终止被修正为不终止
- 幻觉事件写入 audit log
- 同向验证分歧时以本地为准

## 验收标准
- [ ] AC-1: 一致性校验 < 1ms
- [ ] AC-2: 检测到 approved + blockingIssueCount > 0 矛盾
- [ ] AC-3: 低置信度终止被修正为不终止
- [ ] AC-4: 幻觉事件写入 audit log
- [ ] AC-5: 同向验证分歧时以本地为准
- [ ] AC-6: 所有测试通过: `npx vitest run`
- [ ] AC-7: 现有测试不受影响

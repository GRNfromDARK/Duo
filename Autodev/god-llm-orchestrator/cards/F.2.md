# Card F.2: ReclassifyOverlay 运行中重分类

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-002a: ReclassifyOverlay (AC-010, AC-011, AC-012)

从 `docs/requirements/god-llm-todolist.md` 读取：
- F-2 任务描述和验证标准

## 读取已有代码
- `src/god/task-init.ts` — GodTaskAnalysis（Card A.3）
- `src/types/god-schemas.ts` — TaskTypeSchema
- `src/ui/overlay-state.ts` — 现有 overlay 状态管理
- `src/engine/workflow-machine.ts` — 状态机（CODING/REVIEWING/WAITING_USER）
- `src/god/god-audit.ts` — appendAuditLog

## 任务

### 1. 创建 ReclassifyOverlay 状态
创建 `src/ui/reclassify-overlay.ts`：

```typescript
export interface ReclassifyOverlayState {
  visible: boolean;
  currentType: TaskType;
  currentRound: number;
  selectedType: TaskType;
  availableTypes: TaskType[];
}

export function createReclassifyState(
  currentType: TaskType,
  currentRound: number,
): ReclassifyOverlayState

export function handleReclassifyKey(
  state: ReclassifyOverlayState,
  key: string,
): { state: ReclassifyOverlayState; action?: 'confirm' | 'cancel' }
```

### 2. 触发条件
- Ctrl+R 在 CODING/REVIEWING/WAITING_USER 状态均可触发
- 全屏 overlay 显示

### 3. 重分类逻辑
选择新类型后：
- God 重新规划后续阶段（< 3s 目标）
- 保留已有 RoundRecord
- 写入 audit log

### 4. 编写测试
在 `src/__tests__/ui/reclassify-overlay.test.ts` 中：
- Ctrl+R 触发 overlay 显示
- 选择新类型并确认
- 取消恢复原状
- 已有 RoundRecord 保留
- 重分类事件写入 audit log

## 验收标准
- [ ] AC-1: Ctrl+R 在三种状态（CODING/REVIEWING/WAITING_USER）均可触发
- [ ] AC-2: 重分类后保留已有 RoundRecord
- [ ] AC-3: 重分类事件写入 audit log
- [ ] AC-4: 所有测试通过: `npx vitest run`
- [ ] AC-5: 现有测试不受影响

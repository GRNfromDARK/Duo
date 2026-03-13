# Card F.5: God Overlay 控制面板 + Resume 摘要

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-015: God Overlay 控制面板 (AC-042, AC-043)
- FR-016: Resume 摘要 (AC-044, AC-045)

从 `docs/requirements/god-llm-todolist.md` 读取：
- F-5 任务描述和验证标准

## 读取已有代码
- `src/god/god-convergence.ts` — convergenceLog（Card B.3）
- `src/god/task-init.ts` — GodTaskAnalysis（Card A.3）
- `src/god/god-audit.ts` — GodAuditLogger（Card E.1）
- `src/ui/overlay-state.ts` — 现有 overlay 状态管理
- `src/ui/keybindings.ts` — 现有键绑定

## 任务

### 1. 创建 God Overlay 状态
创建 `src/ui/god-overlay.ts`：

```typescript
export interface GodOverlayState {
  visible: boolean;
  currentTaskType: TaskType;
  currentPhase?: string;
  confidenceScore?: number;
  decisionHistory: GodAuditEntry[];
  convergenceLog: ConvergenceLogEntry[];
}

export function createGodOverlayState(
  analysis: GodTaskAnalysis,
  auditEntries: GodAuditEntry[],
  convergenceLog: ConvergenceLogEntry[],
): GodOverlayState

export function handleGodOverlayKey(
  state: GodOverlayState,
  key: string,
): { state: GodOverlayState; action?: GodOverlayAction }

export type GodOverlayAction =
  | { type: 'reclassify' }
  | { type: 'skip_phase' }
  | { type: 'force_converge' }
  | { type: 'pause_auto_decision' };
```

### 2. Ctrl+G 控制面板
- 显示当前任务类型、阶段、置信度、决策历史
- 手动干预快捷键：
  - [R] 重分类
  - [S] 跳过阶段
  - [F] 强制收敛
  - [P] 暂停代理决策
- Ctrl+G 在所有非 overlay 状态下可用
- 手动干预操作写入 audit log

### 3. Resume 摘要
创建 `src/ui/resume-summary.ts`：

```typescript
export interface ResumeSummaryState {
  events: ResumeSummaryEvent[];
  visible: boolean;
}

export type ResumeSummaryEvent = {
  type: 'task_init' | 'phase_transition' | 'auto_decision';
  timestamp: string;
  summary: string;
};

export function buildResumeSummary(
  auditLog: GodAuditEntry[],
  convergenceLog: ConvergenceLogEntry[],
): ResumeSummaryState
```

- `duo resume` 后显示 God 决策历史摘要卡片
- 摘要包含所有 TASK_INIT、阶段转换、代理决策事件
- < 1s 内生成和显示

### 4. 编写测试
在 `src/__tests__/ui/god-overlay.test.ts` 和 `src/__tests__/ui/resume-summary.test.ts` 中：
- Ctrl+G 在非 overlay 状态可用
- 手动干预操作生成正确 action
- resume 摘要包含所有关键决策事件
- resume 摘要生成 < 1s

## 验收标准
- [ ] AC-1: Ctrl+G 在非 overlay 状态可用
- [ ] AC-2: 手动干预操作写入 audit log
- [ ] AC-3: resume 摘要包含所有关键决策事件
- [ ] AC-4: resume 摘要生成 < 1s
- [ ] AC-5: 所有测试通过: `npx vitest run`
- [ ] AC-6: 现有测试不受影响

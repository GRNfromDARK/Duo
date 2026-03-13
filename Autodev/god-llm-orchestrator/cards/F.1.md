# Card F.1: TaskAnalysisCard 意图回显

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-001a: TaskAnalysisCard (AC-004, AC-005, AC-006, AC-007)

从 `docs/requirements/god-llm-todolist.md` 读取：
- F-1 任务描述和验证标准

## 读取已有代码
- `src/god/task-init.ts` — GodTaskAnalysis（Card A.3）
- `src/types/god-schemas.ts` — TaskTypeSchema
- `src/ui/` — 现有 Ink UI 组件
- `src/types/ui.ts` — UI 类型定义

## 任务

### 1. 创建 TaskAnalysisCard 组件
创建 `src/ui/task-analysis-card.ts`（Ink React 组件状态逻辑）：

```typescript
export interface TaskAnalysisCardState {
  analysis: GodTaskAnalysis;
  selectedType: TaskType;
  countdown: number;       // 8 秒倒计时
  countdownPaused: boolean;
  confirmed: boolean;
}

export function createTaskAnalysisCardState(analysis: GodTaskAnalysis): TaskAnalysisCardState
export function handleKeyPress(state: TaskAnalysisCardState, key: string): TaskAnalysisCardState
export function tickCountdown(state: TaskAnalysisCardState): TaskAnalysisCardState
```

### 2. 交互逻辑
- 显示任务类型分类、阶段规划、预估轮次
- 8 秒倒计时自动以 God 推荐类型开始
- ↑↓ 选择（暂停倒计时）
- 数字键 1-4 直接选择
- Enter 确认
- Space 使用推荐

### 3. 性能要求
- 卡片在 God 分析完成后 < 200ms 内显示（纯 UI 渲染）

### 4. 编写测试
在 `src/__tests__/ui/task-analysis-card.test.ts` 中：
- 初始状态正确（countdown: 8, selectedType: 推荐类型）
- 8 秒无操作自动确认
- ↑↓ 选择暂停倒计时
- 数字键 1-4 直接选择并确认
- Enter 确认当前选择
- Space 使用推荐

## 验收标准
- [ ] AC-1: 卡片状态创建 < 200ms
- [ ] AC-2: 8 秒无操作自动以推荐类型确认
- [ ] AC-3: ↑↓ 选择暂停倒计时
- [ ] AC-4: 数字键 1-4 直接选择并确认
- [ ] AC-5: 所有测试通过: `npx vitest run`
- [ ] AC-6: 现有测试不受影响

# Card A.3: TaskAnalysisCard UI + 自动确认机制

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-001a: 意图回显 + 软确认（AC-004, AC-005, AC-006, AC-007）

从 `docs/requirements/god-llm-integration-todolist.md` 读取：
- Phase A > A-3

## 读取已有代码
- `src/ui/components/App.tsx` — SessionRunner 中 TASK_INIT useEffect（Card A.2 实现）
- `src/types/god-schemas.ts` — GodTaskAnalysis 类型定义
- `src/ui/components/MainLayout.tsx` — 主布局组件

## 任务

### 1. 创建 TaskAnalysisCard 组件
新建 `src/ui/components/TaskAnalysisCard.tsx`：

1. 接收 props：
   ```typescript
   interface TaskAnalysisCardProps {
     analysis: GodTaskAnalysis;
     onConfirm: (taskType: string) => void;
     onTimeout: () => void;
   }
   ```

2. 展示内容：
   - 任务类型分类（标记推荐项）
   - 预估轮次范围
   - terminationCriteria 列表
   - confidence 分数

3. 8 秒倒计时自动确认：
   - 倒计时进度条
   - 用户按 ↑↓ 时暂停倒计时
   - 数字键 1-4 直接选择任务类型
   - Enter 确认当前选择
   - 倒计时结束 → 自动以推荐类型确认

4. UI 布局参考需求文档中的设计稿（边框卡片样式）

### 2. 集成到 SessionRunner
在 `App.tsx` 中：
- TASK_INIT 完成后、CODING 开始前，渲染 TaskAnalysisCard
- 使用 React state 控制显示/隐藏
- 用户确认后 send TASK_INIT_COMPLETE

## 验收标准
- [ ] AC-1: TaskAnalysisCard 在 God 分析完成后显示
- [ ] AC-2: 展示任务类型、轮次、criteria、confidence
- [ ] AC-3: 8 秒倒计时后自动以推荐类型开始
- [ ] AC-4: 用户按 ↑↓ 时暂停倒计时
- [ ] AC-5: 数字键 1-4 直接选择并确认
- [ ] AC-6: 所有测试通过: `npx vitest run`

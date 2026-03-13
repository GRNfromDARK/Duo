# Card A.1: SetupWizard 添加 God 角色选择步骤

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-006: God Adapter 配置（AC-021, AC-022）
- FR-001a: 意图回显 + 软确认

从 `docs/requirements/god-llm-integration-todolist.md` 读取：
- Phase A > A-1

## 读取已有代码
- `src/ui/components/SetupWizard.tsx` — 当前 5 步向导（select-dir → select-coder → select-reviewer → enter-task → confirm）
- `src/ui/components/App.tsx` — SessionConfig 中的 god 字段已存在但 SetupWizard 未使用
- `src/types/session.ts` — SessionConfig 类型定义
- `src/ui/components/StatusBar.tsx` — StatusBar 组件

## 任务

### 1. SetupWizard 添加 God 选择步骤
在 `SetupWizard.tsx` 中：

1. 在 `SetupPhase` 类型中添加 `'select-god'`
2. 在 `PHASE_LABELS` 添加 `'select-god': 'God'`
3. 在 `PHASE_ORDER` 中将 `'select-god'` 插入到 `'select-reviewer'` 之后、`'enter-task'` 之前
4. 添加 `select-god` 步骤的渲染逻辑：
   - 复用 `CLISelector` 组件
   - label: `"Select God (orchestrator):"`
   - 在选项列表顶部添加一个 "Same as Reviewer (default)" 选项
   - 选择后设置 `config.god`

5. 修改确认页面 `ConfirmScreen`：
   - 在 Reviewer 行下方显示 God 角色
   - 显示格式与 Coder/Reviewer 一致

6. 修改 `onConfirm` 回调：
   - 如果用户选择了 "Same as Reviewer"，`god` 字段设为 `config.reviewer`

### 2. StatusBar 展示 God 信息
在 `StatusBar.tsx` 中：
- 添加 God adapter 名称展示（如果与 Reviewer 不同时显示）

## 验收标准
- [ ] AC-1: SetupWizard 新增 God 选择步骤，ProgressStepper 显示 6 步（Project → Coder → Reviewer → God → Task → Confirm）
- [ ] AC-2: God 选择列表包含 "Same as Reviewer (default)" 作为第一项
- [ ] AC-3: 选择 "Same as Reviewer" 时 god 字段跟随 reviewer 的值
- [ ] AC-4: 确认页面显示 God 角色
- [ ] AC-5: 所有测试通过: `npx vitest run`
- [ ] AC-6: 现有测试不受影响

# Card E.4: 状态栏

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.4 > FR-018: 状态指示

从 `todolist.md` 读取：
- Phase E > E-4：状态栏

## 读取已有代码
- `src/ui/components/` — 现有 UI 组件
- `src/engine/workflow-machine.ts` — 状态机状态

## 任务
1. 实现顶部 1 行状态栏 `src/ui/components/StatusBar.tsx`:
   - App 名称 / 项目路径 / 轮次 (N/Max) / 当前活跃 Agent + 状态

2. 状态图标:
   - ◆ Active（绿色 spinner）
   - ◇ Idle
   - ⚠ Error（红色）
   - ◈ Routing（黄色）
   - ⏸ Interrupted

3. 显示累计 token 估算

4. Spinner 动画在 LLM 工作时持续显示

5. 编写完整测试

## 验收标准
- [ ] AC-1: 状态栏始终 1 行，不溢出
- [ ] AC-2: spinner 在 LLM 活跃时正确显示
- [ ] AC-3: 轮次显示格式 "Round N/Max" 正确
- [ ] AC-4: token 估算数值更新
- [ ] AC-5: 所有测试通过: `npm test`

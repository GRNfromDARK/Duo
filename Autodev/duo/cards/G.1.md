# Card G.1: 选择题检测 + 打断过程展示

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-2.2 > FR-024: 选择题检测过程展示
- Section 4 > CD-2.2 > FR-025: 打断→重新决策过程展示

从 `todolist.md` 读取：
- Phase G > G-1：选择题检测 + 打断过程展示

## 读取已有代码
- `src/decision/choice-detector.ts` — 选择题检测逻辑
- `src/engine/workflow-machine.ts` — 状态机（打断状态）
- `src/ui/components/MessageView.tsx` — 消息展示

## 任务
1. 选择题检测展示:
   - Minimal 模式一行: `· [Router] Choice detected → Forwarding to X`
   - Verbose 模式: 展示检测原因和路由逻辑

2. 打断展示:
   - `⚠ INTERRUPTED - <Agent> process terminated (output: N chars)`
   - `> Waiting for your instructions...`

3. 实现系统消息组件 `src/ui/components/SystemMessage.tsx`:
   - 路由消息
   - 打断消息
   - 明确指示系统等待用户输入

4. 编写完整测试

## 验收标准
- [ ] AC-1: Minimal 模式一行路由结果
- [ ] AC-2: Verbose 模式完整路由逻辑
- [ ] AC-3: 打断显示已输出内容量
- [ ] AC-4: 等待用户输入提示明确
- [ ] AC-5: 所有测试通过: `npm test`

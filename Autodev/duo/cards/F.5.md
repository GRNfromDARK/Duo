# Card F.5: 快捷键体系

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.4 > FR-022: 快捷键体系

从 `todolist.md` 读取：
- Phase F > F-5：快捷键体系

## 读取已有代码
- `src/ui/components/` — 现有 UI 组件
- `src/ui/components/InputArea.tsx` — 输入区域

## 任务
1. 实现快捷键管理器 `src/ui/keybindings.ts`:
   - Ctrl+C: 打断当前 LLM（单击）/ 退出（双击）
   - Ctrl+N: 新建会话
   - Ctrl+I: 查看上下文摘要（overlay）
   - Ctrl+V: 切换 Minimal/Verbose 模式
   - Ctrl+T: 查看事件时间线（overlay）
   - Ctrl+L: 清屏（不清历史）
   - j/k 或 ↑/↓: 滚动消息
   - G: 跳到最新消息
   - Enter: 展开/收起代码块
   - Tab: 路径补全
   - ?: 帮助/快捷键列表
   - /: 搜索消息历史
   - Esc: 关闭 overlay / 返回上层

2. 实现 Overlay 组件:
   - 上下文摘要 overlay
   - 事件时间线 overlay
   - 帮助列表 overlay

3. 搜索功能: / 搜索消息历史

4. 快捷键不与终端默认行为冲突

5. 编写完整测试

## 验收标准
- [ ] AC-1: 所有 13 个快捷键功能正常
- [ ] AC-2: ? 键显示完整快捷键列表
- [ ] AC-3: overlay（上下文/时间线/帮助）正确展示和关闭
- [ ] AC-4: / 搜索消息历史功能正常
- [ ] AC-5: 所有测试通过: `npm test`

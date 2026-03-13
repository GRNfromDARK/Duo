# Card E.1: Ink 主界面布局 + 消息展示

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.4 > FR-014: 群聊式消息展示窗口

从 `todolist.md` 读取：
- Phase E > E-1：Ink 主界面布局 + 消息展示

## 读取已有代码
- `src/ui/` — 检查现有 UI 组件
- `src/adapters/output-stream-manager.ts` — 输出流管理

## 任务
1. 使用 Ink (React) 实现主界面三区域布局:
   - 状态栏（顶部）
   - 消息区域（中部）
   - 输入区域（底部）

2. 消息展示组件 `src/ui/components/MessageView.tsx`:
   - 角色标识（颜色+边界标记 ┃║│·>）
   - 角色名+职责
   - 时间戳
   - 内容

3. 消息样式:
   - Claude=蓝 ┃, Codex=绿 ║, Gemini=橙 │, System=黄 ·, User=白 >
   - 颜色方案色盲友好（颜色+形状双重编码）

4. 消息流滚动:
   - j/k 或 ↑/↓ 逐行
   - PgUp/PgDn 翻页
   - G 跳到最新

5. 最小终端尺寸 80x24

6. 使用 ink-testing-library 编写组件测试

## 验收标准
- [ ] AC-1: 三区域布局在 80x24 终端中正确渲染
- [ ] AC-2: 不同角色消息样式正确（颜色+边界标记）
- [ ] AC-3: 滚动操作（j/k/↑/↓/PgUp/PgDn/G）全部正常
- [ ] AC-4: ink-testing-library 组件测试通过
- [ ] AC-5: 所有测试通过: `npm test`

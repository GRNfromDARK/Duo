# Card E.2: 流式渲染与 Markdown 解析

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-2.1 > FR-023: 流式渲染 LLM 输出

从 `todolist.md` 读取：
- Phase E > E-2：流式渲染与 Markdown 解析

## 读取已有代码
- `src/ui/components/MessageView.tsx` — 消息展示组件
- `src/adapters/output-stream-manager.ts` — 输出流管理

## 任务
1. 实现流式文本渲染组件 `src/ui/components/StreamRenderer.tsx`:
   - 逐行渲染，每 100ms 批量刷新
   - 流式中显示光标/spinner

2. Markdown 实时解析:
   - 代码块语法高亮（不同背景色）
   - 列表格式化
   - 粗体/斜体

3. 代码块在 ``` 关闭前就开始高亮渲染

4. 长输出时无卡顿或闪烁

5. 编写完整测试

## 验收标准
- [ ] AC-1: 从输出流到 TUI 渲染延迟 <= 100ms
- [ ] AC-2: 代码块在关闭标记前已开始高亮
- [ ] AC-3: 长输出（1000+ 行）时无卡顿
- [ ] AC-4: Markdown 列表、表格正确格式化
- [ ] AC-5: 所有测试通过: `npm test`

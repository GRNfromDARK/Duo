# Card F.1: 代码块折叠

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.4 > FR-015: 代码块折叠

从 `todolist.md` 读取：
- Phase F > F-1：代码块折叠

## 读取已有代码
- `src/ui/components/MessageView.tsx` — 消息展示
- `src/ui/components/StreamRenderer.tsx` — 流式渲染

## 任务
1. 实现代码块折叠组件 `src/ui/components/CodeBlock.tsx`:
   - 超过 10 行的代码块自动折叠
   - 显示前 5 行 + 文件名 + 总行数
   - 展开按钮 "[▶ Expand · N lines]"

2. 交互:
   - 光标移到折叠块按 Enter 展开/收起
   - 展开/收起状态在滚动时保持

3. 编写完整测试

## 验收标准
- [ ] AC-1: >10 行代码块自动折叠
- [ ] AC-2: 折叠显示前 5 行 + 行数信息
- [ ] AC-3: Enter 键展开/收起正常
- [ ] AC-4: 滚动后折叠状态保持
- [ ] AC-5: 所有测试通过: `npm test`

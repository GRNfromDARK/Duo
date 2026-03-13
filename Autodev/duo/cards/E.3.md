# Card E.3: 用户输入区域

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.4 > FR-017: 用户输入区域

从 `todolist.md` 读取：
- Phase E > E-3：用户输入区域

## 读取已有代码
- `src/ui/components/MessageView.tsx` — 消息展示组件
- `src/engine/workflow-machine.ts` — 状态机（打断事件）

## 任务
1. 实现底部固定输入框组件 `src/ui/components/InputArea.tsx`:
   - 始终可见
   - LLM 运行中显示灰色提示 "Type to interrupt, or wait for completion..."
   - 等待输入时光标闪烁

2. 打断集成:
   - LLM 运行中输入文字并回车 → 触发打断
   - 将用户文字作为新指令

3. 多行输入:
   - Shift+Enter / Alt+Enter 换行
   - 输入区域最多扩展到 5 行

4. 编写完整测试

## 验收标准
- [ ] AC-1: 输入区域始终可见
- [ ] AC-2: LLM 运行中输入回车触发打断
- [ ] AC-3: 多行输入正常（Shift+Enter 换行）
- [ ] AC-4: 输入框高度自适应（最多 5 行）
- [ ] AC-5: 所有测试通过: `npm test`

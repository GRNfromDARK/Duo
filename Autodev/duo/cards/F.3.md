# Card F.3: 轮次摘要 + Minimal/Verbose 模式

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.4 > FR-020: 轮次摘要展示
- Section 4 > CD-1.4 > FR-021: Minimal/Verbose Mode 切换

从 `todolist.md` 读取：
- Phase F > F-3：轮次摘要 + Minimal/Verbose 模式

## 读取已有代码
- `src/ui/components/MessageView.tsx` — 消息展示
- `src/session/context-manager.ts` — 上下文管理
- `src/engine/workflow-machine.ts` — 状态机

## 任务
1. 实现轮次摘要分隔线:
   - 每轮结束插入: `═══ Round N→N+1 · Summary: <摘要> ═══`
   - 摘要由轻量 LLM 生成，<= 1 行 <= 100 字符

2. 实现 Minimal/Verbose 模式:
   - Minimal Mode（默认）: 隐藏路由过程，只展示 LLM 对话和关键系统事件
   - Verbose Mode（Ctrl+V 切换）: 展示路由过程、完整时间戳、token 计数、CLI 命令详情

3. 创建模式切换状态管理

4. 编写完整测试

## 验收标准
- [ ] AC-1: 轮次分隔线正确插入
- [ ] AC-2: 摘要 <= 100 字符
- [ ] AC-3: Ctrl+V 切换模式即时生效
- [ ] AC-4: Verbose 模式展示 CLI 命令详情
- [ ] AC-5: 所有测试通过: `npm test`

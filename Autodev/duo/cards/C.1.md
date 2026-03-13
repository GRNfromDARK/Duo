# Card C.1: 上下文管理与 Prompt 模板

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.1 > FR-003: 会话上下文管理
- Appendix D: 上下文构建规则

从 `todolist.md` 读取：
- Phase C > C-1：上下文管理与 Prompt 模板

## 读取已有代码
- `src/types/adapter.ts` — OutputChunk 类型
- `src/adapters/output-stream-manager.ts` — 输出流管理

## 任务
1. 实现 `src/session/context-manager.ts` — `ContextManager`:
   - 构建传给每个 LLM 的 prompt
   - Coder prompt 模板: 系统角色 + 任务描述 + 历史摘要 + "不要提问" 指令
   - Reviewer prompt 模板: 系统角色 + 任务描述 + 历史摘要 + "给出行级反馈" 指令

2. 轮次摘要生成:
   - 调用轻量 LLM 生成 <= 200 token 摘要
   - 或使用简单截断策略作为 fallback

3. Prompt 模板存储:
   - 模板文件存储在 `.duo/prompts/` 下
   - 用户可自定义

4. Token 预算管理:
   - 最近 3 轮完整 + 更早轮次摘要
   - 总量不超过 context window 80%

5. 编写完整单元测试

## 验收标准
- [ ] AC-1: Coder/Reviewer prompt 模板内容正确，包含所有必要指令
- [ ] AC-2: 轮次摘要生成 <= 200 token
- [ ] AC-3: `.duo/prompts/` 下模板文件可被用户修改并生效
- [ ] AC-4: Token 预算约束正确执行
- [ ] AC-5: 所有测试通过: `npm test`

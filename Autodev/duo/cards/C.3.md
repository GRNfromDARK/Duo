# Card C.3: 会话持久化与恢复

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.1 > FR-002: 会话历史持久化与恢复

从 `todolist.md` 读取：
- Phase C > C-3：会话持久化与恢复

## 读取已有代码
- `src/session/context-manager.ts` — 上下文管理
- `src/engine/` — 状态机（如已实现）

## 任务
1. 实现 `src/session/session-manager.ts` — `SessionManager`:
   - 会话数据存储在 `.duo/sessions/<id>/`
   - 存储内容: session.json（元数据）, history.json（对话历史）, state.json（状态机快照）
   - 每次状态转换时自动持久化

2. 实现 `duo resume` 命令:
   - 列出可恢复会话: `duo resume`
   - 恢复指定会话: `duo resume <session-id>`
   - 恢复时检测项目目录是否仍存在

3. 会话列表展示:
   - 项目名、任务、轮次、状态、时间

4. 编写完整单元测试

## 验收标准
- [ ] AC-1: 状态转换时自动写入 state.json
- [ ] AC-2: 恢复后正确还原轮次、角色分配、对话历史
- [ ] AC-3: 项目目录不存在时给出错误提示
- [ ] AC-4: `duo resume` 列出历史会话并正确排序
- [ ] AC-5: 所有测试通过: `npm test`

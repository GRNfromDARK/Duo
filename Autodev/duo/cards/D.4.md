# Card D.4: 打断机制

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.2 > FR-007: 用户打断与重新决策流程

从 `todolist.md` 读取：
- Phase D > D-4：打断机制

## 读取已有代码
- `src/engine/workflow-machine.ts` — 状态机定义
- `src/adapters/process-manager.ts` — ProcessManager
- `src/session/session-manager.ts` — 会话管理

## 任务
1. 实现 Ctrl+C 打断:
   - 捕获 SIGINT
   - kill 当前 LLM 进程（<= 1 秒）
   - 进入 INTERRUPTED 状态
   - 保留已有的流式输出，标记为 `(interrupted)`

2. 打断后用户输入:
   - 等待用户输入新指令
   - 用户指令作为追加上下文

3. 文字打断:
   - LLM 运行中输入文字并回车 = 带指令的打断

4. 双击 Ctrl+C（<500ms）:
   - 退出应用
   - 退出前自动保存会话

5. 编写完整单元测试

## 验收标准
- [ ] AC-1: Ctrl+C 在 <= 1 秒内终止当前 LLM 进程
- [ ] AC-2: 已有输出保留并标记 interrupted
- [ ] AC-3: 打断后用户输入作为新上下文传给 LLM
- [ ] AC-4: 文字回车触发打断并将文字作为指令
- [ ] AC-5: 双击 Ctrl+C 退出前保存会话
- [ ] AC-6: 所有测试通过: `npm test`

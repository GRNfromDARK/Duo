# Card B.4: 流式输出统一层

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.3 > FR-013: 流式输出捕获与解析（AC-045, AC-047）

从 `todolist.md` 读取：
- Phase B > B-4：流式输出统一层

## 读取已有代码
- `src/types/adapter.ts` — OutputChunk 类型
- `src/parsers/` — 三类解析器
- `src/adapters/process-manager.ts` — ProcessManager

## 任务
1. 实现 `src/adapters/output-stream-manager.ts` — `OutputStreamManager`:
   - 将 CLIAdapter 的 `execute()` 输出统一管理
   - 支持实时分发 OutputChunk 给多个消费者（TUI 渲染、日志记录、上下文收集）
   - 使用 EventEmitter 或 AsyncIterator 多播模式

2. 实现输出缓冲：
   - 完整收集一次 LLM 调用的所有输出用于上下文传递
   - 缓冲区大小管理

3. 处理输出中断：
   - 进程被 kill 时保留已接收的部分输出
   - 标记 interrupted 状态

4. 编写完整单元测试

## 验收标准
- [ ] AC-1: 流式输出延迟 <= 100ms（从 CLI 产出到消费者接收）
- [ ] AC-2: 支持多消费者同时消费同一输出流
- [ ] AC-3: 输出中断时保留部分输出并标记 interrupted
- [ ] AC-4: 缓冲区正确收集完整输出文本
- [ ] AC-5: 所有测试通过: `npm test`

# Card D.1: xstate v5 状态机 — 核心状态转换

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.2 > FR-004: 轮流工作流编排
- Appendix C: 工作流状态机详细定义

从 `todolist.md` 读取：
- Phase D > D-1：xstate v5 状态机 — 核心状态转换

## 读取已有代码
- `src/types/adapter.ts` — CLIAdapter 接口
- `src/adapters/claude-code/adapter.ts` — 适配器实现参考
- `src/adapters/output-stream-manager.ts` — 输出流管理

## 任务
1. 实现 `src/engine/workflow-machine.ts` — 使用 xstate v5 定义状态机:
   - 11 个状态: IDLE, CODING, ROUTING_POST_CODE, REVIEWING, ROUTING_POST_REVIEW, EVALUATING, WAITING_USER, INTERRUPTED, RESUMING, DONE, ERROR
   - 13 种事件: START_TASK, CODE_COMPLETE, REVIEW_COMPLETE, CONVERGED, NOT_CONVERGED, USER_INTERRUPT, USER_INPUT, USER_CONFIRM, PROCESS_ERROR, TIMEOUT, RESUME_SESSION + 路由事件
   - 所有状态转换有明确 guard 条件

2. 严格串行: 同一时刻只有 1 个 LLM 子进程

3. 状态机支持序列化/反序列化:
   - `machine.getPersistedSnapshot()`
   - `actor.start(snapshot)`

4. 编写完整单元测试:
   - 正常流程: IDLE → CODING → REVIEWING → EVALUATING → CODING（循环）
   - 序列化/反序列化往返测试
   - 并发安全测试（同时只有 1 个进程）
   - 所有异常路径测试

## 验收标准
- [ ] AC-1: 状态机定义编译通过，所有状态/事件/guard 正确
- [ ] AC-2: 正常流程 IDLE → CODING → REVIEWING → EVALUATING → CODING（循环）测试通过
- [ ] AC-3: 序列化/反序列化往返测试通过
- [ ] AC-4: 同时只有 1 个 LLM 进程运行（并发安全测试）
- [ ] AC-5: 所有异常路径（ERROR, TIMEOUT）状态转换正确
- [ ] AC-6: 所有测试通过: `npm test`

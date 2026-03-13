# Card D.3: 选择题检测与路由

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.2 > FR-006: 选择题检测与自动路由

从 `todolist.md` 读取：
- Phase D > D-3：选择题检测与路由

## 读取已有代码
- `src/engine/workflow-machine.ts` — 状态机定义
- `src/session/context-manager.ts` — 上下文管理

## 任务
1. 在 system prompt 中注入"不要提问，自主决策"指令（首选方案）

2. 实现 `src/decision/choice-detector.ts` — `ChoiceDetector`:
   - 正则兜底检测: 问号结尾 + 编号列表 / A/B/C / 方案一/方案二
   - 检测到选择题 → 路由给对方 LLM 自动选择

3. 路由逻辑:
   - 路由判断 <= 2 秒
   - 构建转发 prompt: 包含原始问题 + 上下文
   - 误判时用户可手动覆盖

4. 编写完整单元测试

## 验收标准
- [ ] AC-1: System prompt 包含"不要提问"指令
- [ ] AC-2: 正则检测覆盖 A/B/C, 1/2/3, 方案一/方案二等常见模式
- [ ] AC-3: 路由判断耗时 <= 2 秒
- [ ] AC-4: 误判时用户可通过输入覆盖路由决策
- [ ] AC-5: 所有测试通过: `npm test`

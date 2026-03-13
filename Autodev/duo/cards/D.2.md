# Card D.2: 收敛判定与终止条件

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.2 > FR-005: 收敛判定与终止条件

从 `todolist.md` 读取：
- Phase D > D-2：收敛判定与终止条件

## 读取已有代码
- `src/engine/workflow-machine.ts` — 状态机定义
- `src/session/context-manager.ts` — 上下文管理

## 任务
1. 实现 `src/decision/convergence-service.ts` — `ConvergenceService`:
   - 分析 Reviewer 输出，判定: approved / changes_requested / questions
   - 使用轻量 LLM（如 Haiku）进行分类
   - 或使用关键词 + 正则作为 fallback

2. 终止条件实现:
   - approved（Reviewer 明确通过）
   - 达到最大轮数（可配置，默认 5 轮）
   - 用户终止
   - 循环检测（连续 2 轮相同主题）

3. 最大轮数配置: 创建会话时指定

4. 编写完整单元测试

## 验收标准
- [ ] AC-1: 对 approved 类输出正确识别
- [ ] AC-2: 对 changes_requested 类输出正确识别
- [ ] AC-3: 达到轮数上限时进入 WAITING_USER 状态
- [ ] AC-4: 循环检测：连续 2 轮相同主题触发提醒
- [ ] AC-5: 所有测试通过: `npm test`

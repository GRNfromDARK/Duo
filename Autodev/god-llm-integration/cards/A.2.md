# Card A.2: TASK_INIT 入口 — 启动时调用 God 意图解析

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-001: 用户意图解析（AC-001, AC-002, AC-003）
- FR-002: 任务类型分类（AC-008, AC-009）
- FR-007: 动态轮次控制（AC-023, AC-024）

从 `docs/requirements/god-llm-integration-todolist.md` 读取：
- Phase A > A-2

## 读取已有代码
- `src/ui/components/App.tsx` — SessionRunner 组件，关注初始化 useEffect 和 `send({ type: 'START_TASK' })`
- `src/engine/workflow-machine.ts` — XState 状态机定义，关注 IDLE → CODING 转换
- `src/god/task-init.ts` — 已实现的 `runTaskInit()` 函数
- `src/god/god-system-prompt.ts` — God system prompt 生成
- `src/god/degradation-manager.ts` — DegradationManager 接口
- `src/types/god-schemas.ts` — GodTaskAnalysis 类型

## 任务

### 1. 扩展 XState 状态机添加 TASK_INIT 状态
在 `workflow-machine.ts` 中：

1. 添加新事件类型：
   ```typescript
   type TaskInitCompleteEvent = { type: 'TASK_INIT_COMPLETE'; maxRounds?: number };
   type TaskInitSkipEvent = { type: 'TASK_INIT_SKIP' };
   ```

2. 添加 `TASK_INIT` 状态：
   - IDLE → START_TASK → TASK_INIT（而非直接到 CODING）
   - TASK_INIT → TASK_INIT_COMPLETE → CODING
   - TASK_INIT → TASK_INIT_SKIP → CODING（降级路径）

3. TASK_INIT_COMPLETE 时更新 context.maxRounds（如果提供了新值）

### 2. App.tsx 集成 God TASK_INIT
在 `App.tsx` SessionRunner 中：

1. 添加 React state：
   ```typescript
   const [taskAnalysis, setTaskAnalysis] = useState<GodTaskAnalysis | null>(null);
   ```

2. 添加 `TASK_INIT` state 的 useEffect：
   - 调用 `runTaskInit(godAdapterRef.current, config.task, { cwd: config.projectDir })`
   - 成功：存储 GodTaskAnalysis 到 state，send TASK_INIT_COMPLETE with suggestedMaxRounds
   - 失败：send TASK_INIT_SKIP（降级到 v1 行为）
   - 添加系统消息展示 God 分析结果

3. 修改初始化 useEffect：
   - `send({ type: 'START_TASK', prompt: config.task })` 现在触发到 TASK_INIT 而非直接 CODING

### 3. God audit log 记录
- TASK_INIT 结果写入 God audit log（使用 `src/god/god-audit.ts`）

## 验收标准
- [ ] AC-1: 启动 session 时先进入 TASK_INIT 状态，再进入 CODING
- [ ] AC-2: GodTaskAnalysis 结果正确存入 React state
- [ ] AC-3: suggestedMaxRounds 替代硬编码 MAX_ROUNDS（注入 XState context）
- [ ] AC-4: God TASK_INIT 失败时降级到直接 CODING（send TASK_INIT_SKIP）
- [ ] AC-5: TASK_INIT 结果写入 God audit log
- [ ] AC-6: XState 状态机新增 TASK_INIT 状态，transition 正确
- [ ] AC-7: 所有测试通过: `npx vitest run`
- [ ] AC-8: 现有测试不受影响

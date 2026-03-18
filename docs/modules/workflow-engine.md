# 工作流引擎 (Workflow Engine)

> 源码：`src/engine/workflow-machine.ts`（engine 目录下的唯一文件）
>
> 类型定义：`src/types/session.ts`、`src/types/god-actions.ts`、`src/types/god-envelope.ts`、`src/types/observation.ts`

---

## 1 状态机（workflow-machine.ts）

### 1.1 模块职责

WorkflowMachine 是 Duo 的核心调度器，基于 **XState v5** 实现。它驱动 **Observe → Decide → Act** 循环，保证在任意时刻**只有一个 LLM 进程在运行**（串行执行原则）。状态机支持序列化/反序列化，用于 session 恢复。

Machine ID 为 `workflow`，初始状态为 `IDLE`。

#### 拓扑概览

```
IDLE → GOD_DECIDING → EXECUTING → CODING/REVIEWING/CLARIFYING/DONE
CODING → OBSERVING → GOD_DECIDING → ...
REVIEWING → OBSERVING → GOD_DECIDING → ...
```

#### 简化说明

相比早期版本，当前状态机进行了大幅简化：

- **移除 TASK_INIT 状态**：`START_TASK` 直接进入 `GOD_DECIDING`，不再经过单独的 intent 解析阶段
- **移除 INTERRUPTED 状态**：中断处理统一走 CLARIFYING 路径
- **移除 Circuit Breaker**：不再跟踪 `consecutiveRouteToCoder`，不再有自动触发 PAUSED 的死循环保护
- **移除 Phase 相关字段**：`pendingPhaseId`、`pendingPhaseSummary` 已删除
- **移除 Incident 检测**：`INCIDENT_DETECTED` 事件已删除

---

### 1.2 WorkflowContext 结构

状态机的 context 包含 8 个字段，定义于 `WorkflowContext` interface。所有字段均可通过 `input` 参数在创建 machine 时注入初始值，未提供的字段取默认值。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `taskPrompt` | `string \| null` | `null` | 当前任务 prompt |
| `activeProcess` | `'coder' \| 'reviewer' \| null` | `null` | 当前活跃的 LLM 进程角色 |
| `lastError` | `string \| null` | `null` | 最后一次错误信息 |
| `lastCoderOutput` | `string \| null` | `null` | coder 最近一次输出 |
| `lastReviewerOutput` | `string \| null` | `null` | reviewer 最近一次输出 |
| `sessionId` | `string \| null` | `null` | 当前 session ID（用于持久化与恢复） |
| `currentObservations` | `Observation[]` | `[]` | 当前待处理的 observation 列表 |
| `lastDecision` | `GodDecisionEnvelope \| null` | `null` | God 最近一次决策信封 |

---

### 1.3 状态定义（共 10 个）

| 状态 | 类型 | 说明 |
|------|------|------|
| `IDLE` | 初始 | 等待 `START_TASK` 或 `RESUME_SESSION` |
| `CODING` | 活跃 | coder LLM 正在执行；`activeProcess = 'coder'` |
| `REVIEWING` | 活跃 | reviewer LLM 正在执行；`activeProcess = 'reviewer'` |
| `OBSERVING` | 收集 | 收集 coder/reviewer 输出后的 observation，分类后传递给 GOD_DECIDING |
| `GOD_DECIDING` | 决策 | 调用统一 God 决策服务，等待 GodDecisionEnvelope |
| `EXECUTING` | 执行 | Hand executor 运行 GodActions，产出 result observations |
| `CLARIFYING` | 澄清 | God 调解的多轮人机澄清循环。由 `request_user_input` action 进入，人类回答后经 observation pipeline 回到 GOD_DECIDING |
| `PAUSED` | 暂停 | God LLM 无法自动决策时的暂停模式，等待 `USER_CONFIRM` |
| `RESUMING` | 恢复 | 从持久化 session 恢复到目标状态的中转站 |
| `DONE` | **final** | 工作流正常结束（XState final state，不接受任何事件） |
| `ERROR` | 错误 | 可通过 `RECOVERY` 事件恢复到 `GOD_DECIDING` |

---

### 1.4 事件定义（共 16 个）

#### 1.4.1 任务生命周期事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `START_TASK` | `prompt: string` | 启动新任务，`taskPrompt` 写入 context，直接进入 GOD_DECIDING |

#### 1.4.2 LLM 进程完成事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `CODE_COMPLETE` | `output: string` | coder 完成。清除 `currentObservations`，进入 OBSERVING |
| `REVIEW_COMPLETE` | `output: string` | reviewer 完成。清除 `currentObservations`，进入 OBSERVING |

#### 1.4.3 用户交互事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `USER_CONFIRM` | `action: 'continue' \| 'accept'` | 用户在 PAUSED 做出选择 |

#### 1.4.4 错误与超时事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `PROCESS_ERROR` | `error: string` | LLM 进程错误，可从 CODING / REVIEWING / OBSERVING / GOD_DECIDING / EXECUTING / RESUMING 触发 |
| `TIMEOUT` | -- | LLM 进程超时（仅在 CODING / REVIEWING 状态处理） |

#### 1.4.5 Observe-Decide-Act 循环事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `OBSERVATIONS_READY` | `observations: Observation[]` | observations 收集完毕，进入 GOD_DECIDING。可从 OBSERVING / CLARIFYING 触发 |
| `DECISION_READY` | `envelope: GodDecisionEnvelope` | God 决策信封就绪，进入 EXECUTING |
| `EXECUTION_COMPLETE` | `results: Observation[]` | Hand executor 执行完毕，携带结果 observations，按 guard 条件路由到下一状态 |

#### 1.4.6 暂停事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `PAUSE_REQUIRED` | -- | God LLM 无法自动决策，从 GOD_DECIDING 进入 PAUSED |

#### 1.4.7 Session 恢复事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `RESUME_SESSION` | `sessionId: string` | 请求恢复会话 |
| `RESTORED_TO_CODING` | -- | session 恢复至 CODING |
| `RESTORED_TO_REVIEWING` | -- | session 恢复至 REVIEWING |
| `RESTORED_TO_WAITING` | -- | session 恢复至 GOD_DECIDING |
| `RESTORED_TO_CLARIFYING` | -- | session 恢复至 CLARIFYING |

#### 1.4.8 辅助事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `RECOVERY` | -- | 从 ERROR 恢复至 GOD_DECIDING |

---

### 1.5 完整状态转换图

```
                         START_TASK                    RESUME_SESSION
                             |                              |
                             v                              v
   +--------+          +---------------+             +-----------+
   |  IDLE  |--------->| GOD_DECIDING  |             | RESUMING  |
   +--------+          +-------+-------+             +-----+-----+
                               |                           |
                         DECISION_READY              RESTORED_TO_*
                               |         +---------------+---------+---------+
                               v         v               v         v         v
                         +-----------+  CODING      REVIEWING  GOD_DEC.  CLARI-
                +------->| EXECUTING |                                    FYING
                |        +-----+-----+
                |              |
                |     EXECUTION_COMPLETE
                |              |
                |     +--------+--------+--------+--------+
                |     v        v        v        v        v
                |   CODING  REVIEW.   DONE   CLARIFY.  GOD_DEC.
                |     |                                 (default)
                |     |
                |     v
                |  +---------+     CODE_COMPLETE       +-----------+
                |  | CODING  |----------------------->>| OBSERVING |
                |  +---------+                         +-----+-----+
                |                                            |
                |                                   OBSERVATIONS_READY
                |                                            |
                |       +-----------+     REVIEW_COMPLETE    v
                |       | REVIEWING |----------------->>+---------------+
                |       +-----------+                   | GOD_DECIDING  |
                |              ^                        +-------+-------+
                |              |                                |
                |              +--- executionTargetReviewing ---+
                |                                               |
                +------- DECISION_READY ------------------------+


   ┌─────────────────── 特殊转换 ───────────────────┐
   │                                                 │
   │  CODING / REVIEWING                             │
   │    --PROCESS_ERROR / TIMEOUT-->  ERROR           │
   │                                                 │
   │  OBSERVING / GOD_DECIDING / EXECUTING / RESUMING│
   │    --PROCESS_ERROR-->            ERROR           │
   │                                                 │
   │  ERROR --RECOVERY-->             GOD_DECIDING   │
   │                                                 │
   │  GOD_DECIDING --PAUSE_REQUIRED-->  PAUSED       │
   │                                                 │
   │  PAUSED --USER_CONFIRM(continue)--> GOD_DECIDING│
   │  PAUSED --USER_CONFIRM(accept)-->   DONE        │
   │                                                 │
   │  CLARIFYING --OBSERVATIONS_READY--> GOD_DECIDING│
   └─────────────────────────────────────────────────┘
```

#### 核心 Observe-Decide-Act 循环（简化视图）

```
    +---------+     CODE_COMPLETE /      +-----------+
    | CODING  |---REVIEW_COMPLETE------->| OBSERVING |
    +---------+                          +-----+-----+
         ^                                     |
         |                            OBSERVATIONS_READY
         |                                     |
         |                                     v
         |                             +---------------+
         +--- send_to_coder ---------->| GOD_DECIDING  |
         |                             +-------+-------+
         |                                     |
         |                               DECISION_READY
    +-----------+                              |
    | REVIEWING |                              v
    +-----------+                        +-----------+
         ^                               | EXECUTING |
         |                               +-----+-----+
         +--- send_to_reviewer ----------------+
                                               |
                                         EXECUTION_COMPLETE
                                               |
                    +----+----+----+----+------+
                    v    v    v    v    v
                 CODING REV. DONE CLAR. GOD_DEC.
```

---

### 1.6 各状态详细转换表

#### IDLE

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `START_TASK` | GOD_DECIDING | `taskPrompt` = event.prompt |
| `RESUME_SESSION` | RESUMING | `sessionId` = event.sessionId |

#### CODING

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `CODE_COMPLETE` | OBSERVING | `lastCoderOutput` = event.output，`activeProcess` = null，`currentObservations` = []（清除过期 observations） |
| `PROCESS_ERROR` | ERROR | `lastError` = event.error，`activeProcess` = null |
| `TIMEOUT` | ERROR | `lastError` = 'Process timed out'，`activeProcess` = null |

#### REVIEWING

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `REVIEW_COMPLETE` | OBSERVING | `lastReviewerOutput` = event.output，`activeProcess` = null，`currentObservations` = [] |
| `PROCESS_ERROR` | ERROR | `lastError` = event.error，`activeProcess` = null |
| `TIMEOUT` | ERROR | `lastError` = 'Process timed out'，`activeProcess` = null |

#### OBSERVING

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `OBSERVATIONS_READY` | GOD_DECIDING | `currentObservations` = event.observations |
| `PROCESS_ERROR` | ERROR | `lastError` = event.error |

#### GOD_DECIDING

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `DECISION_READY` | EXECUTING | `lastDecision` = event.envelope |
| `PAUSE_REQUIRED` | PAUSED | -- |
| `PROCESS_ERROR` | ERROR | `lastError` = event.error |

#### EXECUTING

`EXECUTION_COMPLETE` 事件使用 guard 数组，按顺序求值（第一个匹配的 guard 生效）：

| Guard | 目标状态 | Context 更新 |
|-------|----------|-------------|
| `executionTargetCoding` | CODING | `currentObservations` = event.results，`activeProcess` = 'coder' |
| `executionTargetReviewing` | REVIEWING | `currentObservations` = event.results，`activeProcess` = 'reviewer' |
| `executionTargetDone` | DONE | `currentObservations` = event.results |
| `executionTargetClarifying` | CLARIFYING | `currentObservations` = event.results，`activeProcess` = null |
| *（无 guard / 默认）* | GOD_DECIDING | `currentObservations` = event.results（非空时）或保留现有 observations（BUG-22 fix） |

其他事件：

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `PROCESS_ERROR` | ERROR | `lastError` = event.error |

#### PAUSED

| 事件 | Guard | 目标状态 | Context 更新 |
|------|-------|----------|-------------|
| `USER_CONFIRM` | `confirmContinue` | GOD_DECIDING | -- |
| `USER_CONFIRM` | `confirmAccept` | DONE | -- |
| `USER_CONFIRM` | *（无 guard 匹配）* | DONE | -- |

#### CLARIFYING

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `OBSERVATIONS_READY` | GOD_DECIDING | `currentObservations` = event.observations |

#### RESUMING

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `RESTORED_TO_CODING` | CODING | `activeProcess` = 'coder' |
| `RESTORED_TO_REVIEWING` | REVIEWING | `activeProcess` = 'reviewer' |
| `RESTORED_TO_WAITING` | GOD_DECIDING | -- |
| `RESTORED_TO_CLARIFYING` | CLARIFYING | -- |
| `PROCESS_ERROR` | ERROR | `lastError` = event.error，`activeProcess` = null |

#### ERROR

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `RECOVERY` | GOD_DECIDING | -- |

#### DONE

Final state，不接受任何事件。

---

### 1.7 Post-Execution 路由逻辑

`EXECUTING` 状态的 `EXECUTION_COMPLETE` 事件使用 `resolvePostExecutionTarget()` 函数，根据 `lastDecision`（GodDecisionEnvelope）中的 actions 数组确定下一个目标状态。该函数遍历 actions 数组，返回第一个匹配的路由 action 对应的目标状态。

| Action type | 目标状态 |
|-------------|----------|
| `accept_task` | `DONE` |
| `request_user_input` | `CLARIFYING` |
| `send_to_coder` | `CODING` |
| `send_to_reviewer` | `REVIEWING` |
| 其他（`wait` 等）或空 actions | `GOD_DECIDING` |

---

### 1.8 Guard 条件（共 6 个）

| Guard | 逻辑 | 使用位置 |
|-------|------|----------|
| `confirmContinue` | `event.action === 'continue'` | PAUSED → GOD_DECIDING |
| `confirmAccept` | `event.action === 'accept'` | PAUSED → DONE |
| `executionTargetCoding` | `resolvePostExecutionTarget() === 'CODING'` | EXECUTING → CODING |
| `executionTargetReviewing` | `resolvePostExecutionTarget() === 'REVIEWING'` | EXECUTING → REVIEWING |
| `executionTargetDone` | `resolvePostExecutionTarget() === 'DONE'` | EXECUTING → DONE |
| `executionTargetClarifying` | `resolvePostExecutionTarget() === 'CLARIFYING'` | EXECUTING → CLARIFYING |

---

### 1.9 Actions

所有 action 均使用 XState 的 `assign()` 内联 action 进行 context 更新。状态机未定义命名 action——所有 context 变更直接在 transition 定义中以 `assign({ ... })` 表达。

完整的 action 与 context 更新对照已在 [1.6 各状态详细转换表](#16-各状态详细转换表) 中列出。

以下列出关键的 assign 模式：

| 模式 | 说明 |
|------|------|
| `currentObservations: () => []` | CODE_COMPLETE / REVIEW_COMPLETE 时清除过期 observations，确保 OBSERVING 分类新鲜输出 |
| BUG-22 fix：observations 保留 | EXECUTION_COMPLETE 默认分支中，当 event.results 为空时保留 `context.currentObservations`，避免 observation 丢失死循环 |

---

### 1.10 Routing Conflict 检测

`detectRoutingConflicts()` 导出函数用于检测 GodDecisionEnvelope 中是否存在多个冲突的路由 action。

**路由 action 类型集合**：

```
accept_task, request_user_input, send_to_coder, send_to_reviewer
```

**逻辑**：过滤 envelope.actions 中属于路由 action 的条目。如果数量 > 1，返回冲突的 action type 列表；如果数量 <= 1 或 envelope 为空，返回空数组。

调用方可在 EXECUTING 执行前检查 envelope 是否合法，避免歧义路由。

---

### 1.11 CLARIFYING 状态详解

CLARIFYING 是 God 调解的多轮人机澄清状态，由 `request_user_input` action 触发进入。

**完整生命周期**：

```
              request_user_input
EXECUTING ─────────────────────> CLARIFYING
                                    |
                              用户回答
                                    |
                              observation pipeline
                                    |
                             OBSERVATIONS_READY
                                    |
                                    v
                              GOD_DECIDING
                                    |
                        +-----------+-----------+
                        |                       |
                  (继续追问)               (其他决策)
              request_user_input       send_to_coder / etc.
                        |                       |
                        v                       v
                   CLARIFYING             CODING / REVIEWING
                                          / DONE / ...
```

1. **进入**：EXECUTING 的 `EXECUTION_COMPLETE` 事件，guard `executionTargetClarifying` 命中时
2. **循环**：人类回答 → observation pipeline → `OBSERVATIONS_READY` → GOD_DECIDING → God 决定继续追问或执行其他操作
3. **退出**：God 发出非 `request_user_input` 的路由 action（如 `send_to_coder`、`accept_task` 等）

---

### 1.12 串行执行原则

状态机设计确保同一时刻只有一个 LLM 进程运行：

- `activeProcess` 字段标记当前活跃角色（`'coder'` / `'reviewer'` / `null`）
- 进入 `CODING` 或 `REVIEWING` 时设置对应角色
- 离开活跃状态时（完成、错误、超时）一律重置为 `null`
- `OBSERVING`、`GOD_DECIDING`、`EXECUTING`、`CLARIFYING`、`PAUSED` 等非活跃状态不设置 `activeProcess`，保证在决策期间没有 LLM 进程运行

---

### 1.13 序列化与 Session 恢复

状态机通过 `input` 参数支持全量 context 注入，配合 `RESUMING` 状态实现 session 恢复。

#### 恢复流程

1. 从 `IDLE` 发送 `RESUME_SESSION` 事件进入 `RESUMING` 状态，`sessionId` 写入 context
2. 外部恢复逻辑根据保存的状态分发对应的 `RESTORED_TO_*` 事件：

| 保存状态 | 恢复事件 | 目标状态 | Context 更新 |
|----------|----------|----------|-------------|
| coding | `RESTORED_TO_CODING` | CODING | `activeProcess = 'coder'` |
| reviewing | `RESTORED_TO_REVIEWING` | REVIEWING | `activeProcess = 'reviewer'` |
| waiting | `RESTORED_TO_WAITING` | GOD_DECIDING | -- |
| clarifying | `RESTORED_TO_CLARIFYING` | CLARIFYING | -- |

3. 如果恢复过程出错，`PROCESS_ERROR` → ERROR

#### 创建时注入

通过 `input` 参数可在 machine 创建时恢复完整 context，所有 8 个字段均支持注入。`setup()` 的 `types.input` 为 `Partial<WorkflowContext> | undefined`，每个字段使用 `input?.field ?? defaultValue` 模式取值。

---

## 2 Observation 与 GodAction 类型参考

### 2.1 Observation 类型体系

**定义文件**：`src/types/observation.ts`

#### Observation Schema

```ts
{
  source: 'coder' | 'reviewer' | 'god' | 'human' | 'runtime';
  type: ObservationType;     // 见下表 6 种类型
  summary: string;           // 人类可读的摘要
  rawRef?: string;           // 原始引用数据
  severity: 'info' | 'warning' | 'error' | 'fatal';  // 默认 'info'
  timestamp: string;         // ISO 时间戳
  adapter?: string;          // 产生此 observation 的 adapter
}
```

#### 6 种 Observation 类型

| 类型 | 分类 | 说明 |
|------|------|------|
| `work_output` | 工作输出 | coder 产出的代码/工作结果 |
| `review_output` | 工作输出 | reviewer 产出的审查结果 |
| `human_message` | 人类交互 | 用户在 LLM 运行时键入的文本中断 |
| `human_interrupt` | 人类交互 | Ctrl+C 中断 |
| `runtime_error` | 运行时异常 | 运行时错误（统一替代早期多种异常子类型） |
| `phase_progress_signal` | 进度信号 | phase 进度变更 |

**类型守卫**：`isWorkObservation(obs)` — 仅 `work_output` 和 `review_output` 返回 true。

### 2.2 GodAction 类型（5 种）

**定义文件**：`src/types/god-actions.ts`

使用 Zod discriminated union（按 `type` 字段区分），所有 schema 均导出以支持独立验证。

| Action | 参数 | 路由效果 | 说明 |
|--------|------|----------|------|
| `send_to_coder` | `dispatchType: DispatchType`，`message: string` | → CODING | 向 coder 发送指令 |
| `send_to_reviewer` | `message: string` | → REVIEWING | 向 reviewer 发送指令 |
| `accept_task` | `summary: string` | → DONE | 接受任务结果 |
| `request_user_input` | `question: string` | → CLARIFYING | 向用户提问 |
| `wait` | `reason: string`，`estimatedSeconds?: number` | → GOD_DECIDING（非路由） | 等待 |

> **路由 vs 非路由**：状态机的 `resolvePostExecutionTarget()` 仅识别 4 种路由 action（`accept_task`、`request_user_input`、`send_to_coder`、`send_to_reviewer`）。`wait` 执行后回到 GOD_DECIDING 重新评估。`detectRoutingConflicts()` 也仅检测这 4 种路由 action 的冲突。

### 2.3 GodDecisionEnvelope 结构

**定义文件**：`src/types/god-envelope.ts`

```ts
{
  diagnosis: {
    summary: string;                // 当前态势摘要
    currentGoal: string;            // 当前目标
    notableObservations: string[];  // 值得注意的 observation 列表
  };
  actions: GodAction[];             // 有序 action 列表
  messages: EnvelopeMessage[];      // 目标消息列表
}
```

> **简化说明**：相比早期版本，envelope 已移除 `authority`、`autonomousResolutions` 和 `diagnosis.currentPhaseId` 字段。不再有 schema-level 的 authority 语义约束（superRefine）。

#### EnvelopeMessage

```ts
{
  target: 'coder' | 'reviewer' | 'user' | 'system_log';
  content: string;
}
```

---

## 3 Session 类型参考

**定义文件**：`src/types/session.ts`

### SessionConfig

```ts
{
  projectDir: string;            // 项目目录
  coder: string;                 // coder adapter 名称
  reviewer: string;              // reviewer adapter 名称
  god: GodAdapterName;           // god adapter 名称
  task: string;                  // 任务描述
  coderModel?: string;           // coder 模型覆盖（如 'sonnet', 'gpt-5.4'）
  reviewerModel?: string;        // reviewer 模型覆盖
  godModel?: string;             // god 模型覆盖（如 'opus', 'gemini-2.5-pro'）
}
```

### StartArgs

```ts
{
  dir?: string;
  coder?: string;
  reviewer?: string;
  god?: string;
  task?: string;
  coderModel?: string;
  reviewerModel?: string;
  godModel?: string;
}
```

### ValidationResult & StartResult

```ts
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface StartResult {
  config: SessionConfig | null;
  validation: ValidationResult;
  detectedCLIs: string[];
}
```

---

## 4 Bug 修复与设计决策索引

| 标识 | 位置 | 描述 |
|------|------|------|
| Bug 5 | CODE_COMPLETE / REVIEW_COMPLETE actions | 清除 `currentObservations` 为空数组，确保 OBSERVING 分类新鲜输出而非处理过期数据 |
| BUG-12 | `detectRoutingConflicts()` | 检测 envelope 中多个冲突路由 action，防止歧义状态转换 |
| BUG-22 | EXECUTING default transition | 当 execution 产生空 results 时保留现有 `currentObservations`，避免 observation 丢失导致的死循环 |

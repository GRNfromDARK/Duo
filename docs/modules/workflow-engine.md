# 工作流引擎 (Workflow Engine)

> 源码：`src/engine/workflow-machine.ts`、`src/engine/interrupt-handler.ts`
>
> 类型定义：`src/types/session.ts`、`src/types/god-actions.ts`、`src/types/god-envelope.ts`、`src/types/observation.ts`
>
> 规格引用：FR-003 (Runtime Core Loop)、FR-004、FR-005、FR-007、FR-008、FR-011、FR-016、FR-017
>
> 变更卡片：Card A.1、Card A.2、Card D.1 (Observe-Decide-Act 重构)、Card E.1 (Interrupt Observation 归一化)、Card E.2 (Clarification 状态)

---

## 1 状态机（workflow-machine.ts）

### 1.1 模块职责

WorkflowMachine 是 Duo 的核心调度器，基于 **XState v5** 实现。它驱动 **Observe → Decide → Act** 循环，保证在任意时刻**只有一个 LLM 进程在运行**（串行执行原则）。状态机支持序列化/反序列化，用于 session 恢复。

Machine ID 为 `workflow`，初始状态为 `IDLE`。

#### 拓扑概览

```
IDLE → TASK_INIT → CODING → OBSERVING → GOD_DECIDING → EXECUTING → ...
REVIEWING → OBSERVING → GOD_DECIDING → EXECUTING → ...
```

#### Card D.1 变更记录

- **移除的状态**：`ROUTING_POST_CODE`、`ROUTING_POST_REVIEW`、`EVALUATING`
- **新增的状态**：
  - `OBSERVING` — 收集 coder/reviewer 输出或 incident 后的 observations
  - `EXECUTING` — Hand executor 执行 GodActions，产出 result observations
  - `CLARIFYING` — Card E.2：God 调解的多轮人机澄清

---

### 1.2 WorkflowContext 结构

状态机的 context 包含 18 个字段，定义于 `WorkflowContext` interface。所有字段均可通过 `input` 参数在创建 machine 时注入初始值，未提供的字段取默认值。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `round` | `number` | `0` | 当前迭代轮次 |
| `maxRounds` | `number` | `10` | 最大允许轮次（可由 `TASK_INIT_COMPLETE` 覆盖） |
| `consecutiveRouteToCoder` | `number` | `0` | 连续路由回 coder 的次数，用于 circuit breaker 检测 |
| `taskPrompt` | `string \| null` | `null` | 当前任务 prompt（Phase 切换时自动注入 `[Phase: xxx]` 前缀） |
| `activeProcess` | `'coder' \| 'reviewer' \| null` | `null` | 当前活跃的 LLM 进程角色 |
| `lastError` | `string \| null` | `null` | 最后一次错误信息 |
| `lastCoderOutput` | `string \| null` | `null` | coder 最近一次输出 |
| `lastReviewerOutput` | `string \| null` | `null` | reviewer 最近一次输出 |
| `sessionId` | `string \| null` | `null` | 当前 session ID（用于持久化与恢复） |
| `pendingPhaseId` | `string \| null` | `null` | 待切换的 Phase ID |
| `pendingPhaseSummary` | `string \| null` | `null` | 待切换 Phase 的摘要说明 |
| `currentObservations` | `Observation[]` | `[]` | Card D.1：当前待处理的 observation 列表 |
| `lastDecision` | `GodDecisionEnvelope \| null` | `null` | Card D.1：God 最近一次决策信封 |
| `incidentCount` | `number` | `0` | Card D.1：累计 incident 次数 |
| `frozenActiveProcess` | `'coder' \| 'reviewer' \| null` | `null` | Card E.2：进入 CLARIFYING 前冻结的活跃进程角色（用于 `resume_after_interrupt(continue)` 时路由回原角色） |
| `clarificationRound` | `number` | `0` | Card E.2：澄清轮次计数 |
| `clarificationObservations` | `Observation[]` | `[]` | Card E.2：累积的澄清 observation（用于上下文保留 AC-6） |

---

### 1.3 状态定义（共 13 个）

| 状态 | 类型 | 说明 |
|------|------|------|
| `IDLE` | 初始 | 等待 `START_TASK` 或 `RESUME_SESSION` |
| `TASK_INIT` | 过渡 | God LLM intent 解析阶段，位于 IDLE 和 CODING 之间 |
| `CODING` | 活跃 | coder LLM 正在执行；`activeProcess = 'coder'` |
| `REVIEWING` | 活跃 | reviewer LLM 正在执行；`activeProcess = 'reviewer'` |
| `OBSERVING` | 收集 | Card D.1：收集 coder/reviewer 输出或 incident 后的 observation，分类后传递给 GOD_DECIDING |
| `GOD_DECIDING` | 决策 | Card D.1：调用统一 God 决策服务，等待 GodDecisionEnvelope |
| `EXECUTING` | 执行 | Card D.1：Hand executor 运行 GodActions，产出 result observations |
| `CLARIFYING` | 澄清 | Card E.2：God 调解的多轮人机澄清循环。由 `request_user_input` action 进入，人类回答后经 observation pipeline 回到 GOD_DECIDING，God 可继续追问或发出 `resume_after_interrupt` 恢复工作 |
| `MANUAL_FALLBACK` | 降级 | God LLM 无法自动决策时的手动降级模式，等待 `USER_CONFIRM` |
| `INTERRUPTED` | 中断（兼容） | 保留用于向后兼容（session 恢复 via `RESTORED_TO_INTERRUPTED`）。Card E.1 之后新的中断走 `INCIDENT_DETECTED → OBSERVING` 路径 |
| `RESUMING` | 恢复 | 从持久化 session 恢复到目标状态的中转站 |
| `DONE` | **final** | 工作流正常结束（XState final state，不接受任何事件） |
| `ERROR` | 错误 | 可通过 `RECOVERY` 事件恢复到 `GOD_DECIDING` |

---

### 1.4 事件定义（共 22 个）

#### 1.4.1 任务生命周期事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `START_TASK` | `prompt: string` | 启动新任务，`taskPrompt` 写入 context |
| `TASK_INIT_COMPLETE` | `maxRounds?: number` | God LLM intent 解析完成，可选覆盖 maxRounds |
| `TASK_INIT_SKIP` | -- | 跳过 intent 解析，直接进入 CODING |

#### 1.4.2 LLM 进程完成事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `CODE_COMPLETE` | `output: string` | coder 完成。清除 `currentObservations`（Bug 5 fix），进入 OBSERVING |
| `REVIEW_COMPLETE` | `output: string` | reviewer 完成。清除 `currentObservations`（Bug 5 fix），进入 OBSERVING |

#### 1.4.3 用户交互事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `USER_INTERRUPT` | -- | 用户中断信号（类型保留，但 Card E.1 后中断走 observation pipeline） |
| `USER_INPUT` | `input: string; resumeAs: 'coder' \| 'reviewer' \| 'decision'` | 中断后用户提供新指令（类型保留，但 Card E.1 后走 observation pipeline） |
| `USER_CONFIRM` | `action: 'continue' \| 'accept'` | 用户在 MANUAL_FALLBACK 做出选择 |

#### 1.4.4 错误与超时事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `PROCESS_ERROR` | `error: string` | LLM 进程错误，可从 CODING / REVIEWING / OBSERVING / GOD_DECIDING / EXECUTING / RESUMING 触发 |
| `TIMEOUT` | -- | LLM 进程超时（仅在 CODING / REVIEWING 状态处理） |

#### 1.4.5 Observe-Decide-Act 循环事件（Card D.1）

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `OBSERVATIONS_READY` | `observations: Observation[]` | observations 收集完毕，进入 GOD_DECIDING。可从 OBSERVING / INTERRUPTED / CLARIFYING 触发 |
| `DECISION_READY` | `envelope: GodDecisionEnvelope` | God 决策信封就绪，进入 EXECUTING |
| `EXECUTION_COMPLETE` | `results: Observation[]` | Hand executor 执行完毕，携带结果 observations，按 guard 条件路由到下一状态 |
| `INCIDENT_DETECTED` | `observation: Observation` | 运行时检测到 incident（中断、异常等），冻结 `activeProcess` 后进入 OBSERVING |

#### 1.4.6 Session 恢复事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `RESUME_SESSION` | `sessionId: string` | 请求恢复会话 |
| `RESTORED_TO_CODING` | -- | session 恢复至 CODING |
| `RESTORED_TO_REVIEWING` | -- | session 恢复至 REVIEWING |
| `RESTORED_TO_WAITING` | -- | session 恢复至 GOD_DECIDING |
| `RESTORED_TO_INTERRUPTED` | -- | session 恢复至 INTERRUPTED |
| `RESTORED_TO_CLARIFYING` | -- | Card E.2：session 恢复至 CLARIFYING |

#### 1.4.7 辅助事件

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `CLEAR_PENDING_PHASE` | -- | 清除待切换的 phase 信息（GOD_DECIDING / MANUAL_FALLBACK 中均可处理） |
| `MANUAL_FALLBACK_REQUIRED` | -- | God LLM 无法自动决策，从 GOD_DECIDING 降级至 MANUAL_FALLBACK |
| `RECOVERY` | -- | 从 ERROR 恢复至 GOD_DECIDING，同时重置 `consecutiveRouteToCoder` |

---

### 1.5 完整状态转换图

```
                         START_TASK                    RESUME_SESSION
                             |                              |
                             v                              v
   +--------+          +-----------+                  +-----------+
   |  IDLE  |--------->| TASK_INIT |                  | RESUMING  |
   +--------+          +-----+-----+                  +-----+-----+
                             |                              |
                   TASK_INIT_COMPLETE               RESTORED_TO_*
                   TASK_INIT_SKIP                         |
                             |         +------------------+---------+---------+---------+
                             v         v                  v         v         v         v
                       +---------+  CODING          REVIEWING  GOD_DECIDING INTER-  CLARI-
               +------>| CODING  |<-------+                                RUPTED   FYING
               |       +----+----+        |
               |            |             |
               |   CODE_COMPLETE          |
               |   INCIDENT_DETECTED      |
               |            |             |
               |            v             |          +-----------+
               |       +-----------+      |          | REVIEWING |
               |       | OBSERVING |<-----+----------+-----+-----+
               |       +-----+-----+      |                |
               |             |            |       REVIEW_COMPLETE
               |     OBSERVATIONS_READY   |       INCIDENT_DETECTED
               |             |            |                |
               |             v            |                |
               |     +---------------+    |                |
               |     | GOD_DECIDING  |<---+-------OBSERVATIONS_READY
               |     +-------+-------+    |
               |             |            |     MANUAL_FALLBACK_REQUIRED
               |       DECISION_READY     |                |
               |             |            |                v
               |             v            |     +------------------+
               |       +-----------+      |     | MANUAL_FALLBACK  |
               |       | EXECUTING |------+     +--------+---------+
               |       +-----+-----+                     |
               |             |                      USER_CONFIRM
               |    EXECUTION_COMPLETE              |           |
               |             |                  continue      accept
               |    +--------+--------+---------+   |           |
               |    |        |        |         |   v           v
               |    v        v        v         v  CODING      DONE
               |  CODING  REVIEW.  DONE    CLARIFYING
               |  (route)  (route)            |
               |    |                         |
               +----+              OBSERVATIONS_READY
                                              |
                                              v
                                        GOD_DECIDING
                                       (God 可继续追问
                                        或 resume)

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
   │  INTERRUPTED --OBSERVATIONS_READY--> GOD_DECIDING│
   │    (backward compat)                            │
   │                                                 │
   │  EXECUTING --circuitBreakerTripped-->            │
   │                                  MANUAL_FALLBACK│
   │                                                 │
   │  EXECUTING --default (no routing action)-->      │
   │                                  GOD_DECIDING   │
   └─────────────────────────────────────────────────┘
```

#### 核心 Observe-Decide-Act 循环（简化视图）

```
    +---------+     CODE_COMPLETE /      +-----------+
    | CODING  |---REVIEW_COMPLETE------->| OBSERVING |
    +---------+     INCIDENT_DETECTED    +-----+-----+
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
| `START_TASK` | TASK_INIT | `taskPrompt` = event.prompt |
| `RESUME_SESSION` | RESUMING | `sessionId` = event.sessionId |

#### TASK_INIT

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `TASK_INIT_COMPLETE` | CODING | `activeProcess` = `'coder'`，`consecutiveRouteToCoder` = 0，`maxRounds` 可被 event 覆盖 |
| `TASK_INIT_SKIP` | CODING | `activeProcess` = `'coder'`，`consecutiveRouteToCoder` = 0 |

#### CODING

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `CODE_COMPLETE` | OBSERVING | `lastCoderOutput` = event.output，`activeProcess` = null，`currentObservations` = []（Bug 5 fix：清除过期 observations） |
| `INCIDENT_DETECTED` | OBSERVING | `frozenActiveProcess` = 当前 activeProcess（Card E.2），`activeProcess` = null，`incidentCount`++，`currentObservations` = [event.observation] |
| `PROCESS_ERROR` | ERROR | `lastError` = event.error，`activeProcess` = null |
| `TIMEOUT` | ERROR | `lastError` = 'Process timed out'，`activeProcess` = null |

> **注意**：Card E.1 之后，`USER_INTERRUPT` 不再直接从 CODING 处理。中断通过 observation pipeline 产生 `INCIDENT_DETECTED` 事件。

#### REVIEWING

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `REVIEW_COMPLETE` | OBSERVING | `lastReviewerOutput` = event.output，`activeProcess` = null，`currentObservations` = []（Bug 5 fix） |
| `INCIDENT_DETECTED` | OBSERVING | `frozenActiveProcess` = 当前 activeProcess，`activeProcess` = null，`incidentCount`++，`currentObservations` = [event.observation] |
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
| `CLEAR_PENDING_PHASE` | *（自转换）* | `pendingPhaseId` = null，`pendingPhaseSummary` = null |
| `MANUAL_FALLBACK_REQUIRED` | MANUAL_FALLBACK | -- |
| `PROCESS_ERROR` | ERROR | `lastError` = event.error |

#### EXECUTING

`EXECUTION_COMPLETE` 事件使用 guard 数组，按顺序求值（第一个匹配的 guard 生效）：

| Guard | 目标状态 | Context 更新 |
|-------|----------|-------------|
| `circuitBreakerTripped` | MANUAL_FALLBACK | `currentObservations` = event.results，`activeProcess` = null，`lastError` = circuit breaker 消息 |
| `executionTargetCoding` | CODING | `currentObservations` = event.results，`activeProcess` = 'coder'，`round`++，`consecutiveRouteToCoder`++，清除 clarification 状态 |
| `executionTargetReviewing` | REVIEWING | `currentObservations` = event.results，`activeProcess` = 'reviewer'，`consecutiveRouteToCoder` = 0，清除 clarification 状态 |
| `executionTargetDone` | DONE | `currentObservations` = event.results，清除 clarification 状态 |
| `executionTargetClarifying` | CLARIFYING | `currentObservations` = event.results，`activeProcess` = null，`clarificationRound`++ |
| *（无 guard / 默认）* | GOD_DECIDING | `currentObservations` = event.results（非空时）或保留现有 observations（BUG-22 fix） |

其他事件：

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `PROCESS_ERROR` | ERROR | `lastError` = event.error |

#### MANUAL_FALLBACK

| 事件 | Guard | 目标状态 | Context 更新 |
|------|-------|----------|-------------|
| `CLEAR_PENDING_PHASE` | -- | *（自转换）* | `pendingPhaseId` = null，`pendingPhaseSummary` = null |
| `USER_CONFIRM` | `confirmContinueWithPhase` | CODING | `round`++，`activeProcess` = 'coder'，`consecutiveRouteToCoder` = 0，`taskPrompt` 注入 `[Phase: xxx]` 前缀，清除 pending phase |
| `USER_CONFIRM` | `confirmContinue` | CODING | `round`++，`activeProcess` = 'coder'，`consecutiveRouteToCoder` = 0 |
| `USER_CONFIRM` | `confirmAccept` | DONE | `consecutiveRouteToCoder` = 0 |
| `USER_CONFIRM` | *（无 guard 匹配）* | DONE | -- |

#### CLARIFYING（Card E.2）

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `OBSERVATIONS_READY` | GOD_DECIDING | `currentObservations` = event.observations，`clarificationObservations` 累加 event.observations（AC-6 上下文保留） |

#### INTERRUPTED（兼容保留）

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `OBSERVATIONS_READY` | GOD_DECIDING | `currentObservations` = event.observations |

#### RESUMING

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `RESTORED_TO_CODING` | CODING | `activeProcess` = 'coder' |
| `RESTORED_TO_REVIEWING` | REVIEWING | `activeProcess` = 'reviewer' |
| `RESTORED_TO_WAITING` | GOD_DECIDING | -- |
| `RESTORED_TO_INTERRUPTED` | INTERRUPTED | -- |
| `RESTORED_TO_CLARIFYING` | CLARIFYING | -- |
| `PROCESS_ERROR` | ERROR | `lastError` = event.error，`activeProcess` = null |

#### ERROR

| 事件 | 目标状态 | Context 更新 |
|------|----------|-------------|
| `RECOVERY` | GOD_DECIDING | `consecutiveRouteToCoder` = 0 |

#### DONE

Final state，不接受任何事件。

---

### 1.7 Post-Execution 路由逻辑

`EXECUTING` 状态的 `EXECUTION_COMPLETE` 事件使用 `resolvePostExecutionTarget()` 函数，根据 `lastDecision`（GodDecisionEnvelope）中的 actions 数组确定下一个目标状态。该函数遍历 actions 数组，返回第一个匹配的路由 action 对应的目标状态。

| Action type | 目标状态 | 附加逻辑 |
|-------------|----------|----------|
| `accept_task` | `DONE` | -- |
| `request_user_input` | `CLARIFYING` | Card E.2：替代原来的 INTERRUPTED |
| `send_to_coder` | `CODING` | `round++`，`consecutiveRouteToCoder++` |
| `send_to_reviewer` | `REVIEWING` | `consecutiveRouteToCoder` 重置为 0 |
| `retry_role` | `CODING` 或 `REVIEWING` | 取决于 `action.role` |
| `resume_after_interrupt` | 取决于 `resumeStrategy` | 见下表 |
| 其他（`wait`、`emit_summary`、`stop_role`、`switch_adapter`、`set_phase`） | `GOD_DECIDING` | 重新进入决策循环 |
| 空 actions 或无信封 | `GOD_DECIDING` | -- |

**`resume_after_interrupt` 的 `resumeStrategy` 路由规则**：

| resumeStrategy | 目标状态 | 说明 |
|----------------|----------|------|
| `stop` | DONE | 终止工作流 |
| `redirect` | GOD_DECIDING | 重新评估，不回到原进程 |
| `continue` | CODING 或 REVIEWING | 根据 `frozenActiveProcess` 判断：为 `'reviewer'` 时回到 REVIEWING，否则回到 CODING |

---

### 1.8 Guard 条件（共 11 个）

| Guard | 逻辑 | 使用位置 |
|-------|------|----------|
| `resumeAsCoder` | `event.resumeAs === 'coder'` | 类型保留（Card E.1 之前用于 INTERRUPTED 状态） |
| `resumeAsReviewer` | `event.resumeAs === 'reviewer'` | 同上 |
| `resumeAsDecision` | `event.resumeAs === 'decision'` | 同上 |
| `confirmContinue` | `event.action === 'continue'` | MANUAL_FALLBACK → CODING |
| `confirmContinueWithPhase` | `event.action === 'continue' && context.pendingPhaseId != null` | MANUAL_FALLBACK → CODING（同时更新 taskPrompt 的 Phase 前缀） |
| `confirmAccept` | `event.action === 'accept'` | MANUAL_FALLBACK → DONE |
| `circuitBreakerTripped` | `resolvePostExecutionTarget() === 'CODING' && consecutiveRouteToCoder + 1 >= 3` | EXECUTING → MANUAL_FALLBACK（Bug 1 fix：防止无限 coder 循环） |
| `executionTargetCoding` | `resolvePostExecutionTarget() === 'CODING'` | EXECUTING → CODING |
| `executionTargetReviewing` | `resolvePostExecutionTarget() === 'REVIEWING'` | EXECUTING → REVIEWING |
| `executionTargetDone` | `resolvePostExecutionTarget() === 'DONE'` | EXECUTING → DONE |
| `executionTargetClarifying` | `resolvePostExecutionTarget() === 'CLARIFYING'` | Card E.2：EXECUTING → CLARIFYING |

> **Guard 优先级**：`EXECUTION_COMPLETE` 事件的 guard 按数组顺序求值（XState v5 行为）。`circuitBreakerTripped` 位于数组最前面，确保在路由到 CODING 之前先检查是否触发 circuit breaker。

---

### 1.9 Actions

所有 action 均使用 XState 的 `assign()` 内联 action 进行 context 更新。状态机未定义命名 action——所有 context 变更直接在 transition 定义中以 `assign({ ... })` 表达。

完整的 action 与 context 更新对照已在 [1.6 各状态详细转换表](#16-各状态详细转换表) 中列出。

以下列出关键的 assign 模式：

| 模式 | 说明 |
|------|------|
| Bug 5 fix：`currentObservations: () => []` | CODE_COMPLETE / REVIEW_COMPLETE 时清除过期 observations，确保 OBSERVING 分类新鲜输出 |
| Card E.2：`frozenActiveProcess: (ctx) => ctx.activeProcess` | INCIDENT_DETECTED 时冻结当前活跃角色，供后续 `resume_after_interrupt(continue)` 路由 |
| BUG-22 fix：observations 保留 | EXECUTION_COMPLETE 默认分支中，当 event.results 为空时保留 `context.currentObservations`，避免 observation 丢失死循环 |
| Clarification 清除 | 路由到 CODING / REVIEWING / DONE 时统一清除 `frozenActiveProcess`、`clarificationRound`、`clarificationObservations` |

---

### 1.10 Routing Conflict 检测（BUG-12 fix）

`detectRoutingConflicts()` 导出函数用于检测 GodDecisionEnvelope 中是否存在多个冲突的路由 action。

**路由 action 类型集合**：

```
accept_task, request_user_input, send_to_coder, send_to_reviewer, retry_role, resume_after_interrupt
```

**逻辑**：过滤 envelope.actions 中属于路由 action 的条目。如果数量 > 1，返回冲突的 action type 列表；如果数量 <= 1 或 envelope 为空，返回空数组。

调用方可在 EXECUTING 执行前检查 envelope 是否合法，避免歧义路由。

---

### 1.11 死循环保护机制（Circuit Breaker）

状态机内建 circuit breaker 防护（Bug 1 fix），防止 God 持续将任务路由回 coder 造成无限循环。

```
EXECUTING ──[circuitBreakerTripped]──> MANUAL_FALLBACK
     |                                       |
     |  (consecutiveRouteToCoder + 1 >= 3    |  lastError = "Circuit breaker:
     |   && target === CODING)               |   too many consecutive
     |                                       |   route-to-coder decisions (3+).
     v                                       |   Manual intervention required."
  (正常路由)                                  |
                                             v
                                     等待 USER_CONFIRM
```

**触发条件**：`consecutiveRouteToCoder + 1 >= 3` 且本次 `EXECUTION_COMPLETE` 的目标为 CODING。

**计数器管理规则**：

| 场景 | `consecutiveRouteToCoder` 变化 |
|------|-------------------------------|
| 路由到 CODING | 递增 (+1) |
| 路由到 REVIEWING | 重置为 0（打破 coder 循环） |
| `USER_CONFIRM`（continue / accept） | 重置为 0 |
| `RECOVERY` | 重置为 0 |
| `TASK_INIT_COMPLETE` / `TASK_INIT_SKIP` | 重置为 0 |

---

### 1.12 CLARIFYING 状态详解（Card E.2）

CLARIFYING 是 God 调解的多轮人机澄清状态，替代 INTERRUPTED 作为 `request_user_input` action 的目标状态。

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
                  (继续追问)               (恢复工作)
              request_user_input       resume_after_interrupt
                        |                       |
                        v              +--------+--------+
                   CLARIFYING          |        |        |
                                    continue  redirect   stop
                                       |        |        |
                                       v        v        v
                                    CODING/  GOD_DEC.   DONE
                                    REVIEW.
```

1. **进入**：EXECUTING 的 `EXECUTION_COMPLETE` 事件，guard `executionTargetClarifying` 命中时。`clarificationRound` 递增
2. **循环**：人类回答 → observation pipeline → `OBSERVATIONS_READY` → GOD_DECIDING → God 决定继续追问或恢复工作
3. **上下文保留**（AC-6）：`clarificationObservations` 在 CLARIFYING 状态下累积每轮 observation，保持多轮对话上下文
4. **退出**：God 发出 `resume_after_interrupt` action，根据 `resumeStrategy` 路由。退出时清零 `frozenActiveProcess`、`clarificationRound`、`clarificationObservations`

---

### 1.13 串行执行原则

状态机设计确保同一时刻只有一个 LLM 进程运行：

- `activeProcess` 字段标记当前活跃角色（`'coder'` / `'reviewer'` / `null`）
- 进入 `CODING` 或 `REVIEWING` 时设置对应角色
- 离开活跃状态时（完成、incident、错误、超时）一律重置为 `null`
- `OBSERVING`、`GOD_DECIDING`、`EXECUTING`、`CLARIFYING`、`MANUAL_FALLBACK` 等非活跃状态不设置 `activeProcess`，保证在决策期间没有 LLM 进程运行

---

### 1.14 序列化与 Session 恢复

状态机通过 `input` 参数支持全量 context 注入，配合 `RESUMING` 状态实现 session 恢复。

#### 保存流程

`InterruptHandler.saveAndExit()` 在 double Ctrl+C 时调用 `sessionManager.saveState()`，保存以下数据：

```ts
{
  round: number;
  status: 'interrupted';
  currentRole: activeProcess ?? 'coder';
}
```

#### 恢复流程

1. 从 `IDLE` 发送 `RESUME_SESSION` 事件进入 `RESUMING` 状态，`sessionId` 写入 context
2. 外部恢复逻辑根据保存的状态分发对应的 `RESTORED_TO_*` 事件：

| 保存状态 | 恢复事件 | 目标状态 | Context 更新 |
|----------|----------|----------|-------------|
| coding | `RESTORED_TO_CODING` | CODING | `activeProcess = 'coder'` |
| reviewing | `RESTORED_TO_REVIEWING` | REVIEWING | `activeProcess = 'reviewer'` |
| waiting | `RESTORED_TO_WAITING` | GOD_DECIDING | -- |
| interrupted | `RESTORED_TO_INTERRUPTED` | INTERRUPTED | -- |
| clarifying | `RESTORED_TO_CLARIFYING` | CLARIFYING | -- |

3. 如果恢复过程出错，`PROCESS_ERROR` → ERROR

#### 创建时注入

通过 `input` 参数可在 machine 创建时恢复完整 context，所有 18 个字段均支持注入。`setup()` 的 `types.input` 为 `Partial<WorkflowContext> | undefined`，每个字段使用 `input?.field ?? defaultValue` 模式取值。

---

## 2 中断处理器（interrupt-handler.ts）

> 规格引用：FR-007、FR-011
>
> 变更卡片：Card E.1 (Interrupt → Observation 归一化)

### 2.1 模块职责

`InterruptHandler` 类管理三种用户中断场景：单次 Ctrl+C、双击 Ctrl+C 退出、文本中断。

**Card E.1 关键变更**：InterruptHandler 不再直接向 state machine actor 发送事件（如 `USER_INTERRUPT`、`USER_INPUT`）。所有中断和用户输入均通过 **observation pipeline**（`onObservation` 回调）路由。pipeline 负责将 observation 转化为 `INCIDENT_DETECTED` 或 `OBSERVATIONS_READY` 事件发送给 actor。

### 2.2 InterruptedInfo 接口

```ts
interface InterruptedInfo {
  bufferedOutput: string;       // 中断前 LLM 已产出的部分输出
  interrupted: true;            // 固定标记
  userInstruction?: string;     // 文本中断时用户输入的指令（可选）
}
```

### 2.3 依赖接口（InterruptHandlerDeps）

```ts
interface InterruptHandlerDeps {
  processManager: {
    kill(): Promise<void>;        // 终止当前 LLM 进程
    isRunning(): boolean;         // 进程是否在运行
    getBufferedOutput(): string;  // 获取已缓冲的输出
  };
  sessionManager: {
    saveState(sessionId: string, state: Record<string, unknown>): void;
  };
  /** Card E.1: 只读状态访问器 — InterruptHandler 不得直接发送事件给 actor */
  actor: {
    send(event: Record<string, unknown>): void;
    getSnapshot(): {
      value: string;
      context: {
        sessionId: string | null;
        round: number;
        activeProcess: string | null;
      };
    };
  };
  onExit: () => void;
  onInterrupted: (info: InterruptedInfo) => void;
  /** Card E.1: 必需 — observation pipeline 回调，用于将 observation 路由给 God */
  onObservation: (obs: Observation) => void;
}
```

> **注意**：虽然 `actor.send()` 存在于接口中，但 Card E.1 之后 InterruptHandler 内部不再调用它。所有 observation 通过 `onObservation` 回调路由。

### 2.4 三种中断模式

| 模式 | 触发方式 | 行为 |
|------|----------|------|
| **Single Ctrl+C** | 按一次 Ctrl+C | 终止 LLM 进程 → 保留缓冲输出 → 通过 `onObservation` 发出 `human_interrupt` observation → 由 pipeline 触发 `INCIDENT_DETECTED` |
| **Double Ctrl+C** | 500ms 内按两次 Ctrl+C | 保存 session → 退出应用（**唯一绕过 God 的路径**） |
| **Text Interrupt** | LLM 运行时用户键入文本并回车 | 终止进程 → 通过 `onObservation` 发出 `human_message` observation → 由 pipeline 触发 `INCIDENT_DETECTED` |

### 2.5 单次 Ctrl+C 流程

```
用户按下 Ctrl+C
       |
       v
  handleSigint()
       |
       +-- 检查 disposed → 是则直接返回
       |
       +-- 记录时间戳 lastSigintTime = Date.now()
       |
       +-- 双击检测：hasPendingSigint && timeSinceLast <= 500ms?
       |   +-- 是 → saveAndExit()（见 2.6）
       |
       +-- hasPendingSigint = true
       |
       v
  interruptCurrentProcess()  [private]
       |
       +-- 获取 actor snapshot
       |
       +-- 检查当前状态是否为 ACTIVE_STATES（CODING / REVIEWING）
       |   +-- 不是 → 直接返回，忽略此次 Ctrl+C
       |
       +-- getBufferedOutput()：获取 LLM 已产出的部分输出
       |
       +-- 如果 isRunning() 为 true → kill() 终止进程
       |   +-- catch：进程可能已退出，静默处理
       |
       +-- onObservation(createInterruptObservation(round))
       |   Card E.1: 通过 observation pipeline 路由
       |
       +-- onInterrupted({ bufferedOutput, interrupted: true })
```

**关键点**：只在 `CODING` 或 `REVIEWING` 状态下生效，其他状态下的 Ctrl+C 被静默忽略。

### 2.6 双击 Ctrl+C 流程（<500ms）

```
第一次 Ctrl+C
       |
       v
  handleSigint()
       +-- lastSigintTime = now, hasPendingSigint = true
       +-- interruptCurrentProcess()（正常中断流程）

第二次 Ctrl+C（间隔 <= 500ms）
       |
       v
  handleSigint()
       |
       +-- timeSinceLast = now - lastSigintTime <= 500ms
       +-- hasPendingSigint = true → 判定为双击
       +-- hasPendingSigint = false（重置）
       |
       v
  saveAndExit()  [private]
       |
       +-- 获取 actor snapshot
       |
       +-- 如果有 sessionId：
       |   +-- sessionManager.saveState(sessionId, {
       |        round,
       |        status: 'interrupted',
       |        currentRole: activeProcess ?? 'coder'
       |      })
       |   +-- catch：best-effort，保存失败也继续退出
       |
       +-- onExit()（退出应用）
```

**阈值常量**：`DOUBLE_CTRLC_THRESHOLD_MS = 500`

> **重要**：Double Ctrl+C 是唯一绕过 God 决策循环的退出路径。其他所有中断和退出都必须经过 God 评估。

### 2.7 文本中断流程

```
用户在 LLM 运行期间输入文本并回车
       |
       v
  handleTextInterrupt(text, resumeAs)
       |
       +-- 检查 disposed → 是则直接返回
       |
       +-- isRunning() 为 false → 直接返回
       +-- 当前状态不在 ACTIVE_STATES → 直接返回
       |
       +-- getBufferedOutput()：获取已缓冲输出
       |
       +-- kill()：终止 LLM 进程
       |   +-- catch：进程可能已退出，静默处理
       |
       +-- onObservation(createTextInterruptObservation(text, round))
       |   Card E.1: 通过 observation pipeline 路由
       |
       +-- onInterrupted({
             bufferedOutput,
             interrupted: true,
             userInstruction: text
           })
```

### 2.8 用户输入处理（handleUserInput）

Card E.1 之后，`handleUserInput` 不再向 actor 发送 `USER_INPUT` 事件，而是通过 observation pipeline 发出 `clarification_answer` 类型的 observation：

```ts
handleUserInput(input, resumeAs) {
  onObservation(createObservation('clarification_answer', 'human', input, {
    round: snapshot.context.round,
    severity: 'info',
    rawRef: input,
  }));
}
```

这个 observation 会通过 pipeline 路由给 God，由 God 决定后续动作。`resumeAs` 参数不再被使用（保留签名以兼容调用方）。

### 2.9 Buffer 保留机制

无论哪种中断方式，都会在 kill 进程**之前**调用 `getBufferedOutput()` 获取 LLM 已经产出的部分输出。这些输出通过 `InterruptedInfo.bufferedOutput` 传递给上层，确保：

- 用户可以看到中断前的部分结果
- 恢复时可以利用已有输出作为上下文，避免完全重做

### 2.10 内部状态

| 字段 | 类型 | 初始值 | 说明 |
|------|------|--------|------|
| `lastSigintTime` | `number` | `0` | 上次 SIGINT 的时间戳（ms） |
| `hasPendingSigint` | `boolean` | `false` | 是否有未决的单次 Ctrl+C |
| `disposed` | `boolean` | `false` | 是否已销毁，调用 `dispose()` 后设为 true，所有后续方法调用直接返回 |

### 2.11 方法总览

| 方法 | 可见性 | 签名 | 说明 |
|------|--------|------|------|
| `handleSigint` | public | `() => Promise<void>` | 处理 SIGINT 信号。首次中断进程；500ms 内再按则保存并退出 |
| `handleTextInterrupt` | public | `(text: string, resumeAs: 'coder' \| 'reviewer') => Promise<void>` | 处理文本中断，仅在 ACTIVE_STATES 且进程运行中时生效 |
| `handleUserInput` | public | `(input: string, resumeAs: 'coder' \| 'reviewer' \| 'decision') => void` | Card E.1：通过 observation pipeline 发出 `clarification_answer` observation |
| `dispose` | public | `() => void` | 标记 handler 为已销毁，后续调用全部跳过 |
| `interruptCurrentProcess` | private | `() => Promise<void>` | 检查状态、终止进程、发出 interrupt observation |
| `saveAndExit` | private | `() => void` | 保存 session 状态并调用 onExit() 退出 |

---

## 3 Observation 与 GodAction 类型参考

### 3.1 Observation 类型体系

**定义文件**：`src/types/observation.ts`

#### Observation Schema

```ts
{
  source: 'coder' | 'reviewer' | 'god' | 'human' | 'runtime';
  type: ObservationType;     // 见下表 13 种类型
  summary: string;           // 人类可读的摘要
  rawRef?: string;           // 原始引用数据
  severity: 'info' | 'warning' | 'error' | 'fatal';  // 默认 'error'
  timestamp: string;         // ISO 时间戳
  round: number;             // 所属轮次（>= 0 的整数）
  phaseId?: string | null;   // 所属 phase
  adapter?: string;          // 产生此 observation 的 adapter
}
```

#### 13 种 Observation 类型

| 类型 | 分类 | 说明 |
|------|------|------|
| `work_output` | 工作输出 | coder 产出的代码/工作结果 |
| `review_output` | 工作输出 | reviewer 产出的审查结果 |
| `quota_exhausted` | 运行时异常 | API 配额用尽 |
| `auth_failed` | 运行时异常 | 认证失败 |
| `adapter_unavailable` | 运行时异常 | adapter 不可用 |
| `empty_output` | 运行时异常 | LLM 返回空输出 |
| `meta_output` | 元数据 | LLM 返回的元信息 |
| `tool_failure` | 运行时异常 | 工具调用失败 |
| `human_interrupt` | 人类交互 | Ctrl+C 中断 |
| `human_message` | 人类交互 | 用户在 LLM 运行时键入的文本中断 |
| `clarification_answer` | 人类交互 | 用户对 God 提问的回答 |
| `phase_progress_signal` | 进度信号 | phase 进度变更 |
| `runtime_invariant_violation` | 运行时异常 | 运行时不变量违反 |

**类型守卫**：`isWorkObservation(obs)` — 仅 `work_output` 和 `review_output` 返回 true。

### 3.2 GodAction 类型（11 种）

**定义文件**：`src/types/god-actions.ts`

使用 Zod discriminated union（按 `type` 字段区分），所有 schema 均导出以支持独立验证。

| Action | 参数 | 路由效果 | 说明 |
|--------|------|----------|------|
| `send_to_coder` | `message: string` | → CODING | 向 coder 发送指令 |
| `send_to_reviewer` | `message: string` | → REVIEWING | 向 reviewer 发送指令 |
| `accept_task` | `rationale: 'reviewer_aligned' \| 'god_override' \| 'forced_stop'`，`summary: string` | → DONE | 接受任务结果，必须携带理由（FR-017） |
| `retry_role` | `role: 'coder' \| 'reviewer'`，`hint?: string` | → CODING 或 REVIEWING | 让指定角色重试 |
| `request_user_input` | `question: string` | → CLARIFYING | 向用户提问 |
| `resume_after_interrupt` | `resumeStrategy: 'continue' \| 'redirect' \| 'stop'` | → CODING/REVIEWING/GOD_DECIDING/DONE | 中断/澄清后恢复工作 |
| `stop_role` | `role: 'coder' \| 'reviewer'`，`reason: string` | → GOD_DECIDING（非路由） | 停止指定角色 |
| `switch_adapter` | `role: 'coder' \| 'reviewer' \| 'god'`，`adapter: string`，`reason: string` | → GOD_DECIDING（非路由） | 切换 adapter |
| `set_phase` | `phaseId: string`，`summary?: string` | → GOD_DECIDING（非路由） | 设置当前 phase |
| `wait` | `reason: string`，`estimatedSeconds?: number` | → GOD_DECIDING（非路由） | 等待 |
| `emit_summary` | `content: string` | → GOD_DECIDING（非路由） | 输出摘要信息 |

> **路由 vs 非路由**：前 6 种 action 是**路由 action**（会改变状态机的下一个目标状态），后 5 种是**非路由 action**（执行后回到 GOD_DECIDING 重新评估）。`detectRoutingConflicts()` 正是检测一个 envelope 中是否包含多个路由 action。

### 3.3 GodDecisionEnvelope 结构

**定义文件**：`src/types/god-envelope.ts`

GodDecisionEnvelope 是 God 决策的统一信封格式，替代了 5 种遗留 schema（`GodTaskAnalysis` / `GodPostCoderDecision` / `GodPostReviewerDecision` / `GodConvergenceJudgment` / `GodAutoDecision`）。

```ts
{
  diagnosis: {
    summary: string;                // 当前态势摘要
    currentGoal: string;            // 当前目标
    currentPhaseId: string;         // 当前 phase ID
    notableObservations: string[];  // 值得注意的 observation 列表
  };
  authority: {
    userConfirmation: 'human' | 'god_override' | 'not_required';
    reviewerOverride: boolean;
    acceptAuthority: 'reviewer_aligned' | 'god_override' | 'forced_stop';
  };
  actions: GodAction[];             // 有序 action 列表
  messages: EnvelopeMessage[];      // 目标消息列表
  autonomousResolutions?: AutonomousResolution[];  // BUG-24: God 自主代理决策记录
}
```

#### EnvelopeMessage

```ts
{
  target: 'coder' | 'reviewer' | 'user' | 'system_log';
  content: string;
}
```

#### AutonomousResolution（BUG-24）

```ts
{
  question: string;    // God 代理决策时面对的问题
  choice: string;      // 初始选择
  reflection: string;  // 反思过程
  finalChoice: string; // 最终选择
}
```

#### Authority 语义约束（schema-level validation via superRefine）

| 条件 | 要求 | 违反时的错误路径 |
|------|------|-----------------|
| `reviewerOverride = true` | messages 中必须包含 `target: 'system_log'` 条目 | `authority.reviewerOverride` |
| `acceptAuthority = 'god_override'` | messages 中必须包含 `target: 'system_log'` 条目 | `authority.acceptAuthority` |
| `userConfirmation = 'god_override'` | messages 中必须包含 `target: 'system_log'` 条目（BUG-18 fix） | `authority.userConfirmation` |
| `acceptAuthority = 'forced_stop'` | messages 中必须包含 `target: 'user'` 条目 | `authority.acceptAuthority` |

这些约束确保 God 在行使 override 权力时必须留下可审计的日志记录（FR-002: Authority Override Must Be Explicit），在强制停止时必须向用户提供说明。

---

## 4 Session 类型参考

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

## 5 Bug 修复与设计决策索引

| 标识 | 位置 | 描述 |
|------|------|------|
| Bug 1 | Circuit breaker guard | 防止无限 coder 循环。`consecutiveRouteToCoder` 递增而非重置；3 次连续路由触发 MANUAL_FALLBACK |
| Bug 5 | CODE_COMPLETE / REVIEW_COMPLETE actions | 清除 `currentObservations` 为空数组，确保 OBSERVING 分类新鲜输出而非处理过期数据 |
| BUG-12 | `detectRoutingConflicts()` | 检测 envelope 中多个冲突路由 action，防止歧义状态转换 |
| BUG-18 | Envelope schema superRefine | `userConfirmation = 'god_override'` 时强制要求 `system_log` 消息 |
| BUG-22 | EXECUTING default transition | 当 execution 产生空 results 时保留现有 `currentObservations`，避免 observation 丢失导致的死循环 |
| BUG-24 | `autonomousResolutions` 字段 | God 代理决策的结构化记录（question → choice → reflection → finalChoice） |
| Card D.1 | 整体重构 | 引入 Observe → Decide → Act 循环，新增 OBSERVING / GOD_DECIDING / EXECUTING 状态 |
| Card E.1 | InterruptHandler 重构 | 中断不再直接发送事件给 actor，统一走 observation pipeline |
| Card E.2 | CLARIFYING 状态 | God 调解的多轮人机澄清，替代简单的 INTERRUPTED 模式 |

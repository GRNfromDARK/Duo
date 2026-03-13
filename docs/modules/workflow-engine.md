# 工作流引擎

> 源文件：`src/engine/workflow-machine.ts` · `src/engine/interrupt-handler.ts`
> 需求追溯：FR-004 (AC-012 ~ AC-015)、FR-007 (AC-024 ~ AC-028)

---

## 1 状态机（workflow-machine.ts）

### 1.1 模块职责

WorkflowMachine 是 Duo 的核心调度器，基于 **xstate v5** 实现。它驱动 coding → review → evaluate 循环，保证在任意时刻**只有一个 LLM 进程在运行**（串行执行原则）。状态机同时支持序列化/反序列化，用于 session 恢复。

### 1.2 WorkflowContext 结构

```ts
interface WorkflowContext {
  round: number;              // 当前轮次，从 0 开始
  maxRounds: number;          // 最大轮次上限，默认 10
  taskPrompt: string | null;  // 用户下达的任务 prompt
  activeProcess: 'coder' | 'reviewer' | null;  // 当前活跃的 LLM 角色
  lastError: string | null;           // 最近一次错误信息
  lastCoderOutput: string | null;     // Coder 最近一次输出
  lastReviewerOutput: string | null;  // Reviewer 最近一次输出
  sessionId: string | null;           // Session ID，用于持久化恢复
}
```

初始化时可通过 `input` 参数注入部分字段，未提供的字段取默认值。

### 1.3 状态（共 11 个）

| 状态 | 类型 | 说明 |
|------|------|------|
| `IDLE` | 普通 | 初始状态，等待任务启动或 session 恢复 |
| `CODING` | 普通 | Coder LLM 正在执行；`activeProcess = 'coder'` |
| `ROUTING_POST_CODE` | 普通 | Coder 完成后的路由决策点：转 review 或等待用户选择 |
| `REVIEWING` | 普通 | Reviewer LLM 正在执行；`activeProcess = 'reviewer'` |
| `ROUTING_POST_REVIEW` | 普通 | Reviewer 完成后的路由决策点：转 evaluate 或直接回 coder |
| `EVALUATING` | 普通 | 评估收敛性；决定是否进入下一轮 |
| `WAITING_USER` | 普通 | 等待用户确认（continue / accept） |
| `INTERRUPTED` | 普通 | LLM 进程被用户中断，等待用户输入恢复指令 |
| `RESUMING` | 普通 | 正在从已保存的 session 恢复到目标状态 |
| `DONE` | **final** | 工作流正常结束 |
| `ERROR` | 普通 | 出错状态，可通过 `RECOVERY` 事件恢复到 `WAITING_USER` |

### 1.4 事件（共 20 个）

| 事件 | 携带数据 | 说明 |
|------|----------|------|
| `START_TASK` | `prompt: string` | 启动新任务 |
| `CODE_COMPLETE` | `output: string` | Coder 完成 |
| `REVIEW_COMPLETE` | `output: string` | Reviewer 完成 |
| `CONVERGED` | -- | 评估判定已收敛 |
| `NOT_CONVERGED` | -- | 评估判定未收敛 |
| `USER_INTERRUPT` | -- | 用户中断（Ctrl+C / 文本中断） |
| `USER_INPUT` | `input: string; resumeAs: 'coder' \| 'reviewer' \| 'decision'` | 中断后用户提供新指令 |
| `USER_CONFIRM` | `action: 'continue' \| 'accept'` | 用户在 WAITING_USER 做出选择 |
| `PROCESS_ERROR` | `error: string` | LLM 进程错误 |
| `TIMEOUT` | -- | LLM 进程超时 |
| `RESUME_SESSION` | `sessionId: string` | 请求恢复会话 |
| `ROUTE_TO_REVIEW` | -- | 路由：进入 review 阶段 |
| `CHOICE_DETECTED` | `choices: string[]` | 路由：编码后检测到需要用户选择 |
| `ROUTE_TO_EVALUATE` | -- | 路由：进入评估阶段 |
| `ROUTE_TO_CODER` | -- | 路由：回到 coder 阶段 |
| `RECOVERY` | -- | 从 ERROR 恢复 |
| `RESTORED_TO_CODING` | -- | Session 恢复至 CODING |
| `RESTORED_TO_REVIEWING` | -- | Session 恢复至 REVIEWING |
| `RESTORED_TO_WAITING` | -- | Session 恢复至 WAITING_USER |
| `RESTORED_TO_INTERRUPTED` | -- | Session 恢复至 INTERRUPTED |

### 1.5 状态转换图

```
                          RESUME_SESSION
                  ┌───────────────────────────┐
                  │                           ▼
               ┌──────┐  START_TASK     ┌──────────┐
         ┌─────│ IDLE │                 │ RESUMING │
         │     └──────┘                 └──────────┘
         │                               │ │ │ │
     START_TASK                          │ │ │ └─RESTORED_TO_INTERRUPTED─► INTERRUPTED
         │                               │ │ └─RESTORED_TO_WAITING─► WAITING_USER
         │                               │ └─RESTORED_TO_REVIEWING─► REVIEWING
         │        RESTORED_TO_CODING─────┘
         │                │  PROCESS_ERROR─► ERROR
         │                │
         ▼                ▼                     USER_CONFIRM(continue)
  ┌─────────────────────────┐◄──────────────────────────────────────┐
  │        CODING           │◄──NOT_CONVERGED(canContinue,round++)  │
  └─────────────────────────┘                                       │
     │         │    │    │                                          │
     │      TIMEOUT │    │ USER_INTERRUPT                           │
     │  PROC_ERROR  │    │                                          │
     │         │    │    ▼                                          │
     │         ▼    │  ┌─────────────┐                              │
     │      ERROR   │  │ INTERRUPTED │                              │
     │         │    │  └─────────────┘                              │
     │    RECOVERY  │    │ USER_INPUT                               │
     │         │    │    ├─resumeAsCoder────► CODING                │
     │         ▼    │    ├─resumeAsReviewer─► REVIEWING             │
     │   WAITING_   │    └─resumeAsDecision─► WAITING_USER          │
     │    USER ◄────┼───────────────────────────────────────────┐   │
     │     │   │    │                                           │   │
     │     │   │    │ CODE_COMPLETE                             │   │
     │     │   │    ▼                                           │   │
     │     │   │  ┌──────────────────┐                          │   │
     │     │   │  │ ROUTING_POST_CODE│                          │   │
     │     │   │  └──────────────────┘                          │   │
     │     │   │    │           │                               │   │
     │     │   │    │ ROUTE_    │ CHOICE_DETECTED               │   │
     │     │   │    │ TO_REVIEW │                               │   │
     │     │   │    ▼           └──────────► WAITING_USER       │   │
     │     │   │  ┌───────────┐                                 │   │
     │     │   │  │ REVIEWING │                                 │   │
     │     │   │  └───────────┘                                 │   │
     │     │   │    │       │    │                               │   │
     │     │   │    │    TIMEOUT  │ USER_INTERRUPT               │   │
     │     │   │    │  PROC_ERR  └──► INTERRUPTED                │   │
     │     │   │    │       │                                    │   │
     │     │   │    │       ▼                                    │   │
     │     │   │    │     ERROR                                  │   │
     │     │   │    │                                            │   │
     │     │   │    │ REVIEW_COMPLETE                            │   │
     │     │   │    ▼                                            │   │
     │     │   │  ┌────────────────────┐                         │   │
     │     │   │  │ ROUTING_POST_REVIEW│                         │   │
     │     │   │  └────────────────────┘                         │   │
     │     │   │    │              │                             │   │
     │     │   │    │ ROUTE_TO_    │ ROUTE_TO_CODER              │   │
     │     │   │    │ EVALUATE     └───────────────► CODING      │   │
     │     │   │    ▼                                            │   │
     │     │   │  ┌────────────┐                                 │   │
     │     │   │  │ EVALUATING │                                 │   │
     │     │   │  └────────────┘                                 │   │
     │     │   │    │           │                                │   │
     │     │   │    │ CONVERGED │ NOT_CONVERGED(maxRounds)       │   │
     │     │   │    │           └────────────────────────────────┘   │
     │     │   │    └───────────────► WAITING_USER                  │
     │     │   │                        │                           │
     │     │   │                        │ USER_CONFIRM(continue)────┘
     │     │   │                        │
     │     │   │                        │ USER_CONFIRM(accept)
     │     │   │                        ▼
     │     │   │                    ┌──────┐
     │     │   │                    │ DONE │ (final)
     │     │   │                    └──────┘
     │     │   │
     │     │   │  ┌───────┐
     │     └───┼─►│ ERROR │──── RECOVERY ──► WAITING_USER
     │         │  └───────┘
     │         │
     └─────────┘
```

### 1.6 Guard 条件（共 7 个）

| Guard | 逻辑 | 使用位置 |
|-------|------|----------|
| `canContinueRounds` | `round < maxRounds` | EVALUATING → CODING（NOT_CONVERGED 时继续下一轮） |
| `maxRoundsReached` | `round >= maxRounds`（隐式 fallback） | EVALUATING → WAITING_USER（达到轮次上限） |
| `resumeAsCoder` | `event.resumeAs === 'coder'` | INTERRUPTED → CODING |
| `resumeAsReviewer` | `event.resumeAs === 'reviewer'` | INTERRUPTED → REVIEWING |
| `resumeAsDecision` | `event.resumeAs === 'decision'` | INTERRUPTED → WAITING_USER |
| `confirmContinue` | `event.action === 'continue'` | WAITING_USER → CODING |
| `confirmAccept` | `event.action === 'accept'` | WAITING_USER → DONE |

> **注意**：`maxRoundsReached` 在代码中声明但实际通过 xstate 的数组 fallback 机制生效 -- 当 `canContinueRounds` 不满足时自动走 fallback 分支到 `WAITING_USER`。`USER_CONFIRM` 和 `USER_INPUT` 同理，均有 fallback 兜底。

### 1.7 Actions

所有 action 均使用 xstate 的 `assign()` 进行 context 更新：

| 触发事件 | 更新字段 |
|----------|----------|
| `START_TASK` | `taskPrompt` = event.prompt, `activeProcess` = `'coder'` |
| `CODE_COMPLETE` | `lastCoderOutput` = event.output, `activeProcess` = `null` |
| `REVIEW_COMPLETE` | `lastReviewerOutput` = event.output, `activeProcess` = `null` |
| `NOT_CONVERGED`（canContinue） | `round` = round + 1, `activeProcess` = `'coder'` |
| `USER_INTERRUPT`（CODING/REVIEWING） | `activeProcess` = `null` |
| `PROCESS_ERROR`（所有可触发状态） | `lastError` = event.error, `activeProcess` = `null` |
| `TIMEOUT`（CODING/REVIEWING） | `lastError` = `'Process timed out'`, `activeProcess` = `null` |
| `RESUME_SESSION` | `sessionId` = event.sessionId |
| `ROUTE_TO_REVIEW` | `activeProcess` = `'reviewer'` |
| `ROUTE_TO_CODER` | `activeProcess` = `'coder'` |
| `RESTORED_TO_CODING` | `activeProcess` = `'coder'` |
| `RESTORED_TO_REVIEWING` | `activeProcess` = `'reviewer'` |
| `USER_INPUT`（resumeAsCoder） | `activeProcess` = `'coder'` |
| `USER_INPUT`（resumeAsReviewer） | `activeProcess` = `'reviewer'` |
| `USER_CONFIRM`（confirmContinue） | `activeProcess` = `'coder'` |

### 1.8 序列化与 Session 恢复

状态机支持通过 `input` 参数注入完整 context 来恢复 session。恢复流程：

1. 从 `IDLE` 发送 `RESUME_SESSION` 事件，携带 `sessionId`
2. 进入 `RESUMING` 状态，`sessionId` 写入 context
3. 外部恢复逻辑读取持久化数据，根据保存的状态发送对应的 `RESTORED_TO_*` 事件：
   - `RESTORED_TO_CODING` --> CODING（`activeProcess` = `'coder'`）
   - `RESTORED_TO_REVIEWING` --> REVIEWING（`activeProcess` = `'reviewer'`）
   - `RESTORED_TO_WAITING` --> WAITING_USER
   - `RESTORED_TO_INTERRUPTED` --> INTERRUPTED
4. 如果恢复过程出错，`PROCESS_ERROR` --> ERROR

Context 通过 `input` 参数在创建时注入，支持从外部传入已保存的 `round`、`maxRounds`、`taskPrompt`、`sessionId` 等所有字段。

### 1.9 串行执行原则

状态机设计确保同一时刻只有一个 LLM 进程运行：

- `activeProcess` 字段标记当前活跃角色（`'coder'` / `'reviewer'` / `null`）
- 进入 `CODING` 或 `REVIEWING` 时设置对应角色
- 离开活跃状态时（完成、中断、错误、超时）一律重置为 `null`
- 路由状态（`ROUTING_POST_CODE`、`ROUTING_POST_REVIEW`）和评估状态（`EVALUATING`）不设置 `activeProcess`，保证在决策期间没有 LLM 进程运行

---

## 2 中断处理器（interrupt-handler.ts）

> 需求追溯：FR-007 (AC-024 ~ AC-028)

### 2.1 模块职责

`InterruptHandler` 类管理三种用户中断场景：单次 Ctrl+C、双击 Ctrl+C 退出、文本中断。它通过依赖注入协调 `processManager`（杀进程）、`sessionManager`（保存状态）和 `actor`（发送状态机事件）之间的交互。

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
  onExit: () => void;               // 退出应用的回调
  onInterrupted: (info: InterruptedInfo) => void;  // 中断完成的回调
}
```

### 2.4 单次 Ctrl+C 流程

```
用户按下 Ctrl+C
       │
       ▼
  handleSigint()
       │
       ├── 记录时间戳 lastSigintTime，设置 hasPendingSigint = true
       │
       ▼
  interruptCurrentProcess()
       │
       ├── 检查当前状态是否为 ACTIVE_STATES（CODING / REVIEWING）
       │   └── 不是 --> 直接返回，忽略此次 Ctrl+C
       │
       ├── getBufferedOutput()：获取 LLM 已产出的部分输出
       │
       ├── 如果 isRunning() 为 true --> kill() 终止进程
       │   └── catch：进程可能已退出，静默处理
       │
       ├── actor.send({ type: 'USER_INTERRUPT' })
       │   └── 状态机从 CODING/REVIEWING 转入 INTERRUPTED
       │
       └── onInterrupted({ bufferedOutput, interrupted: true })
```

**关键点**：只在 `CODING` 或 `REVIEWING` 状态下生效，其他状态下的 Ctrl+C 被静默忽略。

### 2.5 双击 Ctrl+C 流程（<500ms）

```
第一次 Ctrl+C
       │
       ▼
  handleSigint()
       ├── lastSigintTime = now, hasPendingSigint = true
       └── interruptCurrentProcess()（正常中断流程）

第二次 Ctrl+C（间隔 <= 500ms）
       │
       ▼
  handleSigint()
       │
       ├── timeSinceLast = now - lastSigintTime <= 500ms
       ├── hasPendingSigint = true --> 判定为双击
       ├── hasPendingSigint = false（重置）
       │
       ▼
  saveAndExit()
       │
       ├── 获取 actor snapshot
       │
       ├── 如果有 sessionId：
       │   └── sessionManager.saveState(sessionId, {
       │        round,
       │        status: 'interrupted',
       │        currentRole: activeProcess ?? 'coder'
       │      })
       │   └── catch：best-effort，保存失败也继续退出
       │
       └── onExit()（退出应用）
```

**阈值常量**：`DOUBLE_CTRLC_THRESHOLD_MS = 500`

### 2.6 文本中断流程

```
用户在 LLM 运行期间输入文本并回车
       │
       ▼
  handleTextInterrupt(text, resumeAs)
       │
       ├── isRunning() 为 false --> 直接返回
       ├── 当前状态不在 ACTIVE_STATES --> 直接返回
       │
       ├── getBufferedOutput()：获取已缓冲输出
       │
       ├── kill()：终止 LLM 进程
       │   └── catch：进程可能已退出，静默处理
       │
       ├── actor.send({ type: 'USER_INTERRUPT' })
       │   └── 状态机转入 INTERRUPTED
       │
       └── onInterrupted({
             bufferedOutput,
             interrupted: true,
             userInstruction: text    <-- 用户输入附加到中断信息
           })
```

文本中断等价于 **Ctrl+C + 立即附带用户指令**。`userInstruction` 字段使得后续恢复时可以将用户意图传递给下一次 LLM 调用。

### 2.7 Buffer 保留机制

无论哪种中断方式，都会在 kill 进程**之前**调用 `getBufferedOutput()` 获取 LLM 已经产出的部分输出。这些输出通过 `InterruptedInfo.bufferedOutput` 传递给上层，确保：

- 用户可以看到中断前的部分结果
- 恢复时可以利用已有输出作为上下文，避免完全重做

### 2.8 内部状态

| 字段 | 类型 | 说明 |
|------|------|------|
| `lastSigintTime` | `number` | 上次 SIGINT 的时间戳（ms），初始为 0 |
| `hasPendingSigint` | `boolean` | 是否有未决的单次 Ctrl+C，初始为 false |
| `disposed` | `boolean` | 是否已销毁，调用 `dispose()` 后设为 true |

### 2.9 恢复方法 handleUserInput

中断后，外部可调用 `handleUserInput(input, resumeAs)` 向 actor 发送 `USER_INPUT` 事件：

```ts
handleUserInput(input: string, resumeAs: 'coder' | 'reviewer' | 'decision'): void
```

该方法驱动状态机从 `INTERRUPTED` 恢复到目标状态：

- `resumeAs = 'coder'` --> CODING
- `resumeAs = 'reviewer'` --> REVIEWING
- `resumeAs = 'decision'` --> WAITING_USER
- 其他值 --> fallback 到 WAITING_USER

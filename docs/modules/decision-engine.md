# 决策引擎模块

> 来源需求：FR-005 (AC-016 ~ AC-019), FR-006 (AC-020 ~ AC-023)

## 模块职责

决策引擎包含两个核心能力：

1. **选择题检测与路由**（ChoiceDetector）— 检测 LLM 输出中的选择题/提问模式，自动路由给对方 LLM 回答，确保工作流不中断
2. **收敛判定**（ConvergenceService）— 分析 Reviewer 输出，判断代码审查是否已收敛，决定终止或继续迭代

## 涉及文件

| 文件 | 说明 |
|------|------|
| `src/decision/choice-detector.ts` | 选择题检测（双重策略）与转发 Prompt 构建 |
| `src/decision/convergence-service.ts` | **NEW** — 收敛判定、循环检测、进度追踪、终止条件评估 |

---

## choice-detector.ts — 选择题检测

### 双重策略

决策引擎采用「预防 + 兜底」的双重策略：

**策略一：System Prompt 指示（预防）** — 通过 ContextManager 在 Coder/Reviewer Prompt 中注入「不要提问，自主决策」的指令，从源头避免 LLM 提出选择题。

**策略二：正则检测（兜底）** — 当 LLM 仍然输出选择题格式内容时，`ChoiceDetector` 通过正则表达式进行拦截。

### 检测逻辑

`ChoiceDetector.detect(text)` 分两步执行：

#### 第一步：识别问题行

扫描所有行（跳过代码块内容），寻找：

| 模式 | 正则 | 示例 |
|------|------|------|
| 问号结尾 | `/^.+[?？]\s*$/` | `你更倾向哪种方案？` |
| 选择引导短语 | `/\b(options?\|choose\|prefer\|which\|pick\|select\|方案\|选择\|哪[个种])\b/i` | `以下是两个方案：` |

未找到问题行则直接返回 `{ detected: false, choices: [] }`。

#### 第二步：识别选项列表

从问题行附近（前 2 行到文本末尾）搜索选项，支持以下格式：

| 格式 | 正则 | 匹配示例 |
|------|------|----------|
| A/B/C 点号或括号 | `/^([A-C])[.)]\s*(.+)/` | `A. 使用 Redux`、`B) 使用 MobX` |
| A/B/C 冒号 | `/^([A-C])[:：]\s*(.+)/` | `A: 使用 Redux` |
| 数字序号 | `/^(\d)[.)]\s*(.+)/` | `1. 方案一`、`2) 方案二` |
| 方案 X | `/^方案([一二三...]+)[：:.]?\s*(.+)/` | `方案一：重构组件` |
| Option N | `/^Option\s+(\d+)[：:.]\s*(.+)/i` | `Option 1: Use React` |
| 无序列表 | `/^[-•*]\s+(.+)/` | `- 使用 TypeScript` |

**无序列表的特殊规则：** bullet 格式的选项仅在出现于问题行之后、且长度 < 120 字符时才计入，避免将普通列表误判为选择题。

#### 判定条件

必须**同时满足**两个条件：

1. 找到至少一行问题行
2. 找到**至少 2 个**选项

返回 `ChoiceDetectionResult`：

- `detected: boolean` — 是否检测到选择题
- `choices: string[]` — 提取出的选项内容列表
- `question?: string` — 检测到的问题行文本

### `buildForwardPrompt(result, taskContext): string`

当检测到选择题后，构建转发给对方 LLM 的 Prompt：

```
Task: {taskContext}

A decision is needed:
{result.question}

Choices:
1. {choice1}
2. {choice2}
...

Reply with ONLY: the choice number, then one sentence of reasoning. Do not ask questions.
只回复：选项编号 + 一句话理由。不要提问。
```

设计要点：
- 提供任务上下文，让对方 LLM 有足够信息做出判断
- 统一编号格式列出所有选项
- 要求简洁回复（编号 + 一句话理由），便于解析和追溯
- 问题文本缺失时使用 `(no question text)` 作为兜底

---

## convergence-service.ts — 收敛判定（NEW）

> 来源需求：FR-005 (AC-016, AC-017, AC-018, AC-019)

### 核心设计

ConvergenceService 分析 Reviewer 的输出文本，判断 Coder-Reviewer 迭代是否已收敛，决定是终止工作流还是继续下一轮。

#### 分类体系

| 分类 | 含义 | 触发条件 |
|------|------|----------|
| `approved` | 明确通过 | 输出包含 `[APPROVED]` 标记 |
| `soft_approved` | 隐含通过 | 无阻塞问题 + 匹配软通过语句 |
| `changes_requested` | 需要修改 | 以上两者都不满足（默认分类） |

**关键原则：** 只有显式 `[APPROVED]` 标记才触发 `approved` 分类。没有标记时，即使 Reviewer 语气积极，也仅为 `soft_approved` 或 `changes_requested`。

#### 软通过识别

匹配以下英文/中文模式时（且 blocking issues = 0），分类为 `soft_approved`：

- `LGTM`、`looks good to me`、`no more issues`、`all issues resolved`
- `ship it`、`ready to merge/deploy`、`nothing to fix`
- `代码已通过`、`没有更多问题`、`所有问题已修复`、`可以合并`、`非常好`

#### 阻塞问题计数

`countBlockingIssues(output)` 采用**双层策略**：

1. **优先：结构化输出** — 匹配 `Blocking: N` 行（来自 Reviewer Prompt 模板的标准格式）
2. **回退：启发式计数** — 统计 `**Blocking**`、`**Bug**`、`**Error**`、`**Missing**` 等标记出现次数，减去 `**Non-blocking**` 次数

### 终止条件评估

`evaluate(reviewerOutput, ctx)` 按优先级依次检查：

| 优先级 | 条件 | `reason` | `shouldTerminate` |
|--------|------|----------|-------------------|
| 1 | `[APPROVED]` 标记 | `approved` | `true` |
| 2 | 软通过（无阻塞 + 通过性语句） | `soft_approved` | `true` |
| 3 | 当前轮次 ≥ `maxRounds`（默认 20） | `max_rounds` | `true` |
| 4 | 循环检测命中 | `loop_detected` | `true` |
| 5 | 问题递减归零（≥2 轮、issue=0、improving、无 `[CHANGES_REQUESTED]`） | `diminishing_issues` | `true` |
| 6 | 以上均不满足 | `null` | `false`（继续迭代） |

### 继续条件

当 `shouldTerminate: false` 时，工作流继续下一轮迭代。这意味着：
- Reviewer 输出了 `[CHANGES_REQUESTED]` 或无明确标记
- 尚未达到最大轮次
- 未检测到循环
- 阻塞问题仍然存在

### 循环检测

`detectLoop(current, previousOutputs)` 使用基于关键词的 Jaccard 相似度检测重复反馈：

**检查 1：近期匹配** — 当前输出与最近 4 轮中任意一轮的相似度 ≥ 0.35 则判定为循环。

**检查 2：周期性模式** — 当前输出与历史中 2 个以上非连续轮次相似度均 ≥ 0.35 则判定为循环。

#### 关键词提取

`extractKeywords(text)` 实现了语言感知的关键词提取：

- **英文** — 提取 ≥ 3 字符的单词，过滤停用词（the, this, that, with, ...）
- **中文** — 提取 CJK 字符并生成 bigram（二元组），过滤停用字（的、了、在、是、...）；同时保留有意义的单字

相似度计算使用 Jaccard 系数：`|A ∩ B| / |A ∪ B|`，阈值 `SIMILARITY_THRESHOLD = 0.35`。

### 进度追踪

`detectProgressTrend(currentIssueCount, previousOutputs)` 返回：

| 趋势 | 判定条件 |
|------|----------|
| `improving` | 当前问题数 < 上轮问题数，或从 >0 降到 0 |
| `stagnant` | 当前问题数 = 上轮问题数 且 >0 |
| `unknown` | 无历史数据或不满足以上条件 |

### 评估结果接口

```typescript
interface ConvergenceResult {
  classification: 'approved' | 'soft_approved' | 'changes_requested';
  shouldTerminate: boolean;
  reason: 'approved' | 'soft_approved' | 'max_rounds' | 'loop_detected' | 'diminishing_issues' | null;
  loopDetected: boolean;
  issueCount: number;
  progressTrend: 'improving' | 'stagnant' | 'unknown';
}
```

---

## 与工作流引擎的集成

决策引擎的两个组件在工作流引擎的不同阶段发挥作用：

### ChoiceDetector 集成点

1. **输出拦截** — 工作流引擎获取 LLM 输出后，经 `ChoiceDetector.detect()` 检查
2. **转发调度** — 检测到选择题后，调用 `buildForwardPrompt()` 生成 Prompt，调度对方 LLM 处理
3. **结果回注** — 对方 LLM 的选择结果注入回原 LLM 的上下文

`ChoiceDetector` 是**无状态**的，不维护对话历史，可在工作流任意节点复用。

### ConvergenceService 集成点

1. **审查后评估** — 工作流引擎在 `EVALUATING` 状态调用 `evaluate()` 判断是否收敛
2. **终止决策** — 根据 `shouldTerminate` 决定进入 `DONE` 状态或回到 `CODING` 状态
3. **进度报告** — `progressTrend` 和 `issueCount` 用于 UI 显示迭代进展

`ConvergenceService` 需要传入 `EvaluateContext`（包含 `currentRound` 和 `previousOutputs`），由工作流引擎负责维护。

---

## 路由流程图

```
LLM 输出文本
    │
    ├─── ChoiceDetector.detect() ────┐
    │                                │
    │   detected: false              │   detected: true
    │       │                        │       │
    │       ▼                        │       ▼
    │   正常流转                     │   buildForwardPrompt()
    │       │                        │       │
    │       │                        │       ▼
    │       │                        │   对方 LLM 回答选择
    │       │                        │       │
    │       │                        │       ▼
    │       │                        │   结果注入原 LLM 上下文
    │       │                        │       │
    │       ◄────────────────────────┘───────┘
    │
    ▼
Reviewer 输出（审查完成后）
    │
    ▼
ConvergenceService.evaluate()
    │
    ├── shouldTerminate: true
    │       │
    │       ├── reason: approved         → 工作流完成 (DONE)
    │       ├── reason: soft_approved    → 工作流完成 (DONE)
    │       ├── reason: max_rounds       → 工作流完成 (DONE)，附带警告
    │       ├── reason: loop_detected    → 工作流完成 (DONE)，附带警告
    │       └── reason: diminishing_issues → 工作流完成 (DONE)
    │
    └── shouldTerminate: false
            │
            ▼
        回到 CODING 状态，开始下一轮迭代
```

# 决策引擎模块

> 源文件: `src/decision/choice-detector.ts` | `src/decision/convergence-service.ts`
>
> 需求追溯: FR-005 (AC-016 ~ AC-019), FR-006 (AC-020 ~ AC-023)

---

## 1. 模块概览

决策引擎负责 Duo 工作流中的两个核心自动化判断：

- **Choice Detector** — 检测 LLM 输出中的选择题/提问模式，自动路由给对方 LLM 代为决策，确保 Coder-Reviewer 迭代循环不因提问而中断。
- **Convergence Service** — 分析 Reviewer 输出，判定收敛状态（通过 / 软通过 / 需修改），检测循环模式，决定是否终止迭代。当 God LLM 降级（degradation fallback）时，Convergence Service 作为基于规则的替代方案承担终止判定职责。

---

## 2. Choice Detector (`choice-detector.ts`)

### 2.1 设计策略：两层防线

采用预防 + 兜底的双层策略：

1. **系统 prompt 层（预防）**：在 Coder/Reviewer 的 prompt 模板中注入"不要提问，自主决策"的明确指令（中英双语），从源头避免 LLM 输出选择题。
2. **Regex 检测层（兜底）**：当 LLM 仍然输出选择题格式的内容时，`ChoiceDetector` 通过正则表达式拦截并自动将问题转发给对方 LLM 决策。

### 2.2 检测逻辑

`detect(text)` 返回 `ChoiceDetectionResult`，**必须同时满足两个条件才触发**：

1. 存在**问题行** — 以 `?` / `？` 结尾，或包含选择引导词
2. 存在**选项列表** — 至少匹配到 2 个选项

```typescript
interface ChoiceDetectionResult {
  detected: boolean;
  choices: string[];    // 提取到的选项文本列表
  question?: string;    // 问题行文本
}
```

#### 预处理：代码块过滤

检测前先过滤 `` ``` `` 包围的代码块内容，防止代码中的注释、字符串或测试用例触发误检测。仅对非代码块中的非空行进行模式匹配。

#### 问题行识别

两类正则协同工作，扫描所有有效行，记录**最后一个**匹配的问题行及其行号：

| 模式 | 正则 | 示例 |
|------|------|------|
| 问号结尾 | `/^.+[?？]\s*$/` | `你更倾向哪种方案？` |
| 选择引导词 | `/\b(options?\|choose\|prefer\|which\|pick\|select\|方案\|选择\|哪[个种])\b/i` | `以下是两个方案：` |

#### 支持的选项模式

| 模式 | 正则 | 示例 |
|------|------|------|
| A/B/C 点号或括号 | `/^([A-C])[.)]\s*(.+)/` | `A. 使用 React` |
| A/B/C 冒号 | `/^([A-C])[:：]\s*(.+)/` | `A: 使用 Redux` |
| 数字编号 | `/^(\d)[.)]\s*(.+)/` | `1. 方案一` |
| 中文方案 | `/^方案([一二三四五六七八九十\d]+)[：:.]?\s*(.+)/` | `方案一：使用 Redux` |
| Option N | `/^Option\s+(\d+)[：:.]\s*(.+)/i` | `Option 1: Use hooks` |
| Bullet 列表 | `/^[-•*]\s+(.+)/` | `- 使用 Context API` |

**Bullet 列表的特殊限制**：仅在问题行之后出现、且内容长度 < 120 字符时才视为选项，避免将正常段落或代码描述误判为选择题选项。

选项搜索范围：从问题行前 2 行（`Math.max(0, questionLineIdx - 2)`）到文本末尾。

### 2.3 Forward Prompt 构建

`buildForwardPrompt(result, taskContext)` 生成转发给对方 LLM 的决策 prompt：

```
Task: <任务上下文>

A decision is needed:
<原始问题文本>

Choices:
1. <选项1>
2. <选项2>
...

Reply with ONLY: the choice number, then one sentence of reasoning. Do not ask questions.
只回复：选项编号 + 一句话理由。不要提问。
```

核心设计约束：
- 提供完整的任务上下文，让对方 LLM 有足够信息做出合理判断
- 统一编号格式列出所有选项，消除原始格式差异
- 严格要求对方 LLM **只返回编号 + 一句话理由**，不允许反问，确保决策链路不发散
- 问题文本缺失时使用 `(no question text)` 作为兜底

### 2.4 无状态设计

`ChoiceDetector` 不维护任何对话历史或内部状态，每次 `detect()` 调用都是独立的。这使得它可以在工作流的任意节点被安全复用，降低耦合度。

---

## 3. Convergence Service (`convergence-service.ts`)

### 3.1 分类体系

`classify(output)` 将 Reviewer 输出分为三类，按优先级判定：

| Classification | 触发条件 | 含义 |
|----------------|---------|------|
| `approved` | 输出中包含 `[APPROVED]` marker | 正式通过 |
| `soft_approved` | 无 blocking issue + 无 `[CHANGES_REQUESTED]` + 匹配 soft approval 短语 | 语义通过（Reviewer 表达了认可但遗漏了标准 marker） |
| `changes_requested` | 其他所有情况 | 需要继续修改（保守默认分类） |

**关键设计**：只有显式的 `[APPROVED]` marker 才触发正式通过。这是保守策略——Reviewer 的客套话或模糊表述不会被误判为通过，避免提前终止迭代。

### 3.2 Soft Approval 模式

以下模式在同时满足"无 blocking issue"且"无 `[CHANGES_REQUESTED]` marker"的前提下触发 `soft_approved`：

**英文模式**：
- `LGTM`
- `looks good to me`
- `no (more) issues/problems/concerns/changes`
- `all issues resolved/fixed/addressed`
- `ship it`
- `ready to merge/ship/deploy`
- `nothing (else) to fix/change/address`

**中文模式**：
- `代码已通过`
- `没有(更多/其他)问题/意见/修改`
- `所有问题/issue已/都修复/解决/处理`
- `可以合并/提交/部署`
- `非常好`

`soft_approved` 作为 `[APPROVED]` marker 的补充机制，兜底处理 Reviewer LLM 忘记输出标准 verdict marker 但已明确表达认可的情况。

### 3.3 Blocking Issue 计数

`countBlockingIssues(output)` 采用两级计数策略：

**第一优先级：结构化输出** — 匹配 `Blocking: N` 格式行（由 Reviewer prompt template 要求产出）。匹配到后直接返回 N，不再执行 heuristic 计数。

```typescript
const explicitMatch = output.match(/^Blocking:\s*(\d+)/m);
```

**第二优先级：Heuristic fallback** — 当 Reviewer 未产出结构化计数行时，统计以下 marker 的出现次数：

| 计入 blocking 的 marker | 正则 |
|------------------------|------|
| `**Blocking**` | `/\*\*Blocking\*\*/gi` |
| `**Bug**` / `**Error**` / `**Missing**` / `**Issue**` / `**Problem**` | `/^\s*[-*]\s*\*\*(?:Bug\|Error\|Missing\|Issue\|Problem)\*\*/gim` |
| 编号问题项 | `/^\s*\d+\.\s*\*\*(?:Location\|Problem\|Bug)\*\*/gim` |

然后减去 `**Non-blocking**` marker 的数量，结果下限为 0。

### 3.4 终止条件评估

`evaluate(reviewerOutput, ctx)` 返回 `ConvergenceResult`，按优先级检查以下终止条件：

| 优先级 | Reason | 条件 | shouldTerminate |
|--------|--------|------|-----------------|
| 1 | `approved` | 输出包含 `[APPROVED]` marker | `true` |
| 2 | `soft_approved` | Soft approval 模式匹配 | `true` |
| 3 | `max_rounds` | `currentRound >= maxRounds`（默认 20） | `true` |
| 4 | `loop_detected` | Loop detection 触发 | `true` |
| 5 | `diminishing_issues` | blocking count = 0 + trend = improving + 无 `[CHANGES_REQUESTED]` + 至少经过 2 轮 | `true` |
| — | `null` | 以上均不满足 | `false`（继续迭代） |

`maxRounds` 默认值为 20（`DEFAULT_MAX_ROUNDS`），可通过 `ConvergenceServiceOptions` 配置。

### 3.5 Loop Detection（循环检测）

`detectLoop(current, previousOutputs)` 通过关键词相似度检测重复反馈模式，防止 Coder 和 Reviewer 陷入无效循环：

**规则一：近期匹配** — 当前输出与最近 4 轮中任意一轮的 Jaccard 相似度 >= 阈值 -> 判定为循环。

**规则二：周期性模式** — 历史至少 3 轮时，扫描最近 8 轮，当前输出与其中 2 轮以上相似 -> 判定为循环。扫描窗口限制为 8 轮以避免长会话中的误报。

**相似度算法**：基于关键词集合的 Jaccard similarity，阈值 `SIMILARITY_THRESHOLD = 0.45`：

```
similarity = |intersection(keywords_A, keywords_B)| / |union(keywords_A, keywords_B)|
```

#### 双语关键词提取

`extractKeywords(text)` 实现中英文双语关键词提取：

**英文处理**：
- 全文小写化
- 按非字母数字字符拆分为词
- 过滤长度 < 3 的词
- 过滤 stop words（the, this, that, with, from, have, been, was, were, are, for, and, but, not, please, could, would, should 等共 30+ 个）

**中文处理**：
- 提取 CJK 字符范围（`\u4e00-\u9fff`）
- 生成 bigram（2 字符滑动窗口）用于语义匹配
- 同时保留有意义的单字符
- 过滤中文 stop words（的、了、在、是、我、有、和、就、不、人、都 等共 30+ 个）

这种双语提取确保了中英文混合输出场景下的循环检测能力。

### 3.6 Progress Trend（进展趋势）

`detectProgressTrend(currentIssueCount, previousOutputs)` 对比当前和最近 3 轮的 blocking issue 数量，判断修复进展：

| Trend | 条件 |
|-------|------|
| `improving` | 当前 issue 数 < 上轮 issue 数，或从 >0 降到 0 |
| `stagnant` | 当前 issue 数 = 上轮 issue 数，且 >0 |
| `unknown` | 无历史数据或不满足上述条件 |

Trend 信息有两个用途：
1. 用于 `diminishing_issues` 终止条件的判断（需要 `improving`）
2. 供 UI 层展示迭代进展状态

### 3.7 评估结果接口

```typescript
interface ConvergenceResult {
  classification: 'approved' | 'soft_approved' | 'changes_requested';
  shouldTerminate: boolean;
  reason: 'approved' | 'soft_approved' | 'max_rounds'
        | 'loop_detected' | 'diminishing_issues' | null;
  loopDetected: boolean;
  issueCount: number;
  progressTrend: 'improving' | 'stagnant' | 'unknown';
}
```

### 3.8 God 降级 Fallback 角色

当 God LLM（编排层）不可用或发生降级时，Convergence Service 承担其部分职责——作为基于规则的终止判定引擎运行。此时终止判定完全依赖于上述确定性规则（marker 匹配、issue 计数、循环检测），而非 God LLM 的智能判断。这种设计确保了即使 God LLM 不可用，工作流仍能可靠地自动终止。

---

## 4. 协作流程

```
LLM 输出文本
    |
    +--- ChoiceDetector.detect()
    |       |
    |       +- detected: false -> 继续正常流程
    |       |
    |       +- detected: true
    |               |
    |               v
    |           buildForwardPrompt()
    |               |
    |               v
    |           转发给对方 LLM 决策
    |               |
    |               v
    |           用决策结果替换原始选择题
    |               |
    |               v
    |           回到正常流程
    |
    +--- ConvergenceService.evaluate()（仅 Reviewer 输出）
            |
            +-- shouldTerminate: true
            |       |
            |       +-- reason: approved          -> 工作流正常完成
            |       +-- reason: soft_approved     -> 工作流正常完成
            |       +-- reason: max_rounds        -> 工作流完成（附带最大轮次警告）
            |       +-- reason: loop_detected     -> 工作流完成（附带循环检测警告）
            |       +-- reason: diminishing_issues -> 工作流完成（问题已消减）
            |
            +-- shouldTerminate: false -> 继续下一轮 Coder -> Reviewer 循环
```

---

## 5. 关键设计决策

| 决策 | 理由 |
|------|------|
| 只认 `[APPROVED]` marker 为正式通过 | 保守策略，避免 Reviewer 的客套话或模糊表述被误判为通过 |
| Soft approval 作为补充机制 | 兜底处理 Reviewer 忘记标记但已明确表达认可的场景 |
| Jaccard similarity + 双语 bigram | 轻量级相似度计算，无需 embedding 模型或外部依赖，原生支持中英文混合 |
| 相似度阈值 0.45 | 平衡灵敏度与误报率——低于此值的输出通常包含足够多的新信息 |
| Bullet 列表长度限制 120 字符 | 避免将正常的代码描述段落误判为选择题选项 |
| 代码块过滤 | 防止代码注释中的问号或列表格式触发误检测 |
| 默认 maxRounds = 20 | 防止无限迭代，可通过配置覆盖 |
| Diminishing issues 至少 2 轮 | 避免首轮就因 issue = 0 而误终止 |
| 双层 issue 计数（结构化优先 + heuristic fallback） | 结构化 `Blocking: N` 最可靠；heuristic 兜底处理非标准格式 |
| ChoiceDetector 无状态 | 不维护任何历史或内部状态，可在工作流任意节点安全复用 |
| Loop detection 扫描窗口限 8 轮 | 避免长会话中早期不相关输出导致误判 |
| 规则引擎作为 God 降级 fallback | 确保 God LLM 不可用时工作流仍能基于确定性规则自动终止 |

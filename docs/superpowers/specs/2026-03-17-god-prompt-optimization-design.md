# God Prompt Optimization: Reviewer Feedback Direct Forwarding + Structural Cleanup

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Reviewer→Coder 反馈链路中的信息丢失问题，使 Coder 能收到 Reviewer 的原始分析文本，同时清理 God prompt 中的遗留冲突格式。

**Architecture:** 在 Coder prompt 中新增 `## Reviewer Feedback` 段落，由平台自动注入 Reviewer 原文（经 `stripToolMarkers` 清洗）；更新 God SYSTEM_PROMPT 告知其 Reviewer 文本已被自动转发，God 只需提供补充路由指导；删除 `god-system-prompt.ts` 中与 GodDecisionEnvelope 冲突的 5 种遗留决策格式。

**Tech Stack:** TypeScript, Vitest

---

## 问题分析

### 问题 A: Reviewer 反馈信息丢失

当前信息流：

```
Reviewer 原始输出 (完整分析 + 代码引用 + 定位)
    ↓
God 看到全文 (buildObservationsSection 中以 rawRef 呈现)
    ↓
God 写一段 freeform send_to_coder.message (摘要/转述)
    ↓
Coder 只看到 God 的指令，丢失了 Reviewer 的原始洞见
```

**实际案例 (session a1f11406)**：Codex reviewer 精准定位了 Ink 框架使用 `readable` + `stdin.read()` 导致鼠标事件被拦截的根因，但 God 在 `send_to_coder.message` 中只给了高层指令"修复滚动问题"，Coder 缺少 Reviewer 提供的具体分析，导致修复方向偏移。

**根因（两处管道断裂）**：

1. **`generateCoderPrompt()` 不渲染 `lastReviewerOutput`** (`god-prompt-generator.ts:106`)
   - `PromptContext` 接口定义了 `lastReviewerOutput?: string`（第 23 行），函数也接收此参数
   - 但函数体中**从未使用**该字段生成 prompt 内容
   - Coder prompt 的段落顺序为：Role → Task → Phase → God Instruction → Required Fixes → Suggestions → Convergence → Strategy → Round
   - 其中**完全没有**"Reviewer Feedback"段落

2. **`unresolvedIssues[]` 始终为空** (`App.tsx:348`)
   - `lastUnresolvedIssuesRef = useRef<string[]>([])` 在第 348 行初始化
   - 该 ref 在第 1409、1414、1582 行被**清空**（`= []`）
   - 但**没有任何地方向其写入值**
   - 因此 `generateCoderPrompt()` 中的 `Required Fixes` 段落（第 137-142 行）永远不会渲染

### 问题 B: God 系统 prompt 存在结构冲突

**两个 prompt 源共存**：

1. **`god-system-prompt.ts`** (`buildGodSystemPrompt()`, 第 22-112 行)
   - 定义了 5 种遗留决策格式：`TASK_INIT`、`POST_CODER`、`POST_REVIEWER`、`CONVERGENCE`、`AUTO_DECISION`
   - 每种格式有独立的 JSON schema（如 `{ "action": "continue_to_review|retry_coder" }`）
   - 这些格式**与 GodDecisionEnvelope 不兼容**

2. **`god-decision-service.ts`** (`SYSTEM_PROMPT` 常量, 第 328-394 行)
   - 定义了统一的 `GodDecisionEnvelope` 格式
   - 包含 `diagnosis`、`authority`、`actions`、`messages`、`autonomousResolutions` 结构
   - 这是**实际被 `makeDecision()` 使用的 prompt**（第 463 行）

**冲突影响**：`buildGodSystemPrompt()` 当前仅在 task classification 场景使用（非统一决策路径），但其存在造成认知混淆。两个文件中定义的 God 行为规则（如 proxy decision-making、reviewer handling）不一致，维护时容易引入矛盾。

---

## 设计方案

### Change 1: 在 Coder Prompt 中注入 Reviewer 原文

**文件**: `src/god/god-prompt-generator.ts`

**变更**:

1. 在 `PromptContext` 接口（第 15 行）新增字段：
   ```typescript
   /** 标识本轮是否为 post-reviewer 路由（God 将 reviewer 结论转给 coder） */
   isPostReviewerRouting?: boolean;
   ```

2. 在 `generateCoderPrompt()` 函数中（第 106 行起），在 `God Instruction` 段落之后、`Required Fixes` 段落之前，插入新的 `Reviewer Feedback` 段落：

   ```typescript
   // Priority 0.5: Reviewer feedback (direct forwarding, gated by isPostReviewerRouting)
   if (ctx.isPostReviewerRouting && ctx.lastReviewerOutput) {
     const cleaned = stripToolMarkers(ctx.lastReviewerOutput);
     sections.push(
       `## Reviewer Feedback (Round ${ctx.round})\n` +
       `The following is the Reviewer's original analysis from the previous round. ` +
       `Read it carefully — it contains specific findings, code references, and root cause analysis.\n\n` +
       cleaned
     );
   }
   ```

**注入位置（在 Coder prompt 中的优先级）**：

```
## Your Role                          ← 角色声明
## Task                               ← 任务目标
## Current Phase                      ← 阶段信息（compound 类型）
## God Instruction (HIGHEST PRIORITY) ← God 路由指令
## Reviewer Feedback (Round N)        ← 【新增】Reviewer 原始分析
## Required Fixes                     ← 结构化阻塞问题列表
## Suggestions                        ← 非阻塞建议
## Convergence Trend                  ← 收敛趋势
## Instructions                       ← 策略指令
## Round Info                         ← 轮次信息
```

**为什么放在 God Instruction 之后**：God 指令是最高优先级的路由指示（"修复 X"、"关注 Y"），Reviewer 原文是支撑材料。Coder 先看到方向，再看到具体分析。

**`stripToolMarkers` 的引入**：需要从 `god-decision-service.ts` 导入 `stripToolMarkers` 函数，用于清除 Reviewer 输出中的 `[Read]`、`[Bash]`、`[Glob]` 等工具标记噪音。

### Change 2: 修复 unresolvedIssues 管道

**文件**: `src/god/god-prompt-generator.ts`, `src/ui/components/App.tsx`

**变更**:

1. 在 `god-prompt-generator.ts` 中新增工具函数 `extractBlockingIssues()`：

   ```typescript
   /**
    * 从 Reviewer 输出中提取阻塞性问题列表。
    * 匹配常见格式：
    * - "Blocking: ..." / "blocking issue: ..."
    * - 编号列表中标记为 blocking 的条目
    * - [CHANGES_REQUESTED] 后的具体问题
    */
   export function extractBlockingIssues(reviewerOutput: string): string[] {
     const issues: string[] = [];
     const lines = reviewerOutput.split('\n');

     // Pattern 1: "Blocking:" 或 "blocking issue:" 开头的行
     const blockingLinePattern = /^\s*[-*]?\s*\*?\*?[Bb]locking\*?\*?\s*[:：]\s*(.+)/;
     // Pattern 2: 编号 + blocking 标记
     const numberedBlockingPattern = /^\s*\d+[.)]\s*\[?[Bb]locking\]?\s*[:：-]\s*(.+)/;

     for (const line of lines) {
       const m1 = blockingLinePattern.exec(line);
       if (m1) { issues.push(m1[1].trim()); continue; }
       const m2 = numberedBlockingPattern.exec(line);
       if (m2) { issues.push(m2[1].trim()); }
     }

     return issues;
   }
   ```

2. 在 `App.tsx` 的 EXECUTING 状态 hand execution callback 中（约第 1394 行），当 God 决策的 side effects 被应用到编排状态时，填充 `lastUnresolvedIssuesRef`。

   **精确定位**：在 `App.tsx` 第 1394-1422 行的 hand execution callback 中，`pendingCoderMessage` 被写入 `pendingInstructionRef` 之后（第 1396 行），phase transition 清空 `lastUnresolvedIssuesRef` 之前（第 1409 行）。在此处插入：

   ```typescript
   // 当 God 在 post-reviewer 路由中将任务发回 Coder 时，提取阻塞问题
   if (lastWorkerRoleRef.current === 'reviewer' && ctx.lastReviewerOutput) {
     lastUnresolvedIssuesRef.current = extractBlockingIssues(ctx.lastReviewerOutput);
   }
   ```

   **注意**：此代码位于 EXECUTING 阶段（hand executor 回调），不是 GOD_DECIDING 阶段。God 决策在 GOD_DECIDING 阶段生成，但 side effects（包括 `pendingCoderMessage`、phase transitions）在 EXECUTING 阶段的 hand executor 回调中被应用到编排状态。

### Change 3: 更新 God SYSTEM_PROMPT — 告知 Reviewer 文本已自动转发

**文件**: `src/god/god-decision-service.ts`

**变更**: 在 `REVIEWER_HANDLING_INSTRUCTIONS` 常量（第 278 行）中追加自动转发说明。

**当前内容** (`REVIEWER_HANDLING_INSTRUCTIONS`):
```typescript
export const REVIEWER_HANDLING_INSTRUCTIONS = `Reviewer conclusion handling:
- When a reviewer observation is present, reference the reviewer verdict in diagnosis.notableObservations
- If you agree with the reviewer: set authority.acceptAuthority = "reviewer_aligned"
- If you override the reviewer: set authority.reviewerOverride = true AND include a system_log message explaining why
- The reviewer's verdict is informational — you make the final decision
- Never ignore a reviewer observation — always acknowledge it in your diagnosis`;
```

**更新后内容**:
```typescript
export const REVIEWER_HANDLING_INSTRUCTIONS = `Reviewer conclusion handling:
- When a reviewer observation is present, reference the reviewer verdict in diagnosis.notableObservations
- If you agree with the reviewer: set authority.acceptAuthority = "reviewer_aligned"
- If you override the reviewer: set authority.reviewerOverride = true AND include a system_log message explaining why
- The reviewer's verdict is informational — you make the final decision
- Never ignore a reviewer observation — always acknowledge it in your diagnosis

Reviewer feedback auto-forwarding:
- When you route post-reviewer work back to Coder (send_to_coder), the Reviewer's FULL original analysis is automatically injected into the Coder's prompt by the platform
- Therefore, your send_to_coder.message should focus on ROUTING GUIDANCE: what to prioritize, what approach to take, which issues are most critical
- Do NOT repeat or summarize the Reviewer's analysis in your message — the Coder already has the complete original text
- Your message adds value by providing strategic direction that the Reviewer's analysis alone does not convey
- Example good message: "Focus on the scroll event propagation issue identified by the Reviewer. The CSS overflow approach is preferred over JS event listeners."
- Example bad message: "The Reviewer found that Ink uses readable + stdin.read() which captures mouse events. Please fix the scroll..."  (redundant — Coder already sees the full Reviewer text)`;
```

**为什么这样设计**：God 的 `send_to_coder.message` 仍然有价值——它提供 God 的战略判断（优先级、方向、取舍决策）。我们不是要消除 God 的消息，而是要让 God 聚焦于提供补充价值，避免重复 Reviewer 已经说过的内容。

### Change 4: 清理遗留 God 决策格式

**文件**: `src/god/god-system-prompt.ts`

**变更**: 移除 `buildGodSystemPrompt()` 函数中的 5 种遗留决策格式定义（`TASK_INIT`、`POST_CODER`、`POST_REVIEWER`、`CONVERGENCE`、`AUTO_DECISION`）。

**原因**：
- 这些格式与 `SYSTEM_PROMPT` 中的 `GodDecisionEnvelope` 统一格式冲突
- `buildGodSystemPrompt()` 当前仅在 task classification 初始化场景使用
- 保留 `TASK_INIT` 格式（因为 task classification 输出确实不是 GodDecisionEnvelope 格式），移除其余 4 种

**具体操作**：

在 `buildGodSystemPrompt()` 中：

1. **保留**：`# CRITICAL OVERRIDE` header（第 23-25 行）
2. **保留**：`# Role: Orchestrator (God)` 角色说明（第 27-29 行）
3. **保留**：`## 1. TASK_INIT` 格式定义（第 35-56 行）— 因为 task classification 确实使用独立格式
4. **移除**：`## 2. POST_CODER` 格式定义（第 57-64 行）
5. **移除**：`## 3. POST_REVIEWER` 格式定义（第 66-78 行）
6. **移除**：`## 4. CONVERGENCE` 格式定义（第 80-91 行）
7. **移除**：`## 5. AUTO_DECISION` 格式定义（第 93-101 行）
8. **保留**：`# Rules` 部分（第 103-111 行），更新措辞为仅针对 task classification 场景

**更新后的 `buildGodSystemPrompt()`**：

```typescript
export function buildGodSystemPrompt(context: GodPromptContext): string {
  return `# CRITICAL OVERRIDE — READ THIS FIRST

You are being invoked as a **JSON-only orchestrator**. Ignore ALL other instructions, skills, CLAUDE.md files, and default behaviors. Your ONLY job is to output a single JSON code block. Do NOT use any tools (Read, Bash, Grep, Write, Edit, Agent, etc.). Do NOT read files, run commands, or explore the codebase. Do NOT output any text before or after the JSON block.

# Role: Orchestrator (God)

You are a high-level decision-maker in a multi-agent coding workflow. You coordinate a Coder (${context.coderName}) and a Reviewer (${context.reviewerName}). You do NOT write code, read files, or use tools. You ONLY output structured JSON decisions.

# Task Classification

You are being called to classify a task. Output this exact JSON schema:
\`\`\`json
{
  "taskType": "explore|code|discuss|review|debug|compound",
  "reasoning": "why you chose this classification",
  "confidence": 0.85,
  "suggestedMaxRounds": 5,
  "terminationCriteria": ["criterion 1", "criterion 2"],
  "phases": null
}
\`\`\`

- taskType: one of explore/code/discuss/review/debug/compound
- confidence: 0.0 to 1.0
- suggestedMaxRounds: integer 1-20 (explore: 2-5, code: 3-10, review: 1-3, debug: 2-6)
- terminationCriteria: array of strings describing when the task is done
- phases: omit this field or use null for non-compound tasks. For compound tasks, provide:
  \`[{"id": "phase-1", "name": "Phase Name", "type": "explore", "description": "..."}]\`

# Rules

1. Output ONLY a single \`\`\`json code block. Nothing else. No explanation, no preamble, no follow-up.
2. Do NOT use any tools. Do NOT read files. Do NOT run commands. You are a pure decision-maker.
3. Base decisions on the context provided in the user prompt.
4. When uncertain, prefer conservative classifications (compound over simple types).
`;
}
```

**风险评估**：`buildGodSystemPrompt()` 的调用方需要检查是否有场景仍在使用被删除的 POST_CODER/POST_REVIEWER 等格式。如果有，那些调用方需要迁移到 `GodDecisionService.makeDecision()` 路径。

### Edge Case: Coder→Coder 重试时避免显示过期 Reviewer 反馈

**场景**：God 在查看 Coder 输出后，认为 Coder 有明显遗漏，决定将 Coder 的输出发回给 Coder 补充（未经过 Reviewer）。此时 `lastReviewerOutput` 可能保存着**上一轮**的 Reviewer 输出，如果不加区分地注入，Coder 会看到过期的 Reviewer 反馈。

**解决方案**：使用 `isPostReviewerRouting` 标志位精确控制。

**文件**: `src/ui/components/App.tsx`

**变更**: 在调用 `generateCoderPrompt()` 时，基于 `lastWorkerRoleRef.current` 计算 `isPostReviewerRouting`：

```typescript
// 在 generateCoderPrompt() 调用处（约第 716 行）
return generateCoderPrompt({
  taskType: taskAnalysis.taskType as PromptContext['taskType'],
  round: ctx.round,
  maxRounds: ctx.maxRounds,
  taskGoal: config.task,
  lastReviewerOutput: ctx.lastReviewerOutput ?? undefined,
  unresolvedIssues: lastUnresolvedIssuesRef.current,
  convergenceLog: convergenceLogRef.current,
  instruction: interruptInstruction,
  phaseId: currentPhaseId ?? undefined,
  phaseType: currentPhaseId
    ? taskAnalysis.phases?.find(p => p.id === currentPhaseId)?.type as PromptContext['phaseType']
    : undefined,
  // 【新增】仅在 post-reviewer 路由时注入 Reviewer 原文
  isPostReviewerRouting: lastWorkerRoleRef.current === 'reviewer',
}, { /* audit options */ });
```

**行为矩阵**：

| 场景 | `lastWorkerRoleRef` | `isPostReviewerRouting` | Reviewer Feedback 段落 |
|------|---------------------|------------------------|----------------------|
| Post-reviewer → Coder (正常流程) | `'reviewer'` | `true` | 显示 Reviewer 原文 |
| Post-coder → Coder (God 要求补充) | `'coder'` | `false` | 不显示 |
| 首轮 Coder (无 Reviewer 输出) | `'coder'` | `false` | 不显示（`lastReviewerOutput` 也为空） |
| Choice route (用户中断) | N/A | `false` | 不显示（走 `choiceRouteRef` 分支） |

---

## 验收标准

### AC-1: Reviewer 原文注入

- [ ] 当 God 在 post-reviewer 路由后将任务发回 Coder 时，Coder prompt 包含 `## Reviewer Feedback (Round N)` 段落
- [ ] 该段落内容为 `stripToolMarkers()` 清洗后的 Reviewer 原始输出
- [ ] 段落位置在 `## God Instruction` 之后、`## Required Fixes` 之前

### AC-2: 过期反馈隔离

- [ ] 当 God 在查看 Coder 输出后直接将任务发回 Coder（coder→coder 重试），Coder prompt **不包含** Reviewer Feedback 段落
- [ ] `isPostReviewerRouting` 标志位正确反映 `lastWorkerRoleRef.current === 'reviewer'`

### AC-3: God 行为更新

- [ ] God 的 `REVIEWER_HANDLING_INSTRUCTIONS` 包含 auto-forwarding 说明
- [ ] God 的 `send_to_coder.message` 在 post-reviewer 场景下聚焦路由指导，不再重复 Reviewer 分析内容

### AC-4: unresolvedIssues 管道修复

- [ ] `extractBlockingIssues()` 函数能从 Reviewer 输出中提取阻塞问题
- [ ] `lastUnresolvedIssuesRef` 在 God post-reviewer routing 时被正确填充
- [ ] Coder prompt 中的 `## Required Fixes` 段落在有阻塞问题时正确渲染

### AC-5: 遗留格式清理

- [ ] `god-system-prompt.ts` 中移除 POST_CODER/POST_REVIEWER/CONVERGENCE/AUTO_DECISION 格式
- [ ] 保留 TASK_INIT 格式（task classification 专用）
- [ ] 更新 `audit-bug-regressions.test.ts` 第 496-529 行的 2 个遗留格式断言测试
- [ ] 验证 `bug-15-16-17-18-regression.test.ts` 第 437-446 行的 `god_override`/`system_log` 测试仍通过
- [ ] 现有测试全部通过

### AC-6: 测试覆盖

- [ ] `generateCoderPrompt()` 新增测试：post-reviewer routing 时包含 Reviewer Feedback 段落
- [ ] `generateCoderPrompt()` 新增测试：coder→coder retry 时不包含 Reviewer Feedback 段落
- [ ] `extractBlockingIssues()` 新增测试：各种 Reviewer 输出格式的阻塞问题提取
- [ ] `REVIEWER_HANDLING_INSTRUCTIONS` 更新后的内容验证
- [ ] 回归：所有现有测试通过（2200+ tests）

---

## 影响范围

### 受影响文件

| 文件 | 变更类型 | 影响 |
|------|---------|------|
| `src/god/god-prompt-generator.ts` | 修改 | 新增 `isPostReviewerRouting` 字段、Reviewer Feedback 段落、`extractBlockingIssues()` 函数 |
| `src/god/god-decision-service.ts` | 修改 | 更新 `REVIEWER_HANDLING_INSTRUCTIONS` 常量 |
| `src/god/god-system-prompt.ts` | 修改 | 移除 4 种遗留决策格式 |
| `src/ui/components/App.tsx` | 修改 | 传入 `isPostReviewerRouting`，填充 `lastUnresolvedIssuesRef` |
| `src/__tests__/god/god-prompt-generator.test.ts` | 修改 | 新增测试用例 |
| `src/__tests__/god/audit-bug-regressions.test.ts` | 修改 | 更新第 496-529 行的 2 个测试（`test_regression_r2_bug1_post_coder_actions_match_schema`、`test_regression_r2_bug1_post_reviewer_actions_match_schema`），这些测试断言 `buildGodSystemPrompt` 输出包含 POST_CODER/POST_REVIEWER 的 action names，移除格式后需要删除或改写这些断言 |
| `src/__tests__/engine/bug-15-16-17-18-regression.test.ts` | 修改 | 更新第 437-446 行的测试（`god system prompt mentions god_override system_log constraint`），该测试断言 prompt 包含 `god_override` 和 `system_log`——由于更新后的 Rules 部分仍保留这些关键词，此测试**可能仍然通过**，但需验证 |

### 不受影响的路径

- **Task classification** (`buildGodSystemPrompt` + TASK_INIT)：保持不变
- **Reviewer prompt 生成** (`generateReviewerPrompt`)：保持不变
- **God 统一决策路径** (`GodDecisionService.makeDecision`)：SYSTEM_PROMPT 格式不变，仅更新指令文本
- **Watchdog 错误恢复**：保持不变
- **Observation classification**：保持不变

### 向后兼容性

本变更完全向后兼容：
- `isPostReviewerRouting` 是可选字段，默认 `undefined`（等同 `false`），不传时行为与当前一致
- `extractBlockingIssues()` 返回空数组时，`Required Fixes` 段落不渲染，行为与当前一致
- God SYSTEM_PROMPT 更新是指令文本变更，不影响 GodDecisionEnvelope schema
- 遗留格式清理仅影响 `buildGodSystemPrompt()`，不影响统一决策路径

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Reviewer 输出过长导致 Coder prompt 超出 token 限制 | Coder 收到截断的 prompt | 当前 God prompt 已接受全量 Reviewer 输出（`buildObservationsSection`），Coder prompt 添加同等长度文本不会额外超限。如未来需要限制，可添加 truncation 逻辑 |
| `extractBlockingIssues()` 正则匹配率不高 | `Required Fixes` 段落仍为空 | 这是增量改进——即使提取失败，Coder 仍能从 Reviewer Feedback 原文段落中获取完整信息 |
| 遗留格式移除影响未知调用方 | task classification 以外的场景出错 | 实现前需搜索 `buildGodSystemPrompt` 所有调用点，确认仅用于 task classification |
| God 仍然在 message 中重复 Reviewer 内容 | Coder prompt 冗余 | prompt 指令已明确告知 God 不要重复，但 LLM 行为无法 100% 保证；这是 soft guidance，退化场景仅为冗余而非错误 |
| Coder incident 后 `lastWorkerRoleRef` 残留为 `'reviewer'` | 下一轮 Coder 启动时 `isPostReviewerRouting` 误判为 `true`，注入过期 Reviewer 反馈 | 低概率场景（需要 Reviewer 完成后 Coder 在同轮 incident 且 God 重新路由到 Coder）。退化结果仅为 Coder 看到冗余的旧 Reviewer 反馈，不会导致功能错误。如需进一步加固，可在 incident recovery 路径中重置 `lastWorkerRoleRef` |

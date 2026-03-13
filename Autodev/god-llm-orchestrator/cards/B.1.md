# Card B.1: 动态 Prompt 生成 Reviewer-Driven

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-003: 动态 Prompt 生成 (AC-013, AC-014, AC-015)
- FR-003a: 任务类型 → Prompt 策略映射
- FR-003b: Reviewer-Driven Prompt 组装优先级
- FR-003c: Prompt 质量保证

从 `docs/requirements/god-llm-todolist.md` 读取：
- B-1 任务描述和验证标准

## 读取已有代码
- `src/god/task-init.ts` — GodTaskAnalysis（Card A.3 已创建）
- `src/god/god-system-prompt.ts` — buildGodSystemPrompt（Card A.2 已创建）
- `src/god/god-audit.ts` — appendAuditLog（Card A.3 已创建）
- `src/types/god-schemas.ts` — schema 定义
- `src/session/context-manager.ts` — 旧 ContextManager（参考，被替代）
- `src/engine/workflow-machine.ts` — WorkflowContext

## 任务

### 1. 创建 God Prompt 生成器
创建 `src/god/god-prompt-generator.ts`：

```typescript
export interface PromptContext {
  taskType: TaskType;
  round: number;
  maxRounds: number;
  phaseId?: string;
  lastReviewerOutput?: string;
  unresolvedIssues?: string[];
  suggestions?: string[];
  convergenceLog?: ConvergenceLogEntry[];
  taskGoal: string;
}

export function generateCoderPrompt(ctx: PromptContext): string
export function generateGodDecisionPrompt(ctx: GodDecisionContext): string
```

### 2. 任务类型 → Prompt 策略映射 (FR-003a)
- explore 型：禁止执行动词（implement/create/write code）
- code 型：包含编码指令和质量要求
- compound 型：随阶段切换策略
- review 型：审查指令
- debug 型：调试指令
- discuss 型：讨论指令

### 3. Reviewer-Driven Prompt 组装 (FR-003b)
优先级顺序：
1. 上一轮 unresolvedIssues（作为 Coder 必做清单）
2. Reviewer suggestions（非阻塞建议）
3. 任务目标 + 阶段 + convergenceLog 趋势
4. 轮次号和剩余轮次

### 4. Prompt 质量保证 (FR-003c)
- explore 型不含执行动词检查
- prompt 长度不超过合理限制
- prompt 内容摘要（≤ 500 字符）写入 audit log

### 5. 编写测试
在 `src/__tests__/god/god-prompt-generator.test.ts` 中：
- explore 型 prompt 不包含 implement/create/write code 等动词
- code 型 prompt 包含编码指令和质量要求
- Coder prompt 中 unresolvedIssues 列为首要待办
- prompt 摘要写入 audit log
- compound 型随阶段切换 prompt 策略

## 验收标准
- [ ] AC-1: explore 型 prompt 不包含 "implement/create/write code" 等动词
- [ ] AC-2: code 型 prompt 包含编码指令和质量要求
- [ ] AC-3: Coder prompt 中 unresolvedIssues 列为首要待办
- [ ] AC-4: prompt 长度不超过合理限制
- [ ] AC-5: prompt 摘要写入 audit log
- [ ] AC-6: 所有测试通过: `npx vitest run`
- [ ] AC-7: 现有测试不受影响

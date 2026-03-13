# Card A.1: God JSON 提取器 + Zod Schema 定义

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- AR-002: God 输出通过 JSON 代码块提取
- OQ-002: God 输出格式约束
- OQ-003: 多 JSON 块取最后一个
- FR-001: GodTaskAnalysis 接口定义
- FR-004: GodPostCoderDecision, GodPostReviewerDecision 接口定义
- FR-005: GodConvergenceJudgment 接口定义
- FR-008: GodAutoDecision 接口定义

从 `docs/requirements/god-llm-todolist.md` 读取：
- A-1 任务描述和验证标准

## 读取已有代码
- `src/parsers/god-json-extractor.ts` — 已有 God JSON 提取器实现（检查是否完整）
- `src/types/god-schemas.ts` — 已有 Zod schema 定义（检查是否完整）
- `src/parsers/index.ts` — parser 导出入口
- `src/__tests__/parsers/` — 现有 parser 测试，了解测试模式

## 任务

### 1. 校验并完善 Zod Schema 定义
确认 `src/types/god-schemas.ts` 包含所有 5 个 schema：
- `GodTaskAnalysisSchema` — 含 taskType, reasoning, phases(optional), suggestedMaxRounds, terminationCriteria
- `GodPostCoderDecisionSchema` — 含 action(continue_to_review/retry_coder/request_user_input), reasoning, retryHint(optional)
- `GodPostReviewerDecisionSchema` — 含 action(route_to_coder/converged/phase_transition/loop_detected/request_user_input), reasoning, unresolvedIssues(optional), confidenceScore, progressTrend
- `GodConvergenceJudgmentSchema` — 含 classification, shouldTerminate, reason(nullable), blockingIssueCount, criteriaProgress, reviewerVerdict
- `GodAutoDecisionSchema` — 含 action(accept/continue_with_instruction/request_human), reasoning, instruction(optional)

对照设计文档确认字段名称和类型是否一致。

### 2. 校验并完善 God JSON 提取器
确认 `src/parsers/god-json-extractor.ts` 实现：
- `extractGodJson<T>(output, schema)`: 提取最后一个 ```json ... ``` 块 + Zod 校验
- 返回 `ExtractResult<T> | null`
- 多个 JSON 块时取最后一个
- 纯文本（无 JSON 块）返回 null
- JSON 解析失败返回结构化错误
- Schema 校验失败返回结构化错误

### 3. 实现校验失败重试逻辑
在 God JSON 提取器中添加重试函数：
```typescript
export async function extractWithRetry<T>(
  output: string,
  schema: z.ZodSchema<T>,
  retryFn: (errorHint: string) => Promise<string>,
): Promise<ExtractResult<T> | null>
```
- 首次提取失败（schema 校验错误）时，调用 retryFn 传入格式纠错提示
- 重试 1 次后仍失败则返回 null
- 纯文本（无 JSON 块）不重试，直接返回 null

### 4. 编写完整测试
在 `src/__tests__/parsers/god-json-extractor.test.ts` 中编写测试：
- 从 mock CLI 输出中正确提取 JSON
- 所有 5 个 schema 编译通过且能校验正确/错误数据
- 多个 JSON 块时提取最后一个
- 纯文本输出返回 null
- JSON 解析错误返回结构化错误
- Schema 校验失败返回结构化错误
- 重试逻辑：首次失败 → retryFn 被调用 → 第二次成功
- 重试逻辑：两次都失败 → 返回 null

## 验收标准
- [ ] AC-1: 从 mock CLI 输出中正确提取 JSON 代码块
- [ ] AC-2: 所有 5 个 Zod schema 定义完整且编译通过
- [ ] AC-3: schema 校验失败时返回结构化错误信息（含路径和原因）
- [ ] AC-4: 多个 JSON 块时提取最后一个
- [ ] AC-5: 纯文本输出（无 JSON 块）时返回 null
- [ ] AC-6: extractWithRetry 重试 1 次附带格式纠错提示，仍失败返回 null
- [ ] AC-7: 所有测试通过: `npx vitest run`
- [ ] AC-8: 现有测试不受影响

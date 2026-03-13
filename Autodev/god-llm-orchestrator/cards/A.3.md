# Card A.3: 意图解析 + 任务分类 + 动态轮次

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-001: 用户意图解析 (AC-001, AC-002, AC-003)
- FR-002: 任务分类 (AC-008, AC-009)
- FR-007: 动态轮次 (AC-023, AC-024)
- OQ-001: God system prompt 设计
- GodTaskAnalysis 接口定义

从 `docs/requirements/god-llm-todolist.md` 读取：
- A-3 任务描述和验证标准

## 读取已有代码
- `src/types/god-schemas.ts` — GodTaskAnalysisSchema（Card A.1 已完善）
- `src/parsers/god-json-extractor.ts` — extractGodJson, extractWithRetry（Card A.1 已完善）
- `src/god/god-system-prompt.ts` — buildGodSystemPrompt（Card A.2 已创建）
- `src/types/session.ts` — SessionConfig（Card A.2 已扩展，含 god 字段）
- `src/engine/workflow-machine.ts` — WorkflowContext, XState 状态机
- `src/adapters/registry.ts` — adapter 注册
- `src/types/adapter.ts` — adapter 接口

## 任务

### 1. 实现 God TASK_INIT 服务
创建 `src/god/task-init.ts`：

```typescript
export interface TaskInitResult {
  analysis: GodTaskAnalysis;
  rawOutput: string;
}

export async function initializeTask(
  godAdapter: CLIAdapter,
  taskPrompt: string,
  systemPrompt: string,
): Promise<TaskInitResult | null>
```

- 通过 God adapter 调用 CLI，传入用户任务描述 + God system prompt
- 从 God CLI 输出中提取 GodTaskAnalysis JSON 块
- 校验失败时使用 extractWithRetry 重试 1 次
- 仍失败返回 null（调用方决定 fallback）

### 2. 任务类型分类逻辑
6 种任务类型：explore / code / discuss / review / debug / compound
- compound 类型必须包含 phases 数组
- suggestedMaxRounds 基于任务类型：
  - explore: 2-5
  - code: 3-10
  - review: 1-3
  - debug: 2-6
  - discuss: 2-5
  - compound: 取决于 phases

### 3. 动态轮次调整
在 God 决策中支持运行时 maxRounds 调整：
```typescript
export function applyDynamicRounds(
  currentMax: number,
  suggested: number,
  taskType: TaskType,
): number
```
- 返回调整后的 maxRounds
- 需要更新 XState context

### 4. God Audit Log 接口
创建 `src/god/god-audit.ts`：
```typescript
export interface GodAuditEntry {
  seq: number;
  timestamp: string;
  round: number;
  decisionType: string;
  inputSummary: string;   // ≤ 500 chars
  outputSummary: string;  // ≤ 500 chars
  decision: unknown;
  model?: string;
  phaseId?: string;
}

export function appendAuditLog(sessionDir: string, entry: GodAuditEntry): void
```

### 5. 编写测试
在 `src/__tests__/god/task-init.test.ts` 中：
- initializeTask 从 mock adapter 输出中正确提取 GodTaskAnalysis
- 6 种任务类型分类验证
- compound 类型输出包含有效 phases 数组
- suggestedMaxRounds 在合理范围内
- 动态轮次调整正确
- schema 校验失败时重试逻辑触发
- God audit log 正确追加

## 验收标准
- [ ] AC-1: initializeTask 从 God CLI 输出中正确提取 GodTaskAnalysis
- [ ] AC-2: 6 种任务类型分类（explore/code/discuss/review/debug/compound）
- [ ] AC-3: compound 类型输出包含有效 phases 数组
- [ ] AC-4: suggestedMaxRounds 在合理范围内（按类型约束）
- [ ] AC-5: 动态轮次调整正确写入并可更新 maxRounds
- [ ] AC-6: 分类结果写入 God audit log
- [ ] AC-7: 所有测试通过: `npx vitest run`
- [ ] AC-8: 现有测试不受影响

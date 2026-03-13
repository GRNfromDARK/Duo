# Card F.3: WAITING_USER 代理决策 + 逃生窗口

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-008: WAITING_USER 代理决策 (AC-025, AC-026, AC-027)

从 `docs/requirements/god-llm-todolist.md` 读取：
- F-3 任务描述和验证标准

## 读取已有代码
- `src/god/god-router.ts` — God 决策能力（Card B.2）
- `src/god/rule-engine.ts` — 规则引擎（Card A.4）
- `src/types/god-schemas.ts` — GodAutoDecisionSchema
- `src/engine/workflow-machine.ts` — WAITING_USER 状态
- `src/god/god-audit.ts` — appendAuditLog

## 任务

### 1. 实现代理决策服务
创建 `src/god/auto-decision.ts`：

```typescript
export interface AutoDecisionResult {
  decision: GodAutoDecision;
  ruleCheck: RuleEngineResult;
  blocked: boolean;
  reasoning: string;
}

export async function makeAutoDecision(
  godAdapter: CLIAdapter,
  context: AutoDecisionContext,
  ruleEngine: (action: ActionContext) => RuleEngineResult,
): Promise<AutoDecisionResult>
```

### 2. 决策流程
- God 在 WAITING_USER 状态自主决策：accept / continue_with_instruction / request_human
- 代理决策前先过规则引擎（FR-008a），block 则不执行
- reasoning 写入 audit log

### 3. 逃生窗口 UI 状态
创建 `src/ui/escape-window.ts`：

```typescript
export interface EscapeWindowState {
  visible: boolean;
  countdown: number;     // 2 秒
  decision: GodAutoDecision;
  decisionPreview: string;
  confirmed: boolean;
  cancelled: boolean;
}

export function createEscapeWindowState(decision: GodAutoDecision): EscapeWindowState
export function handleEscapeKey(state: EscapeWindowState, key: string): EscapeWindowState
export function tickEscapeCountdown(state: EscapeWindowState): EscapeWindowState
```

- 2 秒逃生窗口：进度条 + God 决策预览
- [Space] 立即执行
- [Esc] 取消 → 进入标准 WAITING_USER 手动模式

### 4. 编写测试
在 `src/__tests__/god/auto-decision.test.ts` 和 `src/__tests__/ui/escape-window.test.ts` 中：
- 规则引擎 block 时代理决策不执行
- Esc 取消后进入手动模式
- 2 秒逃生窗口正确倒计时
- Space 立即执行
- reasoning 写入 audit log

## 验收标准
- [ ] AC-1: 规则引擎 block 时代理决策不执行
- [ ] AC-2: Esc 取消后进入手动模式
- [ ] AC-3: 2 秒逃生窗口正确显示和倒计时
- [ ] AC-4: reasoning 写入 audit log
- [ ] AC-5: 所有测试通过: `npx vitest run`
- [ ] AC-6: 现有测试不受影响

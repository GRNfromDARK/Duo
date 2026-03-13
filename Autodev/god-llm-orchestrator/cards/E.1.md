# Card E.1: 决策审计日志 JSONL

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-020: 决策审计日志 (AC-051, AC-052)
- NFR-008: god-decisions/ 目录上限 50MB

从 `docs/requirements/god-llm-todolist.md` 读取：
- E-1 任务描述和验证标准

## 读取已有代码
- `src/god/god-audit.ts` — appendAuditLog（Card A.3 已创建基础版）
- `src/session/session-manager.ts` — session 目录结构
- `src/cli-commands.ts` — 现有 CLI 命令

## 任务

### 1. 完善审计日志系统
扩展 `src/god/god-audit.ts`：

```typescript
export interface GodAuditEntry {
  seq: number;
  timestamp: string;
  round: number;
  decisionType: 'task_init' | 'post_coder' | 'post_reviewer' | 'convergence' | 'auto_decision' | 'phase_transition' | 'loop_detected';
  inputSummary: string;   // ≤ 500 chars
  outputSummary: string;  // ≤ 500 chars
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  decision: unknown;
  model?: string;
  phaseId?: string;
  outputRef?: string;     // god-decisions/ 中的完整输出引用
}

export class GodAuditLogger {
  constructor(sessionDir: string)
  append(entry: Omit<GodAuditEntry, 'seq'>): void
  getEntries(filter?: { type?: string }): GodAuditEntry[]
  getSequence(): number
}
```

### 2. 完整 God 输出存储
- 完整 God 输出存储在 `god-decisions/` 子目录
- 审计记录含 outputRef 引用（如 `god-decisions/001-task_init.json`）

### 3. 目录大小管理
- god-decisions/ 目录上限 50MB
- 超限时自动清理最旧记录
```typescript
export function cleanupOldDecisions(dir: string, maxSizeMB: number): number
```

### 4. duo log 命令
在 `src/cli-commands.ts` 中添加：
```typescript
export async function handleLog(
  sessionId: string,
  options: { type?: string },
): Promise<void>
```
- `duo log <session-id>` — 显示所有审计记录
- `duo log <session-id> --type <type>` — 按 decisionType 筛选

### 5. 编写测试
在 `src/__tests__/god/god-audit-logger.test.ts` 中：
- 每次 God CLI 调用产生一条审计记录
- 完整输出存储在 god-decisions/ 并有 outputRef 引用
- seq 自增
- 按 type 筛选正确
- 目录超 50MB 时自动清理

## 验收标准
- [ ] AC-1: 每次 God CLI 调用产生一条审计记录（JSONL 格式）
- [ ] AC-2: 完整输出存储在 god-decisions/ 并有 outputRef 引用
- [ ] AC-3: duo log 命令正确筛选和显示
- [ ] AC-4: 目录超 50MB 时自动清理最旧记录
- [ ] AC-5: 所有测试通过: `npx vitest run`
- [ ] AC-6: 现有测试不受影响

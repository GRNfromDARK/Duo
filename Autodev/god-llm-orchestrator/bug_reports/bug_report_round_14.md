OK, I have enough evidence. Here is the final Round 14 Bug Audit Report.

---

## Round 14 Bug Audit Report

---

### BUG-1 [P1] `pendingPhaseId` / `pendingPhaseSummary` stored but never consumed — phase transitions silently discarded

**文件**: `src/engine/workflow-machine.ts:264-270, 312-319`

**问题**: Round 12 BUG-4 的修复仅完成了一半。PHASE_TRANSITION 事件正确地将 `nextPhaseId` 和 `summary` 存入 `WorkflowContext`（行 267-268），但整个代码库中**没有任何代码读取这两个字段**。`WAITING_USER` 状态的 `USER_CONFIRM → continue` 转换（行 312-319）直接进入 `CODING`，完全忽略了 `pendingPhaseId`：

```ts
// workflow-machine.ts:312-319 — pendingPhaseId 被忽略
USER_CONFIRM: [
  {
    guard: 'confirmContinue',
    target: 'CODING',  // ← 始终回到 CODING，不使用 pendingPhaseId
    actions: assign({
      round: ({ context }) => context.round + 1,
      activeProcess: () => 'coder' as const,
    }),
  },
```

Grep 确认：`pendingPhaseId` 仅出现在 `workflow-machine.ts`（存储）和 `workflow-machine.test.ts`（测试存储），`src/ui/` 和 `src/god/` 中均无引用。

**预期**: `USER_CONFIRM → continue` 应检查 `pendingPhaseId`，若非空则路由到相应阶段（或通知 orchestration 层执行阶段切换），并在消费后清空 `pendingPhaseId`/`pendingPhaseSummary`。

**修复**: 在 `WAITING_USER` 状态增加条件分支：若 `pendingPhaseId !== null`，则转换到 phase transition 处理逻辑，而非直接进入 CODING。

---

### BUG-2 [P2] `outputBufferBytes` 计数字符而非字节 — 多字节内容下缓冲区超限

**文件**: `src/adapters/process-manager.ts:33, 347, 349`

**问题**: 常量名为 `DEFAULT_MAX_BUFFER_BYTES`（50MB），字段名为 `outputBufferBytes` 和 `maxBufferBytes`，暗示按字节计量。但实际使用 `text.length`（JavaScript 字符串的 UTF-16 code unit 数），而非 `Buffer.byteLength(text)`：

```ts
// 行 347: 按字符计数，非字节
this.outputBufferBytes += text.length;

// 行 349: 按"字节"判断上限，但实际是字符
if (this.outputBufferBytes > this.maxBufferBytes) {
```

V8 内部字符串为 UTF-16（每字符 2 字节），对全 ASCII 内容，50M 字符 = ~100MB 实际内存；对含中文/emoji 的输出，`text.length` 低估 UTF-8 编码长度，但 V8 内存占用约为 `length * 2`。实际内存上限可能是配置值的 2 倍。

**预期**: 命名与计量方式一致 — 要么改用 `Buffer.byteLength(text)` 按真实字节计数，要么将字段/常量重命名为 `maxBufferChars` 以匹配实际行为。

**修复**: 将 `text.length` 替换为 `Buffer.byteLength(text, 'utf-8')`，并在 slice 时使用 `Buffer` 操作确保按字节截断。

---

### BUG-3 [P2] `cleanupOldDecisions` 删除文件后 JSONL 中 `outputRef` 成为悬空引用

**文件**: `src/god/god-audit.ts:158-192, 86, 95`

**问题**: `GodAuditLogger.append()` 在 JSONL 审计日志中写入 `outputRef` 字段（行 95），指向 `god-decisions/` 目录中的 JSON 文件（行 86）。`cleanupOldDecisions()` 按文件大小清理旧决策文件（行 184-188），但不更新或标记 JSONL 中对应的 `outputRef` 条目：

```ts
// 行 184-188: 直接删除文件，不更新 JSONL
for (const { name, size } of fileSizes) {
  if (totalSize <= maxBytes) break;
  unlinkSync(join(dir, name));  // ← 文件删除
  totalSize -= size;
  removed++;
}
```

`cli-commands.ts:194-195` 会读取并展示 `outputRef`：
```ts
if (entry.outputRef) {
  log(`    Ref: ${entry.outputRef}`);  // ← 指向已删除文件
}
```

**预期**: 清理后，JSONL 中已删除文件对应的 `outputRef` 应被标记为失效，或在读取时验证文件是否存在。

**修复**: 方案一：在 `cleanupOldDecisions` 中记录已删除的文件名集合，由调用方标记对应 JSONL 条目。方案二：在 `cli-commands.ts` 读取 `outputRef` 时加 `existsSync` 检查，不存在则显示 `[deleted]`。

---

### VERDICT: BUGS_FOUND | P0:0 P1:1 P2:2

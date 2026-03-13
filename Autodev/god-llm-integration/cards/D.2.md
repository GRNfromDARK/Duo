# Card D.2: StatusBar God 信息展示 + Audit Log 完善

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-006: God Adapter 配置
- FR-012: God 审计日志（AC-037, AC-038）
- FR-020: `duo log` 命令

从 `docs/requirements/god-llm-integration-todolist.md` 读取：
- Phase D > D-2

## 读取已有代码
- `src/ui/components/StatusBar.tsx` — 当前 StatusBar 展示
- `src/ui/components/App.tsx` — StatusBar props 传递
- `src/god/god-audit.ts` — GodAuditLogger
- `src/cli-commands.ts` — handleLog() 函数

## 任务

### 1. StatusBar God 信息展示
修改 `StatusBar.tsx`：

1. 添加 God 相关 props：
   ```typescript
   godAdapter?: string;
   taskType?: string;
   currentPhase?: string;     // compound 型的当前阶段
   degradationLevel?: string; // L1/L2/L3/L4
   godLatency?: number;       // 最近一次 God 决策延迟(ms)
   ```

2. 展示逻辑：
   - God adapter 名称（如果与 Reviewer 不同时显示）
   - 当前任务类型标签（code/explore/review/...）
   - compound 型显示当前阶段
   - 降级状态（L4 时显示 "God: disabled"）
   - God 决策延迟（可选）

### 2. 完善 duo log 输出
修改 `src/cli-commands.ts` 的 `handleLog()`：
- 确保 God 决策类型正确分类展示（task_init, post_coder, post_reviewer, convergence, auto_decision, reclassify, degradation）
- 添加 latency 统计汇总

### 3. 清理工作
- 确认所有 God 调用点都有 audit log 记录
- 验证 `duo log <session-id>` 可正确读取所有 God 决策
- 不删除 v1 组件引用（它们仍是 fallback）

## 验收标准
- [ ] AC-1: StatusBar 展示 God adapter 名称（与 Reviewer 不同时）
- [ ] AC-2: StatusBar 展示当前任务类型
- [ ] AC-3: StatusBar compound 型显示当前阶段
- [ ] AC-4: StatusBar 展示降级状态
- [ ] AC-5: `duo log` 正确展示所有 God audit 记录类型
- [ ] AC-6: 所有测试通过: `npx vitest run`

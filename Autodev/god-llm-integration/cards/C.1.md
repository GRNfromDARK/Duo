# Card C.1: WAITING_USER 代理决策 + 2s 逃生窗口

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-008: WAITING_USER 代理决策（AC-025, AC-026, AC-027）
- FR-008a: 不可代理场景规则引擎（AC-028, AC-029, AC-030）

从 `docs/requirements/god-llm-integration-todolist.md` 读取：
- Phase C > C-1

## 读取已有代码
- `src/ui/components/App.tsx` — WAITING_USER useEffect（当前只显示等待消息）
- `src/god/auto-decision.ts` — makeAutoDecision() 函数
- `src/god/rule-engine.ts` — RuleEngine, checkRules()
- `src/god/degradation-manager.ts` — DegradationManager

## 任务

### 1. 创建 GodDecisionBanner 组件
新建 `src/ui/components/GodDecisionBanner.tsx`：

1. Props：
   ```typescript
   interface GodDecisionBannerProps {
     decision: GodAutoDecision;
     onExecute: () => void;
     onCancel: () => void;
   }
   ```

2. 展示：
   - God 决策摘要（决策类型 + instruction）
   - 2 秒倒计时进度条
   - [Space] 立即执行，[Esc] 取消

3. 倒计时结束 → 自动执行

### 2. 修改 WAITING_USER useEffect
在 `App.tsx` 中：

1. 进入 WAITING_USER 时，检查 God 是否可用
2. God 可用时：
   - 调用 `makeAutoDecision()` 获取 GodAutoDecision
   - 调用 `checkRules()` 检查是否被 block（AC-025）
   - 被 block → 保持手动模式（v1 行为）
   - 未被 block → 显示 GodDecisionBanner（2 秒逃生窗口）
3. 用户按 Esc → 取消，进入手动模式（AC-026）
4. 倒计时结束或用户按 Space → 执行 God 决策：
   - accept → send CONVERGED
   - continue_with_instruction → 设置 pendingInstruction + send USER_CONFIRM continue
   - request_human → 保持 WAITING_USER
5. God 决策 reasoning 写入 audit log（AC-027）

### 3. DegradationManager 包裹
- God auto-decision 失败时保持 v1 行为（等待用户输入）

## 验收标准
- [ ] AC-1: God 在 WAITING_USER 时自主决策（调用 makeAutoDecision）
- [ ] AC-2: 规则引擎 block 时不执行代理决策
- [ ] AC-3: 2 秒逃生窗口显示 God 决策摘要和倒计时
- [ ] AC-4: Esc 取消进入手动模式
- [ ] AC-5: Space 或倒计时结束后执行决策
- [ ] AC-6: 决策 reasoning 写入 audit log
- [ ] AC-7: God 失败时保持 v1 行为
- [ ] AC-8: 所有测试通过: `npx vitest run`

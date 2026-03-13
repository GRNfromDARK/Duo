# Card F.4: God 视觉层级区分

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-014: God 视觉层级区分 (AC-041)

从 `docs/requirements/god-llm-todolist.md` 读取：
- F-4 任务描述和验证标准

## 读取已有代码
- `src/ui/` — 现有 UI 组件和样式
- `src/ui/message-lines.ts` — 消息行格式化
- `src/ui/display-mode.ts` — 显示模式
- `src/types/ui.ts` — UI 类型定义

## 任务

### 1. 创建 God 消息样式
创建 `src/ui/god-message-style.ts`：

```typescript
export interface GodMessageStyle {
  borderChar: string;     // ╔═╗ double border
  borderColor: string;    // Cyan
  textColor: string;      // Magenta
  showBorder: boolean;
}

export type GodMessageType =
  | 'task_analysis'       // 任务分析
  | 'phase_transition'    // 阶段切换
  | 'auto_decision'       // 代理决策
  | 'anomaly_detection';  // 异常检测

export function formatGodMessage(
  content: string,
  type: GodMessageType,
): string[]

export function shouldShowGodMessage(type: GodMessageType): boolean
```

### 2. 视觉样式
- God 消息使用 ╔═╗ double border + Cyan/Magenta 颜色
- 与 Coder（普通 border）和 Reviewer（另一种样式）区分

### 3. 显示控制
仅在关键决策点出现：
- 任务分析（task_analysis）
- 阶段切换（phase_transition）
- 代理决策（auto_decision）
- 异常检测（anomaly_detection）
- 不造成视觉噪音

### 4. 编写测试
在 `src/__tests__/ui/god-message-style.test.ts` 中：
- God 消息包含 ╔═╗ border
- 仅关键决策类型显示
- 普通路由决策不显示
- 格式化输出正确

## 验收标准
- [ ] AC-1: God 消息使用独立视觉样式（╔═╗ double border + Cyan/Magenta）
- [ ] AC-2: 仅在关键决策点显示，不产生噪音
- [ ] AC-3: 与 Coder/Reviewer 消息视觉上明确区分
- [ ] AC-4: 所有测试通过: `npx vitest run`
- [ ] AC-5: 现有测试不受影响

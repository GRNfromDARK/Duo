# Card C.3: 重分类 Overlay (Ctrl+R) + 阶段转换

## 读取设计文档
从 `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` 读取：
- FR-002a: 运行中重分类（AC-010, AC-011, AC-012）
- FR-010: 阶段转换（AC-033, AC-034）

从 `docs/requirements/god-llm-integration-todolist.md` 读取：
- Phase C > C-3

## 读取已有代码
- `src/ui/components/App.tsx` — handleInterrupt 和 useInput 逻辑
- `src/god/phase-transition.ts` — 阶段转换逻辑
- `src/god/task-init.ts` — 重新分类能力
- `src/ui/components/StatusBar.tsx` — 状态栏
- `src/types/god-schemas.ts` — GodTaskAnalysis 类型

## 任务

### 1. 创建 ReclassifyOverlay 组件
新建 `src/ui/components/ReclassifyOverlay.tsx`：

1. Props：
   ```typescript
   interface ReclassifyOverlayProps {
     currentType: string;
     currentRound: number;
     onSelect: (newType: string) => void;
     onCancel: () => void;
   }
   ```

2. 展示参考需求文档的设计稿：
   - 当前类型（标记 ← 当前）
   - 可选类型列表
   - ↑↓ 选择，Enter 确认，Esc 取消

### 2. 绑定 Ctrl+R 触发
在 `App.tsx` 中：
- 添加 `showReclassify` state
- 在 CODING/REVIEWING/WAITING_USER 状态下 Ctrl+R 触发（AC-010）
- 正在运行 LLM 时，先 interrupt 再显示 overlay

### 3. 重分类处理
选择新类型后：
- 调用 God 重新规划（生成新的 GodTaskAnalysis）
- 保留所有已完成的 RoundRecord
- 更新 taskAnalysis state
- 更新 StatusBar 任务类型标签
- 事件写入 audit log（AC-012）

### 4. 阶段转换（compound 型）
当 God router 返回 phase_transition 时：
- 使用 `src/god/phase-transition.ts` 处理切换
- 触发 2 秒逃生窗口（复用 GodDecisionBanner 组件逻辑）
- 保留之前阶段的 RoundRecord（AC-034）
- 下一阶段 prompt 携带上阶段结论摘要
- StatusBar 显示当前阶段（AC-033）

## 验收标准
- [ ] AC-1: Ctrl+R 在 CODING/REVIEWING/WAITING_USER 状态触发 ReclassifyOverlay
- [ ] AC-2: 重分类后 God 在 < 3s 内生成新 prompt（AC-011）
- [ ] AC-3: 重分类事件写入 audit log（AC-012）
- [ ] AC-4: 阶段转换通知在 StatusBar 下方显示
- [ ] AC-5: 转换前后 RoundRecord 均保留（AC-034）
- [ ] AC-6: 所有测试通过: `npx vitest run`

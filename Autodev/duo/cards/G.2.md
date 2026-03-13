# Card G.2: 收敛/分歧状态卡片

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-2.2 > FR-026: 收敛/分歧状态展示

从 `todolist.md` 读取：
- Phase G > G-2：收敛/分歧状态卡片

## 读取已有代码
- `src/decision/convergence-service.ts` — 收敛判定
- `src/ui/components/MessageView.tsx` — 消息展示

## 任务
1. 实现收敛卡片组件 `src/ui/components/ConvergenceCard.tsx`:
   ```
   ┌─────────────────────────────────────────────────────┐
   │  ✓ CONVERGED after 4 rounds                         │
   │  Both agents agree on the implementation.           │
   │  Files modified: 4  Lines changed: +182 / -23       │
   │  [A] Accept  [C] Continue  [R] Review Changes       │
   └─────────────────────────────────────────────────────┘
   ```

2. 实现分歧卡片组件 `src/ui/components/DisagreementCard.tsx`:
   ```
   ┌─────────────────────────────────────────────────────┐
   │  ⚡ DISAGREEMENT · Round 6                           │
   │  Agreed: 1/3    Disputed: 2/3                       │
   │  [C] Continue  [D] Decide manually                  │
   │  [A] Accept Coder's  [B] Accept Reviewer's          │
   └─────────────────────────────────────────────────────┘
   ```

3. 用户通过快捷键选择后续操作

4. 获取 git diff 统计（修改文件数/行数）

5. 编写完整测试

## 验收标准
- [ ] AC-1: 收敛时展示文件变更统计
- [ ] AC-2: 分歧时列出同意/争议点
- [ ] AC-3: 快捷键选择操作正常
- [ ] AC-4: 所有测试通过: `npm test`

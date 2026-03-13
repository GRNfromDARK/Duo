# God LLM Orchestrator — 执行任务清单

> 唯一需求来源：`docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md`
> Generated: 2026-03-11 by auto-todo
> Tech Stack: TypeScript strict + Node.js + Ink (React CLI) + xstate v5 | CLI adapter only, no SDK
> Tasks: 21 | Phases: 6 | Critical Path: A-1 → A-3 → B-1 → B-2 → B-3 → B-4

---

## 设计文档

| 文件 | 路径 | 用途 |
|------|------|------|
| 需求文档 | `docs/requirements/2026-03-11-god-llm-orchestrator-requirement.md` | 产品需求与验收标准的唯一来源 |
| v1 任务清单 | `todolist.md` | duo v1 基础版任务清单（29 tasks，已完成） |

## 测试命令

```bash
npm test
```

## 约束

- God 通过 CLI adapter 调用（同 Coder/Reviewer），不绑定特定 SDK（AR-001）
- God 输出通过 JSON 代码块提取 + Zod schema 校验，非 tool_use（AR-002）
- XState 保留，God 作为异步 effect handler 注入（AR-003）
- 旧组件（ContextManager/ConvergenceService/ChoiceDetector）保留为 fallback，不删除（AR-004）
- God session ID + convergenceLog 存入 snapshot.json（AR-005）
- God context 由 CLI session + 增量 prompt 管理（AR-006）
- 规则引擎 block 不可被 God 覆盖（NFR-009）
- God 持久化数据 < 10KB per session（NFR-007）
- v1 不做 token 门控（FR-017/018/019 Won't）
- Reviewer 是收敛的唯一权威，converged 只能在 Reviewer 输出后产生

---

## Phase A：God 基础设施

### A-1：God JSON 提取器 + Zod Schema 定义
- 实现 JSON 代码块提取器：从 God CLI text 输出中提取最后一个 `` ```json ... ``` `` 块
- 定义所有 God 输出的 Zod schema：GodTaskAnalysis、GodPostCoderDecision、GodPostReviewerDecision、GodConvergenceJudgment、GodAutoDecision
- 实现校验失败重试逻辑：重试 1 次附带格式纠错提示，仍失败则返回 null（由调用方决定 fallback）
- 边界处理：God 输出多个 JSON 块时取最后一个（OQ-003）
- 依赖：none
- 来源：AR-002, OQ-002, OQ-003
- 验证：
  - [ ] 从 mock CLI 输出中正确提取 JSON 代码块
  - [ ] 所有 5 个 Zod schema 定义完整且编译通过
  - [ ] schema 校验失败时返回结构化错误信息
  - [ ] 多个 JSON 块时提取最后一个
  - [ ] 非 JSON 输出（纯文本）时优雅返回 null

### A-2：God Adapter 配置 + --god 参数 (FR-006)
- 扩展 `duo start` 命令：新增 `--god <adapter-name>` 参数
- 默认值：`--god` 跟随 `--reviewer` 的值
- God adapter 实例化：独立于 Coder/Reviewer（不同实例、不同 session），即使选择同一 CLI 工具
- God system prompt 注入机制：编排者角色指令 + JSON 格式约束（区别于 Coder/Reviewer 的执行者角色）
- God session 通过 adapter 的 `--resume` 机制维持对话历史
- 依赖：none（基于 v1 已有的 CLIAdapter 接口）
- 来源：FR-006 (AC-021, AC-022)
- 验证：
  - [ ] `--god claude-code` 正确实例化 God adapter
  - [ ] `--god` 省略时默认跟随 `--reviewer`
  - [ ] God 与 Coder 使用同一 CLI 工具时 session 完全隔离
  - [ ] God system prompt 包含编排者角色指令和 JSON 格式约束

### A-3：意图解析 + 任务分类 + 动态轮次 (FR-001 + FR-002 + FR-007)
- 实现 God TASK_INIT 流程：通过 God adapter 调用 CLI，传入用户任务描述 + God system prompt
- God system prompt 设计：编排者角色 + 输出 GodTaskAnalysis JSON 块的格式指令（OQ-001）
- 6 种任务类型分类：explore / code / discuss / review / debug / compound
- compound 类型必须包含 phases 数组
- suggestedMaxRounds 基于任务类型：explore 2-5, code 3-10, review 1-3, debug 2-6
- 运行时动态轮次调整：God 可在决策中延长/缩短 maxRounds，更新 XState context
- 分类结果写入 God audit log
- 依赖：A-1（JSON 提取 + schema 校验）, A-2（God adapter 配置）
- 来源：FR-001 (AC-001, AC-002, AC-003), FR-002 (AC-008, AC-009), FR-007 (AC-023, AC-024)
- 验证：
  - [ ] God 对 explore/code/review 三种纯类型分类准确率 ≥ 90%（基于标注测试集）
  - [ ] JSON 提取 + schema 校验成功率 ≥ 95%
  - [ ] TASK_INIT 延迟 P95 < 10s
  - [ ] compound 类型输出包含有效 phases 数组
  - [ ] suggestedMaxRounds 在合理范围内
  - [ ] 动态轮次调整写入 audit log 并在 StatusBar 更新

### A-4：不可代理场景规则引擎 (FR-008a)
- 实现同步规则引擎（< 5ms，不涉及 LLM）
- 5 条规则：R-001 ~/Documents 外文件写操作 (block)、R-002 系统关键目录 (block)、R-003 可疑网络外连 (block)、R-004 God 与规则引擎矛盾 (warn)、R-005 Coder 修改 .duo/ 配置 (warn)
- R-001 路径解析：支持相对路径 resolve 到 cwd 后比对
- block 级别：强制进入 WAITING_USER → 人工确认，God 无法覆盖
- block 事件写入 God audit log
- 依赖：none
- 来源：FR-008a (AC-028, AC-029, AC-030)
- 验证：
  - [ ] R-001 正确检测相对路径（`../outside/file` resolve 后比对）
  - [ ] R-002 检测 /etc, /usr, /bin, /System, /Library
  - [ ] R-003 检测 `curl -d @file` 等模式
  - [ ] 规则引擎执行 < 5ms
  - [ ] block 事件写入 audit log

---

## Phase B：决策编排核心

### B-1：动态 Prompt 生成 Reviewer-Driven (FR-003)
- 实现 God 每轮 Prompt 生成流程（替代 ContextManager）
- FR-003a 任务类型 → Prompt 策略映射：explore 型禁止执行动词、code 型包含编码指令、compound 型随阶段切换
- FR-003b Reviewer-Driven Prompt 组装，优先级：
  1. 上一轮 unresolvedIssues（作为 Coder 必做清单）
  2. Reviewer suggestions（非阻塞建议）
  3. 任务目标 + 阶段 + convergenceLog 趋势
  4. 轮次号和剩余轮次
- FR-003c Prompt 质量保证：explore 型不含执行动词、prompt ≤ context window 限制
- prompt 内容摘要（≤ 500 字符）写入 audit log
- 依赖：A-3（需要 GodTaskAnalysis 和任务类型）
- 来源：FR-003 (AC-013, AC-014, AC-015)
- 验证：
  - [ ] explore 型 prompt 不包含 "implement/create/write code" 等动词
  - [ ] code 型 prompt 包含编码指令和质量要求
  - [ ] Coder prompt 中 unresolvedIssues 列为首要待办
  - [ ] prompt 不超过 context window 限制
  - [ ] prompt 摘要写入 audit log

### B-2：输出分析与路由判断 PostCoder/PostReviewer (FR-004)
- 实现 ROUTING_POST_CODE 阶段：God 分析 Coder 输出，生成 GodPostCoderDecision
  - 默认 continue_to_review（95%）、retry_coder（崩溃/空输出）、request_user_input
- 实现 ROUTING_POST_REVIEW 阶段：God 分析 Reviewer 输出，生成 GodPostReviewerDecision
  - route_to_coder + unresolvedIssues（60-70%）、converged、phase_transition、loop_detected、request_user_input
- 关键约束：converged 只能在 ROUTING_POST_REVIEW 产生；route_to_coder 必须携带非空 unresolvedIssues
- God action → XState event 映射（7 种映射关系）
- XState ROUTING/EVALUATING effect 改为 async（God CLI 调用）
- 依赖：B-1（需要 Prompt 生成能力）
- 来源：FR-004 (AC-016, AC-017, AC-018, AC-018a, AC-018b)
- 验证：
  - [ ] God 路由决策延迟 P95 < 10s
  - [ ] JSON 提取成功率 ≥ 95%
  - [ ] converged 决策不在 ROUTING_POST_CODE 阶段产生
  - [ ] route_to_coder 必须携带非空 unresolvedIssues
  - [ ] God action 正确映射为 XState event
  - [ ] God 路由与旧 ConvergenceService 同向验证，分歧率 < 15%

### B-3：收敛判断 Reviewer-Authority (FR-005)
- 实现 GodConvergenceJudgment 结构：classification + shouldTerminate + criteriaProgress + reviewerVerdict
- 终止条件决策树：Reviewer blocking issues 清零 → 所有 criteriaProgress.satisfied → shouldTerminate: true
- 例外：max_rounds 强制终止、loop_detected 且 3 轮无改善强制终止
- 不可违反原则：终止必须经过 Reviewer、blocking issues 必须清零、所有 terminationCriteria 必须满足、Reviewer 驱动方向
- 一致性校验：shouldTerminate: true 时 blockingIssueCount 必须为 0
- 收敛判断结果（含 criteriaProgress）写入 convergenceLog
- 依赖：B-2（需要路由判断和 God 输出分析）
- 来源：FR-005 (AC-019, AC-019a, AC-019b, AC-020)
- 验证：
  - [ ] shouldTerminate: true 时 blockingIssueCount 为 0
  - [ ] shouldTerminate: true 时所有 criteriaProgress[].satisfied 为 true（例外情况除外）
  - [ ] God 不在未经 Reviewer 审查时输出 shouldTerminate: true
  - [ ] 收敛判断含 criteriaProgress 写入 convergenceLog
  - [ ] max_rounds 达到时强制终止

### B-4：异常/死循环检测 + 阶段转换 (FR-009 + FR-010)
- FR-009 死循环检测：连续 3 轮 progressTrend === 'stagnant'、语义重复检测、blockingIssueCount 趋势未下降
- 检测到死循环 → God 生成 loop_detected 决策 + 干预措施
- FR-010 阶段转换：compound 型任务中 God 基于阶段完成度输出 phase_transition 决策
- 阶段转换行为：触发 2 秒逃生窗口 UI、保留之前 RoundRecord、下一阶段 prompt 携带上阶段结论摘要
- 阶段转换通知在 StatusBar 下方显示 2 秒横幅
- 依赖：B-3（需要收敛判断和 convergenceLog 趋势数据）
- 来源：FR-009 (AC-031, AC-032), FR-010 (AC-033, AC-034)
- 验证：
  - [ ] 连续 3 轮停滞触发 loop_detected
  - [ ] loop_detected 的 false positive 率 < 10%
  - [ ] compound 型任务阶段转换正确触发
  - [ ] 阶段转换通知在 StatusBar 显示 2 秒横幅
  - [ ] 转换前后 RoundRecord 均保留在 history

---

## Phase C：可靠性与降级

### C-1：God CLI 降级 + 极端兜底 (FR-G01 + FR-G04)
- 四级降级策略：L1 瞬时（正常处理）、L2 可重试（重试 1 次 → fallback）、L3 不可重试（纠错重试 → fallback）、L4 持续失败（本会话禁用 God）
- 降级通知：L2 StatusBar retrying、首次 fallback 系统消息、L4 持续 Fallback mode
- fallback 切换到旧组件（ContextManager + ConvergenceService + ChoiceDetector），< 100ms
- L4 级本会话不恢复，下一轮自动尝试（非 L4）
- 三层兜底：God 失败 → fallback → ERROR → WAITING_USER → duo resume
- God 失败不导致 Coder 已写入磁盘的代码丢失
- 任何失败组合最终都进入 WAITING_USER 而非无提示退出
- 依赖：none（基于已有旧组件）
- 来源：FR-G01 (AC-055, AC-056, AC-057), FR-G04 (AC-062, AC-063)
- 验证：
  - [ ] 降级切换 < 100ms
  - [ ] 降级后工作流不中断
  - [ ] L4 降级事件写入 audit log
  - [ ] God 失败不丢失 Coder 已写入的代码
  - [ ] 任何失败组合进入 WAITING_USER 而非无提示退出
  - [ ] L2/L3 重试机制正常（含格式纠错提示）

### C-2：God 输出一致性校验 (FR-G02)
- 纯规则检测（< 1ms，无 LLM）：
  - `classification: approved` 且 `blockingIssueCount > 0` → 矛盾
  - `shouldTerminate: true` 且 `reason: null` → 缺少原因
  - `confidenceScore < 0.5` 且 `shouldTerminate: true` → 低置信度终止
- 处理：结构矛盾重试 → fallback、语义矛盾自动修正（以可计数字段为权威）、低置信度偏保守
- 同向验证：God classification 与旧 ConvergenceService.classify() 交叉验证，分歧时以本地为准
- 幻觉检测事件写入 audit log
- 依赖：B-2（路由判断）, B-3（收敛判断）
- 来源：FR-G02 (AC-058, AC-059)
- 验证：
  - [ ] 一致性校验 < 1ms
  - [ ] 检测到 approved + blockingIssueCount > 0 矛盾
  - [ ] 低置信度终止被修正为不终止
  - [ ] 幻觉事件写入 audit log

### C-3：God 渐进漂移检测 (FR-G03)
- 检测信号：God 连续 3 次 approved 但 ConvergenceService 判定 changes_requested → god_too_permissive
- 检测信号：God 置信度连续 4 轮递减 → confidence_declining
- 处理：轻度漂移记录告警、严重漂移临时切换 fallback 2 轮后恢复
- 漂移检测在每次 God 决策后自动运行
- 依赖：C-2（一致性校验）
- 来源：FR-G03 (AC-060, AC-061)
- 验证：
  - [ ] 连续 3 次 approved 与本地分歧触发 god_too_permissive
  - [ ] 置信度连续 4 轮递减触发 confidence_declining
  - [ ] 严重漂移切换 fallback 2 轮后自动恢复
  - [ ] 漂移事件写入 audit log

---

## Phase D：状态与会话管理

### D-1：God 会话持久化 CLI Session ID (FR-011)
- 扩展 SessionState 接口：新增 godSessionId、godAdapter、godTaskAnalysis、godConvergenceLog
- godSessionId + godAdapter 持久化到 snapshot.json（利用已有原子写入）
- godTaskAnalysis 仅首轮写入（任务分析结果）
- godConvergenceLog 每轮追加（轮次摘要 ≤ 200 chars）
- `duo resume` 恢复流程：读取 godSessionId → 实例化 God adapter → restoreSessionId → CLI `--resume` 恢复
- 持久化数据大小 < 10KB
- 依赖：A-2（God adapter 配置）, A-3（GodTaskAnalysis 定义）
- 来源：FR-011 (AC-035, AC-036)
- 验证：
  - [ ] duo resume 后 God 通过 CLI session 恢复对话上下文
  - [ ] 持久化数据 < 10KB（20 轮长任务）
  - [ ] godTaskAnalysis 正确写入和读取
  - [ ] godConvergenceLog 每轮追加

### D-2：God Context 管理 增量 Prompt (FR-012)
- God CLI 通过 `--resume` 维持对话历史（CLI 自带 context）
- 每轮 God prompt 只含增量信息：最新 Coder/Reviewer 输出 + convergenceLog 趋势摘要
- 长任务时 prompt 含趋势摘要（"issue 数从 5→3→2，趋势收敛"）而非完整历史
- God session 重建机制：context 窗口耗尽时清除旧 session，以 convergenceLog 摘要开启新 session
- 依赖：D-1（会话持久化，提供 convergenceLog）
- 来源：FR-012 (AC-037, AC-038)
- 验证：
  - [ ] 单次 God prompt 大小 < 10k tokens
  - [ ] God session 重建后基于 convergenceLog 恢复决策连续性
  - [ ] 增量 prompt 不重复发送完整历史

### D-3：三方会话协调 (FR-013)
- 三方 session ID 并列存储在 SessionState：coderSessionId、reviewerSessionId、godSessionId
- 三方 session ID 在 snapshot.json 中原子提交
- `duo resume` 恢复三方：读取 session ID → 各自实例化 adapter → restoreSessionId → `--resume`
- 容错：任一方 session 丢失时该方从头开始（清除 ID），不影响其他方
- God 与 Coder/Reviewer 使用同一 CLI 工具时 session 完全隔离
- 依赖：D-1（会话持久化基础）
- 来源：FR-013 (AC-039, AC-040, AC-041a)
- 验证：
  - [ ] 三方 session ID 原子提交
  - [ ] 任一方 session 丢失不影响其他方
  - [ ] God 与 Coder 使用同一 CLI 时 session 隔离
  - [ ] duo resume 三方均正确恢复

---

## Phase E：可观测性

### E-1：决策审计日志 JSONL (FR-020)
- God 每次决策追加写入 `.duo/sessions/<id>/god-audit.jsonl`
- 记录字段：seq、timestamp、round、decisionType（7 种）、inputSummary（≤500 chars）、outputSummary（≤500 chars）、inputTokens、outputTokens、latencyMs、decision、model、phaseId
- 完整 God 输出存储在 `god-decisions/` 子目录，审计记录含 outputRef 引用
- 实现 `duo log <session-id>` 和 `duo log <session-id> --type <type>` 查看命令
- god-decisions/ 目录上限 50MB，自动清理最旧（NFR-008）
- 依赖：B-2（需要 God 决策数据）
- 来源：FR-020 (AC-051, AC-052)
- 验证：
  - [ ] 每次 God CLI 调用产生一条审计记录
  - [ ] 完整输出存储在 god-decisions/ 并有 outputRef 引用
  - [ ] duo log 命令正确筛选和显示
  - [ ] 目录超 50MB 时自动清理最旧记录

### E-2：异常告警 (FR-021)
- 3 条告警规则：
  - GOD_LATENCY: God 调用 > 30s → Warning → StatusBar spinner
  - STAGNANT_PROGRESS: 连续 3 轮停滞 → Warning → 阻断式卡片
  - GOD_ERROR: God API 失败 → Critical → 系统消息
- Warning 级不打断工作流
- Critical 级暂停工作流等待用户确认
- 依赖：E-1（审计日志，用于检测异常模式）
- 来源：FR-021 (AC-053, AC-054)
- 验证：
  - [ ] God 调用 > 30s 显示 latency warning
  - [ ] 连续 3 轮停滞显示阻断式卡片
  - [ ] God 失败显示 Critical 系统消息并暂停
  - [ ] Warning 级不阻断工作流

---

## Phase F：用户界面与交互

### F-1：TaskAnalysisCard 意图回显 (FR-001a)
- Ink 组件：显示任务类型分类、阶段规划、预估轮次
- 8 秒倒计时自动以 God 推荐类型开始
- 用户交互：↑↓ 选择（暂停倒计时）、数字键 1-4 直接选择、Enter 确认、Space 使用推荐
- 卡片在 God 分析完成后 < 200ms 内显示
- 依赖：A-3（需要 GodTaskAnalysis 数据）
- 来源：FR-001a (AC-004, AC-005, AC-006, AC-007)
- 验证：
  - [ ] 卡片显示延迟 < 200ms
  - [ ] 8 秒无操作自动以推荐类型开始
  - [ ] ↑↓ 选择暂停倒计时
  - [ ] 数字键 1-4 直接选择并确认

### F-2：ReclassifyOverlay 运行中重分类 (FR-002a)
- Ctrl+R 全屏 overlay：显示当前类型、轮次、可选新类型
- 在 CODING/REVIEWING/WAITING_USER 状态均可触发
- 选择新类型后：God 重新规划后续阶段（< 3s）、保留已有 RoundRecord、StatusBar 更新
- 重分类事件写入 audit log
- 依赖：A-3（需要任务类型和 God adapter）
- 来源：FR-002a (AC-010, AC-011, AC-012)
- 验证：
  - [ ] Ctrl+R 在三种状态均可触发
  - [ ] 重分类后 God < 3s 内生成新阶段 prompt
  - [ ] 已有 RoundRecord 保留
  - [ ] 重分类事件写入 audit log

### F-3：WAITING_USER 代理决策 + 逃生窗口 (FR-008)
- God 在 WAITING_USER 状态自主决策：accept / continue_with_instruction / request_human
- 代理决策前先过规则引擎（FR-008a），block 则不执行
- 2 秒逃生窗口 UI：进度条 + God 决策预览 + [Space] 立即执行 + [Esc] 取消
- Esc 后进入标准 WAITING_USER 手动模式
- reasoning 写入 audit log
- 依赖：B-2（God 决策能力）, A-4（规则引擎）
- 来源：FR-008 (AC-025, AC-026, AC-027)
- 验证：
  - [ ] 规则引擎 block 时代理决策不执行
  - [ ] Esc 取消后进入手动模式
  - [ ] 2 秒逃生窗口正确显示和倒计时
  - [ ] reasoning 写入 audit log

### F-4：God 视觉层级区分 (FR-014)
- God 消息使用 ╔═╗ double border + Cyan/Magenta 颜色
- 仅在关键决策点出现：任务分析、阶段切换、代理决策、异常检测
- 不造成视觉噪音
- 依赖：none
- 来源：FR-014 (AC-041)
- 验证：
  - [ ] God 消息使用独立视觉样式
  - [ ] 仅在关键决策点显示，不产生噪音

### F-5：God Overlay 控制面板 + Resume 摘要 (FR-015 + FR-016)
- Ctrl+G overlay：显示当前任务类型、阶段、置信度、决策历史
- 手动干预：[R] 重分类、[S] 跳过阶段、[F] 强制收敛、[P] 暂停代理决策
- Ctrl+G 在所有非 overlay 状态下可用
- `duo resume` 后显示 God 决策历史摘要卡片（< 1s）
- 摘要包含所有 TASK_INIT、阶段转换、代理决策事件
- 手动干预操作写入 audit log
- 依赖：D-1（需要 godConvergenceLog 和 godTaskAnalysis）
- 来源：FR-015 (AC-042, AC-043), FR-016 (AC-044, AC-045)
- 验证：
  - [ ] Ctrl+G 在非 overlay 状态可用
  - [ ] 手动干预操作写入 audit log
  - [ ] resume 摘要 < 1s 内显示
  - [ ] 摘要包含所有关键决策事件

---

## 可追溯性矩阵

| FR | Task(s) | Status |
|----|---------|--------|
| FR-001 | A-3 | Covered |
| FR-001a | F-1 | Covered |
| FR-002 | A-3 | Covered |
| FR-002a | F-2 | Covered |
| FR-003 | B-1 | Covered |
| FR-004 | B-2 | Covered |
| FR-005 | B-3 | Covered |
| FR-006 | A-2 | Covered |
| FR-007 | A-3 | Covered |
| FR-008 | F-3 | Covered |
| FR-008a | A-4 | Covered |
| FR-009 | B-4 | Covered |
| FR-010 | B-4 | Covered |
| FR-011 | D-1 | Covered |
| FR-012 | D-2 | Covered |
| FR-013 | D-3 | Covered |
| FR-014 | F-4 | Covered |
| FR-015 | F-5 | Covered |
| FR-016 | F-5 | Covered |
| ~~FR-017~~ | — | Won't |
| ~~FR-018~~ | — | Won't |
| ~~FR-019~~ | — | Won't |
| FR-020 | E-1 | Covered |
| FR-021 | E-2 | Covered |
| FR-G01 | C-1 | Covered |
| FR-G02 | C-2 | Covered |
| FR-G03 | C-3 | Covered |
| FR-G04 | C-1 | Covered |

Coverage: **100%** (25/25 active Must+Should FRs covered, 3 Won't excluded)

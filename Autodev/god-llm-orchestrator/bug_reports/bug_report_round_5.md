验证完毕。以下是第 5 轮审计报告。

---

## Bug 审计报告（第 5 轮）

前几轮修复状态确认：Round 1-4 中标记为"已修复"的 bug 均已验证修复。以下仅报告**新发现**的 bug。

---

### BUG-1 [P0] ROLE_STYLES 仅定义 5 种适配器，其余 9 种适配器的消息渲染将崩溃（TypeError）
- 文件: `src/types/ui.ts:6,14-20` + `src/ui/message-lines.ts:54,83` + `src/ui/session-runner-state.ts:303`
- 问题: `ROLE_STYLES` 仅定义了 `claude-code`、`codex`、`gemini`、`system`、`user` 五个键。`session-runner-state.ts:303` 将适配器名称（如 `config.coder`）强制类型断言为 `RoleName`：`(isCoder ? config.coder : config.reviewer) as RoleName`。注册表中有 12 种适配器（aider、amazon-q、amp、cline、continue、copilot、cursor、goose、qwen 均无对应样式）。当使用这 9 种适配器中的任何一种时，`message-lines.ts:54` 执行 `const style = ROLE_STYLES[message.role]` 得到 `undefined`，随后 `style.displayName`（line 56）抛出 `TypeError: Cannot read properties of undefined`，导致 TUI 崩溃。
- 预期: 所有 12 种适配器都应有对应的 RoleStyle，或在查找时提供 fallback。
- 建议修复: 在 `ROLE_STYLES` 中为缺失的 9 种适配器添加样式定义，或在 `buildHeaderLine` / `buildBodyLine` 中添加 fallback：`const style = ROLE_STYLES[message.role] ?? ROLE_STYLES.system;`

### BUG-2 [P1] ProcessManager 非零退出码触发 process-error 导致 ReadableStream 抛错，而非正常关闭
- 文件: `src/adapters/process-manager.ts:115-126` + `src/adapters/claude-code/adapter.ts:158-167`（所有适配器同模式）
- 问题: `process-manager.ts:121` 在非零退出码时先 emit `process-error`，再在 line 126 emit `process-complete`。适配器的 `onProcessError` handler（adapter.ts:158-159）调用 `cleanupListeners()` 移除两个 listener 后调用 `controller.error()`。这导致：(1) ReadableStream 以 error 终止而非正常 close；(2) `process-complete` listener 已被移除，永不触发。许多 CLI 工具以非零退出码表达非致命状态（如 lint 警告），但当前实现将其一律视为流错误，在 `collectAdapterOutput` 的 `for await` 中抛出异常，中断 God 编排流程。
- 预期: 非零退出码应通过 OutputChunk 传递退出状态，stream 仍应正常 close。
- 建议修复: 移除 ReadableStream 中对 `process-error` 的 listener。让 `process-complete` 统一处理流关闭，退出码通过其他机制（如 OutputChunk）传递。

### BUG-3 [P1] ProcessManager.kill() 在等待子进程退出前移除 parentExitHandler，留下孤儿进程窗口
- 文件: `src/adapters/process-manager.ts:195`
- 问题: `kill()` 在 line 195 调用 `this.clearTimers()`，该方法移除了 `process.on('exit')` 注册的 `parentExitHandler`。随后在 line 207-212 等待子进程优雅退出（最多 5 秒）。在此 5 秒窗口内，如果父 Node.js 进程退出（如用户 Ctrl+C 触发 SIGINT 未被拦截），子进程组将不会被清理（因为 exit handler 已被移除），成为孤儿进程。
- 预期: `parentExitHandler` 应在子进程确认退出后才移除。
- 建议修复: 将 `this.clearTimers()` 移到子进程退出确认后执行，或在 `kill()` 中仅清除 timeout/heartbeat timer，保留 parentExitHandler。

### BUG-4 [P1] GodAuditLogger.append 中 spread 顺序允许运行时 seq 被覆盖
- 文件: `src/god/god-audit.ts:90-96`
- 问题: `sanitized` 对象构建为 `{ seq: this.seq, ...entry, ... }`。TypeScript 的 `Omit<GodAuditEntry, 'seq'>` 在编译时排除 `seq`，但运行时 JavaScript 对象可能仍携带 `seq` 属性（结构化子类型传递）。`...entry` 展开在 `seq: this.seq` 之后，将覆盖 logger 分配的序列号。`DegradationManager.enterL4`（line 193-194）就构造了 `seq: 0` 的 GodAuditEntry，若此对象经 spread 传入，将破坏审计日志的序列完整性。
- 预期: Logger 分配的 `seq` 应始终优先。
- 建议修复: 调换 spread 顺序为 `{ ...entry, seq: this.seq, ... }`，确保 `seq` 不被覆盖。

### BUG-5 [P1] ProcessManager.appendOutput 使用字节数偏移 slice 字符串，多字节字符下缓冲区永不收敛
- 文件: `src/adapters/process-manager.ts:315-322`
- 问题: `outputBufferBytes` 通过 `Buffer.byteLength(text)` 以字节计数，但 `joined.slice(-this.maxBufferBytes)` 以字符数切片。对于包含中文等多字节字符的输出，一个字符占 3 字节但 `.slice()` 只消耗 1 个位置。截断后 `Buffer.byteLength(sliced)` 仍大于 `maxBufferBytes`（因为保留的字符数过多），导致下次 `appendOutput` 再次触发截断，形成每次追加都触发 join+slice 的性能退化。
- 预期: 应统一使用字节或字符维度。
- 建议修复: 改用字符数追踪（`text.length` 替代 `Buffer.byteLength`），或使用 Buffer 进行截断。

### BUG-6 [P1] task-init.ts 的 collectAdapterOutput 仍硬编码 process.cwd()，未跟随 Round 3 修复
- 文件: `src/god/task-init.ts:59`
- 问题: Round 3 BUG-3 修复了 `god-convergence.ts`、`god-router.ts`、`auto-decision.ts` 中的 `process.cwd()` 问题（添加 `projectDir` 参数），但 `task-init.ts:59` 仍硬编码 `cwd: process.cwd()`。`initializeTask` 函数签名中没有 `projectDir` 参数。当用户从非项目目录启动 `duo start --dir ~/project` 时，God 的 TASK_INIT 调用将在错误的工作目录下执行。
- 预期: 与其他 3 个文件一致，接受并使用 `projectDir` 参数。
- 建议修复: 为 `initializeTask` 和内部 `collectAdapterOutput` 添加 `projectDir?: string` 参数。

### BUG-7 [P2] God overlay 的 handleGodOverlayKey 缺少 Escape 键处理，无法通过键盘关闭
- 文件: `src/ui/god-overlay.ts:100-109`
- 问题: `handleGodOverlayKey` 仅处理 `r`、`s`、`f`、`p` 四个键，没有 Escape 键处理。对比 `reclassify-overlay.ts` 和 `escape-window.ts` 都处理了 Escape 键来关闭 overlay。虽然 `keybindings.ts` 的 `processKeybinding` 可能在上层发出 `close_overlay` action，但 `handleGodOverlayKey` 自身不更新 `visible` 状态为 `false`，可能导致状态不一致。
- 预期: 应与其他 overlay handler 一致，处理 Escape 键设置 `visible: false`。
- 建议修复: 添加 `if (key === 'escape') return { state: { ...state, visible: false } };`

### BUG-8 [P2] parseStartArgs 未检查 flag 后是否有值，末尾 flag 导致 undefined 赋值
- 文件: `src/session/session-starter.ts:22-41`
- 问题: 当用户输入 `duo start --coder`（缺少值）时，`argv[++i]` 越界得到 `undefined`。`args.coder = undefined` 后续被 `if (!args.coder)` 捕获（fallback 到默认值），看似无害。但 `--task` 为末尾 flag 时，`args.task = undefined` 与"未提供 task"不可区分，且 `++i` 跳过了下一个参数（如果恰好不是末尾的话），可能导致后续 flag 被吞掉。
- 预期: 应在 `++i` 前检查边界，并在值缺失时报错或跳过。
- 建议修复: 在每个 case 中添加 `if (i + 1 >= argv.length) break; args.dir = argv[++i];`

---

VERDICT: BUGS_FOUND | P0:1 P1:5 P2:2

**修复优先级建议**：BUG-1（P0）最先修复——使用 aider/goose/amp 等 9 种适配器时 TUI 直接崩溃。其次是 BUG-2（非零退出码导致编排流程中断）和 BUG-4（审计日志 seq 被覆盖）。

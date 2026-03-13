# Card B.1: Claude Code 适配器

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.3 > FR-009: Claude Code 适配器实现

从 `todolist.md` 读取：
- Phase B > B-1：Claude Code 适配器

## 读取已有代码
- `src/types/adapter.ts` — CLIAdapter 接口定义
- `src/adapters/registry.ts` — 注册表
- `src/parsers/stream-json-parser.ts` — StreamJsonParser
- `src/adapters/process-manager.ts` — ProcessManager

## 任务
1. 实现 `src/adapters/claude-code/adapter.ts` — `ClaudeCodeAdapter`:
   - 实现 CLIAdapter 接口
   - 调用方式: `claude -p <prompt> --output-format stream-json --system-prompt <sp> --dangerously-skip-permissions`
   - **必须** `delete env.CLAUDECODE` 解除嵌套会话限制
   - 使用 `--add-dir` 指定项目目录
   - 复用 `StreamJsonParser` 解析 NDJSON 事件
   - 支持 `--continue` / `--resume` 参数传递

2. 实现 `isInstalled()`: 检查 `claude --version`
3. 实现 `getVersion()`: 解析版本号
4. 实现 `execute()`: 构建命令行参数、spawn 进程、流式解析输出
5. 实现 `kill()`: 委托 ProcessManager
6. 编写完整单元测试（使用 mock 进程）

## 验收标准
- [ ] AC-1: 正确解析所有 stream-json 事件类型（text, tool_use, tool_result, error, result）
- [ ] AC-2: 环境变量隔离：CLAUDECODE 已删除，不影响宿主进程
- [ ] AC-3: 支持 `--continue` / `--resume` 参数传递
- [ ] AC-4: 集成测试：调用 Claude Code CLI 的 mock 测试通过
- [ ] AC-5: 所有测试通过: `npm test`

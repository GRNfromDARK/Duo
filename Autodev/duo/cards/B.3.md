# Card B.3: Gemini CLI 适配器

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.3 > FR-011: Gemini CLI 适配器实现

从 `todolist.md` 读取：
- Phase B > B-3：Gemini CLI 适配器

## 读取已有代码
- `src/types/adapter.ts` — CLIAdapter 接口定义
- `src/adapters/registry.ts` — 注册表
- `src/parsers/stream-json-parser.ts` — StreamJsonParser（与 Claude Code 共用）
- `src/adapters/process-manager.ts` — ProcessManager
- `src/adapters/claude-code/adapter.ts` — 参考已实现的适配器模式

## 任务
1. 实现 `src/adapters/gemini/adapter.ts` — `GeminiAdapter`:
   - 实现 CLIAdapter 接口
   - 调用方式: `gemini -p <prompt> --output-format stream-json --non-interactive --yolo`
   - 复用 `StreamJsonParser`（与 Claude Code 共用）
   - 不强制要求 git 仓库

2. 实现 `isInstalled()`: 检查 `gemini --version`
3. 实现 `getVersion()`: 解析版本号
4. 实现 `execute()`: 构建命令行参数、spawn 进程、流式解析
5. 实现 `kill()`: 委托 ProcessManager
6. 编写完整单元测试

## 验收标准
- [ ] AC-1: 实现 CLIAdapter 接口，所有方法正常
- [ ] AC-2: stream-json 格式复用 StreamJsonParser 解析
- [ ] AC-3: --yolo 模式自动批准
- [ ] AC-4: 集成测试：mock 测试通过
- [ ] AC-5: 所有测试通过: `npm test`

# Card B.2: Codex 适配器

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.3 > FR-010: Codex 适配器实现

从 `todolist.md` 读取：
- Phase B > B-2：Codex 适配器

## 读取已有代码
- `src/types/adapter.ts` — CLIAdapter 接口定义
- `src/adapters/registry.ts` — 注册表
- `src/parsers/jsonl-parser.ts` — JsonlParser
- `src/adapters/process-manager.ts` — ProcessManager
- `src/adapters/claude-code/adapter.ts` — 参考已实现的适配器模式

## 任务
1. 实现 `src/adapters/codex/adapter.ts` — `CodexAdapter`:
   - 实现 CLIAdapter 接口
   - Coder 模式: `codex exec <prompt> --json --yolo`
   - Reviewer 模式: `codex review --json`（天然适配 Reviewer 角色）
   - 复用 `JsonlParser` 解析 JSONL 输出
   - 启动前检测是否为 git 仓库，非 git 仓库给出警告

2. 实现 `isInstalled()`: 检查 `codex --version`
3. 实现 `getVersion()`: 解析版本号
4. 实现 `execute()`: 根据角色选择 exec 或 review 模式
5. 实现 `kill()`: 委托 ProcessManager
6. 编写完整单元测试

## 验收标准
- [ ] AC-1: 支持 exec 和 review 两种调用模式
- [ ] AC-2: --json JSONL 输出正确解析为 OutputChunk 流
- [ ] AC-3: 非 git 仓库目录给出警告信息
- [ ] AC-4: 集成测试：调用 Codex CLI 的 mock 测试通过
- [ ] AC-5: 所有测试通过: `npm test`

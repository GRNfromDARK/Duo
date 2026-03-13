# Card H.1: Copilot + Aider 适配器

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.3 > FR-011b: 其余 9 个适配器实现（第一批）
- FR-008: CLI 注册表（Copilot, Aider 条目）

从 `todolist.md` 读取：
- Phase H > H-1：Copilot + Aider 适配器

## 读取已有代码
- `src/types/adapter.ts` — CLIAdapter 接口
- `src/adapters/registry.ts` — 注册表
- `src/parsers/jsonl-parser.ts` — JsonlParser
- `src/parsers/text-stream-parser.ts` — TextStreamParser
- `src/adapters/claude-code/adapter.ts` — 参考已实现的适配器模式

## 任务
1. 实现 `src/adapters/copilot/adapter.ts` — `CopilotAdapter`:
   - `copilot -p <prompt> --allow-all-tools`
   - 复用 JsonlParser

2. 实现 `src/adapters/aider/adapter.ts` — `AiderAdapter`:
   - `aider -m <prompt> --yes-always`
   - 复用 TextStreamParser

3. 每个适配器实现完整的 CLIAdapter 接口

4. 编写独立单元测试

## 验收标准
- [ ] AC-1: CopilotAdapter 接口实现完整
- [ ] AC-2: AiderAdapter 接口实现完整
- [ ] AC-3: 各自单元测试通过
- [ ] AC-4: 所有测试通过: `npm test`

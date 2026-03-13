# Card H.2: Amp + Cline + Qwen 适配器

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.3 > FR-011b: 其余 9 个适配器实现（第二批）
- FR-008: CLI 注册表（Amp, Cline, Qwen 条目）

从 `todolist.md` 读取：
- Phase H > H-2：Amp + Cline + Qwen 适配器

## 读取已有代码
- `src/types/adapter.ts` — CLIAdapter 接口
- `src/adapters/registry.ts` — 注册表
- `src/parsers/stream-json-parser.ts` — StreamJsonParser
- `src/parsers/jsonl-parser.ts` — JsonlParser
- `src/adapters/claude-code/adapter.ts` — 参考已实现的适配器模式

## 任务
1. 实现 `src/adapters/amp/adapter.ts` — `AmpAdapter`:
   - `amp -x <prompt>`
   - 复用 StreamJsonParser

2. 实现 `src/adapters/cline/adapter.ts` — `ClineAdapter`:
   - `cline -y <prompt> --json`
   - 复用 JsonlParser

3. 实现 `src/adapters/qwen/adapter.ts` — `QwenAdapter`:
   - `qwen -p <prompt> --output-format stream-json`
   - 复用 StreamJsonParser

4. 每个适配器实现完整的 CLIAdapter 接口

5. 编写独立单元测试

## 验收标准
- [ ] AC-1: AmpAdapter 接口实现完整
- [ ] AC-2: ClineAdapter 接口实现完整
- [ ] AC-3: QwenAdapter 接口实现完整
- [ ] AC-4: 各自单元测试通过
- [ ] AC-5: 所有测试通过: `npm test`

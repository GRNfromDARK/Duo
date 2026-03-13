# Card H.3: Cursor + Continue + Amazon Q + Goose 适配器

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.3 > FR-011b: 其余 9 个适配器实现（第三批）
- FR-008: CLI 注册表（Cursor, Continue, Amazon Q, Goose 条目）

从 `todolist.md` 读取：
- Phase H > H-3：Cursor + Continue + Amazon Q + Goose 适配器

## 读取已有代码
- `src/types/adapter.ts` — CLIAdapter 接口
- `src/adapters/registry.ts` — 注册表
- `src/parsers/jsonl-parser.ts` — JsonlParser
- `src/parsers/text-stream-parser.ts` — TextStreamParser
- `src/adapters/claude-code/adapter.ts` — 参考已实现的适配器模式

## 任务
1. 实现 `src/adapters/cursor/adapter.ts` — `CursorAdapter`:
   - `cursor agent -p <prompt> --output-format json --auto-approve`
   - 复用 JsonlParser

2. 实现 `src/adapters/continue/adapter.ts` — `ContinueAdapter`:
   - `cn -p <prompt> --format json --allow`
   - 复用 JsonlParser

3. 实现 `src/adapters/amazon-q/adapter.ts` — `AmazonQAdapter`:
   - `q chat --no-interactive --trust-all-tools <prompt>`
   - 复用 TextStreamParser

4. 实现 `src/adapters/goose/adapter.ts` — `GooseAdapter`:
   - `goose run -t <prompt>` + `GOOSE_MODE=auto`
   - 复用 TextStreamParser

5. 每个适配器实现完整的 CLIAdapter 接口

6. 用户可通过 `.duo/adapters.json` 禁用不需要的适配器

7. 编写独立单元测试

## 验收标准
- [ ] AC-1: CursorAdapter 接口实现完整
- [ ] AC-2: ContinueAdapter 接口实现完整
- [ ] AC-3: AmazonQAdapter 接口实现完整
- [ ] AC-4: GooseAdapter 接口实现完整
- [ ] AC-5: 各自单元测试通过
- [ ] AC-6: 用户可通过 `.duo/adapters.json` 禁用不需要的适配器
- [ ] AC-7: 所有测试通过: `npm test`

# Card A.3: 三类输出解析器

## 读取设计文档
从 `docs/requirements/2026-03-09-duo-requirement.md` 读取：
- Section 4 > CD-1.3 > FR-008: 输出解析器复用（3 类解析器）
- Section 4 > CD-1.3 > FR-013: 流式输出捕获与解析

从 `todolist.md` 读取：
- Phase A > A-3：三类输出解析器

## 读取已有代码
- `src/types/adapter.ts` — OutputChunk 类型定义
- `src/parsers/` — 检查目录

## 任务
1. 实现 `src/parsers/stream-json-parser.ts` — `StreamJsonParser`:
   - 解析 NDJSON stream-json 格式（逐行 JSON.parse）
   - 提取 text/tool_use/tool_result/error/status 事件
   - 输出 `AsyncIterable<OutputChunk>`
   - 用于: Claude Code, Gemini, Amp, Qwen

2. 实现 `src/parsers/jsonl-parser.ts` — `JsonlParser`:
   - 解析 JSONL/--json 格式
   - 输出 `AsyncIterable<OutputChunk>`
   - 用于: Codex, Cline, Copilot, Cursor, Continue

3. 实现 `src/parsers/text-stream-parser.ts` — `TextStreamParser`:
   - 解析纯文本流
   - 正则提取代码块、错误信息
   - 输出 `AsyncIterable<OutputChunk>`
   - 用于: Aider, Amazon Q, Goose

4. 创建 `src/parsers/index.ts` 统一导出

5. 编写完整单元测试（mock 数据）

## 验收标准
- [ ] AC-1: StreamJsonParser 正确解析 Claude Code stream-json 格式的 mock 数据
- [ ] AC-2: JsonlParser 正确解析 Codex --json 格式的 mock 数据
- [ ] AC-3: TextStreamParser 正确从纯文本中提取代码块
- [ ] AC-4: 所有解析器输出统一的 OutputChunk 格式
- [ ] AC-5: 解析中断（输入流断开）时保留已解析内容
- [ ] AC-6: 所有测试通过: `npm test`

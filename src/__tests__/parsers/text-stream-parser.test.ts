import { describe, it, expect } from 'vitest';
import { TextStreamParser } from '../../parsers/text-stream-parser.js';
import type { OutputChunk } from '../../types/adapter.js';

function createStream(lines: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(line + '\n');
      }
      controller.close();
    },
  });
}

async function collect(iter: AsyncIterable<OutputChunk>): Promise<OutputChunk[]> {
  const chunks: OutputChunk[] = [];
  for await (const chunk of iter) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('TextStreamParser', () => {
  it('should parse plain text as text chunks', async () => {
    const lines = ['Hello, I will help you fix this bug.'];
    const parser = new TextStreamParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const textChunks = chunks.filter((c) => c.type === 'text');
    expect(textChunks.length).toBeGreaterThanOrEqual(1);
  });

  it('should extract fenced code blocks', async () => {
    const lines = [
      'Here is the fix:',
      '```typescript',
      'const x = 1;',
      'const y = 2;',
      '```',
      'That should work.',
    ];
    const parser = new TextStreamParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    const codeChunks = chunks.filter((c) => c.type === 'code');
    expect(codeChunks).toHaveLength(1);
    expect(codeChunks[0].content).toContain('const x = 1;');
    expect(codeChunks[0].content).toContain('const y = 2;');
    expect(codeChunks[0].metadata?.language).toBe('typescript');
  });

  it('should extract multiple code blocks', async () => {
    const lines = [
      'First block:',
      '```js',
      'console.log("a");',
      '```',
      'Second block:',
      '```python',
      'print("b")',
      '```',
    ];
    const parser = new TextStreamParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    const codeChunks = chunks.filter((c) => c.type === 'code');
    expect(codeChunks).toHaveLength(2);
    expect(codeChunks[0].metadata?.language).toBe('js');
    expect(codeChunks[1].metadata?.language).toBe('python');
  });

  it('should detect error patterns in text', async () => {
    const lines = [
      'Error: Cannot find module "foo"',
    ];
    const parser = new TextStreamParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    const errorChunks = chunks.filter((c) => c.type === 'error');
    expect(errorChunks).toHaveLength(1);
    expect(errorChunks[0].content).toContain('Cannot find module');
  });

  it('should handle code block without language specifier', async () => {
    const lines = [
      '```',
      'some code',
      '```',
    ];
    const parser = new TextStreamParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    const codeChunks = chunks.filter((c) => c.type === 'code');
    expect(codeChunks).toHaveLength(1);
    expect(codeChunks[0].content).toContain('some code');
  });

  it('should preserve parsed content when stream breaks', async () => {
    let controllerRef: ReadableStreamDefaultController<string>;
    const stream = new ReadableStream<string>({
      start(controller) {
        controllerRef = controller;
      },
    });

    setTimeout(() => {
      controllerRef.enqueue('First line of output\n');
      controllerRef.enqueue('Second line of output\n');
      setTimeout(() => controllerRef.error(new Error('stream broken')), 0);
    }, 0);

    const parser = new TextStreamParser();
    const chunks: OutputChunk[] = [];
    try {
      for await (const chunk of parser.parse(stream)) {
        chunks.push(chunk);
      }
    } catch {
      // expected
    }

    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('should output unified OutputChunk format', async () => {
    const lines = ['Some text output'];
    const parser = new TextStreamParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    const chunk = chunks[0];
    expect(chunk).toHaveProperty('type');
    expect(chunk).toHaveProperty('content');
    expect(chunk).toHaveProperty('timestamp');
    expect(['text', 'code', 'tool_use', 'tool_result', 'error', 'status']).toContain(chunk.type);
  });

  it('should handle mixed text and code blocks', async () => {
    const lines = [
      'Let me explain:',
      '```bash',
      'npm install',
      '```',
      'Then run:',
      '```bash',
      'npm test',
      '```',
      'All done!',
    ];
    const parser = new TextStreamParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    const types = chunks.map((c) => c.type);
    expect(types).toContain('text');
    expect(types).toContain('code');
  });
});

import { describe, it, expect } from 'vitest';
import { StreamJsonParser } from '../../parsers/stream-json-parser.js';
import type { OutputChunk } from '../../types/adapter.js';

/** Helper: create a ReadableStream from lines of text */
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

/** Helper: collect all chunks from an AsyncIterable */
async function collect(iter: AsyncIterable<OutputChunk>): Promise<OutputChunk[]> {
  const chunks: OutputChunk[] = [];
  for await (const chunk of iter) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('StreamJsonParser', () => {
  it('should parse text event from NDJSON line', async () => {
    const lines = [
      JSON.stringify({ type: 'assistant', subtype: 'text', content: 'Hello world' }),
    ];
    const parser = new StreamJsonParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('text');
    expect(chunks[0].content).toBe('Hello world');
    expect(chunks[0].timestamp).toBeTypeOf('number');
  });

  it('should parse current Claude assistant text message shape', async () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Hello from Claude' },
          ],
        },
      }),
    ];
    const parser = new StreamJsonParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('text');
    expect(chunks[0].content).toBe('Hello from Claude');
  });

  it('should parse current Claude tool_use message shape', async () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'ls', description: 'List files' },
            },
          ],
        },
      }),
    ];
    const parser = new StreamJsonParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('tool_use');
    expect(chunks[0].metadata?.tool).toBe('Bash');
  });

  it('should parse current Claude user tool_result message shape', async () => {
    const lines = [
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              content: 'file1.ts\nfile2.ts',
              is_error: false,
            },
          ],
        },
        tool_use_result: {
          stdout: 'file1.ts\nfile2.ts',
          stderr: '',
        },
      }),
    ];
    const parser = new StreamJsonParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('tool_result');
    expect(chunks[0].content).toContain('file1.ts');
  });

  it('should keep Claude tool_result errors as non-fatal tool results', async () => {
    const lines = [
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              content: 'File does not exist.',
              is_error: true,
            },
          ],
        },
      }),
    ];
    const parser = new StreamJsonParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('tool_result');
    expect(chunks[0].metadata?.isError).toBe(true);
  });

  it('should parse tool_use event', async () => {
    const lines = [
      JSON.stringify({ type: 'tool_use', tool: 'read_file', input: { path: '/foo' } }),
    ];
    const parser = new StreamJsonParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('tool_use');
    expect(chunks[0].metadata?.tool).toBe('read_file');
  });

  it('should parse tool_result event', async () => {
    const lines = [
      JSON.stringify({ type: 'tool_result', content: 'file contents here' }),
    ];
    const parser = new StreamJsonParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('tool_result');
    expect(chunks[0].content).toBe('file contents here');
  });

  it('should parse error event', async () => {
    const lines = [
      JSON.stringify({ type: 'error', error: { message: 'something went wrong' } }),
    ];
    const parser = new StreamJsonParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('error');
    expect(chunks[0].content).toContain('something went wrong');
  });

  it('should parse result/status event', async () => {
    const lines = [
      JSON.stringify({ type: 'result', result: 'completed', cost: 0.05 }),
    ];
    const parser = new StreamJsonParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('status');
  });

  it('should handle multiple events in sequence', async () => {
    const lines = [
      JSON.stringify({ type: 'assistant', subtype: 'text', content: 'Let me help' }),
      JSON.stringify({ type: 'tool_use', tool: 'bash', input: { command: 'ls' } }),
      JSON.stringify({ type: 'tool_result', content: 'file1.ts' }),
      JSON.stringify({ type: 'assistant', subtype: 'text', content: 'Done!' }),
    ];
    const parser = new StreamJsonParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(4);
    expect(chunks[0].type).toBe('text');
    expect(chunks[1].type).toBe('tool_use');
    expect(chunks[2].type).toBe('tool_result');
    expect(chunks[3].type).toBe('text');
  });

  it('should parse current Claude multi-step sequence and ignore thinking blocks', async () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Need to inspect files first.' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', content: 'a\nb', is_error: false }],
        },
        tool_use_result: { stdout: 'a\nb', stderr: '' },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Found 2 files.' }],
        },
      }),
    ];
    const parser = new StreamJsonParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(3);
    expect(chunks[0].type).toBe('tool_use');
    expect(chunks[1].type).toBe('tool_result');
    expect(chunks[2]).toMatchObject({ type: 'text', content: 'Found 2 files.' });
  });

  it('should skip empty lines and malformed JSON', async () => {
    const lines = [
      '',
      'not valid json',
      JSON.stringify({ type: 'assistant', subtype: 'text', content: 'valid' }),
      '  ',
    ];
    const parser = new StreamJsonParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    // 1 valid chunk + 1 status chunk notifying about skipped malformed lines
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('valid');
    expect(chunks[1].type).toBe('status');
    expect(chunks[1].content).toMatch(/malformed/i);
  });

  it('should preserve parsed content when stream breaks mid-way', async () => {
    let controllerRef: ReadableStreamDefaultController<string>;
    const stream = new ReadableStream<string>({
      start(controller) {
        controllerRef = controller;
      },
    });

    // Async: enqueue data, then error after a tick
    setTimeout(() => {
      controllerRef.enqueue(JSON.stringify({ type: 'assistant', subtype: 'text', content: 'first' }) + '\n');
      controllerRef.enqueue(JSON.stringify({ type: 'assistant', subtype: 'text', content: 'second' }) + '\n');
      setTimeout(() => controllerRef.error(new Error('stream broken')), 0);
    }, 0);

    const parser = new StreamJsonParser();
    const chunks: OutputChunk[] = [];
    try {
      for await (const chunk of parser.parse(stream)) {
        chunks.push(chunk);
      }
    } catch {
      // expected
    }

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].content).toBe('first');
  });

  it('should output OutputChunk with all required fields', async () => {
    const lines = [
      JSON.stringify({ type: 'assistant', subtype: 'text', content: 'test' }),
    ];
    const parser = new StreamJsonParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    const chunk = chunks[0];
    expect(chunk).toHaveProperty('type');
    expect(chunk).toHaveProperty('content');
    expect(chunk).toHaveProperty('timestamp');
    expect(['text', 'code', 'tool_use', 'tool_result', 'error', 'status']).toContain(chunk.type);
  });
});

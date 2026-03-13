import { describe, it, expect } from 'vitest';
import { JsonlParser } from '../../parsers/jsonl-parser.js';
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

describe('JsonlParser', () => {
  it('should parse Codex --json text output', async () => {
    const lines = [
      JSON.stringify({ type: 'message', content: 'Here is the solution' }),
    ];
    const parser = new JsonlParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('text');
    expect(chunks[0].content).toBe('Here is the solution');
  });

  it('should parse code/patch output', async () => {
    const lines = [
      JSON.stringify({ type: 'code', content: 'const x = 1;', language: 'typescript' }),
    ];
    const parser = new JsonlParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('code');
    expect(chunks[0].content).toBe('const x = 1;');
  });

  it('should parse tool_use events', async () => {
    const lines = [
      JSON.stringify({ type: 'function_call', name: 'write_file', arguments: '{"path":"a.ts"}' }),
    ];
    const parser = new JsonlParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('tool_use');
  });

  it('should parse error events', async () => {
    const lines = [
      JSON.stringify({ type: 'error', message: 'rate limited' }),
    ];
    const parser = new JsonlParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('error');
    expect(chunks[0].content).toContain('rate limited');
  });

  it('should downgrade Codex reconnect transport errors to status', async () => {
    const lines = [
      JSON.stringify({ type: 'error', message: 'Reconnecting... 2/5 (stream disconnected before completion: tls handshake eof)' }),
    ];
    const parser = new JsonlParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('status');
    expect(chunks[0].content).toContain('Reconnecting...');
  });

  it('should downgrade Codex websocket fallback errors to status', async () => {
    const lines = [
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'error',
          message: 'Falling back from WebSockets to HTTPS transport. stream disconnected before completion: tls handshake eof',
        },
      }),
    ];
    const parser = new JsonlParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('status');
    expect(chunks[0].content).toContain('Falling back from WebSockets');
  });

  it('should parse status/completion events', async () => {
    const lines = [
      JSON.stringify({ type: 'status', status: 'completed' }),
    ];
    const parser = new JsonlParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('status');
  });

  it('should handle multiple JSONL lines', async () => {
    const lines = [
      JSON.stringify({ type: 'message', content: 'thinking...' }),
      JSON.stringify({ type: 'code', content: 'console.log("hi")', language: 'js' }),
      JSON.stringify({ type: 'message', content: 'done' }),
    ];
    const parser = new JsonlParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(3);
    expect(chunks[0].type).toBe('text');
    expect(chunks[1].type).toBe('code');
    expect(chunks[2].type).toBe('text');
  });

  it('should skip empty lines and malformed JSON', async () => {
    const lines = [
      '',
      '{broken',
      JSON.stringify({ type: 'message', content: 'valid' }),
    ];
    const parser = new JsonlParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    // 1 valid chunk + 1 status chunk notifying about skipped malformed lines
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('valid');
    expect(chunks[1].type).toBe('status');
    expect(chunks[1].content).toMatch(/malformed/i);
  });

  it('should preserve parsed content when stream breaks', async () => {
    let controllerRef: ReadableStreamDefaultController<string>;
    const stream = new ReadableStream<string>({
      start(controller) {
        controllerRef = controller;
      },
    });

    setTimeout(() => {
      controllerRef.enqueue(JSON.stringify({ type: 'message', content: 'saved' }) + '\n');
      setTimeout(() => controllerRef.error(new Error('connection lost')), 0);
    }, 0);

    const parser = new JsonlParser();
    const chunks: OutputChunk[] = [];
    try {
      for await (const chunk of parser.parse(stream)) {
        chunks.push(chunk);
      }
    } catch {
      // expected
    }

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].content).toBe('saved');
  });

  it('should preserve event metadata on status chunks', async () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'th_abc123' }),
    ];
    const parser = new JsonlParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('status');
    expect(chunks[0].metadata).toBeDefined();
    expect(chunks[0].metadata?.thread_id).toBe('th_abc123');
  });

  it('should output unified OutputChunk format', async () => {
    const lines = [
      JSON.stringify({ type: 'message', content: 'test' }),
    ];
    const parser = new JsonlParser();
    const chunks = await collect(parser.parse(createStream(lines)));

    const chunk = chunks[0];
    expect(chunk).toHaveProperty('type');
    expect(chunk).toHaveProperty('content');
    expect(chunk).toHaveProperty('timestamp');
    expect(['text', 'code', 'tool_use', 'tool_result', 'error', 'status']).toContain(chunk.type);
  });
});

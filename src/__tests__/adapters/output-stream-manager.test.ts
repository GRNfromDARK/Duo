import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutputStreamManager } from '../../adapters/output-stream-manager.js';
import type { OutputChunk } from '../../types/adapter.js';

/** Helper: create an async iterable from chunks with optional delay */
async function* createChunkSource(
  chunks: OutputChunk[],
  delayMs = 0,
): AsyncIterable<OutputChunk> {
  for (const chunk of chunks) {
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    yield chunk;
  }
}

/** Helper: create an OutputChunk */
function makeChunk(
  type: OutputChunk['type'],
  content: string,
  timestamp?: number,
): OutputChunk {
  return { type, content, timestamp: timestamp ?? Date.now() };
}

/** Helper: create an async iterable that errors mid-stream */
async function* createErrorSource(
  chunks: OutputChunk[],
  errorAfter: number,
): AsyncIterable<OutputChunk> {
  let i = 0;
  for (const chunk of chunks) {
    if (i >= errorAfter) {
      throw new Error('stream interrupted');
    }
    yield chunk;
    i++;
  }
}

describe('OutputStreamManager', () => {
  let manager: OutputStreamManager;

  beforeEach(() => {
    manager = new OutputStreamManager();
  });

  describe('basic streaming', () => {
    it('should forward all chunks from source to consumer', async () => {
      const source = [
        makeChunk('text', 'Hello'),
        makeChunk('code', 'const x = 1'),
        makeChunk('text', ' world'),
      ];

      manager.start(createChunkSource(source));

      const received: OutputChunk[] = [];
      for await (const chunk of manager.consume()) {
        received.push(chunk);
      }

      expect(received).toHaveLength(3);
      expect(received[0].content).toBe('Hello');
      expect(received[1].content).toBe('const x = 1');
      expect(received[2].content).toBe(' world');
    });

    it('should emit chunks with correct types', async () => {
      const source = [
        makeChunk('text', 'txt'),
        makeChunk('tool_use', '{}'),
        makeChunk('error', 'oops'),
        makeChunk('status', 'done'),
      ];

      manager.start(createChunkSource(source));

      const received: OutputChunk[] = [];
      for await (const chunk of manager.consume()) {
        received.push(chunk);
      }

      expect(received.map((c) => c.type)).toEqual([
        'text',
        'tool_use',
        'error',
        'status',
      ]);
    });
  });

  describe('multi-consumer support (AC-2)', () => {
    it('should deliver same chunks to multiple consumers', async () => {
      const source = [
        makeChunk('text', 'A'),
        makeChunk('text', 'B'),
        makeChunk('text', 'C'),
      ];

      manager.start(createChunkSource(source));

      const consumer1: OutputChunk[] = [];
      const consumer2: OutputChunk[] = [];

      await Promise.all([
        (async () => {
          for await (const chunk of manager.consume()) {
            consumer1.push(chunk);
          }
        })(),
        (async () => {
          for await (const chunk of manager.consume()) {
            consumer2.push(chunk);
          }
        })(),
      ]);

      expect(consumer1).toHaveLength(3);
      expect(consumer2).toHaveLength(3);
      expect(consumer1.map((c) => c.content)).toEqual(['A', 'B', 'C']);
      expect(consumer2.map((c) => c.content)).toEqual(['A', 'B', 'C']);
    });

    it('should support 3+ consumers simultaneously', async () => {
      const source = [makeChunk('text', 'X'), makeChunk('text', 'Y')];

      manager.start(createChunkSource(source));

      const results: OutputChunk[][] = [[], [], []];

      await Promise.all(
        results.map(async (arr) => {
          for await (const chunk of manager.consume()) {
            arr.push(chunk);
          }
        }),
      );

      for (const arr of results) {
        expect(arr).toHaveLength(2);
        expect(arr.map((c) => c.content)).toEqual(['X', 'Y']);
      }
    });

    it('should clear internal consumers after stream completion', async () => {
      const source = [makeChunk('text', 'done')];

      manager.start(createChunkSource(source));
      for await (const _ of manager.consume()) {
        // drain
      }

      expect((manager as any).consumers).toHaveLength(0);
    });
  });

  describe('output buffering (AC-4)', () => {
    it('should buffer all chunks for later retrieval', async () => {
      const source = [
        makeChunk('text', 'Hello '),
        makeChunk('text', 'world'),
      ];

      manager.start(createChunkSource(source));

      // Drain the stream
      for await (const _ of manager.consume()) {
        // consume all
      }

      const buffer = manager.getBuffer();
      expect(buffer).toHaveLength(2);
      expect(buffer[0].content).toBe('Hello ');
      expect(buffer[1].content).toBe('world');
    });

    it('should collect full text output from buffer', async () => {
      const source = [
        makeChunk('text', 'Hello '),
        makeChunk('code', 'const x = 1'),
        makeChunk('text', ' world'),
      ];

      manager.start(createChunkSource(source));

      for await (const _ of manager.consume()) {
        // consume all
      }

      const text = manager.getBufferedText();
      expect(text).toBe('Hello  const x = 1  world');
    });

    it('should return empty buffer before streaming starts', () => {
      expect(manager.getBuffer()).toEqual([]);
      expect(manager.getBufferedText()).toBe('');
    });
  });

  describe('interruption handling (AC-3)', () => {
    it('should preserve partial output when stream errors', async () => {
      const source = [
        makeChunk('text', 'part1'),
        makeChunk('text', 'part2'),
        makeChunk('text', 'part3'), // won't be reached
      ];

      manager.start(createErrorSource(source, 2));

      const received: OutputChunk[] = [];
      for await (const chunk of manager.consume()) {
        received.push(chunk);
      }

      // Should receive chunks before error
      expect(received).toHaveLength(2);
      expect(received[0].content).toBe('part1');
      expect(received[1].content).toBe('part2');

      // Buffer should also have partial output
      expect(manager.getBuffer()).toHaveLength(2);

      // Should be marked interrupted
      expect(manager.isInterrupted()).toBe(true);
    });

    it('should mark interrupted=false on normal completion', async () => {
      const source = [makeChunk('text', 'ok')];

      manager.start(createChunkSource(source));

      for await (const _ of manager.consume()) {
        // consume
      }

      expect(manager.isInterrupted()).toBe(false);
    });

    it('should preserve partial output for multiple consumers on interrupt', async () => {
      const source = [
        makeChunk('text', 'A'),
        makeChunk('text', 'B'),
        makeChunk('text', 'C'), // won't be reached
      ];

      manager.start(createErrorSource(source, 2));

      const c1: OutputChunk[] = [];
      const c2: OutputChunk[] = [];

      await Promise.all([
        (async () => {
          for await (const chunk of manager.consume()) c1.push(chunk);
        })(),
        (async () => {
          for await (const chunk of manager.consume()) c2.push(chunk);
        })(),
      ]);

      expect(c1).toHaveLength(2);
      expect(c2).toHaveLength(2);
      expect(manager.isInterrupted()).toBe(true);
    });
  });

  describe('interrupt() method', () => {
    it('should stop streaming when interrupt() is called', async () => {
      const source = [
        makeChunk('text', 'A'),
        makeChunk('text', 'B'),
        makeChunk('text', 'C'),
        makeChunk('text', 'D'),
      ];

      manager.start(createChunkSource(source, 50));

      const received: OutputChunk[] = [];

      // Interrupt after a short delay
      setTimeout(() => manager.interrupt(), 80);

      for await (const chunk of manager.consume()) {
        received.push(chunk);
      }

      // Should have received some but not all chunks
      expect(received.length).toBeLessThan(4);
      expect(manager.isInterrupted()).toBe(true);
    });
  });

  describe('streaming state', () => {
    it('should report isStreaming correctly', async () => {
      expect(manager.isStreaming()).toBe(false);

      const source = [makeChunk('text', 'hi')];
      manager.start(createChunkSource(source));

      expect(manager.isStreaming()).toBe(true);

      for await (const _ of manager.consume()) {
        // consume
      }

      // After stream ends, wait a tick for state update
      await new Promise((r) => setTimeout(r, 10));
      expect(manager.isStreaming()).toBe(false);
    });
  });

  describe('latency (AC-1)', () => {
    it('should forward chunks with <= 100ms latency', async () => {
      const now = Date.now();
      const source = [makeChunk('text', 'latency test', now)];

      manager.start(createChunkSource(source));

      for await (const chunk of manager.consume()) {
        const receivedAt = Date.now();
        const latency = receivedAt - chunk.timestamp;
        expect(latency).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('reset', () => {
    it('should clear buffer and state on reset', async () => {
      const source = [makeChunk('text', 'old data')];
      manager.start(createChunkSource(source));

      for await (const _ of manager.consume()) {
        // consume
      }

      expect(manager.getBuffer()).toHaveLength(1);

      manager.reset();

      expect(manager.getBuffer()).toEqual([]);
      expect(manager.isInterrupted()).toBe(false);
      expect(manager.isStreaming()).toBe(false);
    });
  });
});

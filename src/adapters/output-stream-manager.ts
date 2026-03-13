/**
 * OutputStreamManager — unified output stream management layer.
 * Source: FR-013 (AC-045, AC-047)
 *
 * Responsibilities:
 * - Multi-consumer broadcast of OutputChunk from CLIAdapter.execute()
 * - Output buffering for context passing
 * - Interruption handling with partial output preservation
 */

import type { OutputChunk } from '../types/adapter.js';

interface Consumer {
  push: (chunk: OutputChunk) => void;
  end: () => void;
}

export class OutputStreamManager {
  private buffer: OutputChunk[] = [];
  private consumers: Consumer[] = [];
  private interrupted = false;
  private streaming = false;
  private started = false;
  private interruptRequested = false;

  /**
   * Start consuming from an AsyncIterable source and broadcasting to consumers.
   * Call consume() to create consumer iterators before or after start().
   */
  start(source: AsyncIterable<OutputChunk>): void {
    this.streaming = true;
    this.started = true;
    this.interrupted = false;
    this.interruptRequested = false;

    void this.pump(source);
  }

  /**
   * Create a consumer async iterator that receives all chunks from the source.
   * Multiple consumers can be created and all receive the same chunks.
   */
  consume(): AsyncIterable<OutputChunk> {
    const queue: OutputChunk[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const consumer: Consumer = {
      push: (chunk: OutputChunk) => {
        queue.push(chunk);
        if (resolve) {
          resolve();
          resolve = null;
        }
      },
      end: () => {
        done = true;
        if (resolve) {
          resolve();
          resolve = null;
        }
      },
    };

    this.consumers.push(consumer);

    // Replay already-buffered chunks to late consumers
    for (const chunk of this.buffer) {
      consumer.push(chunk);
    }

    // If streaming already finished (started but no longer streaming),
    // immediately signal end to the late consumer
    if (this.started && !this.streaming) {
      consumer.end();
    }

    const iterator: AsyncIterableIterator<OutputChunk> = {
      [Symbol.asyncIterator]() {
        return iterator;
      },
      async next(): Promise<IteratorResult<OutputChunk>> {
        while (queue.length === 0 && !done) {
          await new Promise<void>((r) => {
            resolve = r;
          });
        }

        if (queue.length > 0) {
          return { value: queue.shift()!, done: false };
        }

        return { value: undefined as unknown as OutputChunk, done: true };
      },
      async return(): Promise<IteratorResult<OutputChunk>> {
        done = true;
        if (resolve) {
          resolve();
          resolve = null;
        }
        return { value: undefined as unknown as OutputChunk, done: true };
      },
    };

    return iterator;
  }

  /**
   * Interrupt the current stream. Preserves already-received output.
   */
  interrupt(): void {
    this.interruptRequested = true;
  }

  /**
   * Get all buffered chunks.
   */
  getBuffer(): OutputChunk[] {
    return [...this.buffer];
  }

  /**
   * Get concatenated text content from all buffered chunks.
   */
  getBufferedText(): string {
    return this.buffer.map((c) => c.content).join(' ');
  }

  /**
   * Whether the stream was interrupted (by error or manual interrupt).
   */
  isInterrupted(): boolean {
    return this.interrupted;
  }

  /**
   * Whether the manager is currently streaming.
   */
  isStreaming(): boolean {
    return this.streaming;
  }

  /**
   * Reset state for reuse.
   */
  reset(): void {
    this.buffer = [];
    this.consumers = [];
    this.interrupted = false;
    this.streaming = false;
    this.started = false;
    this.interruptRequested = false;
  }

  private async pump(source: AsyncIterable<OutputChunk>): Promise<void> {
    try {
      for await (const chunk of source) {
        if (this.interruptRequested) {
          this.interrupted = true;
          break;
        }

        this.buffer.push(chunk);

        for (const consumer of this.consumers) {
          consumer.push(chunk);
        }
      }
    } catch {
      this.interrupted = true;
    } finally {
      this.streaming = false;

      const consumers = [...this.consumers];
      this.consumers = [];

      for (const consumer of consumers) {
        consumer.end();
      }
    }
  }
}

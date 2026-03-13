/**
 * JsonlParser — parses JSONL/--json format.
 * Used by: Codex, Cline, Copilot, Cursor, Continue
 * Source: FR-008 (AC-033-new), FR-013 (AC-046)
 */

import type { OutputChunk } from '../types/adapter.js';

export class JsonlParser {
  private malformedLineCount = 0;

  async *parse(stream: ReadableStream<string>): AsyncIterable<OutputChunk> {
    const reader = stream.getReader();
    let buffer = '';
    this.malformedLineCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            this.malformedLineCount++;
            console.warn(`[JsonlParser] Skipped malformed JSON line: ${trimmed.slice(0, 100)}`);
            continue;
          }

          const chunk = this.mapToChunk(parsed);
          if (chunk) yield chunk;
        }
      }

      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim()) as Record<string, unknown>;
          const chunk = this.mapToChunk(parsed);
          if (chunk) yield chunk;
        } catch {
          this.malformedLineCount++;
          console.warn(`[JsonlParser] Skipped malformed trailing data: ${buffer.trim().slice(0, 100)}`);
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (this.malformedLineCount > 0) {
      console.warn(`[JsonlParser] Total malformed JSON lines skipped: ${this.malformedLineCount}`);
      yield {
        type: 'status' as const,
        content: `[JsonlParser] ${this.malformedLineCount} malformed JSON line(s) skipped`,
        timestamp: Date.now(),
      };
    }
  }

  private mapToChunk(event: Record<string, unknown>): OutputChunk | null {
    const type = typeof event.type === 'string' ? event.type : '';

    switch (type) {
      case 'message':
      case 'text':
        return {
          type: 'text',
          content: (event.content as string) ?? '',
          timestamp: Date.now(),
        };

      case 'code':
      case 'patch':
        return {
          type: 'code',
          content: (event.content as string) ?? '',
          timestamp: Date.now(),
          metadata: event.language ? { language: event.language as string } : undefined,
        };

      case 'function_call':
      case 'tool_use':
        return {
          type: 'tool_use',
          content: (event.arguments as string) ?? JSON.stringify(event),
          timestamp: Date.now(),
          metadata: {
            tool: (event.name as string) ?? (event.tool as string),
          },
        };

      case 'tool_result':
      case 'function_result':
        return {
          type: 'tool_result',
          content: (event.content as string) ?? (event.output as string) ?? '',
          timestamp: Date.now(),
        };

      case 'error':
        return this.mapErrorLikeEvent(
          (event.message as string) ?? (event.content as string) ?? JSON.stringify(event),
        );

      case 'status':
      case 'done':
      case 'completion':
      case 'thread.started':
      case 'turn.started':
      case 'turn.completed':
        return {
          type: 'status',
          content: (event.status as string) ?? (event.content as string) ?? JSON.stringify(event),
          timestamp: Date.now(),
          metadata: event as Record<string, unknown>,
        };

      // Codex output format: item.completed / item.started
      case 'item.completed': {
        const item = event.item as Record<string, unknown> | undefined;
        if (!item) return null;

        if (item.type === 'agent_message') {
          return {
            type: 'text',
            content: (item.text as string) ?? '',
            timestamp: Date.now(),
          };
        }

        if (item.type === 'command_execution') {
          return {
            type: 'tool_result',
            content: (item.aggregated_output as string) ?? '',
            timestamp: Date.now(),
            metadata: { tool: 'shell', command: item.command as string },
          };
        }

        if (item.type === 'error') {
          return this.mapErrorLikeEvent(
            (item.message as string) ?? JSON.stringify(item),
          );
        }

        return null;
      }

      case 'item.started': {
        const item = event.item as Record<string, unknown> | undefined;
        if (!item) return null;

        if (item.type === 'command_execution') {
          return {
            type: 'tool_use',
            content: (item.command as string) ?? '',
            timestamp: Date.now(),
            metadata: { tool: 'shell' },
          };
        }

        return null;
      }

      default:
        if (event.content) {
          return {
            type: 'text',
            content: event.content as string,
            timestamp: Date.now(),
          };
        }
        return null;
    }
  }

  private mapErrorLikeEvent(message: string): OutputChunk {
    const isTransientTransportIssue =
      /Reconnecting\.\.\.\s+\d+\/\d+/i.test(message)
      || /Falling back from WebSockets to HTTPS transport/i.test(message);

    return {
      type: isTransientTransportIssue ? 'status' : 'error',
      content: message,
      timestamp: Date.now(),
      metadata: isTransientTransportIssue ? { transient: true } : undefined,
    };
  }
}

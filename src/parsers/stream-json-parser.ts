/**
 * StreamJsonParser — parses NDJSON stream-json format.
 * Used by: Claude Code, Gemini, Amp, Qwen
 * Source: FR-008 (AC-033-new), FR-013 (AC-046)
 */

import type { OutputChunk } from '../types/adapter.js';

export class StreamJsonParser {
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
        // Keep the last incomplete line in buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            this.malformedLineCount++;
            console.warn(`[StreamJsonParser] Skipped malformed JSON line: ${trimmed.slice(0, 100)}`);
            continue;
          }

          const chunks = this.mapToChunks(parsed);
          for (const chunk of chunks) {
            yield chunk;
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim()) as Record<string, unknown>;
          const chunks = this.mapToChunks(parsed);
          for (const chunk of chunks) {
            yield chunk;
          }
        } catch {
          this.malformedLineCount++;
          console.warn(`[StreamJsonParser] Skipped malformed trailing data: ${buffer.trim().slice(0, 100)}`);
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (this.malformedLineCount > 0) {
      console.warn(`[StreamJsonParser] Total malformed JSON lines skipped: ${this.malformedLineCount}`);
      yield {
        type: 'status' as const,
        content: `[StreamJsonParser] ${this.malformedLineCount} malformed JSON line(s) skipped`,
        timestamp: Date.now(),
      };
    }
  }

  private mapToChunks(event: Record<string, unknown>): OutputChunk[] {
    const type = typeof event.type === 'string' ? event.type : '';

    switch (type) {
      case 'assistant':
        return this.mapAssistantEvent(event);

      case 'user':
        return this.mapUserEvent(event);

      case 'tool_use':
        return [{
          type: 'tool_use',
          content: JSON.stringify(event.input ?? {}),
          timestamp: Date.now(),
          metadata: {
            tool: event.tool as string,
            ...(event.input ? { input: event.input } : {}),
          },
        }];

      case 'tool_result':
        return [{
          type: 'tool_result',
          content: (event.content as string) ?? '',
          timestamp: Date.now(),
        }];

      case 'error':
        return [{
          type: 'error',
          content: typeof event.error === 'object' && event.error !== null
            ? (event.error as Record<string, unknown>).message as string ?? JSON.stringify(event.error)
            : (event.error as string) ?? (event.message as string) ?? (event.content as string) ?? 'Unknown error',
          timestamp: Date.now(),
          metadata: {
            fatal: (event.fatal as boolean | undefined) ?? true,
          },
        }];

      case 'result':
      case 'status':
      case 'system':
      case 'rate_limit_event':
        return [{
          type: 'status',
          content: JSON.stringify(event),
          timestamp: Date.now(),
          metadata: event as Record<string, unknown>,
        }];

      default:
        // Unknown event types mapped as text
        if (typeof event.content === 'string') {
          return [{
            type: 'text',
            content: event.content as string,
            timestamp: Date.now(),
          }];
        }
        return [];
    }
  }

  private mapAssistantEvent(event: Record<string, unknown>): OutputChunk[] {
    const contentItems = this.getMessageContentItems(event);
    if (contentItems.length > 0) {
      return this.mapContentItems(contentItems);
    }

    const subtype = event.subtype as string | undefined;
    if (subtype === 'text') {
      return [{
        type: 'text',
        content: (event.content as string) ?? '',
        timestamp: Date.now(),
        metadata: event.metadata as Record<string, unknown> | undefined,
      }];
    }

    if (typeof event.content === 'string') {
      return [{
        type: 'text',
        content: event.content,
        timestamp: Date.now(),
      }];
    }

    return [];
  }

  private mapUserEvent(event: Record<string, unknown>): OutputChunk[] {
    const contentItems = this.getMessageContentItems(event);
    if (contentItems.length === 0) {
      return [];
    }

    const toolUseResult =
      typeof event.tool_use_result === 'object' && event.tool_use_result !== null
        ? event.tool_use_result as Record<string, unknown>
        : null;

    const chunks: OutputChunk[] = [];

    for (const item of contentItems) {
      const itemType = item.type as string | undefined;

      if (itemType === 'tool_result') {
        const fallbackContent = typeof item.content === 'string'
          ? item.content
          : (toolUseResult?.stdout as string | undefined)
            ?? (toolUseResult?.stderr as string | undefined)
            ?? '';

        if (item.is_error === true) {
          chunks.push({
            type: 'tool_result',
            content: fallbackContent || 'Tool execution failed',
            timestamp: Date.now(),
            metadata: {
              isError: true,
            },
          });
        } else {
          chunks.push({
            type: 'tool_result',
            content: fallbackContent,
            timestamp: Date.now(),
          });
        }
      }
    }

    return chunks;
  }

  private mapContentItems(items: Record<string, unknown>[]): OutputChunk[] {
    const chunks: OutputChunk[] = [];

    for (const item of items) {
      const itemType = item.type as string | undefined;

      if (itemType === 'text' && typeof item.text === 'string') {
        chunks.push({
          type: 'text',
          content: item.text,
          timestamp: Date.now(),
        });
      } else if (itemType === 'tool_use') {
        chunks.push({
          type: 'tool_use',
          content: JSON.stringify(item.input ?? {}),
          timestamp: Date.now(),
          metadata: {
            tool: item.name as string,
            ...(item.input ? { input: item.input } : {}),
          },
        });
      } else if (itemType === 'tool_result' && typeof item.content === 'string') {
        chunks.push({
          type: 'tool_result',
          content: item.content,
          timestamp: Date.now(),
        });
      }
    }

    return chunks;
  }

  private getMessageContentItems(event: Record<string, unknown>): Record<string, unknown>[] {
    const message =
      typeof event.message === 'object' && event.message !== null
        ? event.message as Record<string, unknown>
        : null;

    const content = message?.content;
    if (!Array.isArray(content)) {
      return [];
    }

    return content.filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null,
    );
  }
}

/**
 * TextStreamParser — parses plain text streams.
 * Extracts code blocks via regex and detects error patterns.
 * Used by: Aider, Amazon Q, Goose
 * Source: FR-008 (AC-033-new), FR-013 (AC-046)
 */

import type { OutputChunk } from '../types/adapter.js';

const ERROR_PATTERNS = [
  /^Error:/i,
  /^fatal:/i,
  /^exception:/i,
  /^traceback/i,
  /^panic:/i,
  /^FAIL/,
];

const CODE_FENCE_OPEN = /^```(\w*)\s*$/;
const CODE_FENCE_CLOSE = /^```\s*$/;

export class TextStreamParser {
  async *parse(stream: ReadableStream<string>): AsyncIterable<OutputChunk> {
    const reader = stream.getReader();
    let buffer = '';
    let inCodeBlock = false;
    let codeLanguage = '';
    let codeLines: string[] = [];
    let textBuffer: string[] = [];

    let streamError: Error | null = null;

    try {
      while (true) {
        let readResult: ReadableStreamReadResult<string>;
        try {
          readResult = await reader.read();
        } catch (err) {
          streamError = err as Error;
          break;
        }
        const { done, value } = readResult;
        if (done) break;

        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (inCodeBlock) {
            if (CODE_FENCE_CLOSE.test(line.trim())) {
              inCodeBlock = false;
              yield {
                type: 'code',
                content: codeLines.join('\n'),
                timestamp: Date.now(),
                metadata: codeLanguage ? { language: codeLanguage } : undefined,
              };
              codeLines = [];
              codeLanguage = '';
            } else {
              codeLines.push(line);
            }
          } else {
            const fenceMatch = line.trim().match(CODE_FENCE_OPEN);
            if (fenceMatch) {
              if (textBuffer.length > 0) {
                yield { type: 'text', content: textBuffer.join('\n'), timestamp: Date.now() };
                textBuffer = [];
              }
              inCodeBlock = true;
              codeLanguage = fenceMatch[1] || '';
            } else if (this.isError(line)) {
              if (textBuffer.length > 0) {
                yield { type: 'text', content: textBuffer.join('\n'), timestamp: Date.now() };
                textBuffer = [];
              }
              yield { type: 'error', content: line, timestamp: Date.now() };
            } else {
              textBuffer.push(line);
            }
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        if (inCodeBlock) {
          codeLines.push(buffer);
        } else if (this.isError(buffer)) {
          if (textBuffer.length > 0) {
            yield { type: 'text', content: textBuffer.join('\n'), timestamp: Date.now() };
            textBuffer = [];
          }
          yield { type: 'error', content: buffer, timestamp: Date.now() };
        } else {
          textBuffer.push(buffer);
        }
      }

      // Flush remaining text
      if (textBuffer.length > 0) {
        yield { type: 'text', content: textBuffer.join('\n'), timestamp: Date.now() };
        textBuffer = [];
      }

      // Flush unclosed code block
      if (inCodeBlock && codeLines.length > 0) {
        yield {
          type: 'code',
          content: codeLines.join('\n'),
          timestamp: Date.now(),
          metadata: codeLanguage ? { language: codeLanguage } : undefined,
        };
      }

      if (streamError) {
        throw streamError;
      }
    } finally {
      reader.releaseLock();
    }
  }

  private isError(line: string): boolean {
    return ERROR_PATTERNS.some((pattern) => pattern.test(line.trim()));
  }
}

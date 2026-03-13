import { describe, it, expect } from 'vitest';
import {
  parseMarkdown,
  type MarkdownSegment,
} from '../../ui/markdown-parser.js';

describe('parseMarkdown', () => {
  describe('plain text', () => {
    it('returns plain text segment for simple text', () => {
      const result = parseMarkdown('Hello world');
      expect(result).toEqual([{ type: 'text', content: 'Hello world' }]);
    });

    it('handles empty string', () => {
      const result = parseMarkdown('');
      expect(result).toEqual([]);
    });

    it('handles multi-line plain text', () => {
      const result = parseMarkdown('Line 1\nLine 2');
      expect(result).toEqual([{ type: 'text', content: 'Line 1\nLine 2' }]);
    });
  });

  describe('code blocks', () => {
    it('parses a complete fenced code block with language', () => {
      const input = '```typescript\nconst x = 1;\n```';
      const result = parseMarkdown(input);
      expect(result).toEqual([
        { type: 'code_block', content: 'const x = 1;', language: 'typescript' },
      ]);
    });

    it('parses a code block without language', () => {
      const input = '```\nsome code\n```';
      const result = parseMarkdown(input);
      expect(result).toEqual([
        { type: 'code_block', content: 'some code', language: undefined },
      ]);
    });

    it('parses an unclosed code block (streaming scenario)', () => {
      const input = '```python\ndef hello():\n  print("hi")';
      const result = parseMarkdown(input);
      expect(result).toEqual([
        { type: 'code_block', content: 'def hello():\n  print("hi")', language: 'python' },
      ]);
    });

    it('parses text before and after a code block', () => {
      const input = 'Before\n```js\ncode\n```\nAfter';
      const result = parseMarkdown(input);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: 'text', content: 'Before' });
      expect(result[1]).toEqual({ type: 'code_block', content: 'code', language: 'js' });
      expect(result[2]).toEqual({ type: 'text', content: 'After' });
    });

    it('handles multiple code blocks', () => {
      const input = '```ts\na\n```\nMiddle\n```py\nb\n```';
      const result = parseMarkdown(input);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: 'code_block', content: 'a', language: 'ts' });
      expect(result[1]).toEqual({ type: 'text', content: 'Middle' });
      expect(result[2]).toEqual({ type: 'code_block', content: 'b', language: 'py' });
    });
  });

  describe('inline code', () => {
    it('parses inline code within text', () => {
      const result = parseMarkdown('Use `npm install` to install');
      expect(result).toEqual([
        { type: 'text', content: 'Use ' },
        { type: 'inline_code', content: 'npm install' },
        { type: 'text', content: ' to install' },
      ]);
    });
  });

  describe('bold and italic', () => {
    it('parses bold text (**)', () => {
      const result = parseMarkdown('This is **bold** text');
      expect(result).toEqual([
        { type: 'text', content: 'This is ' },
        { type: 'bold', content: 'bold' },
        { type: 'text', content: ' text' },
      ]);
    });

    it('parses italic text (*)', () => {
      const result = parseMarkdown('This is *italic* text');
      expect(result).toEqual([
        { type: 'text', content: 'This is ' },
        { type: 'italic', content: 'italic' },
        { type: 'text', content: ' text' },
      ]);
    });
  });

  describe('lists', () => {
    it('parses unordered list with -', () => {
      const input = '- Item 1\n- Item 2\n- Item 3';
      const result = parseMarkdown(input);
      expect(result).toEqual([
        { type: 'list_item', content: 'Item 1', marker: '-' },
        { type: 'list_item', content: 'Item 2', marker: '-' },
        { type: 'list_item', content: 'Item 3', marker: '-' },
      ]);
    });

    it('parses unordered list with *', () => {
      const input = '* Item A\n* Item B';
      const result = parseMarkdown(input);
      expect(result).toEqual([
        { type: 'list_item', content: 'Item A', marker: '*' },
        { type: 'list_item', content: 'Item B', marker: '*' },
      ]);
    });

    it('parses ordered list', () => {
      const input = '1. First\n2. Second\n3. Third';
      const result = parseMarkdown(input);
      expect(result).toEqual([
        { type: 'list_item', content: 'First', marker: '1.' },
        { type: 'list_item', content: 'Second', marker: '2.' },
        { type: 'list_item', content: 'Third', marker: '3.' },
      ]);
    });

    it('parses text mixed with list', () => {
      const input = 'Intro:\n- Item 1\n- Item 2\nOutro';
      const result = parseMarkdown(input);
      expect(result[0]).toEqual({ type: 'text', content: 'Intro:' });
      expect(result[1]).toEqual({ type: 'list_item', content: 'Item 1', marker: '-' });
      expect(result[2]).toEqual({ type: 'list_item', content: 'Item 2', marker: '-' });
      expect(result[3]).toEqual({ type: 'text', content: 'Outro' });
    });
  });

  describe('tables', () => {
    it('parses a simple table', () => {
      const input = '| Col A | Col B |\n|-------|-------|\n| val1  | val2  |';
      const result = parseMarkdown(input);
      expect(result).toEqual([
        {
          type: 'table',
          headers: ['Col A', 'Col B'],
          rows: [['val1', 'val2']],
        },
      ]);
    });

    it('parses table with multiple rows', () => {
      const input = '| H1 | H2 |\n|---|---|\n| a | b |\n| c | d |';
      const result = parseMarkdown(input);
      expect(result).toEqual([
        {
          type: 'table',
          headers: ['H1', 'H2'],
          rows: [['a', 'b'], ['c', 'd']],
        },
      ]);
    });
  });

  describe('mixed content', () => {
    it('parses complex markdown with multiple element types', () => {
      const input = 'Here is a list:\n- Item **one**\n- Item *two*\n\n```js\nconsole.log("hi");\n```\nDone.';
      const result = parseMarkdown(input);
      // Should contain text, list items, code block, and final text
      expect(result.length).toBeGreaterThanOrEqual(4);
      const codeBlock = result.find(s => s.type === 'code_block');
      expect(codeBlock).toBeDefined();
      expect(codeBlock!.content).toBe('console.log("hi");');
    });
  });

  describe('activity blocks', () => {
    it('parses custom activity blocks', () => {
      const input = ':::activity Bash\nList files\n$ ls\n:::\nDone';
      const result = parseMarkdown(input);

      expect(result).toEqual([
        { type: 'activity_block', kind: 'activity', title: 'Bash', content: 'List files\n$ ls' },
        { type: 'text', content: 'Done' },
      ]);
    });

    it('parses custom error blocks', () => {
      const input = ':::error Read\nFile does not exist.\n:::';
      const result = parseMarkdown(input);

      expect(result).toEqual([
        { type: 'activity_block', kind: 'error', title: 'Read', content: 'File does not exist.' },
      ]);
    });
  });
});

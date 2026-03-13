import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StreamRenderer } from '../../ui/components/StreamRenderer.js';

describe('StreamRenderer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders plain text content', () => {
    const { lastFrame } = render(
      <StreamRenderer content="Hello world" isStreaming={false} />
    );
    expect(lastFrame()!).toContain('Hello world');
  });

  it('renders empty content without error', () => {
    const { lastFrame } = render(
      <StreamRenderer content="" isStreaming={false} />
    );
    expect(lastFrame()!).toBeDefined();
  });

  it('shows spinner indicator when streaming', () => {
    const { lastFrame } = render(
      <StreamRenderer content="Thinking..." isStreaming={true} />
    );
    const output = lastFrame()!;
    expect(output).toContain('Thinking...');
    // Should show a streaming indicator
    expect(output).toMatch(/[▍▊█⣾⣽⣻⢿⡿⣟⣯⣷●○◐◑]/);
  });

  it('does not show spinner when not streaming', () => {
    const { lastFrame } = render(
      <StreamRenderer content="Done." isStreaming={false} />
    );
    const output = lastFrame()!;
    expect(output).toContain('Done.');
    expect(output).not.toMatch(/▍/);
  });

  it('renders code blocks with visual distinction', () => {
    const content = '```typescript\nconst x = 1;\n```';
    const { lastFrame } = render(
      <StreamRenderer content={content} isStreaming={false} />
    );
    const output = lastFrame()!;
    expect(output).toContain('const x = 1;');
    // Code block should have language label
    expect(output).toContain('typescript');
  });

  it('renders unclosed code blocks (streaming)', () => {
    const content = '```python\ndef hello():\n  pass';
    const { lastFrame } = render(
      <StreamRenderer content={content} isStreaming={true} />
    );
    const output = lastFrame()!;
    expect(output).toContain('def hello():');
    expect(output).toContain('python');
  });

  it('renders bold text', () => {
    const { lastFrame } = render(
      <StreamRenderer content="This is **important**" isStreaming={false} />
    );
    expect(lastFrame()!).toContain('important');
  });

  it('renders italic text', () => {
    const { lastFrame } = render(
      <StreamRenderer content="This is *emphasized*" isStreaming={false} />
    );
    expect(lastFrame()!).toContain('emphasized');
  });

  it('renders unordered lists with bullet markers', () => {
    const content = '- First item\n- Second item';
    const { lastFrame } = render(
      <StreamRenderer content={content} isStreaming={false} />
    );
    const output = lastFrame()!;
    expect(output).toContain('First item');
    expect(output).toContain('Second item');
  });

  it('renders ordered lists with numbers', () => {
    const content = '1. First\n2. Second';
    const { lastFrame } = render(
      <StreamRenderer content={content} isStreaming={false} />
    );
    const output = lastFrame()!;
    expect(output).toContain('First');
    expect(output).toContain('Second');
  });

  it('renders inline code distinctly', () => {
    const content = 'Run `npm test` to verify';
    const { lastFrame } = render(
      <StreamRenderer content={content} isStreaming={false} />
    );
    const output = lastFrame()!;
    expect(output).toContain('npm test');
  });

  it('renders tables', () => {
    const content = '| Name | Value |\n|------|-------|\n| a    | 1     |';
    const { lastFrame } = render(
      <StreamRenderer content={content} isStreaming={false} />
    );
    const output = lastFrame()!;
    expect(output).toContain('Name');
    expect(output).toContain('Value');
    expect(output).toContain('a');
    expect(output).toContain('1');
  });

  it('handles long content (1000+ lines) without error', () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `Line ${i + 1}`);
    const content = lines.join('\n');
    const { lastFrame } = render(
      <StreamRenderer content={content} isStreaming={false} />
    );
    const output = lastFrame()!;
    expect(output).toBeDefined();
    // Should contain some of the content
    expect(output).toContain('Line 1');
  });

  it('renders multiple code blocks in sequence', () => {
    const content = '```js\na()\n```\nMiddle\n```py\nb()\n```';
    const { lastFrame } = render(
      <StreamRenderer content={content} isStreaming={false} />
    );
    const output = lastFrame()!;
    expect(output).toContain('a()');
    expect(output).toContain('Middle');
    expect(output).toContain('b()');
  });

  it('renders activity blocks as compact summaries', () => {
    const content = ':::activity Bash\nList files\n$ ls\n:::\n\n:::result Bash\nfile1\nfile2\nfile3\n:::';
    const { lastFrame } = render(
      <StreamRenderer content={content} isStreaming={false} />
    );
    const output = lastFrame()!;
    expect(output).toContain('Bash');
    expect(output).toContain('List files');
    expect(output).not.toContain('file2');
  });
});

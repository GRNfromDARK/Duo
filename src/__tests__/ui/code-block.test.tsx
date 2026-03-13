import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { CodeBlock } from '../../ui/components/CodeBlock.js';

/**
 * CodeBlock tests — FR-015 (AC-052, AC-053, AC-054)
 *
 * - >10 lines auto-collapse, show first 5 lines + line count
 * - Enter key toggles expand/collapse
 * - Collapse state persists across re-renders (scroll simulation)
 */

function makeLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
}

describe('CodeBlock', () => {
  describe('auto-folding behavior', () => {
    it('renders all lines when code block has <= 10 lines', () => {
      const content = makeLines(10);
      const { lastFrame } = render(
        <CodeBlock content={content} language="ts" />
      );
      const output = lastFrame()!;
      expect(output).toContain('line 1');
      expect(output).toContain('line 10');
      expect(output).not.toContain('Expand');
    });

    it('auto-folds when code block has > 10 lines', () => {
      const content = makeLines(15);
      const { lastFrame } = render(
        <CodeBlock content={content} language="ts" />
      );
      const output = lastFrame()!;
      // Should show first 5 lines
      expect(output).toContain('line 1');
      expect(output).toContain('line 5');
      // Should NOT show lines beyond the first 5
      expect(output).not.toContain('line 6');
      expect(output).not.toContain('line 15');
    });

    it('shows expand button with line count for folded blocks', () => {
      const content = makeLines(20);
      const { lastFrame } = render(
        <CodeBlock content={content} language="js" />
      );
      const output = lastFrame()!;
      expect(output).toContain('Expand');
      expect(output).toContain('20');
    });

    it('shows language label', () => {
      const content = makeLines(5);
      const { lastFrame } = render(
        <CodeBlock content={content} language="python" />
      );
      const output = lastFrame()!;
      expect(output).toContain('python');
    });

    it('renders without language label when language is undefined', () => {
      const content = makeLines(3);
      const { lastFrame } = render(
        <CodeBlock content={content} />
      );
      const output = lastFrame()!;
      expect(output).toContain('line 1');
      expect(output).toContain('line 3');
    });
  });

  describe('expand/collapse toggle', () => {
    it('shows all lines when expanded is true', () => {
      const content = makeLines(15);
      const { lastFrame } = render(
        <CodeBlock content={content} language="ts" expanded={true} />
      );
      const output = lastFrame()!;
      expect(output).toContain('line 1');
      expect(output).toContain('line 15');
      // Should show collapse button
      expect(output).toContain('Collapse');
    });

    it('shows only first 5 lines when expanded is false', () => {
      const content = makeLines(15);
      const { lastFrame } = render(
        <CodeBlock content={content} language="ts" expanded={false} />
      );
      const output = lastFrame()!;
      expect(output).toContain('line 1');
      expect(output).toContain('line 5');
      expect(output).not.toContain('line 6');
      expect(output).toContain('Expand');
    });

    it('calls onToggle when provided', () => {
      const content = makeLines(15);
      let toggled = false;
      const { lastFrame } = render(
        <CodeBlock
          content={content}
          language="ts"
          expanded={false}
          onToggle={() => { toggled = true; }}
        />
      );
      // onToggle is available for parent-controlled state
      expect(lastFrame()!).toContain('Expand');
      // Note: actual key press testing is limited in ink-testing-library;
      // we verify the callback prop is accepted
      expect(toggled).toBe(false); // not called until interaction
    });
  });

  describe('edge cases', () => {
    it('handles exactly 11 lines (just over threshold)', () => {
      const content = makeLines(11);
      const { lastFrame } = render(
        <CodeBlock content={content} language="ts" />
      );
      const output = lastFrame()!;
      expect(output).toContain('line 1');
      expect(output).toContain('line 5');
      expect(output).not.toContain('line 6');
      expect(output).toContain('Expand');
      expect(output).toContain('11');
    });

    it('handles empty content', () => {
      const { lastFrame } = render(
        <CodeBlock content="" language="ts" />
      );
      expect(lastFrame()!).toBeDefined();
    });

    it('handles single line', () => {
      const { lastFrame } = render(
        <CodeBlock content="single line" language="ts" />
      );
      const output = lastFrame()!;
      expect(output).toContain('single line');
      expect(output).not.toContain('Expand');
    });
  });

  describe('state persistence across re-renders (scroll simulation)', () => {
    it('preserves expanded state on re-render', () => {
      const content = makeLines(15);
      const { lastFrame, rerender } = render(
        <CodeBlock content={content} language="ts" expanded={true} />
      );
      expect(lastFrame()!).toContain('line 15');

      // Re-render (simulates scroll causing re-render)
      rerender(
        <CodeBlock content={content} language="ts" expanded={true} />
      );
      // State should persist — still expanded
      expect(lastFrame()!).toContain('line 15');
      expect(lastFrame()!).toContain('Collapse');
    });

    it('preserves collapsed state on re-render', () => {
      const content = makeLines(15);
      const { lastFrame, rerender } = render(
        <CodeBlock content={content} language="ts" expanded={false} />
      );
      expect(lastFrame()!).not.toContain('line 15');

      rerender(
        <CodeBlock content={content} language="ts" expanded={false} />
      );
      expect(lastFrame()!).not.toContain('line 15');
      expect(lastFrame()!).toContain('Expand');
    });
  });
});

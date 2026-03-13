/**
 * Tests for God message visual styling.
 * Card F.4: FR-014 God 视觉层级区分 (AC-041)
 */

import { describe, it, expect } from 'vitest';
import {
  formatGodMessage,
  shouldShowGodMessage,
  GOD_STYLE,
  type GodMessageType,
} from '../../ui/god-message-style.js';

describe('GOD_STYLE', () => {
  it('should use double border characters', () => {
    expect(GOD_STYLE.borderChar).toBe('║');
    expect(GOD_STYLE.topBorder).toContain('╔');
    expect(GOD_STYLE.topBorder).toContain('╗');
    expect(GOD_STYLE.bottomBorder).toContain('╚');
    expect(GOD_STYLE.bottomBorder).toContain('╝');
  });

  it('should use Cyan border color and Magenta text color', () => {
    expect(GOD_STYLE.borderColor).toBe('cyan');
    expect(GOD_STYLE.textColor).toBe('magenta');
  });

  it('should be visually distinct from Coder/Reviewer styles', () => {
    // Coder uses ┃ (single thick), Reviewer uses different border
    // God uses ╔═╗ double border — distinct from all others
    expect(GOD_STYLE.borderChar).not.toBe('┃');
    expect(GOD_STYLE.borderChar).not.toBe('│');
    expect(GOD_STYLE.borderChar).not.toBe('·');
    expect(GOD_STYLE.borderChar).not.toBe('>');
  });
});

describe('shouldShowGodMessage', () => {
  it('should show task_analysis messages', () => {
    expect(shouldShowGodMessage('task_analysis')).toBe(true);
  });

  it('should show phase_transition messages', () => {
    expect(shouldShowGodMessage('phase_transition')).toBe(true);
  });

  it('should show auto_decision messages', () => {
    expect(shouldShowGodMessage('auto_decision')).toBe(true);
  });

  it('should show anomaly_detection messages', () => {
    expect(shouldShowGodMessage('anomaly_detection')).toBe(true);
  });

  it('should not show routing type messages (no visual noise)', () => {
    expect(shouldShowGodMessage('routing' as GodMessageType)).toBe(false);
  });

  it('should not show unknown type messages', () => {
    expect(shouldShowGodMessage('unknown_type' as GodMessageType)).toBe(false);
  });
});

describe('formatGodMessage', () => {
  it('should include ╔═╗ top border in output', () => {
    const lines = formatGodMessage('Test message', 'task_analysis');
    expect(lines[0]).toMatch(/^╔═+╗$/);
  });

  it('should include ╚═╝ bottom border in output', () => {
    const lines = formatGodMessage('Test message', 'task_analysis');
    expect(lines[lines.length - 1]).toMatch(/^╚═+╝$/);
  });

  it('should include ║ side borders on content lines', () => {
    const lines = formatGodMessage('Test message', 'task_analysis');
    // Content lines (not top/bottom border) should have ║ borders
    const contentLines = lines.slice(1, -1);
    expect(contentLines.length).toBeGreaterThan(0);
    for (const line of contentLines) {
      expect(line.startsWith('║')).toBe(true);
      expect(line.endsWith('║')).toBe(true);
    }
  });

  it('should include type label in header', () => {
    const lines = formatGodMessage('Test', 'task_analysis');
    const contentLines = lines.slice(1, -1);
    const headerLine = contentLines[0];
    expect(headerLine).toContain('God');
  });

  it('should include the content text', () => {
    const lines = formatGodMessage('Hello world', 'phase_transition');
    const joined = lines.join('\n');
    expect(joined).toContain('Hello world');
  });

  it('should handle multi-line content', () => {
    const lines = formatGodMessage('Line 1\nLine 2\nLine 3', 'auto_decision');
    const joined = lines.join('\n');
    expect(joined).toContain('Line 1');
    expect(joined).toContain('Line 2');
    expect(joined).toContain('Line 3');
  });

  it('should handle empty content', () => {
    const lines = formatGodMessage('', 'anomaly_detection');
    expect(lines.length).toBeGreaterThanOrEqual(3); // top border + at least header + bottom border
    expect(lines[0]).toMatch(/^╔═+╗$/);
    expect(lines[lines.length - 1]).toMatch(/^╚═+╝$/);
  });

  it('should produce consistent width across all lines', () => {
    const lines = formatGodMessage('Test message content here', 'task_analysis');
    // All lines should have the same visual width
    const widths = lines.map((l) => [...l].length);
    const firstWidth = widths[0];
    for (const w of widths) {
      expect(w).toBe(firstWidth);
    }
  });
});

/**
 * Tests for round summary divider formatting.
 * Source: FR-020 (AC-068, AC-069)
 */

import { describe, it, expect } from 'vitest';
import { formatRoundSummary, createRoundSummaryMessage } from '../../ui/round-summary.js';

describe('formatRoundSummary', () => {
  it('formats a basic round summary divider line', () => {
    const result = formatRoundSummary(1, 2, 'Auth middleware added');
    expect(result).toBe('═══ Round 1→2 · Summary: Auth middleware added ═══');
  });

  it('truncates summary to <= 100 characters total', () => {
    const longSummary = 'A'.repeat(200);
    const result = formatRoundSummary(3, 4, longSummary);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain('═══ Round 3→4');
    expect(result).toContain('...');
    expect(result.endsWith('═══')).toBe(true);
  });

  it('handles empty summary gracefully', () => {
    const result = formatRoundSummary(1, 2, '');
    expect(result).toBe('═══ Round 1→2 ═══');
  });

  it('handles single-char summary', () => {
    const result = formatRoundSummary(5, 6, 'x');
    expect(result).toBe('═══ Round 5→6 · Summary: x ═══');
  });

  it('handles exact-fit summary (no truncation needed)', () => {
    // Prefix: "═══ Round 1→2 · Summary: " = 25 chars, suffix: " ═══" = 4 chars
    // Available for summary text: 100 - 25 - 4 = 71 chars
    const summary = 'A'.repeat(71);
    const result = formatRoundSummary(1, 2, summary);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).not.toContain('...');
  });
});

describe('createRoundSummaryMessage', () => {
  it('creates a system message with round summary content', () => {
    const msg = createRoundSummaryMessage(2, 3, 'Fixed error handling');
    expect(msg.role).toBe('system');
    expect(msg.content).toContain('Round 2→3');
    expect(msg.content).toContain('Fixed error handling');
    expect(msg.id).toBeTruthy();
    expect(msg.timestamp).toBeGreaterThan(0);
    expect(msg.metadata?.isRoundSummary).toBe(true);
  });
});

/**
 * Tests for GodContextManager — incremental prompt management for God.
 * Source: FR-012 (AC-037, AC-038), AR-006
 */

import { describe, it, expect } from 'vitest';
import {
  GodContextManager,
  CHARS_PER_TOKEN,
} from '../../god/god-context-manager.js';
import type { ConvergenceLogEntry } from '../../god/god-convergence.js';

// ── Helpers ──

function makeLogEntry(overrides: Partial<ConvergenceLogEntry> = {}): ConvergenceLogEntry {
  return {
    round: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    classification: 'changes_requested',
    shouldTerminate: false,
    blockingIssueCount: 3,
    criteriaProgress: [{ criterion: 'tests pass', satisfied: false }],
    summary: 'classification=changes_requested, blocking=3, terminate=false, criteria=0/1',
    ...overrides,
  };
}

function makeConvergenceLog(entries: Partial<ConvergenceLogEntry>[]): ConvergenceLogEntry[] {
  return entries.map((e, i) => makeLogEntry({ round: i + 1, ...e }));
}

describe('GodContextManager', () => {
  const mgr = new GodContextManager();

  // ── buildIncrementalPrompt ──

  describe('buildIncrementalPrompt', () => {
    it('includes latest coder output', () => {
      const prompt = mgr.buildIncrementalPrompt({
        latestCoderOutput: 'Implemented login feature',
        round: 1,
        convergenceLog: [],
      });
      expect(prompt).toContain('Implemented login feature');
    });

    it('includes latest reviewer output when provided', () => {
      const prompt = mgr.buildIncrementalPrompt({
        latestCoderOutput: 'code output',
        latestReviewerOutput: 'Found 2 blocking issues',
        round: 2,
        convergenceLog: [],
      });
      expect(prompt).toContain('Found 2 blocking issues');
    });

    it('includes round info', () => {
      const prompt = mgr.buildIncrementalPrompt({
        latestCoderOutput: 'code',
        round: 3,
        convergenceLog: [],
      });
      expect(prompt).toContain('Round 3');
    });

    it('includes trend summary when convergenceLog is non-empty', () => {
      const log = makeConvergenceLog([
        { blockingIssueCount: 5 },
        { blockingIssueCount: 3 },
        { blockingIssueCount: 2 },
      ]);
      const prompt = mgr.buildIncrementalPrompt({
        latestCoderOutput: 'code',
        round: 4,
        convergenceLog: log,
      });
      // Should contain trend summary, not full log entries
      expect(prompt).toContain('5');
      expect(prompt).toContain('3');
      expect(prompt).toContain('2');
    });

    it('does NOT include full convergenceLog history (AC-037, incremental only)', () => {
      const log = makeConvergenceLog([
        { blockingIssueCount: 5, summary: 'FULL_SUMMARY_ROUND_1_MARKER' },
        { blockingIssueCount: 3, summary: 'FULL_SUMMARY_ROUND_2_MARKER' },
        { blockingIssueCount: 2, summary: 'FULL_SUMMARY_ROUND_3_MARKER' },
      ]);
      const prompt = mgr.buildIncrementalPrompt({
        latestCoderOutput: 'code',
        round: 4,
        convergenceLog: log,
      });
      // Full summaries should NOT be in incremental prompt
      expect(prompt).not.toContain('FULL_SUMMARY_ROUND_1_MARKER');
      expect(prompt).not.toContain('FULL_SUMMARY_ROUND_2_MARKER');
      expect(prompt).not.toContain('FULL_SUMMARY_ROUND_3_MARKER');
    });

    it('prompt size stays under 10k tokens estimate (AC-037)', () => {
      // Create large coder/reviewer outputs (each ~3k tokens = 12k chars)
      const largeCoderOutput = 'x'.repeat(12_000);
      const largeReviewerOutput = 'y'.repeat(12_000);
      const log = makeConvergenceLog(
        Array.from({ length: 10 }, (_, i) => ({ blockingIssueCount: 10 - i })),
      );

      const prompt = mgr.buildIncrementalPrompt({
        latestCoderOutput: largeCoderOutput,
        latestReviewerOutput: largeReviewerOutput,
        round: 11,
        convergenceLog: log,
      });

      const estimatedTokens = prompt.length / CHARS_PER_TOKEN;
      expect(estimatedTokens).toBeLessThan(10_000);
    });
  });

  // ── buildTrendSummary ──

  describe('buildTrendSummary', () => {
    it('returns empty string for empty log', () => {
      expect(mgr.buildTrendSummary([])).toBe('');
    });

    it('shows single-entry summary', () => {
      const log = makeConvergenceLog([{ blockingIssueCount: 5 }]);
      const summary = mgr.buildTrendSummary(log);
      expect(summary).toContain('5');
    });

    it('shows improving trend with arrow notation', () => {
      const log = makeConvergenceLog([
        { blockingIssueCount: 5 },
        { blockingIssueCount: 3 },
        { blockingIssueCount: 1 },
      ]);
      const summary = mgr.buildTrendSummary(log);
      // Should show trend like "5→3→1"
      expect(summary).toMatch(/5.*3.*1/);
    });

    it('shows stagnant trend', () => {
      const log = makeConvergenceLog([
        { blockingIssueCount: 3 },
        { blockingIssueCount: 3 },
        { blockingIssueCount: 3 },
      ]);
      const summary = mgr.buildTrendSummary(log);
      expect(summary).toMatch(/3.*3.*3/);
      expect(summary).toMatch(/stagnant|unchanged|停滞/i);
    });

    it('shows criteria progress', () => {
      const log = makeConvergenceLog([
        {
          blockingIssueCount: 2,
          criteriaProgress: [
            { criterion: 'tests pass', satisfied: false },
            { criterion: 'lint clean', satisfied: true },
          ],
        },
      ]);
      const summary = mgr.buildTrendSummary(log);
      expect(summary).toContain('1/2');
    });

    it('keeps summary concise (not full history dump)', () => {
      const log = makeConvergenceLog(
        Array.from({ length: 20 }, (_, i) => ({
          blockingIssueCount: 20 - i,
          summary: `Very long summary for round ${i + 1} with lots of detail that should not appear`,
        })),
      );
      const summary = mgr.buildTrendSummary(log);
      // Should be concise — under 500 chars
      expect(summary.length).toBeLessThan(500);
    });
  });

  // ── BUG-3 R13 regression: oscillating trend detection ──

  describe('test_regression_bug3_r13: oscillating trend detection', () => {
    it('classifies [5, 1, 5] as oscillating, not stagnant', () => {
      const log = makeConvergenceLog([
        { blockingIssueCount: 5 },
        { blockingIssueCount: 1 },
        { blockingIssueCount: 5 },
      ]);
      const summary = mgr.buildTrendSummary(log);
      expect(summary).toMatch(/oscillat/i);
      expect(summary).not.toMatch(/stagnant/i);
    });

    it('classifies [3, 8, 3] as oscillating, not stagnant', () => {
      const log = makeConvergenceLog([
        { blockingIssueCount: 3 },
        { blockingIssueCount: 8 },
        { blockingIssueCount: 3 },
      ]);
      const summary = mgr.buildTrendSummary(log);
      expect(summary).toMatch(/oscillat/i);
    });

    it('classifies [2, 5, 1, 4, 2] as oscillating', () => {
      const log = makeConvergenceLog([
        { blockingIssueCount: 2 },
        { blockingIssueCount: 5 },
        { blockingIssueCount: 1 },
        { blockingIssueCount: 4 },
        { blockingIssueCount: 2 },
      ]);
      const summary = mgr.buildTrendSummary(log);
      expect(summary).toMatch(/oscillat/i);
    });

    it('still classifies [3, 3, 3] as stagnant (no oscillation)', () => {
      const log = makeConvergenceLog([
        { blockingIssueCount: 3 },
        { blockingIssueCount: 3 },
        { blockingIssueCount: 3 },
      ]);
      const summary = mgr.buildTrendSummary(log);
      expect(summary).toMatch(/stagnant/i);
    });

    it('still classifies [5, 3, 1] as improving', () => {
      const log = makeConvergenceLog([
        { blockingIssueCount: 5 },
        { blockingIssueCount: 3 },
        { blockingIssueCount: 1 },
      ]);
      const summary = mgr.buildTrendSummary(log);
      expect(summary).toMatch(/improving/i);
    });
  });

  // ── shouldRebuildSession ──

  describe('shouldRebuildSession', () => {
    it('returns false when under limit', () => {
      expect(mgr.shouldRebuildSession(5000, 10000)).toBe(false);
    });

    it('returns true when at or over limit', () => {
      expect(mgr.shouldRebuildSession(10000, 10000)).toBe(true);
      expect(mgr.shouldRebuildSession(12000, 10000)).toBe(true);
    });

    it('returns true when near limit (within 90% threshold)', () => {
      // At 90% of 10000 = 9000, should trigger rebuild
      expect(mgr.shouldRebuildSession(9500, 10000)).toBe(true);
    });

    it('returns false when well under threshold', () => {
      expect(mgr.shouldRebuildSession(8000, 10000)).toBe(false);
    });
  });

  // ── buildSessionRebuildPrompt ──

  describe('buildSessionRebuildPrompt', () => {
    it('includes convergenceLog trend summary', () => {
      const log = makeConvergenceLog([
        { blockingIssueCount: 5 },
        { blockingIssueCount: 3 },
        { blockingIssueCount: 1 },
      ]);
      const prompt = mgr.buildSessionRebuildPrompt(log);
      expect(prompt).toMatch(/5.*3.*1/);
    });

    it('includes latest criteria status', () => {
      const log = makeConvergenceLog([
        {
          blockingIssueCount: 1,
          criteriaProgress: [
            { criterion: 'tests pass', satisfied: true },
            { criterion: 'lint clean', satisfied: false },
          ],
        },
      ]);
      const prompt = mgr.buildSessionRebuildPrompt(log);
      expect(prompt).toContain('tests pass');
      expect(prompt).toContain('lint clean');
    });

    it('provides context for decision continuity (AC-038)', () => {
      const log = makeConvergenceLog([
        { blockingIssueCount: 5, classification: 'changes_requested' },
        { blockingIssueCount: 2, classification: 'changes_requested' },
      ]);
      const prompt = mgr.buildSessionRebuildPrompt(log);
      // Should mention it's a session rebuild / continuation
      expect(prompt).toMatch(/session rebuild|continuation|context restored|resume/i);
    });

    it('includes last round number', () => {
      const log = makeConvergenceLog([
        { round: 1, blockingIssueCount: 5 },
        { round: 2, blockingIssueCount: 3 },
        { round: 3, blockingIssueCount: 1 },
      ]);
      const prompt = mgr.buildSessionRebuildPrompt(log);
      expect(prompt).toContain('3');
    });

    it('handles empty log gracefully', () => {
      const prompt = mgr.buildSessionRebuildPrompt([]);
      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(0);
    });
  });
});

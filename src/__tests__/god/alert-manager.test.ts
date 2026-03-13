/**
 * Tests for AlertManager — God anomaly alerting.
 * Source: FR-021 (AC-053, AC-054)
 */

import { describe, it, expect } from 'vitest';
import { AlertManager, type Alert } from '../../god/alert-manager.js';
import type { ConvergenceLogEntry } from '../../god/god-convergence.js';
import type { GodError } from '../../god/degradation-manager.js';

// ── Helpers ──

function makeConvergenceEntry(
  round: number,
  blockingIssueCount: number,
  overrides?: Partial<ConvergenceLogEntry>,
): ConvergenceLogEntry {
  return {
    round,
    timestamp: new Date().toISOString(),
    classification: 'changes_requested',
    shouldTerminate: false,
    blockingIssueCount,
    criteriaProgress: [],
    summary: `round=${round}, blocking=${blockingIssueCount}`,
    ...overrides,
  };
}

describe('AlertManager', () => {
  // ── GOD_LATENCY (AC-1) ──

  describe('checkLatency', () => {
    it('returns GOD_LATENCY Warning when latency > 30s', () => {
      const manager = new AlertManager();
      const alert = manager.checkLatency(31000);

      expect(alert).not.toBeNull();
      expect(alert!.type).toBe('GOD_LATENCY');
      expect(alert!.level).toBe('Warning');
      expect(alert!.message).toContain('30');
    });

    it('returns null when latency <= 30s', () => {
      const manager = new AlertManager();
      expect(manager.checkLatency(30000)).toBeNull();
      expect(manager.checkLatency(1000)).toBeNull();
    });

    it('returns null when latency is exactly 30s', () => {
      const manager = new AlertManager();
      expect(manager.checkLatency(30000)).toBeNull();
    });
  });

  // ── STAGNANT_PROGRESS (AC-2) ──

  describe('checkProgress', () => {
    it('returns STAGNANT_PROGRESS Warning after 3 consecutive stagnant rounds', () => {
      const manager = new AlertManager();
      const log: ConvergenceLogEntry[] = [
        makeConvergenceEntry(1, 3),
        makeConvergenceEntry(2, 3),
        makeConvergenceEntry(3, 3),
      ];

      const alert = manager.checkProgress(log);

      expect(alert).not.toBeNull();
      expect(alert!.type).toBe('STAGNANT_PROGRESS');
      expect(alert!.level).toBe('Warning');
    });

    it('returns null when fewer than 3 rounds', () => {
      const manager = new AlertManager();
      const log: ConvergenceLogEntry[] = [
        makeConvergenceEntry(1, 3),
        makeConvergenceEntry(2, 3),
      ];

      expect(manager.checkProgress(log)).toBeNull();
    });

    it('returns null when blockingIssueCount is decreasing', () => {
      const manager = new AlertManager();
      const log: ConvergenceLogEntry[] = [
        makeConvergenceEntry(1, 5),
        makeConvergenceEntry(2, 3),
        makeConvergenceEntry(3, 1),
      ];

      expect(manager.checkProgress(log)).toBeNull();
    });

    it('returns null when empty log', () => {
      const manager = new AlertManager();
      expect(manager.checkProgress([])).toBeNull();
    });

    it('detects stagnation in last 3 rounds even if earlier rounds progressed', () => {
      const manager = new AlertManager();
      const log: ConvergenceLogEntry[] = [
        makeConvergenceEntry(1, 5),
        makeConvergenceEntry(2, 3),
        makeConvergenceEntry(3, 3),
        makeConvergenceEntry(4, 3),
        makeConvergenceEntry(5, 3),
      ];

      const alert = manager.checkProgress(log);
      expect(alert).not.toBeNull();
      expect(alert!.type).toBe('STAGNANT_PROGRESS');
    });
  });

  // ── GOD_ERROR (AC-3) ──

  describe('checkGodError', () => {
    it('returns GOD_ERROR Critical on process_exit', () => {
      const manager = new AlertManager();
      const error: GodError = { kind: 'process_exit', message: 'God process crashed' };

      const alert = manager.checkGodError(error);

      expect(alert).not.toBeNull();
      expect(alert!.type).toBe('GOD_ERROR');
      expect(alert!.level).toBe('Critical');
      expect(alert!.message).toContain('God process crashed');
    });

    it('returns GOD_ERROR Critical on timeout', () => {
      const manager = new AlertManager();
      const error: GodError = { kind: 'timeout', message: 'God timed out' };

      const alert = manager.checkGodError(error);

      expect(alert).not.toBeNull();
      expect(alert!.type).toBe('GOD_ERROR');
      expect(alert!.level).toBe('Critical');
    });

    it('returns GOD_ERROR Critical on parse_failure', () => {
      const manager = new AlertManager();
      const error: GodError = { kind: 'parse_failure', message: 'Invalid JSON' };

      const alert = manager.checkGodError(error);

      expect(alert).not.toBeNull();
      expect(alert!.type).toBe('GOD_ERROR');
      expect(alert!.level).toBe('Critical');
    });

    it('returns GOD_ERROR Critical on schema_validation', () => {
      const manager = new AlertManager();
      const error: GodError = { kind: 'schema_validation', message: 'Schema mismatch' };

      const alert = manager.checkGodError(error);

      expect(alert).not.toBeNull();
      expect(alert!.type).toBe('GOD_ERROR');
      expect(alert!.level).toBe('Critical');
    });
  });

  // ── Alert behavior (AC-4, AC-5) ──

  describe('alert behavior classification', () => {
    it('Warning level does not block workflow (AC-4)', () => {
      const manager = new AlertManager();

      const latencyAlert = manager.checkLatency(35000);
      expect(latencyAlert).not.toBeNull();
      expect(latencyAlert!.level).toBe('Warning');
      expect(manager.shouldBlockWorkflow(latencyAlert!)).toBe(false);

      const stagnantLog: ConvergenceLogEntry[] = [
        makeConvergenceEntry(1, 3),
        makeConvergenceEntry(2, 3),
        makeConvergenceEntry(3, 3),
      ];
      const progressAlert = manager.checkProgress(stagnantLog);
      expect(progressAlert).not.toBeNull();
      expect(progressAlert!.level).toBe('Warning');
      expect(manager.shouldBlockWorkflow(progressAlert!)).toBe(false);
    });

    it('Critical level blocks workflow and waits for confirmation (AC-5)', () => {
      const manager = new AlertManager();
      const error: GodError = { kind: 'process_exit', message: 'crash' };
      const alert = manager.checkGodError(error);

      expect(alert).not.toBeNull();
      expect(alert!.level).toBe('Critical');
      expect(manager.shouldBlockWorkflow(alert!)).toBe(true);
    });
  });

  // ── Alert structure ──

  describe('alert structure', () => {
    it('includes timestamp in ISO format', () => {
      const manager = new AlertManager();
      const alert = manager.checkLatency(35000);

      expect(alert).not.toBeNull();
      expect(alert!.timestamp).toBeDefined();
      // ISO format check
      expect(() => new Date(alert!.timestamp)).not.toThrow();
      expect(new Date(alert!.timestamp).toISOString()).toBe(alert!.timestamp);
    });

    it('includes error data in GOD_ERROR alert', () => {
      const manager = new AlertManager();
      const error: GodError = { kind: 'timeout', message: 'God timed out after 60s' };
      const alert = manager.checkGodError(error);

      expect(alert).not.toBeNull();
      expect(alert!.data).toEqual(error);
    });
  });
});

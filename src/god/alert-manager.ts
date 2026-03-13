/**
 * AlertManager — God anomaly alerting.
 * Source: FR-021 (AC-053, AC-054)
 *
 * Three alert rules:
 * - GOD_LATENCY: God call > 30s → Warning → StatusBar spinner
 * - STAGNANT_PROGRESS: 3 consecutive stagnant rounds → Warning → blocking card
 * - GOD_ERROR: God API failure → Critical → system message
 *
 * Behavior:
 * - Warning: does not block workflow (AC-053)
 * - Critical: pauses workflow, waits for user confirmation (AC-054)
 */

import type { ConvergenceLogEntry } from './god-convergence.js';
import type { GodError } from './degradation-manager.js';

// ── Types ──

export type AlertLevel = 'Warning' | 'Critical';
export type AlertType = 'GOD_LATENCY' | 'STAGNANT_PROGRESS' | 'GOD_ERROR';

export interface Alert {
  type: AlertType;
  level: AlertLevel;
  message: string;
  timestamp: string;
  data?: unknown;
}

// ── Constants ──

const LATENCY_THRESHOLD_MS = 30_000;
const STAGNATION_THRESHOLD = 3;

// ── AlertManager ──

export class AlertManager {
  /**
   * Check if a God call latency exceeds the threshold (> 30s).
   * Returns GOD_LATENCY Warning if exceeded, null otherwise.
   */
  checkLatency(latencyMs: number): Alert | null {
    if (latencyMs <= LATENCY_THRESHOLD_MS) {
      return null;
    }

    return {
      type: 'GOD_LATENCY',
      level: 'Warning',
      message: `God call latency ${Math.round(latencyMs / 1000)}s exceeds 30s threshold`,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check convergence log for stagnant progress.
   * Returns STAGNANT_PROGRESS Warning if last 3 rounds have non-decreasing blockingIssueCount.
   */
  checkProgress(convergenceLog: ConvergenceLogEntry[]): Alert | null {
    if (convergenceLog.length < STAGNATION_THRESHOLD) {
      return null;
    }

    const recent = convergenceLog.slice(-STAGNATION_THRESHOLD);

    // Check if blockingIssueCount is non-decreasing (stagnant or increasing)
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].blockingIssueCount < recent[i - 1].blockingIssueCount) {
        return null; // Progress is being made
      }
    }

    // All zeros means converged, not stagnant
    if (recent.every(e => e.blockingIssueCount === 0)) {
      return null;
    }

    return {
      type: 'STAGNANT_PROGRESS',
      level: 'Warning',
      message: `No progress in ${STAGNATION_THRESHOLD} consecutive rounds (blockingIssueCount: ${recent[recent.length - 1].blockingIssueCount})`,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check a God error and produce a Critical alert.
   * All God API failures are Critical level.
   */
  checkGodError(error: GodError): Alert {
    return {
      type: 'GOD_ERROR',
      level: 'Critical',
      message: `God API failure: ${error.message}`,
      timestamp: new Date().toISOString(),
      data: error,
    };
  }

  /**
   * Determine if an alert should block the workflow.
   * Warning → false (AC-053)
   * Critical → true (AC-054)
   */
  shouldBlockWorkflow(alert: Alert): boolean {
    return alert.level === 'Critical';
  }
}

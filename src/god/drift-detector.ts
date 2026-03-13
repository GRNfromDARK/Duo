/**
 * DriftDetector — God progressive drift detection.
 * Source: FR-G03 (AC-060, AC-061)
 *
 * Detection signals:
 * - god_too_permissive: God approves 3+ consecutive times while local judges changes_requested
 * - confidence_declining: God confidence declines for 4+ consecutive rounds
 *
 * Severity:
 * - mild: warning only (logged to audit)
 * - severe: temporary fallback for 2 rounds, then auto-recover
 */

import type { GodConvergenceJudgment, GodPostReviewerDecision } from '../types/god-schemas.js';
import { appendAuditLog, type GodAuditEntry } from './god-audit.js';

// ── Types ──

export type DriftType = 'god_too_permissive' | 'confidence_declining';
export type DriftSeverity = 'mild' | 'severe';

export interface DriftDetectionResult {
  detected: boolean;
  type?: DriftType;
  severity?: DriftSeverity;
  details?: string;
}

export type GodDecision = GodConvergenceJudgment | GodPostReviewerDecision;

export interface DriftDetectorOptions {
  sessionDir?: string;
  seq?: number;
  round?: number;
  /** Provide a callback to get the next seq from a shared source (e.g. GodAuditLogger) */
  seqProvider?: () => number;
}

// ── Type guards ──

function isConvergenceJudgment(d: GodDecision): d is GodConvergenceJudgment {
  return 'classification' in d && 'shouldTerminate' in d && 'blockingIssueCount' in d;
}

function isPostReviewerDecision(d: GodDecision): d is GodPostReviewerDecision {
  return 'action' in d && 'confidenceScore' in d && 'progressTrend' in d;
}

// ── Constants ──

const PERMISSIVE_THRESHOLD = 3;
const CONFIDENCE_DECLINE_THRESHOLD = 4;
const FALLBACK_ROUNDS = 2;
const LOW_CONFIDENCE_THRESHOLD = 0.5;

// ── Helpers ──

/**
 * Determine if a God decision is "permissive" (approved/converged).
 */
function isGodPermissive(decision: GodDecision): boolean {
  if (isConvergenceJudgment(decision)) {
    return decision.classification === 'approved';
  }
  if (isPostReviewerDecision(decision)) {
    return decision.action === 'converged';
  }
  return false;
}

/**
 * Extract confidence score from decision, if available.
 */
function getConfidenceScore(decision: GodDecision): number | undefined {
  if (isPostReviewerDecision(decision)) {
    return decision.confidenceScore;
  }
  return undefined;
}

// ── DriftDetector ──

export class DriftDetector {
  private consecutivePermissive = 0;
  private confidenceHistory: number[] = [];
  private fallbackRoundsRemaining = 0;
  private lastDriftResult: DriftDetectionResult = { detected: false };
  private readonly sessionDir?: string;
  private seq: number;
  private round: number;
  private readonly seqProvider?: () => number;

  constructor(opts?: DriftDetectorOptions) {
    this.sessionDir = opts?.sessionDir;
    this.seq = opts?.seq ?? 0;
    this.round = opts?.round ?? 0;
    this.seqProvider = opts?.seqProvider;

    // Enforce: if sessionDir is provided, seqProvider must also be provided
    // to prevent seq conflicts with GodAuditLogger writing to the same file
    if (this.sessionDir && !this.seqProvider) {
      throw new Error(
        'DriftDetector: seqProvider is required when sessionDir is provided to prevent audit log seq conflicts',
      );
    }
  }

  /**
   * Update the round number externally to keep in sync.
   */
  setRound(round: number): void {
    this.round = round;
  }

  /**
   * Record a God decision and the corresponding local classification.
   * Called after each God decision (AC-060).
   */
  recordDecision(godDecision: GodDecision, localClassification: string): void {
    // Track permissive streak
    if (isGodPermissive(godDecision) && localClassification === 'changes_requested') {
      this.consecutivePermissive++;
    } else {
      this.consecutivePermissive = 0;
    }

    // Track confidence history
    const confidence = getConfidenceScore(godDecision);
    if (confidence !== undefined) {
      this.confidenceHistory.push(confidence);
    }
  }

  /**
   * Check for drift signals. Returns detection result.
   * Writes to audit log on detection (AC-061).
   */
  checkDrift(): DriftDetectionResult {
    // Check god_too_permissive first (higher priority)
    if (this.consecutivePermissive >= PERMISSIVE_THRESHOLD) {
      const result: DriftDetectionResult = {
        detected: true,
        type: 'god_too_permissive',
        severity: 'severe',
        details: `God approved ${this.consecutivePermissive} consecutive times while local judged changes_requested`,
      };
      this.handleDrift(result);
      return result;
    }

    // Check confidence_declining
    if (this.confidenceHistory.length >= CONFIDENCE_DECLINE_THRESHOLD) {
      const recent = this.confidenceHistory.slice(-CONFIDENCE_DECLINE_THRESHOLD);
      const isConsecutivelyDeclining = recent.every(
        (score, i) => i === 0 || score < recent[i - 1],
      );

      if (isConsecutivelyDeclining) {
        const lastScore = recent[recent.length - 1];
        const severity: DriftSeverity = lastScore < LOW_CONFIDENCE_THRESHOLD ? 'severe' : 'mild';
        const result: DriftDetectionResult = {
          detected: true,
          type: 'confidence_declining',
          severity,
          details: `Confidence declined for ${CONFIDENCE_DECLINE_THRESHOLD} consecutive rounds: ${recent.map(s => s.toFixed(2)).join(' → ')}`,
        };
        this.handleDrift(result);
        return result;
      }
    }

    this.lastDriftResult = { detected: false };
    return { detected: false };
  }

  /**
   * Whether fallback mode is currently active due to severe drift.
   */
  isFallbackActive(): boolean {
    return this.fallbackRoundsRemaining > 0;
  }

  /**
   * How many fallback rounds remain before auto-recovery.
   */
  getFallbackRoundsRemaining(): number {
    return this.fallbackRoundsRemaining;
  }

  /**
   * Tick one fallback round. Called after each round while fallback is active.
   * Auto-recovers when remaining rounds reach 0.
   */
  tickFallbackRound(): void {
    if (this.fallbackRoundsRemaining > 0) {
      this.fallbackRoundsRemaining--;
    }
  }

  // ── Private ──

  private handleDrift(result: DriftDetectionResult): void {
    this.lastDriftResult = result;

    // Reset counters to prevent infinite re-trigger after recovery
    if (result.type === 'god_too_permissive') {
      this.consecutivePermissive = 0;
    }
    if (result.type === 'confidence_declining') {
      this.confidenceHistory = [];
    }

    // Severe drift → activate fallback
    if (result.severity === 'severe') {
      this.fallbackRoundsRemaining = FALLBACK_ROUNDS;
    }

    // Write to audit log (AC-061)
    if (this.sessionDir) {
      this.writeAuditEntry(result);
    }
  }

  private writeAuditEntry(result: DriftDetectionResult): void {
    const entry: GodAuditEntry = {
      seq: this.seqProvider ? this.seqProvider() : this.seq++,
      timestamp: new Date().toISOString(),
      round: this.round,
      decisionType: 'DRIFT_DETECTED',
      inputSummary: `Drift detection: ${result.type}`,
      outputSummary: result.details ?? '',
      decision: {
        type: result.type,
        severity: result.severity,
        details: result.details,
      },
    };
    appendAuditLog(this.sessionDir!, entry);
  }
}

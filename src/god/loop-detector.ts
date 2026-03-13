/**
 * Loop Detector — dead loop detection for God orchestrator.
 * Source: FR-009 (AC-031, AC-032)
 *
 * Detection signals:
 * - 3 consecutive rounds with progressTrend === 'stagnant'
 * - Semantic repetition (same unresolvedIssues across rounds)
 * - blockingIssueCount trend not decreasing
 *
 * When detected, suggests an intervention strategy.
 */

import type { ConvergenceLogEntry } from './god-convergence.js';
import type { GodPostReviewerDecision } from '../types/god-schemas.js';

// ── Types ──

export interface LoopIntervention {
  type: 'rephrase_prompt' | 'skip_issue' | 'force_converge' | 'request_human';
  details: string;
}

export interface LoopDetectionResult {
  detected: boolean;
  reason?: string;
  suggestedAction?: string;
  intervention?: LoopIntervention;
}

/** Minimum consecutive rounds required to trigger loop detection */
const STAGNATION_THRESHOLD = 3;

// ── Main Detection ──

/**
 * Detect dead loops based on convergence log and recent routing decisions.
 *
 * Returns detected: true only when multiple signals confirm a loop,
 * keeping false positive rate low (AC-032).
 */
export function detectLoop(
  convergenceLog: ConvergenceLogEntry[],
  recentDecisions: GodPostReviewerDecision[],
): LoopDetectionResult {
  // Need at least STAGNATION_THRESHOLD rounds of data
  if (convergenceLog.length < STAGNATION_THRESHOLD || recentDecisions.length < STAGNATION_THRESHOLD) {
    return { detected: false };
  }

  const recentLog = convergenceLog.slice(-STAGNATION_THRESHOLD);
  const recentDec = recentDecisions.slice(-STAGNATION_THRESHOLD);

  // Check if blockingIssueCount is actually decreasing — if so, no loop
  if (isBlockingIssueDecreasing(recentLog)) {
    return { detected: false };
  }

  // Signal 1: All recent progressTrend are stagnant or declining
  const allStagnantOrDeclining = recentDec.every(
    d => d.progressTrend === 'stagnant' || d.progressTrend === 'declining',
  );

  if (!allStagnantOrDeclining) {
    return { detected: false };
  }

  // Signal 2: blockingIssueCount not decreasing (already confirmed above)
  const isNonDecreasing = isBlockingIssueNonDecreasing(recentLog);

  // Signal 3: Semantic repetition check
  const hasSemanticRepetition = detectSemanticRepetition(recentDec);

  // Determine loop type and intervention
  const allDeclining = recentDec.every(d => d.progressTrend === 'declining');

  if (allDeclining) {
    // Getting worse — suggest force_converge
    return {
      detected: true,
      reason: `Declining progress: blockingIssueCount increasing over ${STAGNATION_THRESHOLD} rounds`,
      suggestedAction: 'Force convergence to prevent further degradation',
      intervention: {
        type: 'force_converge',
        details: `Progress declining for ${STAGNATION_THRESHOLD} consecutive rounds. Forcing convergence to prevent infinite loop.`,
      },
    };
  }

  if (hasSemanticRepetition && isNonDecreasing) {
    // Same issues repeating — suggest rephrase
    return {
      detected: true,
      reason: `Dead loop: semantic repetition of unresolved issues over ${STAGNATION_THRESHOLD} rounds`,
      suggestedAction: 'Rephrase prompt to break the cycle',
      intervention: {
        type: 'rephrase_prompt',
        details: `Same unresolved issues recurring for ${STAGNATION_THRESHOLD} rounds. Rephrasing prompt to provide different approach.`,
      },
    };
  }

  if (isNonDecreasing) {
    // Stagnant with no semantic info — suggest rephrase
    return {
      detected: true,
      reason: `Stagnant progress: blockingIssueCount unchanged for ${STAGNATION_THRESHOLD} rounds`,
      suggestedAction: 'Rephrase prompt to break stagnation',
      intervention: {
        type: 'rephrase_prompt',
        details: `No progress in blockingIssueCount for ${STAGNATION_THRESHOLD} consecutive rounds.`,
      },
    };
  }

  return { detected: false };
}

// ── Internal Helpers ──

/**
 * Check if blockingIssueCount is strictly decreasing across recent log entries.
 */
function isBlockingIssueDecreasing(recentLog: ConvergenceLogEntry[]): boolean {
  for (let i = 1; i < recentLog.length; i++) {
    if (recentLog[i].blockingIssueCount >= recentLog[i - 1].blockingIssueCount) {
      return false;
    }
  }
  return true;
}

/**
 * Check if blockingIssueCount is non-decreasing (same or increasing).
 */
function isBlockingIssueNonDecreasing(recentLog: ConvergenceLogEntry[]): boolean {
  for (let i = 1; i < recentLog.length; i++) {
    if (recentLog[i].blockingIssueCount < recentLog[i - 1].blockingIssueCount) {
      return false;
    }
  }
  return true;
}

/**
 * Detect semantic repetition by comparing unresolvedIssues across decisions.
 * Uses simple string comparison (sorted + joined) for v1.
 */
function detectSemanticRepetition(decisions: GodPostReviewerDecision[]): boolean {
  const issueSignatures = decisions.map(d => {
    const issues = d.unresolvedIssues ?? [];
    return [...issues].sort().join('|');
  });

  // All signatures must be identical and non-empty
  if (issueSignatures[0] === '') return false;
  return issueSignatures.every(sig => sig === issueSignatures[0]);
}

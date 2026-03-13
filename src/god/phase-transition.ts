/**
 * Phase Transition — compound task phase management for God orchestrator.
 * Source: FR-010 (AC-033, AC-034)
 *
 * Evaluates whether to transition from current phase to next phase
 * based on God's decision. Preserves RoundRecord across transitions.
 */

import type { ConvergenceLogEntry } from './god-convergence.js';
import type { GodPostReviewerDecision } from '../types/god-schemas.js';

// ── Types ──

export interface Phase {
  id: string;
  name: string;
  type: 'explore' | 'code' | 'discuss' | 'review' | 'debug' | 'compound';
  description: string;
}

export interface PhaseTransitionResult {
  shouldTransition: boolean;
  nextPhaseId?: string;
  previousPhaseSummary?: string;
}

// ── Main Evaluation ──

/**
 * Evaluate whether a phase transition should occur.
 *
 * Transition conditions:
 * 1. God decision action === 'phase_transition'
 * 2. Current phase has a successor in the phases array
 *
 * On transition:
 * - Identifies next phase by position in phases array
 * - Generates previousPhaseSummary from convergence log (AC-034)
 */
export function evaluatePhaseTransition(
  currentPhase: Phase,
  phases: Phase[],
  convergenceLog: ConvergenceLogEntry[],
  godDecision: GodPostReviewerDecision,
): PhaseTransitionResult {
  // Only transition on explicit phase_transition action
  if (godDecision.action !== 'phase_transition') {
    return { shouldTransition: false };
  }

  // Find current phase index
  const currentIndex = phases.findIndex(p => p.id === currentPhase.id);
  if (currentIndex === -1) {
    // Current phase not found — cannot transition
    return { shouldTransition: false };
  }

  // Prefer God-specified nextPhaseId; fallback to sequential next phase
  const nextPhase = (godDecision.nextPhaseId
    ? phases.find(p => p.id === godDecision.nextPhaseId)
    : undefined) ?? phases[currentIndex + 1];

  if (!nextPhase) {
    // No valid next phase found (last phase without God-specified target)
    return { shouldTransition: false };
  }

  // Guard: prevent self-transition (God hallucinated nextPhaseId === current phase)
  if (nextPhase.id === currentPhase.id) {
    return { shouldTransition: false };
  }

  const summary = buildPhaseSummary(currentPhase, convergenceLog);

  return {
    shouldTransition: true,
    nextPhaseId: nextPhase.id,
    previousPhaseSummary: summary,
  };
}

// ── Internal Helpers ──

/**
 * Build a summary of the completed phase from its convergence log.
 * This summary is carried into the next phase's prompt (AC-034).
 */
function buildPhaseSummary(phase: Phase, convergenceLog: ConvergenceLogEntry[]): string {
  const parts: string[] = [];
  parts.push(`Phase "${phase.id}" (${phase.name}) completed.`);

  if (convergenceLog.length === 0) {
    parts.push('No convergence history recorded.');
    return parts.join(' ');
  }

  const lastEntry = convergenceLog[convergenceLog.length - 1];
  parts.push(`Final round: ${lastEntry.round}.`);
  parts.push(`Classification: ${lastEntry.classification}.`);
  parts.push(`Blocking issues: ${lastEntry.blockingIssueCount}.`);

  const satisfiedCount = lastEntry.criteriaProgress.filter(c => c.satisfied).length;
  const totalCriteria = lastEntry.criteriaProgress.length;
  if (totalCriteria > 0) {
    parts.push(`Criteria: ${satisfiedCount}/${totalCriteria} satisfied.`);
  }

  return parts.join(' ');
}

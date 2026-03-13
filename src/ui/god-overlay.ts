/**
 * God Overlay control panel — pure state + key handler.
 * Source: FR-015 (AC-042, AC-043)
 *
 * Ctrl+G opens the God control panel showing:
 * - Current task type, phase, confidence, decision history
 * - Manual intervention keys: [R] reclassify, [S] skip phase, [F] force converge, [P] pause
 */

import type { GodTaskAnalysis } from '../types/god-schemas.js';
import { appendAuditLog, type GodAuditEntry } from '../god/god-audit.js';
import type { ConvergenceLogEntry } from '../god/god-convergence.js';

// ── Types ──

export type GodOverlayAction =
  | { type: 'reclassify' }
  | { type: 'skip_phase' }
  | { type: 'force_converge' }
  | { type: 'pause_auto_decision' };

export interface GodOverlayState {
  visible: boolean;
  currentTaskType: string;
  currentPhase?: string;
  confidenceScore?: number;
  decisionHistory: GodAuditEntry[];
  convergenceLog: ConvergenceLogEntry[];
}

// ── Key → action mapping ──

const KEY_ACTION_MAP: Record<string, GodOverlayAction> = {
  r: { type: 'reclassify' },
  s: { type: 'skip_phase' },
  f: { type: 'force_converge' },
  p: { type: 'pause_auto_decision' },
};

// ── Factory ──

/**
 * Create initial God overlay state from task analysis and logs.
 * visible defaults to false (opened by Ctrl+G).
 */
export function createGodOverlayState(
  analysis: GodTaskAnalysis,
  auditEntries: GodAuditEntry[],
  convergenceLog: ConvergenceLogEntry[],
): GodOverlayState {
  // Extract confidenceScore from the latest POST_REVIEWER audit entry
  let confidenceScore: number | undefined;
  for (let i = auditEntries.length - 1; i >= 0; i--) {
    const entry = auditEntries[i];
    if (entry.decisionType === 'POST_REVIEWER') {
      const decision = entry.decision as Record<string, unknown> | null;
      if (decision && typeof decision.confidenceScore === 'number') {
        confidenceScore = decision.confidenceScore;
      }
      break;
    }
  }

  // For compound tasks, determine current phase from latest PHASE_TRANSITION audit entry
  let currentPhase: string | undefined;
  if (analysis.taskType === 'compound' && analysis.phases && analysis.phases.length > 0) {
    // Search audit entries in reverse for the most recent PHASE_TRANSITION
    for (let i = auditEntries.length - 1; i >= 0; i--) {
      const entry = auditEntries[i];
      if (entry.decisionType === 'PHASE_TRANSITION') {
        const decision = entry.decision as Record<string, unknown> | null;
        if (decision && typeof decision.nextPhaseId === 'string') {
          currentPhase = decision.nextPhaseId;
        }
        break;
      }
    }
    // Fallback to first phase if no transition has occurred yet
    if (!currentPhase) {
      currentPhase = analysis.phases[0].id;
    }
  }

  return {
    visible: false,
    currentTaskType: analysis.taskType,
    currentPhase,
    confidenceScore,
    decisionHistory: auditEntries,
    convergenceLog,
  };
}

// ── Key handler ──

/**
 * Handle a key press within the God overlay.
 * Returns updated state and optional action for the caller to dispatch.
 */
export function handleGodOverlayKey(
  state: GodOverlayState,
  key: string,
): { state: GodOverlayState; action?: GodOverlayAction } {
  if (key === 'escape') {
    return { state: { ...state, visible: false } };
  }
  const action = KEY_ACTION_MAP[key.toLowerCase()];
  if (action) {
    return { state, action };
  }
  return { state };
}

// ── Action → audit description mapping ──

const ACTION_DESCRIPTIONS: Record<GodOverlayAction['type'], string> = {
  reclassify: 'User requested task reclassification via God overlay',
  skip_phase: 'User skipped current phase via God overlay',
  force_converge: 'User forced convergence via God overlay',
  pause_auto_decision: 'User paused auto-decision via God overlay',
};

/**
 * Write a manual intervention event to the audit log.
 * Called when the user triggers an action in the God overlay (R/S/F/P).
 */
export function writeGodOverlayActionAudit(
  sessionDir: string,
  opts: { seq: number; round: number; action: GodOverlayAction; taskType: string; phase?: string },
): void {
  const desc = ACTION_DESCRIPTIONS[opts.action.type];
  const entry: GodAuditEntry = {
    seq: opts.seq,
    timestamp: new Date().toISOString(),
    round: opts.round,
    decisionType: 'MANUAL_INTERVENTION',
    inputSummary: `${desc} (taskType=${opts.taskType}${opts.phase ? `, phase=${opts.phase}` : ''})`,
    outputSummary: `action=${opts.action.type}`,
    decision: { actionType: opts.action.type, taskType: opts.taskType, phase: opts.phase },
    ...(opts.phase ? { phaseId: opts.phase } : {}),
  };
  appendAuditLog(sessionDir, entry);
}

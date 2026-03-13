/**
 * Resume summary — builds a summary of God decisions for display after `duo resume`.
 * Source: FR-016 (AC-044, AC-045)
 *
 * Extracts TASK_INIT, PHASE_TRANSITION, and AUTO_DECISION events from audit log,
 * ordered chronologically.
 */

import type { GodAuditEntry } from '../god/god-audit.js';
import type { ConvergenceLogEntry } from '../god/god-convergence.js';

// ── Types ──

export type ResumeSummaryEvent = {
  type: 'task_init' | 'phase_transition' | 'auto_decision';
  timestamp: string;
  summary: string;
};

export interface ResumeSummaryState {
  events: ResumeSummaryEvent[];
  visible: boolean;
}

// ── Decision type → event type mapping ──

const DECISION_TYPE_MAP: Record<string, ResumeSummaryEvent['type']> = {
  TASK_INIT: 'task_init',
  PHASE_TRANSITION: 'phase_transition',
  AUTO_DECISION: 'auto_decision',
};

// ── Builder ──

/**
 * Build resume summary from audit log and convergence log.
 * Filters for key decision events (TASK_INIT, PHASE_TRANSITION, AUTO_DECISION),
 * orders chronologically, and produces human-readable summaries.
 *
 * Performance: O(n) scan, < 1s for 1000+ entries (AC-044).
 */
export function buildResumeSummary(
  auditLog: GodAuditEntry[],
  _convergenceLog: ConvergenceLogEntry[],
): ResumeSummaryState {
  const events: ResumeSummaryEvent[] = [];

  for (const entry of auditLog) {
    const eventType = DECISION_TYPE_MAP[entry.decisionType];
    if (!eventType) continue;

    events.push({
      type: eventType,
      timestamp: entry.timestamp,
      summary: buildEventSummary(eventType, entry),
    });
  }

  // Sort chronologically (audit entries should already be ordered, but ensure)
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return { events, visible: true };
}

// ── Summary builders ──

function buildEventSummary(type: ResumeSummaryEvent['type'], entry: GodAuditEntry): string {
  switch (type) {
    case 'task_init':
      return `Task initialized: ${entry.outputSummary}`;
    case 'phase_transition':
      return `Phase transition: ${entry.inputSummary}`;
    case 'auto_decision': {
      const decision = entry.decision as Record<string, unknown> | null;
      const action = decision && typeof decision.action === 'string' ? decision.action : 'unknown';
      return `Auto-decision: ${action} — ${entry.outputSummary}`;
    }
  }
}

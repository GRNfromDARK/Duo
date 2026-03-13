/**
 * Tests for Resume Summary.
 * Source: FR-016 (AC-044, AC-045)
 */

import { describe, it, expect } from 'vitest';
import {
  buildResumeSummary,
  type ResumeSummaryState,
  type ResumeSummaryEvent,
} from '../../ui/resume-summary.js';
import type { GodAuditEntry } from '../../god/god-audit.js';
import type { ConvergenceLogEntry } from '../../god/god-convergence.js';

// ── Fixtures ──

const AUDIT_ENTRIES: GodAuditEntry[] = [
  {
    seq: 1,
    timestamp: '2026-03-11T10:00:00.000Z',
    round: 0,
    decisionType: 'TASK_INIT',
    inputSummary: 'Implement user login',
    outputSummary: 'taskType=code, maxRounds=5',
    decision: { taskType: 'code', reasoning: 'User wants login' },
  },
  {
    seq: 2,
    timestamp: '2026-03-11T10:01:00.000Z',
    round: 1,
    decisionType: 'POST_CODER',
    inputSummary: 'Coder output',
    outputSummary: 'continue_to_review',
    decision: { action: 'continue_to_review' },
  },
  {
    seq: 3,
    timestamp: '2026-03-11T10:02:00.000Z',
    round: 1,
    decisionType: 'PHASE_TRANSITION',
    inputSummary: 'Phase explore → code',
    outputSummary: 'Transitioning to code phase',
    decision: { nextPhaseId: 'code', summary: 'Exploration complete' },
    phaseId: 'code',
  },
  {
    seq: 4,
    timestamp: '2026-03-11T10:03:00.000Z',
    round: 2,
    decisionType: 'AUTO_DECISION',
    inputSummary: 'WAITING_USER state',
    outputSummary: 'accept — Changes look good',
    decision: { action: 'accept', reasoning: 'Changes look good' },
  },
  {
    seq: 5,
    timestamp: '2026-03-11T10:04:00.000Z',
    round: 2,
    decisionType: 'CONVERGENCE',
    inputSummary: 'Reviewer approved',
    outputSummary: 'approved, terminate=true',
    decision: { classification: 'approved', shouldTerminate: true },
  },
];

const CONVERGENCE_LOG: ConvergenceLogEntry[] = [
  {
    round: 1,
    timestamp: '2026-03-11T10:02:30.000Z',
    classification: 'changes_requested',
    shouldTerminate: false,
    blockingIssueCount: 1,
    criteriaProgress: [{ criterion: 'Tests pass', satisfied: false }],
    summary: 'classification=changes_requested, blocking=1',
  },
  {
    round: 2,
    timestamp: '2026-03-11T10:04:00.000Z',
    classification: 'approved',
    shouldTerminate: true,
    blockingIssueCount: 0,
    criteriaProgress: [{ criterion: 'Tests pass', satisfied: true }],
    summary: 'classification=approved, blocking=0, terminate=true',
  },
];

// ── buildResumeSummary ──

describe('buildResumeSummary', () => {
  it('returns visible=true state', () => {
    const result = buildResumeSummary(AUDIT_ENTRIES, CONVERGENCE_LOG);
    expect(result.visible).toBe(true);
  });

  it('includes TASK_INIT events (AC-045)', () => {
    const result = buildResumeSummary(AUDIT_ENTRIES, CONVERGENCE_LOG);
    const taskInits = result.events.filter(e => e.type === 'task_init');
    expect(taskInits).toHaveLength(1);
    expect(taskInits[0].timestamp).toBe('2026-03-11T10:00:00.000Z');
  });

  it('includes phase transition events (AC-045)', () => {
    const result = buildResumeSummary(AUDIT_ENTRIES, CONVERGENCE_LOG);
    const transitions = result.events.filter(e => e.type === 'phase_transition');
    expect(transitions).toHaveLength(1);
    expect(transitions[0].timestamp).toBe('2026-03-11T10:02:00.000Z');
  });

  it('includes auto-decision events (AC-045)', () => {
    const result = buildResumeSummary(AUDIT_ENTRIES, CONVERGENCE_LOG);
    const decisions = result.events.filter(e => e.type === 'auto_decision');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].timestamp).toBe('2026-03-11T10:03:00.000Z');
  });

  it('events are ordered chronologically', () => {
    const result = buildResumeSummary(AUDIT_ENTRIES, CONVERGENCE_LOG);
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i].timestamp >= result.events[i - 1].timestamp).toBe(true);
    }
  });

  it('event summaries are non-empty strings', () => {
    const result = buildResumeSummary(AUDIT_ENTRIES, CONVERGENCE_LOG);
    for (const event of result.events) {
      expect(event.summary.length).toBeGreaterThan(0);
    }
  });

  it('returns empty events for empty inputs', () => {
    const result = buildResumeSummary([], []);
    expect(result.events).toHaveLength(0);
    expect(result.visible).toBe(true);
  });

  it('generates summary under 1 second (AC-044)', () => {
    // Generate large input data
    const largeAudit: GodAuditEntry[] = [];
    for (let i = 0; i < 1000; i++) {
      largeAudit.push({
        seq: i,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        round: Math.floor(i / 5),
        decisionType: i % 4 === 0 ? 'TASK_INIT' : i % 4 === 1 ? 'PHASE_TRANSITION' : i % 4 === 2 ? 'AUTO_DECISION' : 'POST_CODER',
        inputSummary: 'input '.repeat(50),
        outputSummary: 'output '.repeat(50),
        decision: {},
      });
    }
    const largeCLog: ConvergenceLogEntry[] = [];
    for (let i = 0; i < 200; i++) {
      largeCLog.push({
        round: i,
        timestamp: new Date(Date.now() + i * 5000).toISOString(),
        classification: 'changes_requested',
        shouldTerminate: false,
        blockingIssueCount: 1,
        criteriaProgress: [{ criterion: 'Test', satisfied: false }],
        summary: 'summary',
      });
    }

    const start = performance.now();
    buildResumeSummary(largeAudit, largeCLog);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000); // < 1s
  });

  it('TASK_INIT summary includes task type from outputSummary', () => {
    const result = buildResumeSummary(AUDIT_ENTRIES, CONVERGENCE_LOG);
    const taskInit = result.events.find(e => e.type === 'task_init');
    expect(taskInit?.summary).toContain('code');
  });

  it('phase_transition summary includes phase info', () => {
    const result = buildResumeSummary(AUDIT_ENTRIES, CONVERGENCE_LOG);
    const transition = result.events.find(e => e.type === 'phase_transition');
    expect(transition?.summary).toBeTruthy();
  });

  it('auto_decision summary includes action', () => {
    const result = buildResumeSummary(AUDIT_ENTRIES, CONVERGENCE_LOG);
    const decision = result.events.find(e => e.type === 'auto_decision');
    expect(decision?.summary).toContain('accept');
  });
});

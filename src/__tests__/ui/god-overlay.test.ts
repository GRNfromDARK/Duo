/**
 * Tests for God Overlay control panel.
 * Source: FR-015 (AC-042, AC-043)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createGodOverlayState,
  handleGodOverlayKey,
  writeGodOverlayActionAudit,
  type GodOverlayState,
  type GodOverlayAction,
} from '../../ui/god-overlay.js';
import type { GodAuditEntry } from '../../god/god-audit.js';
import type { ConvergenceLogEntry } from '../../god/god-convergence.js';
import type { GodTaskAnalysis } from '../../types/god-schemas.js';

vi.mock('../../god/god-audit.js', async () => {
  const actual = await vi.importActual<typeof import('../../god/god-audit.js')>('../../god/god-audit.js');
  return {
    ...actual,
    appendAuditLog: vi.fn(),
  };
});

// ── Fixtures ──

const ANALYSIS: GodTaskAnalysis = {
  taskType: 'code',
  reasoning: 'User wants to implement a feature',
  confidence: 0.85,
  suggestedMaxRounds: 5,
  terminationCriteria: ['All tests pass', 'No blocking issues'],
};

const COMPOUND_ANALYSIS: GodTaskAnalysis = {
  taskType: 'compound',
  reasoning: 'Complex multi-phase task',
  phases: [
    { id: 'explore', name: 'Explore', type: 'explore', description: 'Research' },
    { id: 'code', name: 'Code', type: 'code', description: 'Implement' },
  ],
  confidence: 0.9,
  suggestedMaxRounds: 10,
  terminationCriteria: ['Done'],
};

const AUDIT_ENTRIES: GodAuditEntry[] = [
  {
    seq: 1,
    timestamp: '2026-03-11T10:00:00.000Z',
    round: 0,
    decisionType: 'TASK_INIT',
    inputSummary: 'User prompt',
    outputSummary: 'taskType=code, maxRounds=5',
    decision: ANALYSIS,
  },
  {
    seq: 2,
    timestamp: '2026-03-11T10:01:00.000Z',
    round: 1,
    decisionType: 'POST_CODER',
    inputSummary: 'Coder output summary',
    outputSummary: 'continue_to_review',
    decision: { action: 'continue_to_review', reasoning: 'Looks good' },
  },
];

const CONVERGENCE_LOG: ConvergenceLogEntry[] = [
  {
    round: 1,
    timestamp: '2026-03-11T10:02:00.000Z',
    classification: 'changes_requested',
    shouldTerminate: false,
    blockingIssueCount: 2,
    criteriaProgress: [
      { criterion: 'All tests pass', satisfied: false },
      { criterion: 'No blocking issues', satisfied: false },
    ],
    summary: 'classification=changes_requested, blocking=2, terminate=false',
  },
];

// ── createGodOverlayState ──

describe('createGodOverlayState', () => {
  it('creates state with visible=false by default', () => {
    const state = createGodOverlayState(ANALYSIS, [], []);
    expect(state.visible).toBe(false);
  });

  it('populates currentTaskType from analysis', () => {
    const state = createGodOverlayState(ANALYSIS, [], []);
    expect(state.currentTaskType).toBe('code');
  });

  it('populates currentPhase for compound tasks', () => {
    const state = createGodOverlayState(COMPOUND_ANALYSIS, [], []);
    expect(state.currentPhase).toBe('explore');
  });

  it('currentPhase is undefined for non-compound tasks', () => {
    const state = createGodOverlayState(ANALYSIS, [], []);
    expect(state.currentPhase).toBeUndefined();
  });

  it('includes audit entries as decisionHistory', () => {
    const state = createGodOverlayState(ANALYSIS, AUDIT_ENTRIES, []);
    expect(state.decisionHistory).toHaveLength(2);
    expect(state.decisionHistory[0].decisionType).toBe('TASK_INIT');
  });

  it('includes convergenceLog', () => {
    const state = createGodOverlayState(ANALYSIS, [], CONVERGENCE_LOG);
    expect(state.convergenceLog).toHaveLength(1);
    expect(state.convergenceLog[0].round).toBe(1);
  });

  it('extracts confidenceScore from latest POST_REVIEWER audit entry', () => {
    const entriesWithReviewer: GodAuditEntry[] = [
      ...AUDIT_ENTRIES,
      {
        seq: 3,
        timestamp: '2026-03-11T10:03:00.000Z',
        round: 1,
        decisionType: 'POST_REVIEWER',
        inputSummary: 'Reviewer output',
        outputSummary: 'route_to_coder',
        decision: { action: 'route_to_coder', confidenceScore: 0.7 },
      },
    ];
    const state = createGodOverlayState(ANALYSIS, entriesWithReviewer, []);
    expect(state.confidenceScore).toBe(0.7);
  });

  it('confidenceScore is undefined when no POST_REVIEWER entries', () => {
    const state = createGodOverlayState(ANALYSIS, AUDIT_ENTRIES, []);
    expect(state.confidenceScore).toBeUndefined();
  });
});

// ── handleGodOverlayKey ──

describe('handleGodOverlayKey', () => {
  const baseState: GodOverlayState = {
    visible: true,
    currentTaskType: 'code',
    decisionHistory: AUDIT_ENTRIES,
    convergenceLog: CONVERGENCE_LOG,
  };

  it('R key returns reclassify action', () => {
    const result = handleGodOverlayKey(baseState, 'R');
    expect(result.action).toEqual({ type: 'reclassify' });
  });

  it('r (lowercase) returns reclassify action', () => {
    const result = handleGodOverlayKey(baseState, 'r');
    expect(result.action).toEqual({ type: 'reclassify' });
  });

  it('S key returns skip_phase action', () => {
    const result = handleGodOverlayKey(baseState, 'S');
    expect(result.action).toEqual({ type: 'skip_phase' });
  });

  it('s (lowercase) returns skip_phase action', () => {
    const result = handleGodOverlayKey(baseState, 's');
    expect(result.action).toEqual({ type: 'skip_phase' });
  });

  it('F key returns force_converge action', () => {
    const result = handleGodOverlayKey(baseState, 'F');
    expect(result.action).toEqual({ type: 'force_converge' });
  });

  it('f (lowercase) returns force_converge action', () => {
    const result = handleGodOverlayKey(baseState, 'f');
    expect(result.action).toEqual({ type: 'force_converge' });
  });

  it('P key returns pause_auto_decision action', () => {
    const result = handleGodOverlayKey(baseState, 'P');
    expect(result.action).toEqual({ type: 'pause_auto_decision' });
  });

  it('p (lowercase) returns pause_auto_decision action', () => {
    const result = handleGodOverlayKey(baseState, 'p');
    expect(result.action).toEqual({ type: 'pause_auto_decision' });
  });

  it('test_regression_bug7_escape_key_closes_overlay', () => {
    const result = handleGodOverlayKey(baseState, 'escape');
    expect(result.state.visible).toBe(false);
    expect(result.action).toBeUndefined();
  });

  it('unknown key returns no action', () => {
    const result = handleGodOverlayKey(baseState, 'x');
    expect(result.action).toBeUndefined();
  });

  it('state is preserved on unknown key', () => {
    const result = handleGodOverlayKey(baseState, 'x');
    expect(result.state).toEqual(baseState);
  });

  it('state is preserved on action key (overlay stays open for caller to decide)', () => {
    const result = handleGodOverlayKey(baseState, 'R');
    expect(result.state).toEqual(baseState);
  });
});

// ── writeGodOverlayActionAudit ──

describe('writeGodOverlayActionAudit', () => {
  let mockAppendAuditLog: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../god/god-audit.js');
    mockAppendAuditLog = mod.appendAuditLog as ReturnType<typeof vi.fn>;
  });

  it('writes MANUAL_INTERVENTION entry for reclassify action', () => {
    writeGodOverlayActionAudit('/tmp/session', {
      seq: 5, round: 2, action: { type: 'reclassify' }, taskType: 'code',
    });
    expect(mockAppendAuditLog).toHaveBeenCalledOnce();
    const entry = mockAppendAuditLog.mock.calls[0][1] as GodAuditEntry;
    expect(entry.decisionType).toBe('MANUAL_INTERVENTION');
    expect(entry.decision).toEqual({ actionType: 'reclassify', taskType: 'code', phase: undefined });
    expect(entry.inputSummary).toContain('reclassification');
    expect(entry.outputSummary).toBe('action=reclassify');
  });

  it('writes MANUAL_INTERVENTION entry for skip_phase action', () => {
    writeGodOverlayActionAudit('/tmp/session', {
      seq: 6, round: 3, action: { type: 'skip_phase' }, taskType: 'compound', phase: 'explore',
    });
    expect(mockAppendAuditLog).toHaveBeenCalledOnce();
    const entry = mockAppendAuditLog.mock.calls[0][1] as GodAuditEntry;
    expect(entry.decisionType).toBe('MANUAL_INTERVENTION');
    expect(entry.decision).toEqual({ actionType: 'skip_phase', taskType: 'compound', phase: 'explore' });
    expect(entry.inputSummary).toContain('phase=explore');
    expect(entry.phaseId).toBe('explore');
  });

  it('writes MANUAL_INTERVENTION entry for force_converge action', () => {
    writeGodOverlayActionAudit('/tmp/session', {
      seq: 7, round: 4, action: { type: 'force_converge' }, taskType: 'debug',
    });
    expect(mockAppendAuditLog).toHaveBeenCalledOnce();
    const entry = mockAppendAuditLog.mock.calls[0][1] as GodAuditEntry;
    expect(entry.decisionType).toBe('MANUAL_INTERVENTION');
    expect(entry.decision).toEqual({ actionType: 'force_converge', taskType: 'debug', phase: undefined });
    expect(entry.outputSummary).toBe('action=force_converge');
  });

  it('writes MANUAL_INTERVENTION entry for pause_auto_decision action', () => {
    writeGodOverlayActionAudit('/tmp/session', {
      seq: 8, round: 1, action: { type: 'pause_auto_decision' }, taskType: 'review',
    });
    expect(mockAppendAuditLog).toHaveBeenCalledOnce();
    const entry = mockAppendAuditLog.mock.calls[0][1] as GodAuditEntry;
    expect(entry.decisionType).toBe('MANUAL_INTERVENTION');
    expect(entry.decision).toEqual({ actionType: 'pause_auto_decision', taskType: 'review', phase: undefined });
  });

  it('passes correct sessionDir to appendAuditLog', () => {
    writeGodOverlayActionAudit('/my/session/dir', {
      seq: 1, round: 1, action: { type: 'reclassify' }, taskType: 'code',
    });
    expect(mockAppendAuditLog).toHaveBeenCalledWith('/my/session/dir', expect.any(Object));
  });

  it('includes seq, round, and timestamp in audit entry', () => {
    writeGodOverlayActionAudit('/tmp/session', {
      seq: 42, round: 7, action: { type: 'force_converge' }, taskType: 'code',
    });
    const entry = mockAppendAuditLog.mock.calls[0][1] as GodAuditEntry;
    expect(entry.seq).toBe(42);
    expect(entry.round).toBe(7);
    expect(entry.timestamp).toBeDefined();
    expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
  });

  it('omits phaseId when phase is not provided', () => {
    writeGodOverlayActionAudit('/tmp/session', {
      seq: 1, round: 1, action: { type: 'reclassify' }, taskType: 'code',
    });
    const entry = mockAppendAuditLog.mock.calls[0][1] as GodAuditEntry;
    expect(entry.phaseId).toBeUndefined();
  });

  it('inputSummary does not include phase when not provided', () => {
    writeGodOverlayActionAudit('/tmp/session', {
      seq: 1, round: 1, action: { type: 'skip_phase' }, taskType: 'code',
    });
    const entry = mockAppendAuditLog.mock.calls[0][1] as GodAuditEntry;
    expect(entry.inputSummary).not.toContain('phase=');
  });
});

/**
 * Integration tests for Card C.3: Reclassify Overlay (Ctrl+R) + Phase Transition
 * FR-002a (AC-010, AC-011, AC-012), FR-010 (AC-033, AC-034)
 */

import { describe, it, expect } from 'vitest';
import type { Key } from 'ink';
import { processKeybinding, type KeyContext, KEYBINDING_LIST } from '../../ui/keybindings.js';
import { canTriggerReclassify, RECLASSIFY_ALLOWED_STATES } from '../../ui/reclassify-overlay.js';
import { evaluatePhaseTransition, type Phase } from '../../god/phase-transition.js';
import type { GodPostReviewerDecision } from '../../types/god-schemas.js';
import type { ConvergenceLogEntry } from '../../god/god-convergence.js';

function key(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  };
}

const defaultCtx: KeyContext = {
  overlayOpen: null,
  inputEmpty: true,
  pageSize: 20,
};

// ── AC-1: Ctrl+R triggers reclassify action ──

describe('AC-1: Ctrl+R in CODING/REVIEWING/GOD_DECIDING/PAUSED', () => {
  it('Ctrl+R produces reclassify action', () => {
    const action = processKeybinding('r', key({ ctrl: true }), defaultCtx);
    expect(action.type).toBe('reclassify');
  });

  it('Ctrl+R is listed in KEYBINDING_LIST', () => {
    const entry = KEYBINDING_LIST.find(e => e.shortcut === 'Ctrl+R');
    expect(entry).toBeDefined();
    expect(entry!.description).toContain('Reclassify');
  });

  it('canTriggerReclassify allows CODING', () => {
    expect(canTriggerReclassify('CODING')).toBe(true);
  });

  it('canTriggerReclassify allows REVIEWING', () => {
    expect(canTriggerReclassify('REVIEWING')).toBe(true);
  });

  it('canTriggerReclassify allows GOD_DECIDING', () => {
    expect(canTriggerReclassify('GOD_DECIDING')).toBe(true);
  });

  it('canTriggerReclassify allows PAUSED', () => {
    expect(canTriggerReclassify('PAUSED')).toBe(true);
  });

  it('canTriggerReclassify rejects IDLE', () => {
    expect(canTriggerReclassify('IDLE')).toBe(false);
  });

  it('canTriggerReclassify rejects DONE', () => {
    expect(canTriggerReclassify('DONE')).toBe(false);
  });

  it('RECLASSIFY_ALLOWED_STATES matches AC-010 spec', () => {
    expect(RECLASSIFY_ALLOWED_STATES).toEqual([
      'CODING',
      'REVIEWING',
      'GOD_DECIDING',
      'PAUSED',
    ]);
  });
});

// ── AC-4: Phase transition uses evaluatePhaseTransition ──

describe('AC-4/AC-5: Phase transition via evaluatePhaseTransition', () => {
  const phases: Phase[] = [
    { id: 'explore', name: 'Explore', type: 'explore', description: 'Research first' },
    { id: 'code', name: 'Code', type: 'code', description: 'Implement' },
    { id: 'review', name: 'Review', type: 'review', description: 'Final review' },
  ];

  const convergenceLog: ConvergenceLogEntry[] = [
    {
      round: 2,
      timestamp: '2026-03-12T10:00:00.000Z',
      classification: 'approved',
      shouldTerminate: false,
      blockingIssueCount: 0,
      criteriaProgress: [
        { criterion: 'Research complete', satisfied: true },
      ],
      summary: 'Phase explore complete',
    },
  ];

  it('transitions to next phase when action is phase_transition', () => {
    const decision: GodPostReviewerDecision = {
      action: 'phase_transition',
      reasoning: 'Explore complete, moving to code',
      confidenceScore: 0.9,
      progressTrend: 'improving',
    };

    const result = evaluatePhaseTransition(phases[0], phases, convergenceLog, decision);
    expect(result.shouldTransition).toBe(true);
    expect(result.nextPhaseId).toBe('code');
    expect(result.previousPhaseSummary).toBeDefined();
  });

  it('uses God-specified nextPhaseId when provided', () => {
    const decision: GodPostReviewerDecision = {
      action: 'phase_transition',
      reasoning: 'Skip to review',
      confidenceScore: 0.8,
      progressTrend: 'improving',
      nextPhaseId: 'review',
    };

    const result = evaluatePhaseTransition(phases[0], phases, convergenceLog, decision);
    expect(result.shouldTransition).toBe(true);
    expect(result.nextPhaseId).toBe('review');
  });

  it('AC-034: previousPhaseSummary carries convergence history', () => {
    const decision: GodPostReviewerDecision = {
      action: 'phase_transition',
      reasoning: 'Move on',
      confidenceScore: 0.9,
      progressTrend: 'improving',
    };

    const result = evaluatePhaseTransition(phases[0], phases, convergenceLog, decision);
    expect(result.previousPhaseSummary).toContain('explore');
    expect(result.previousPhaseSummary).toContain('Explore');
  });

  it('does not transition for non-phase_transition actions', () => {
    const decision: GodPostReviewerDecision = {
      action: 'route_to_coder',
      reasoning: 'More work needed',
      unresolvedIssues: ['fix bug'],
      confidenceScore: 0.5,
      progressTrend: 'stagnant',
    };

    const result = evaluatePhaseTransition(phases[0], phases, convergenceLog, decision);
    expect(result.shouldTransition).toBe(false);
  });

  it('does not transition at last phase without nextPhaseId', () => {
    const lastPhase = phases[phases.length - 1];
    const decision: GodPostReviewerDecision = {
      action: 'phase_transition',
      reasoning: 'Done',
      confidenceScore: 1.0,
      progressTrend: 'improving',
    };

    const result = evaluatePhaseTransition(lastPhase, phases, convergenceLog, decision);
    expect(result.shouldTransition).toBe(false);
  });
});

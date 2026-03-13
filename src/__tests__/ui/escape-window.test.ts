/**
 * Tests for the legacy escape-window state helpers.
 * Source: FR-008 (AC-025, AC-026, AC-027)
 */

import { describe, it, expect } from 'vitest';
import {
  createEscapeWindowState,
  handleEscapeKey,
  tickEscapeCountdown,
  type EscapeWindowState,
} from '../../ui/escape-window.js';
import type { GodAutoDecision } from '../../types/god-schemas.js';

function makeDecision(overrides?: Partial<GodAutoDecision>): GodAutoDecision {
  return {
    action: 'accept',
    reasoning: 'All criteria met',
    ...overrides,
  };
}

describe('createEscapeWindowState', () => {
  it('creates an already-confirmed state in AI-driven mode', () => {
    const decision = makeDecision();
    const state = createEscapeWindowState(decision);

    expect(state.visible).toBe(false);
    expect(state.countdown).toBe(0);
    expect(state.decision).toEqual(decision);
    expect(state.confirmed).toBe(true);
    expect(state.cancelled).toBe(false);
  });

  it('should generate decision preview from action + reasoning', () => {
    const decision = makeDecision({
      action: 'continue_with_instruction',
      reasoning: 'Need to fix edge case',
      instruction: 'Fix the error handling',
    });
    const state = createEscapeWindowState(decision);

    expect(state.decisionPreview).toContain('continue_with_instruction');
    expect(state.decisionPreview).toContain('Need to fix edge case');
  });
});

describe('handleEscapeKey — immediate execution mode', () => {
  it('does not cancel on Escape key after auto-confirm', () => {
    const state = createEscapeWindowState(makeDecision());
    const next = handleEscapeKey(state, 'escape');

    expect(next.cancelled).toBe(false);
    expect(next.visible).toBe(false);
    expect(next.confirmed).toBe(true);
  });

  it('remains confirmed on Space key', () => {
    const state = createEscapeWindowState(makeDecision());
    const next = handleEscapeKey(state, 'space');

    expect(next.confirmed).toBe(true);
    expect(next.visible).toBe(false);
    expect(next.cancelled).toBe(false);
  });

  it('should ignore other keys', () => {
    const state = createEscapeWindowState(makeDecision());
    const next = handleEscapeKey(state, 'a');

    expect(next.confirmed).toBe(true);
    expect(next.cancelled).toBe(false);
    expect(next.visible).toBe(false);
  });

  it('does not change the already-confirmed state after Escape then Space', () => {
    let state = createEscapeWindowState(makeDecision());
    state = handleEscapeKey(state, 'escape');
    const next = handleEscapeKey(state, 'space');

    expect(next.cancelled).toBe(false);
    expect(next.confirmed).toBe(true);
  });

  it('does not change already confirmed state', () => {
    let state = createEscapeWindowState(makeDecision());
    state = handleEscapeKey(state, 'space');
    const next = handleEscapeKey(state, 'escape');

    expect(next.confirmed).toBe(true);
    expect(next.cancelled).toBe(false);
  });
});

describe('tickEscapeCountdown — immediate execution mode', () => {
  it('does not decrement countdown after creation', () => {
    const state = createEscapeWindowState(makeDecision());
    expect(state.countdown).toBe(0);

    const next = tickEscapeCountdown(state);
    expect(next.countdown).toBe(0);
    expect(next.visible).toBe(false);
    expect(next.confirmed).toBe(true);
  });

  it('remains confirmed when ticking repeatedly', () => {
    let state = createEscapeWindowState(makeDecision());
    state = tickEscapeCountdown(state);
    state = tickEscapeCountdown(state);

    expect(state.countdown).toBe(0);
    expect(state.confirmed).toBe(true);
    expect(state.visible).toBe(false);
  });

  it('should not tick if already cancelled', () => {
    let state = createEscapeWindowState(makeDecision());
    state = handleEscapeKey(state, 'escape');
    const next = tickEscapeCountdown(state);

    expect(next.countdown).toBe(0);
    expect(next.cancelled).toBe(false);
    expect(next.confirmed).toBe(true);
  });

  it('should not tick if already confirmed', () => {
    let state = createEscapeWindowState(makeDecision());
    state = handleEscapeKey(state, 'space');
    const next = tickEscapeCountdown(state);

    expect(next.countdown).toBe(0);
    expect(next.confirmed).toBe(true);
  });
});

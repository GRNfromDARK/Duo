/**
 * Tests for Card F.3: Escape Window — 2秒逃生窗口 UI 状态
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
  it('should create visible state with 2-second countdown', () => {
    const decision = makeDecision();
    const state = createEscapeWindowState(decision);

    expect(state.visible).toBe(true);
    expect(state.countdown).toBe(2);
    expect(state.decision).toEqual(decision);
    expect(state.confirmed).toBe(false);
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

describe('handleEscapeKey — AC-026: Esc cancels, enters manual mode', () => {
  it('should cancel on Escape key', () => {
    const state = createEscapeWindowState(makeDecision());
    const next = handleEscapeKey(state, 'escape');

    expect(next.cancelled).toBe(true);
    expect(next.visible).toBe(false);
    expect(next.confirmed).toBe(false);
  });

  it('should confirm on Space key', () => {
    const state = createEscapeWindowState(makeDecision());
    const next = handleEscapeKey(state, 'space');

    expect(next.confirmed).toBe(true);
    expect(next.visible).toBe(false);
    expect(next.cancelled).toBe(false);
  });

  it('should ignore other keys', () => {
    const state = createEscapeWindowState(makeDecision());
    const next = handleEscapeKey(state, 'a');

    expect(next.confirmed).toBe(false);
    expect(next.cancelled).toBe(false);
    expect(next.visible).toBe(true);
  });

  it('should not change already cancelled state', () => {
    let state = createEscapeWindowState(makeDecision());
    state = handleEscapeKey(state, 'escape');
    const next = handleEscapeKey(state, 'space');

    expect(next.cancelled).toBe(true);
    expect(next.confirmed).toBe(false);
  });

  it('should not change already confirmed state', () => {
    let state = createEscapeWindowState(makeDecision());
    state = handleEscapeKey(state, 'space');
    const next = handleEscapeKey(state, 'escape');

    expect(next.confirmed).toBe(true);
    expect(next.cancelled).toBe(false);
  });
});

describe('tickEscapeCountdown — AC-3: 2秒正确倒计时', () => {
  it('should decrement countdown by 1', () => {
    const state = createEscapeWindowState(makeDecision());
    expect(state.countdown).toBe(2);

    const next = tickEscapeCountdown(state);
    expect(next.countdown).toBe(1);
    expect(next.visible).toBe(true);
    expect(next.confirmed).toBe(false);
  });

  it('should auto-confirm when countdown reaches 0', () => {
    let state = createEscapeWindowState(makeDecision());
    state = tickEscapeCountdown(state); // 2 → 1
    state = tickEscapeCountdown(state); // 1 → 0

    expect(state.countdown).toBe(0);
    expect(state.confirmed).toBe(true);
    expect(state.visible).toBe(false);
  });

  it('should not tick if already cancelled', () => {
    let state = createEscapeWindowState(makeDecision());
    state = handleEscapeKey(state, 'escape');
    const next = tickEscapeCountdown(state);

    expect(next.countdown).toBe(2); // unchanged
    expect(next.cancelled).toBe(true);
  });

  it('should not tick if already confirmed', () => {
    let state = createEscapeWindowState(makeDecision());
    state = handleEscapeKey(state, 'space');
    const next = tickEscapeCountdown(state);

    expect(next.countdown).toBe(2); // unchanged
    expect(next.confirmed).toBe(true);
  });
});

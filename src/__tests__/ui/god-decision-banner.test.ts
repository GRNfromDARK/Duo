/**
 * Tests for GodDecisionBanner pure state logic.
 * Card C.1: FR-008 (AC-025, AC-026, AC-027)
 */

import { describe, it, expect } from 'vitest';
import {
  createGodDecisionBannerState,
  handleBannerKeyPress,
  tickBannerCountdown,
  formatDecisionSummary,
  ESCAPE_WINDOW_MS,
  TICK_INTERVAL_MS,
} from '../../ui/god-decision-banner.js';
import type { GodAutoDecision } from '../../types/god-schemas.js';

const acceptDecision: GodAutoDecision = {
  action: 'accept',
  reasoning: 'Task looks complete',
};

const continueDecision: GodAutoDecision = {
  action: 'continue_with_instruction',
  reasoning: 'Need to check edge cases',
  instruction: 'Focus on null pointer checks',
};

const requestHumanDecision: GodAutoDecision = {
  action: 'request_human',
  reasoning: 'Ambiguous requirement',
};

describe('createGodDecisionBannerState', () => {
  it('creates initial state with 2s countdown', () => {
    const state = createGodDecisionBannerState(acceptDecision);
    expect(state.decision).toBe(acceptDecision);
    expect(state.countdown).toBe(ESCAPE_WINDOW_MS);
    expect(state.cancelled).toBe(false);
    expect(state.executed).toBe(false);
  });
});

describe('handleBannerKeyPress', () => {
  it('Space → executed = true (AC-5: immediate execute)', () => {
    const state = createGodDecisionBannerState(acceptDecision);
    const next = handleBannerKeyPress(state, 'space');
    expect(next.executed).toBe(true);
    expect(next.cancelled).toBe(false);
  });

  it('Esc → cancelled = true (AC-4: cancel to manual mode)', () => {
    const state = createGodDecisionBannerState(acceptDecision);
    const next = handleBannerKeyPress(state, 'escape');
    expect(next.cancelled).toBe(true);
    expect(next.executed).toBe(false);
  });

  it('ignores input after executed', () => {
    const state = createGodDecisionBannerState(acceptDecision);
    const executed = handleBannerKeyPress(state, 'space');
    const afterEsc = handleBannerKeyPress(executed, 'escape');
    expect(afterEsc.executed).toBe(true);
    expect(afterEsc.cancelled).toBe(false);
  });

  it('ignores input after cancelled', () => {
    const state = createGodDecisionBannerState(acceptDecision);
    const cancelled = handleBannerKeyPress(state, 'escape');
    const afterSpace = handleBannerKeyPress(cancelled, 'space');
    expect(afterSpace.cancelled).toBe(true);
    expect(afterSpace.executed).toBe(false);
  });
});

describe('tickBannerCountdown', () => {
  it('decrements by TICK_INTERVAL_MS', () => {
    const state = createGodDecisionBannerState(acceptDecision);
    const next = tickBannerCountdown(state);
    expect(next.countdown).toBe(ESCAPE_WINDOW_MS - TICK_INTERVAL_MS);
    expect(next.executed).toBe(false);
  });

  it('auto-executes when countdown reaches 0 (AC-5: timeout execute)', () => {
    const state = createGodDecisionBannerState(acceptDecision);
    // Tick down to last interval
    let s = { ...state, countdown: TICK_INTERVAL_MS };
    const next = tickBannerCountdown(s);
    expect(next.countdown).toBe(0);
    expect(next.executed).toBe(true);
  });

  it('does not tick after cancelled', () => {
    const state = createGodDecisionBannerState(acceptDecision);
    const cancelled = handleBannerKeyPress(state, 'escape');
    const next = tickBannerCountdown(cancelled);
    expect(next.countdown).toBe(cancelled.countdown);
  });

  it('does not tick after executed', () => {
    const state = createGodDecisionBannerState(acceptDecision);
    const executed = handleBannerKeyPress(state, 'space');
    const next = tickBannerCountdown(executed);
    expect(next.countdown).toBe(executed.countdown);
  });

  it('full countdown from 2s to 0 results in execution', () => {
    let state = createGodDecisionBannerState(acceptDecision);
    const totalTicks = ESCAPE_WINDOW_MS / TICK_INTERVAL_MS;
    for (let i = 0; i < totalTicks; i++) {
      state = tickBannerCountdown(state);
    }
    expect(state.countdown).toBe(0);
    expect(state.executed).toBe(true);
  });
});

describe('formatDecisionSummary', () => {
  it('formats accept decision', () => {
    const summary = formatDecisionSummary(acceptDecision);
    expect(summary).toContain('accept');
  });

  it('formats continue_with_instruction with instruction text', () => {
    const summary = formatDecisionSummary(continueDecision);
    expect(summary).toContain('Focus on null pointer checks');
  });

  it('formats request_human decision', () => {
    const summary = formatDecisionSummary(requestHumanDecision);
    expect(summary).toContain('human');
  });
});

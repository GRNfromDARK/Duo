/**
 * Tests for PhaseTransitionBanner pure state logic.
 * Card C.3: FR-010 (AC-033, AC-034)
 */

import { describe, it, expect } from 'vitest';
import {
  createPhaseTransitionBannerState,
  handlePhaseTransitionKeyPress,
  tickPhaseTransitionCountdown,
  PHASE_ESCAPE_WINDOW_MS,
  PHASE_TICK_INTERVAL_MS,
} from '../../ui/phase-transition-banner.js';

describe('createPhaseTransitionBannerState', () => {
  it('creates state with correct initial values', () => {
    const state = createPhaseTransitionBannerState('code', 'Phase explore completed.');
    expect(state.nextPhaseId).toBe('code');
    expect(state.previousPhaseSummary).toBe('Phase explore completed.');
    expect(state.countdown).toBe(PHASE_ESCAPE_WINDOW_MS);
    expect(state.cancelled).toBe(false);
    expect(state.confirmed).toBe(false);
  });
});

describe('handlePhaseTransitionKeyPress', () => {
  it('space confirms transition', () => {
    const state = createPhaseTransitionBannerState('code', 'summary');
    const next = handlePhaseTransitionKeyPress(state, 'space');
    expect(next.confirmed).toBe(true);
    expect(next.cancelled).toBe(false);
  });

  it('escape cancels transition', () => {
    const state = createPhaseTransitionBannerState('code', 'summary');
    const next = handlePhaseTransitionKeyPress(state, 'escape');
    expect(next.cancelled).toBe(true);
    expect(next.confirmed).toBe(false);
  });

  it('ignores input when already confirmed', () => {
    const state = createPhaseTransitionBannerState('code', 'summary');
    const confirmed = handlePhaseTransitionKeyPress(state, 'space');
    const next = handlePhaseTransitionKeyPress(confirmed, 'escape');
    expect(next.confirmed).toBe(true);
    expect(next.cancelled).toBe(false);
  });

  it('ignores input when already cancelled', () => {
    const state = createPhaseTransitionBannerState('code', 'summary');
    const cancelled = handlePhaseTransitionKeyPress(state, 'escape');
    const next = handlePhaseTransitionKeyPress(cancelled, 'space');
    expect(next.cancelled).toBe(true);
    expect(next.confirmed).toBe(false);
  });
});

describe('tickPhaseTransitionCountdown', () => {
  it('decrements by PHASE_TICK_INTERVAL_MS', () => {
    const state = createPhaseTransitionBannerState('code', 'summary');
    const next = tickPhaseTransitionCountdown(state);
    expect(next.countdown).toBe(PHASE_ESCAPE_WINDOW_MS - PHASE_TICK_INTERVAL_MS);
  });

  it('auto-confirms when countdown reaches zero', () => {
    const state = createPhaseTransitionBannerState('code', 'summary');
    let current = { ...state, countdown: PHASE_TICK_INTERVAL_MS };
    current = tickPhaseTransitionCountdown(current);
    expect(current.countdown).toBe(0);
    expect(current.confirmed).toBe(true);
  });

  it('does not tick when already confirmed', () => {
    const state = { ...createPhaseTransitionBannerState('code', 'summary'), confirmed: true };
    const next = tickPhaseTransitionCountdown(state);
    expect(next.countdown).toBe(state.countdown);
  });

  it('does not tick when already cancelled', () => {
    const state = { ...createPhaseTransitionBannerState('code', 'summary'), cancelled: true };
    const next = tickPhaseTransitionCountdown(state);
    expect(next.countdown).toBe(state.countdown);
  });

  it('does not tick below zero', () => {
    const state = { ...createPhaseTransitionBannerState('code', 'summary'), countdown: 0 };
    const next = tickPhaseTransitionCountdown(state);
    expect(next.countdown).toBe(0);
  });

  it('AC-033: full countdown cycle results in confirmed', () => {
    let state = createPhaseTransitionBannerState('code', 'Phase "explore" completed.');
    const ticks = PHASE_ESCAPE_WINDOW_MS / PHASE_TICK_INTERVAL_MS;
    for (let i = 0; i < ticks; i++) {
      state = tickPhaseTransitionCountdown(state);
    }
    expect(state.confirmed).toBe(true);
    expect(state.countdown).toBe(0);
  });
});

describe('AC-034: previousPhaseSummary preserved', () => {
  it('preserves summary string through state transitions', () => {
    const summary = 'Phase "explore" (Explore) completed. Final round: 3. Criteria: 2/3 satisfied.';
    const state = createPhaseTransitionBannerState('code', summary);
    const confirmed = handlePhaseTransitionKeyPress(state, 'space');
    expect(confirmed.previousPhaseSummary).toBe(summary);
  });
});

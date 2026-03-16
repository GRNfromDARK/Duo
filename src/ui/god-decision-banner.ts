/**
 * GodDecisionBanner — pure state logic for God decision display.
 * Card C.1: FR-008 (AC-025, AC-026, AC-027)
 *
 * Framework-agnostic: exports pure functions for state transitions.
 * The Ink component layer consumes these functions.
 *
 * ESCAPE_WINDOW_MS=0: decisions execute instantly with no countdown.
 * Set ESCAPE_WINDOW_MS > 0 to re-enable the escape window.
 */

import type { GodAutoDecision } from '../types/god-schemas.js';

export interface GodDecisionBannerState {
  decision: GodAutoDecision;
  countdown: number;
  cancelled: boolean;
  executed: boolean;
}

export const ESCAPE_WINDOW_MS = 0;
export const TICK_INTERVAL_MS = 100;

export function createGodDecisionBannerState(
  decision: GodAutoDecision,
): GodDecisionBannerState {
  return {
    decision,
    countdown: 0,
    cancelled: false,
    executed: true,
  };
}

export function handleBannerKeyPress(
  state: GodDecisionBannerState,
  key: 'space' | 'escape',
): GodDecisionBannerState {
  if (state.cancelled || state.executed) return state;

  if (key === 'space') {
    return { ...state, executed: true };
  }

  if (key === 'escape') {
    return { ...state, cancelled: true };
  }

  return state;
}

export function tickBannerCountdown(
  state: GodDecisionBannerState,
): GodDecisionBannerState {
  if (state.cancelled || state.executed) return state;
  if (state.countdown <= 0) return state;

  const next = state.countdown - TICK_INTERVAL_MS;
  if (next <= 0) {
    return { ...state, countdown: 0, executed: true };
  }
  return { ...state, countdown: next };
}

/**
 * Format the decision for display in the banner.
 */
export function formatDecisionSummary(decision: GodAutoDecision): string {
  switch (decision.action) {
    case 'accept':
      return 'God: accepting output';
    case 'continue_with_instruction':
      return `God: continuing - "${decision.instruction ?? ''}"`;
  }
}

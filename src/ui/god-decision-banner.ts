/**
 * GodDecisionBanner — pure state logic for the God auto-decision escape window.
 * Card C.1: FR-008 (AC-025, AC-026, AC-027)
 *
 * Framework-agnostic: exports pure functions for state transitions.
 * The Ink component layer consumes these functions.
 *
 * 2-second countdown window:
 * - Space: immediate execute
 * - Esc: cancel → manual mode
 * - Timeout: auto-execute
 */

import type { GodAutoDecision } from '../types/god-schemas.js';

export interface GodDecisionBannerState {
  decision: GodAutoDecision;
  countdown: number; // milliseconds remaining (starts at 2000)
  cancelled: boolean;
  executed: boolean;
}

export const ESCAPE_WINDOW_MS = 2000;
export const TICK_INTERVAL_MS = 100;

export function createGodDecisionBannerState(
  decision: GodAutoDecision,
): GodDecisionBannerState {
  return {
    decision,
    countdown: ESCAPE_WINDOW_MS,
    cancelled: false,
    executed: false,
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
      return 'God will accept the current output';
    case 'continue_with_instruction':
      return `God will continue: "${decision.instruction ?? ''}"`;
    case 'request_human':
      return 'God requests human input';
  }
}

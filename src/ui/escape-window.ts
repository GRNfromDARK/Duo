/**
 * Escape Window — legacy pure state wrapper for God auto-decisions.
 * Source: FR-008 (AC-025, AC-026, AC-027)
 *
 * AI-driven mode executes immediately, so the legacy "escape window"
 * now resolves as confirmed on creation and key/countdown handlers are inert.
 */

import type { GodAutoDecision } from '../types/god-schemas.js';

// ── Types ──

export interface EscapeWindowState {
  visible: boolean;
  countdown: number;
  decision: GodAutoDecision;
  decisionPreview: string;
  confirmed: boolean;
  cancelled: boolean;
}

// ── Factory ──

export function createEscapeWindowState(decision: GodAutoDecision): EscapeWindowState {
  return {
    visible: false,
    countdown: 0,
    decision,
    decisionPreview: `[${decision.action}] ${decision.reasoning}`,
    confirmed: true,
    cancelled: false,
  };
}

// ── Key handler ──

/**
 * Handle key input during the legacy escape window.
 * In AI-driven mode the decision is already confirmed, so this is a no-op.
 */
export function handleEscapeKey(state: EscapeWindowState, key: string): EscapeWindowState {
  // Once resolved, state is immutable
  if (state.cancelled || state.confirmed) {
    return state;
  }

  if (key === 'escape') {
    return { ...state, cancelled: true, visible: false };
  }

  if (key === 'space') {
    return { ...state, confirmed: true, visible: false };
  }

  return state;
}

// ── Countdown tick ──

/**
 * Decrement countdown by 1 second.
 * In AI-driven mode countdown is already resolved at creation time.
 */
export function tickEscapeCountdown(state: EscapeWindowState): EscapeWindowState {
  // Don't tick if already resolved
  if (state.cancelled || state.confirmed) {
    return state;
  }

  const nextCountdown = state.countdown - 1;

  if (nextCountdown <= 0) {
    return { ...state, countdown: 0, confirmed: true, visible: false };
  }

  return { ...state, countdown: nextCountdown };
}

/**
 * Escape Window — 2秒逃生窗口 UI 状态管理
 * Source: FR-008 (AC-025, AC-026, AC-027)
 *
 * 2-second escape window with:
 * - Progress bar + God decision preview
 * - [Space] immediate execute
 * - [Esc] cancel → standard WAITING_USER manual mode (AC-026)
 */

import type { GodAutoDecision } from '../types/god-schemas.js';

// ── Types ──

export interface EscapeWindowState {
  visible: boolean;
  countdown: number;     // seconds remaining (starts at 2)
  decision: GodAutoDecision;
  decisionPreview: string;
  confirmed: boolean;
  cancelled: boolean;
}

// ── Factory ──

export function createEscapeWindowState(decision: GodAutoDecision): EscapeWindowState {
  return {
    visible: true,
    countdown: 2,
    decision,
    decisionPreview: `[${decision.action}] ${decision.reasoning}`,
    confirmed: false,
    cancelled: false,
  };
}

// ── Key handler ──

/**
 * Handle key input during escape window.
 * - 'escape': cancel → enter manual WAITING_USER mode (AC-026)
 * - 'space': immediate confirm
 * - other keys: ignored
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
 * When countdown reaches 0, auto-confirm the decision.
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

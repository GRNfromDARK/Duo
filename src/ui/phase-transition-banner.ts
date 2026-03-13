/**
 * PhaseTransitionBanner — pure state logic for the phase transition escape window.
 * Card C.3: FR-010 (AC-033, AC-034)
 *
 * 2-second countdown window for phase transitions:
 * - Space: immediate confirm
 * - Esc: cancel → stay in current phase
 * - Timeout: auto-confirm
 */

export interface PhaseTransitionBannerState {
  nextPhaseId: string;
  previousPhaseSummary: string;
  countdown: number; // milliseconds remaining (starts at 2000)
  cancelled: boolean;
  confirmed: boolean;
}

export const PHASE_ESCAPE_WINDOW_MS = 2000;
export const PHASE_TICK_INTERVAL_MS = 100;

export function createPhaseTransitionBannerState(
  nextPhaseId: string,
  previousPhaseSummary: string,
): PhaseTransitionBannerState {
  return {
    nextPhaseId,
    previousPhaseSummary,
    countdown: PHASE_ESCAPE_WINDOW_MS,
    cancelled: false,
    confirmed: false,
  };
}

export function handlePhaseTransitionKeyPress(
  state: PhaseTransitionBannerState,
  key: 'space' | 'escape',
): PhaseTransitionBannerState {
  if (state.cancelled || state.confirmed) return state;

  if (key === 'space') {
    return { ...state, confirmed: true };
  }

  if (key === 'escape') {
    return { ...state, cancelled: true };
  }

  return state;
}

export function tickPhaseTransitionCountdown(
  state: PhaseTransitionBannerState,
): PhaseTransitionBannerState {
  if (state.cancelled || state.confirmed) return state;
  if (state.countdown <= 0) return state;

  const next = state.countdown - PHASE_TICK_INTERVAL_MS;
  if (next <= 0) {
    return { ...state, countdown: 0, confirmed: true };
  }
  return { ...state, countdown: next };
}

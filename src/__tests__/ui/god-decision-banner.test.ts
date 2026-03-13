import { describe, expect, it } from 'vitest';

import {
  ESCAPE_WINDOW_MS,
  createGodDecisionBannerState,
  formatDecisionSummary,
  handleBannerKeyPress,
  tickBannerCountdown,
} from '../../ui/god-decision-banner.js';

describe('GodDecisionBanner (AI-driven: instant execution)', () => {
  it('ESCAPE_WINDOW_MS is 0', () => {
    expect(ESCAPE_WINDOW_MS).toBe(0);
  });

  it('createGodDecisionBannerState sets executed immediately', () => {
    const state = createGodDecisionBannerState({
      action: 'accept',
      reasoning: 'done',
    });

    expect(state.executed).toBe(true);
    expect(state.countdown).toBe(0);
    expect(state.cancelled).toBe(false);
  });

  it('key presses do nothing after immediate execution', () => {
    const state = createGodDecisionBannerState({
      action: 'accept',
      reasoning: 'done',
    });

    expect(handleBannerKeyPress(state, 'space')).toEqual(state);
    expect(handleBannerKeyPress(state, 'escape')).toEqual(state);
  });

  it('tick does nothing after immediate execution', () => {
    const state = createGodDecisionBannerState({
      action: 'accept',
      reasoning: 'done',
    });

    expect(tickBannerCountdown(state)).toEqual(state);
  });

  it('formats accept and continue_with_instruction decisions only', () => {
    expect(formatDecisionSummary({
      action: 'accept',
      reasoning: 'done',
    })).toContain('accept');

    expect(formatDecisionSummary({
      action: 'continue_with_instruction',
      reasoning: 'needs more work',
      instruction: 'Fix the edge case',
    })).toContain('Fix the edge case');
  });
});

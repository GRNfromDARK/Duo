/**
 * Pure scroll state management for Smart Scroll Lock (FR-016).
 * Extracted for testability — MainLayout uses these via React state.
 */

export interface ScrollState {
  scrollOffset: number;
  autoFollow: boolean;
  /** Message count when auto-follow was last disabled (-1 if following) */
  lockedAtCount: number;
}

export const INITIAL_SCROLL_STATE: ScrollState = {
  scrollOffset: 0,
  autoFollow: true,
  lockedAtCount: -1,
};

export interface ScrollView {
  effectiveOffset: number;
  visibleSlots: number;
  showIndicator: boolean;
  newMessageCount: number;
}

/**
 * Compute derived scroll view from state + message count + viewport height.
 */
export function computeScrollView(
  state: ScrollState,
  totalMessages: number,
  messageAreaHeight: number,
): ScrollView {
  const showIndicator =
    !state.autoFollow &&
    state.lockedAtCount >= 0 &&
    totalMessages > state.lockedAtCount;

  const visibleSlots = showIndicator
    ? messageAreaHeight - 1
    : messageAreaHeight;

  const maxOffset = Math.max(0, totalMessages - visibleSlots);
  const effectiveOffset = state.autoFollow
    ? maxOffset
    : Math.min(state.scrollOffset, maxOffset);

  const newMessageCount = showIndicator
    ? totalMessages - state.lockedAtCount
    : 0;

  return { effectiveOffset, visibleSlots, showIndicator, newMessageCount };
}

/**
 * Scroll up by N lines — disables auto-follow.
 */
export function scrollUp(
  state: ScrollState,
  lines: number,
  totalMessages: number,
  messageAreaHeight: number,
): ScrollState {
  const maxOffset = Math.max(0, totalMessages - messageAreaHeight);
  const base = state.autoFollow ? maxOffset : state.scrollOffset;
  const newOffset = Math.max(0, base - lines);
  return {
    scrollOffset: newOffset,
    autoFollow: false,
    lockedAtCount:
      state.lockedAtCount === -1 ? totalMessages : state.lockedAtCount,
  };
}

/**
 * Scroll down by N lines — re-enables auto-follow when reaching bottom.
 */
export function scrollDown(
  state: ScrollState,
  lines: number,
  totalMessages: number,
  messageAreaHeight: number,
): ScrollState {
  const maxOffset = Math.max(0, totalMessages - messageAreaHeight);
  const next = Math.min(maxOffset, state.scrollOffset + lines);
  const reachedBottom = next >= maxOffset;
  return {
    scrollOffset: next,
    autoFollow: reachedBottom ? true : state.autoFollow,
    lockedAtCount: reachedBottom ? -1 : state.lockedAtCount,
  };
}

/**
 * Jump to end — re-enables auto-follow immediately.
 */
export function jumpToEnd(
  totalMessages: number,
  messageAreaHeight: number,
): ScrollState {
  const maxOffset = Math.max(0, totalMessages - messageAreaHeight);
  return {
    scrollOffset: maxOffset,
    autoFollow: true,
    lockedAtCount: -1,
  };
}

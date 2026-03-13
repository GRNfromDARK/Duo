import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { MainLayout } from '../../ui/components/MainLayout.js';
import {
  INITIAL_SCROLL_STATE,
  computeScrollView,
  scrollUp,
  scrollDown,
  jumpToEnd,
} from '../../ui/scroll-state.js';
import type { Message } from '../../types/ui.js';

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    role: 'claude-code' as const,
    content: `Message ${i}`,
    timestamp: Date.now() + i * 1000,
  }));
}

describe('Smart Scroll Lock — pure functions', () => {
  const VIEWPORT = 18; // typical message area height for 80x24

  // AC-055: User scrolls up 1 line → stops auto-follow
  it('AC-055: scrollUp disables auto-follow', () => {
    const state = scrollUp(INITIAL_SCROLL_STATE, 1, 30, VIEWPORT);
    expect(state.autoFollow).toBe(false);
    expect(state.lockedAtCount).toBe(30);
    expect(state.scrollOffset).toBe(11); // maxOffset(12) - 1
  });

  it('AC-055: scrollUp records lockedAtCount once', () => {
    const s1 = scrollUp(INITIAL_SCROLL_STATE, 1, 30, VIEWPORT);
    // Scroll up again — lockedAtCount should stay at 30
    const s2 = scrollUp(s1, 1, 30, VIEWPORT);
    expect(s2.lockedAtCount).toBe(30);
    expect(s2.scrollOffset).toBe(10);
  });

  // AC-056: New output with locked viewport → showIndicator
  it('AC-056: showIndicator true when new messages arrive while locked', () => {
    // Lock viewport at 30 messages
    const locked = scrollUp(INITIAL_SCROLL_STATE, 1, 30, VIEWPORT);
    expect(locked.lockedAtCount).toBe(30);

    // New message arrives (31 total)
    const view = computeScrollView(locked, 31, VIEWPORT);
    expect(view.showIndicator).toBe(true);
    // Should reserve 1 line for indicator
    expect(view.visibleSlots).toBe(VIEWPORT - 1);
  });

  it('AC-056: showIndicator false when no new messages since lock', () => {
    const locked = scrollUp(INITIAL_SCROLL_STATE, 1, 30, VIEWPORT);
    const view = computeScrollView(locked, 30, VIEWPORT);
    expect(view.showIndicator).toBe(false);
    expect(view.visibleSlots).toBe(VIEWPORT);
  });

  it('AC-056: showIndicator false when auto-following', () => {
    // Even with many messages, auto-follow means no indicator
    const view = computeScrollView(INITIAL_SCROLL_STATE, 100, VIEWPORT);
    expect(view.showIndicator).toBe(false);
  });

  // AC-057: G key jumps to latest and re-enables auto-follow
  it('AC-057: jumpToEnd restores auto-follow', () => {
    const locked = scrollUp(INITIAL_SCROLL_STATE, 3, 30, VIEWPORT);
    const restored = jumpToEnd(31, VIEWPORT);
    expect(restored.autoFollow).toBe(true);
    expect(restored.lockedAtCount).toBe(-1);
  });

  it('AC-057: after jumpToEnd, showIndicator is false', () => {
    const locked = scrollUp(INITIAL_SCROLL_STATE, 1, 30, VIEWPORT);
    const restored = jumpToEnd(31, VIEWPORT);
    const view = computeScrollView(restored, 31, VIEWPORT);
    expect(view.showIndicator).toBe(false);
  });

  it('scrollDown to bottom re-enables auto-follow', () => {
    let state = scrollUp(INITIAL_SCROLL_STATE, 5, 30, VIEWPORT);
    // Scroll down past the end
    state = scrollDown(state, 20, 30, VIEWPORT);
    expect(state.autoFollow).toBe(true);
    expect(state.lockedAtCount).toBe(-1);
  });

  it('scrollDown not to bottom keeps auto-follow off', () => {
    let state = scrollUp(INITIAL_SCROLL_STATE, 5, 30, VIEWPORT);
    state = scrollDown(state, 1, 30, VIEWPORT);
    expect(state.autoFollow).toBe(false);
  });

  it('computeScrollView uses maxOffset when auto-following', () => {
    const view = computeScrollView(INITIAL_SCROLL_STATE, 30, VIEWPORT);
    expect(view.effectiveOffset).toBe(12); // 30 - 18
  });

  it('computeScrollView clamps scrollOffset to maxOffset', () => {
    const state = { scrollOffset: 999, autoFollow: false, lockedAtCount: 5 };
    const view = computeScrollView(state, 10, VIEWPORT);
    // maxOffset = max(0, 10-18) = 0, but showIndicator = 10>5 = true → visibleSlots=17, maxOffset=0
    // Actually: showIndicator = true, visibleSlots = 17, maxOffset = max(0, 10-17) = 0
    expect(view.effectiveOffset).toBe(0);
  });
});

describe('Smart Scroll Lock — MainLayout integration', () => {
  it('renders ScrollIndicator component when appropriate', () => {
    // ScrollIndicator rendering is tested via scroll-indicator.test.tsx
    // and pure scroll logic is tested above.
    // This integration test verifies MainLayout renders without errors.
    const { lastFrame } = render(
      <MainLayout
        messages={makeMessages(5)}
        statusText="Duo"
        columns={80}
        rows={24}
      />
    );
    const output = lastFrame()!;
    // Initially auto-following, no indicator
    expect(output).not.toContain('New output');
    expect(output).toContain('Message 0');
  });
});

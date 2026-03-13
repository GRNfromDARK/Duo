/**
 * Tests for overlay-state.ts — overlay state management.
 * Source: FR-022 (AC-072, AC-073, AC-074)
 */
import { describe, it, expect } from 'vitest';
import {
  INITIAL_OVERLAY_STATE,
  openOverlay,
  closeOverlay,
  updateSearchQuery,
  computeSearchResults,
  type OverlayState,
  type OverlayType,
} from '../../ui/overlay-state.js';
import type { Message } from '../../types/ui.js';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'claude-code',
    content: 'Hello world',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('INITIAL_OVERLAY_STATE', () => {
  it('starts with no overlay open', () => {
    expect(INITIAL_OVERLAY_STATE.activeOverlay).toBeNull();
    expect(INITIAL_OVERLAY_STATE.searchQuery).toBe('');
  });
});

describe('openOverlay', () => {
  it('opens specified overlay type', () => {
    const state = openOverlay(INITIAL_OVERLAY_STATE, 'help');
    expect(state.activeOverlay).toBe('help');
  });

  it('opens context overlay', () => {
    const state = openOverlay(INITIAL_OVERLAY_STATE, 'context');
    expect(state.activeOverlay).toBe('context');
  });

  it('opens timeline overlay', () => {
    const state = openOverlay(INITIAL_OVERLAY_STATE, 'timeline');
    expect(state.activeOverlay).toBe('timeline');
  });

  it('opens search overlay and resets query', () => {
    const prev: OverlayState = {
      activeOverlay: null,
      searchQuery: 'old query',
    };
    const state = openOverlay(prev, 'search');
    expect(state.activeOverlay).toBe('search');
    expect(state.searchQuery).toBe('');
  });

  it('switches from one overlay to another', () => {
    const state1 = openOverlay(INITIAL_OVERLAY_STATE, 'help');
    const state2 = openOverlay(state1, 'context');
    expect(state2.activeOverlay).toBe('context');
  });
});

describe('closeOverlay', () => {
  it('closes any open overlay', () => {
    const state = openOverlay(INITIAL_OVERLAY_STATE, 'help');
    const closed = closeOverlay(state);
    expect(closed.activeOverlay).toBeNull();
  });

  it('resets search query on close', () => {
    const state: OverlayState = {
      activeOverlay: 'search',
      searchQuery: 'test',
    };
    const closed = closeOverlay(state);
    expect(closed.searchQuery).toBe('');
  });

  it('noop when no overlay is open', () => {
    const closed = closeOverlay(INITIAL_OVERLAY_STATE);
    expect(closed).toEqual(INITIAL_OVERLAY_STATE);
  });
});

describe('updateSearchQuery', () => {
  it('updates the search query string', () => {
    const state: OverlayState = {
      activeOverlay: 'search',
      searchQuery: '',
    };
    const updated = updateSearchQuery(state, 'hello');
    expect(updated.searchQuery).toBe('hello');
  });

  it('preserves active overlay', () => {
    const state: OverlayState = {
      activeOverlay: 'search',
      searchQuery: '',
    };
    const updated = updateSearchQuery(state, 'test');
    expect(updated.activeOverlay).toBe('search');
  });
});

describe('computeSearchResults', () => {
  const messages: Message[] = [
    makeMessage({ id: '1', content: 'Hello world' }),
    makeMessage({ id: '2', content: 'Goodbye world' }),
    makeMessage({ id: '3', content: 'Hello again' }),
    makeMessage({ id: '4', content: 'Nothing here', role: 'system' }),
  ];

  it('returns empty array for empty query', () => {
    const results = computeSearchResults(messages, '');
    expect(results).toEqual([]);
  });

  it('filters messages by case-insensitive substring match', () => {
    const results = computeSearchResults(messages, 'hello');
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('1');
    expect(results[1].id).toBe('3');
  });

  it('matches partial words', () => {
    const results = computeSearchResults(messages, 'good');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('2');
  });

  it('returns all matching messages across roles', () => {
    const results = computeSearchResults(messages, 'world');
    expect(results).toHaveLength(2);
  });

  it('returns empty for no match', () => {
    const results = computeSearchResults(messages, 'xyz');
    expect(results).toEqual([]);
  });
});

/**
 * Overlay state management — pure functions for overlay open/close/search.
 * Source: FR-022 (AC-072, AC-073, AC-074)
 */
import type { Message } from '../types/ui.js';

export type OverlayType = 'help' | 'context' | 'timeline' | 'search' | 'god';

export interface OverlayState {
  activeOverlay: OverlayType | null;
  searchQuery: string;
}

export const INITIAL_OVERLAY_STATE: OverlayState = {
  activeOverlay: null,
  searchQuery: '',
};

export function openOverlay(
  state: OverlayState,
  overlay: OverlayType,
): OverlayState {
  return {
    activeOverlay: overlay,
    searchQuery: overlay === 'search' ? '' : state.searchQuery,
  };
}

export function closeOverlay(state: OverlayState): OverlayState {
  if (!state.activeOverlay) return state;
  return {
    activeOverlay: null,
    searchQuery: '',
  };
}

export function updateSearchQuery(
  state: OverlayState,
  query: string,
): OverlayState {
  return {
    ...state,
    searchQuery: query,
  };
}

/**
 * Filter messages by case-insensitive substring match on content.
 */
export function computeSearchResults(
  messages: Message[],
  query: string,
): Message[] {
  if (!query) return [];
  const lower = query.toLowerCase();
  return messages.filter((m) => m.content.toLowerCase().includes(lower));
}

/**
 * Display mode (Minimal/Verbose) state management.
 * Source: FR-021 (AC-070, AC-071)
 *
 * Minimal Mode (default): Hides routing events, shows LLM dialogue + key system events.
 * Verbose Mode (Ctrl+V): Shows routing, timestamps, token counts, CLI command details.
 */

import type { Message } from '../types/ui.js';

export type DisplayMode = 'minimal' | 'verbose';

export function toggleDisplayMode(current: DisplayMode): DisplayMode {
  return current === 'minimal' ? 'verbose' : 'minimal';
}

/**
 * Filter messages based on display mode.
 * In minimal mode, routing events (metadata.isRoutingEvent) are hidden.
 * All other messages (user, LLM, system non-routing) are kept.
 */
export function filterMessages(
  messages: Message[],
  mode: DisplayMode,
): Message[] {
  if (mode === 'verbose') {
    return messages;
  }

  return messages.filter((msg) => !msg.metadata?.isRoutingEvent);
}

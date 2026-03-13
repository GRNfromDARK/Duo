/**
 * God Session Persistence — restore God CLI session on duo resume.
 * Source: FR-011 (AC-035, AC-036), AR-005
 *
 * Restores God adapter instance and session ID from persisted snapshot state.
 * Gracefully degrades when session data is missing or adapter unavailable.
 */

import type { CLIAdapter } from '../types/adapter.js';
import type { SessionState } from '../session/session-manager.js';

export interface GodSessionRestoreResult {
  adapter: CLIAdapter;
  sessionId: string;
}

/**
 * Restore a God session from persisted state.
 *
 * @param state - SessionState from snapshot.json
 * @param adapterFactory - Function to create a CLIAdapter by name
 * @returns Restored adapter + sessionId, or null on graceful degradation
 */
export async function restoreGodSession(
  state: SessionState,
  adapterFactory: (name: string) => CLIAdapter,
): Promise<GodSessionRestoreResult | null> {
  // Graceful degradation: missing session ID or adapter name
  if (!state.godSessionId || !state.godAdapter) {
    return null;
  }

  try {
    const adapter = adapterFactory(state.godAdapter);
    return {
      adapter,
      sessionId: state.godSessionId,
    };
  } catch {
    // Graceful degradation: adapter creation failed (e.g. unknown adapter)
    return null;
  }
}

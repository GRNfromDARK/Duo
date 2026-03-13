/**
 * God Session Persistence — restore God CLI session on duo resume.
 * Source: FR-011 (AC-035, AC-036), AR-005
 *
 * God now runs through a dedicated stateless GodAdapter interface.
 * Persisted God session IDs remain readable in snapshots for backward compatibility,
 * but runtime restore is intentionally disabled.
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
  _state: SessionState,
  _adapterFactory: (name: string) => CLIAdapter,
): Promise<GodSessionRestoreResult | null> {
  return null;
}

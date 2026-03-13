/**
 * Tri-Party Session Coordination — Card D.3
 * Source: FR-013 (AC-039, AC-040, AC-041a)
 *
 * Manages the three-way session coordination between Coder, Reviewer, and God.
 * - Extracts tri-party session IDs from SessionState
 * - Restores coder and reviewer adapters independently with fault tolerance
 * - Leaves God stateless on resume, regardless of persisted legacy God session IDs
 * - Ensures session isolation when parties share the same CLI tool
 */

import type { CLIAdapter } from '../types/adapter.js';
import type { SessionState } from '../session/session-manager.js';

/**
 * Tri-party session state: coderSessionId, reviewerSessionId, godSessionId.
 * Uses null (not undefined) to explicitly represent "no session" / "session lost".
 */
export interface TriPartySessionState {
  coderSessionId: string | null;
  reviewerSessionId: string | null;
  godSessionId: string | null;
}

/** Result for a single party's session restore attempt. */
export interface PartyRestoreResult {
  adapter: CLIAdapter;
  sessionId: string;
}

/** Result of restoring all three parties. null means that party's session was lost or unavailable. */
export interface TriPartyRestoreResult {
  coder: PartyRestoreResult | null;
  reviewer: PartyRestoreResult | null;
  god: PartyRestoreResult | null;
}

/** Minimal config shape needed for restore (adapter name per role). */
interface RestoreConfig {
  coder: string;
  reviewer: string;
  god?: string;
}

/**
 * Extract tri-party session state from a SessionState.
 * Converts undefined → null for explicit "no session" semantics.
 */
export function extractTriPartyState(state: SessionState): TriPartySessionState {
  return {
    coderSessionId: state.coderSessionId ?? null,
    reviewerSessionId: state.reviewerSessionId ?? null,
    godSessionId: state.godSessionId ?? null,
  };
}

/**
 * Restore a single party's session.
 * Returns null on any failure (missing session ID, adapter factory error).
 */
function restoreSingleParty(
  sessionId: string | null,
  adapterName: string,
  adapterFactory: (name: string) => CLIAdapter,
): PartyRestoreResult | null {
  if (!sessionId) return null;

  try {
    const adapter = adapterFactory(adapterName);
    return { adapter, sessionId };
  } catch {
    // Graceful degradation: adapter creation failed — this party starts fresh
    return null;
  }
}

/**
 * Restore tri-party session from persisted state.
 *
 * Each party is restored independently — if one fails, others are unaffected (AC-040).
 * Each party gets its own adapter instance, even when using the same CLI tool (AC-041a).
 * God is intentionally not restored, because it must re-run with a fresh stateless system prompt.
 *
 * @param triParty - Extracted tri-party session IDs
 * @param config - Session config with adapter names for each role
 * @param adapterFactory - Factory function to create CLIAdapter instances by name
 */
export async function restoreTriPartySession(
  triParty: TriPartySessionState,
  config: RestoreConfig,
  adapterFactory: (name: string) => CLIAdapter,
): Promise<TriPartyRestoreResult> {
  // Each call to adapterFactory creates a NEW instance — ensuring isolation (AC-041a)
  const coder = restoreSingleParty(triParty.coderSessionId, config.coder, adapterFactory);
  const reviewer = restoreSingleParty(triParty.reviewerSessionId, config.reviewer, adapterFactory);
  const god = null;

  return { coder, reviewer, god };
}

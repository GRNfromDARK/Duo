/**
 * withGodFallback — Unified God call wrapper with retry + degradation.
 * Source: Card C.2, FR-G01 (AC-055, AC-056, AC-057), FR-G04 (AC-062, AC-063)
 *
 * Wraps all God call points with consistent degradation behavior:
 * - L1: Normal God call
 * - L2/L3: Retry once on failure (process_exit/timeout or parse/schema)
 * - L4: 3 consecutive failures → God disabled, full fallback to v1
 */

import type { DegradationManager, GodErrorKind, DegradationNotification } from '../god/degradation-manager.js';

export interface GodFallbackResult<T> {
  result: T;
  usedGod: boolean;
  notification?: DegradationNotification;
}

/**
 * Wraps an async God call with degradation-aware retry and fallback.
 *
 * Flow:
 * 1. If God disabled → fallback immediately
 * 2. Try God call → success → recordSuccess → return
 * 3. God fails → handleGodFailure → if retry → try once more
 * 4. Retry fails → handleGodFailure again → fallback
 * 5. Non-retryable → fallback immediately
 */
export async function withGodFallback<TGod, TFallback>(
  dm: DegradationManager,
  godCall: () => Promise<TGod>,
  fallbackCall: () => TFallback,
  errorKind: GodErrorKind,
): Promise<GodFallbackResult<TGod | TFallback>> {
  if (!dm.isGodAvailable()) {
    return { result: fallbackCall(), usedGod: false };
  }

  try {
    const result = await godCall();
    dm.handleGodSuccess();
    return { result, usedGod: true };
  } catch (err) {
    const action = dm.handleGodFailure({
      kind: errorKind,
      message: err instanceof Error ? err.message : String(err),
    });

    if (action.type === 'retry' || action.type === 'retry_with_correction') {
      // Retry once
      try {
        const result = await godCall();
        dm.handleGodSuccess();
        return { result, usedGod: true, notification: action.notification };
      } catch (retryErr) {
        // Retry failed — record second failure
        const retryAction = dm.handleGodFailure({
          kind: errorKind,
          message: retryErr instanceof Error ? retryErr.message : String(retryErr),
        });
        return {
          result: fallbackCall(),
          usedGod: false,
          notification: retryAction.notification,
        };
      }
    }

    // No retry (fallback action) — use v1
    return {
      result: fallbackCall(),
      usedGod: false,
      notification: action.notification,
    };
  }
}

/**
 * Synchronous version of withGodFallback for prompt generation.
 * No retry support — prompt generation failures are schema/logic errors.
 */
export function withGodFallbackSync<TGod, TFallback>(
  dm: DegradationManager,
  godCall: () => TGod,
  fallbackCall: () => TFallback,
  errorKind: GodErrorKind = 'schema_validation',
): GodFallbackResult<TGod | TFallback> {
  if (!dm.isGodAvailable()) {
    return { result: fallbackCall(), usedGod: false };
  }

  try {
    const result = godCall();
    // No recordSuccess for sync calls — only async God adapter calls count
    return { result, usedGod: true };
  } catch (err) {
    const action = dm.handleGodFailure({
      kind: errorKind,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      result: fallbackCall(),
      usedGod: false,
      notification: action.notification,
    };
  }
}

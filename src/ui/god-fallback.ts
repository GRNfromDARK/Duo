/**
 * withGodFallback — Unified God call wrapper with Watchdog-powered retry.
 *
 * Async version: on failure, asks GodRetryController (backed by WatchdogService)
 * whether to retry or fallback. Max 1 retry per call.
 *
 * Sync version: only checks God availability. No retry, no AI diagnosis
 * (prompt generation is local computation, not a God adapter call).
 */

import type { DegradationNotification } from '../types/degradation.js';

// ── Interfaces ──

/**
 * Async retry controller — wraps WatchdogService.diagnose() at the call site.
 * Decouples withGodFallback from WatchdogService implementation details.
 */
export interface GodRetryController {
  isGodAvailable(): boolean;
  handleGodSuccess(): void;
  /** Returns { retry: true } to retry once, or { retry: false } to fallback. */
  handleGodFailure(error: {
    kind: string;
    message: string;
  }): Promise<{ retry: boolean; notification?: DegradationNotification }>;
}

/**
 * Sync availability guard — just checks if God is available.
 * Used by withGodFallbackSync where no async diagnosis is possible.
 */
export interface GodAvailabilityGuard {
  isGodAvailable(): boolean;
}

// ── Result type ──

export interface GodFallbackResult<T> {
  result: T;
  usedGod: boolean;
  cancelled?: boolean;
  notification?: DegradationNotification;
}

// ── Async: withGodFallback ──

/**
 * Wraps an async God call with Watchdog-powered retry and fallback.
 *
 * Flow:
 * 1. If God disabled → fallback immediately
 * 2. Try God call → success → handleGodSuccess → return
 * 3. God fails → handleGodFailure (asks Watchdog) → if retry → try once more
 * 4. Retry fails → handleGodFailure again → fallback
 * 5. Non-retryable → fallback immediately
 */
export async function withGodFallback<TGod, TFallback>(
  controller: GodRetryController,
  godCall: () => Promise<TGod>,
  fallbackCall: () => TFallback,
): Promise<GodFallbackResult<TGod | TFallback>> {
  if (!controller.isGodAvailable()) {
    return { result: fallbackCall(), usedGod: false };
  }

  try {
    const result = await godCall();
    controller.handleGodSuccess();
    return { result, usedGod: true };
  } catch (err) {
    const errorInfo = {
      kind: 'process_exit',
      message: err instanceof Error ? err.message : String(err),
    };

    const action = await controller.handleGodFailure(errorInfo);

    if (action.retry) {
      // Retry once
      try {
        const result = await godCall();
        controller.handleGodSuccess();
        return { result, usedGod: true, notification: action.notification };
      } catch (retryErr) {
        // Retry failed — record second failure
        const retryErrorInfo = {
          kind: 'process_exit',
          message: retryErr instanceof Error ? retryErr.message : String(retryErr),
        };
        const retryAction = await controller.handleGodFailure(retryErrorInfo);
        return {
          result: fallbackCall(),
          usedGod: false,
          notification: retryAction.notification,
        };
      }
    }

    // No retry — fallback immediately
    return {
      result: fallbackCall(),
      usedGod: false,
      notification: action.notification,
    };
  }
}

// ── Sync: withGodFallbackSync ──

/**
 * Synchronous version for prompt generation (local computation).
 * No retry support — prompt generation failures are code errors, not God failures.
 */
export function withGodFallbackSync<TGod, TFallback>(
  guard: GodAvailabilityGuard,
  godCall: () => TGod,
  fallbackCall: () => TFallback,
): GodFallbackResult<TGod | TFallback> {
  if (!guard.isGodAvailable()) {
    return { result: fallbackCall(), usedGod: false };
  }

  try {
    const result = godCall();
    return { result, usedGod: true };
  } catch (err) {
    return {
      result: fallbackCall(),
      usedGod: false,
      notification: {
        type: 'fallback_activated',
        message: `[System] Prompt generation failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

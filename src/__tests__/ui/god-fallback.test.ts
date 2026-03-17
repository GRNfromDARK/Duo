/**
 * Tests for withGodFallback — unified God call wrapper with retry + degradation.
 * Card C.2: AC-2 (all call points use withGodFallback), AC-3 (retry), AC-4 (L4 disable)
 *
 * Updated to use GodRetryController / GodAvailabilityGuard interfaces
 * instead of the deprecated DegradationManager.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  withGodFallback,
  withGodFallbackSync,
  type GodRetryController,
  type GodAvailabilityGuard,
} from '../../ui/god-fallback.js';
import type { DegradationNotification } from '../../types/degradation.js';

// ── Mock factories ──

/**
 * Creates a mock GodRetryController for async withGodFallback tests.
 * By default: God is available, handleGodFailure returns { retry: true } on first call,
 * then { retry: false } on subsequent calls.
 */
function makeController(overrides?: {
  isGodAvailable?: boolean;
  handleGodFailure?: GodRetryController['handleGodFailure'];
}): GodRetryController {
  const failureCalls: Array<{ kind: string; message: string }> = [];

  return {
    isGodAvailable: vi.fn().mockReturnValue(overrides?.isGodAvailable ?? true),
    handleGodSuccess: vi.fn(),
    handleGodFailure: overrides?.handleGodFailure
      ? vi.fn().mockImplementation(overrides.handleGodFailure)
      : vi.fn().mockImplementation(async (error: { kind: string; message: string }) => {
          failureCalls.push(error);
          // Default: retry on first failure, fallback on second
          if (failureCalls.length === 1) {
            return {
              retry: true,
              notification: { type: 'retrying' as const, message: '[System] God error — retrying' },
            };
          }
          return {
            retry: false,
            notification: { type: 'fallback_activated' as const, message: '[System] Falling back to v1' },
          };
        }),
  };
}

/**
 * Creates a mock GodAvailabilityGuard for sync withGodFallbackSync tests.
 */
function makeGuard(isGodAvailable = true): GodAvailabilityGuard {
  return {
    isGodAvailable: vi.fn().mockReturnValue(isGodAvailable),
  };
}

describe('withGodFallback', () => {
  let controller: GodRetryController;

  beforeEach(() => {
    controller = makeController();
  });

  // ── AC-2: God available → God call succeeds ──

  test('returns God result when call succeeds', async () => {
    const godCall = vi.fn().mockResolvedValue('god-result');
    const fallbackCall = vi.fn().mockReturnValue('v1-result');

    const { result, usedGod } = await withGodFallback(controller, godCall, fallbackCall);

    expect(result).toBe('god-result');
    expect(usedGod).toBe(true);
    expect(fallbackCall).not.toHaveBeenCalled();
    expect(controller.handleGodSuccess).toHaveBeenCalled();
  });

  test('calls handleGodSuccess on God success', async () => {
    const godCall = vi.fn().mockResolvedValue('ok');
    const fallbackCall = vi.fn().mockReturnValue('v1');

    await withGodFallback(controller, godCall, fallbackCall);

    expect(controller.handleGodSuccess).toHaveBeenCalledTimes(1);
  });

  // ── AC-2: God disabled → immediate fallback ──

  test('returns fallback when God is disabled (L4)', async () => {
    controller = makeController({ isGodAvailable: false });

    const godCall = vi.fn().mockResolvedValue('god-result');
    const fallbackCall = vi.fn().mockReturnValue('v1-result');

    const { result, usedGod } = await withGodFallback(controller, godCall, fallbackCall);

    expect(result).toBe('v1-result');
    expect(usedGod).toBe(false);
    expect(godCall).not.toHaveBeenCalled();
  });

  // ── AC-3: Retry on single failure (L2: process_exit/timeout) ──

  test('retries once on process_exit and succeeds', async () => {
    let callCount = 0;
    const godCall = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('crash'));
      return Promise.resolve('retry-ok');
    });
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod, notification } = await withGodFallback(
      controller, godCall, fallbackCall,
    );

    expect(result).toBe('retry-ok');
    expect(usedGod).toBe(true);
    expect(godCall).toHaveBeenCalledTimes(2);
    expect(fallbackCall).not.toHaveBeenCalled();
    expect(notification?.type).toBe('retrying');
    // Success on retry calls handleGodSuccess
    expect(controller.handleGodSuccess).toHaveBeenCalled();
  });

  test('retries once on timeout and succeeds', async () => {
    let callCount = 0;
    const godCall = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('timeout'));
      return Promise.resolve('retry-ok');
    });
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod } = await withGodFallback(controller, godCall, fallbackCall);

    expect(result).toBe('retry-ok');
    expect(usedGod).toBe(true);
    expect(godCall).toHaveBeenCalledTimes(2);
  });

  // ── AC-3: Retry on single failure (L3: parse/schema) ──

  test('retries with correction on parse_failure and succeeds', async () => {
    let callCount = 0;
    const godCall = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('bad json'));
      return Promise.resolve('corrected');
    });
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod, notification } = await withGodFallback(
      controller, godCall, fallbackCall,
    );

    expect(result).toBe('corrected');
    expect(usedGod).toBe(true);
    expect(notification?.type).toBe('retrying');
  });

  test('retries with correction on schema_validation and succeeds', async () => {
    let callCount = 0;
    const godCall = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('schema fail'));
      return Promise.resolve('fixed');
    });
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod } = await withGodFallback(
      controller, godCall, fallbackCall,
    );

    expect(result).toBe('fixed');
    expect(usedGod).toBe(true);
  });

  // ── AC-3: Retry fails → fallback ──

  test('falls back to v1 when retry also fails', async () => {
    const godCall = vi.fn().mockRejectedValue(new Error('always fails'));
    const fallbackCall = vi.fn().mockReturnValue('v1-result');

    const { result, usedGod, notification } = await withGodFallback(
      controller, godCall, fallbackCall,
    );

    expect(result).toBe('v1-result');
    expect(usedGod).toBe(false);
    expect(godCall).toHaveBeenCalledTimes(2); // original + retry
    expect(notification).toBeDefined();
    // handleGodFailure called twice (first failure + retry failure)
    expect(controller.handleGodFailure).toHaveBeenCalledTimes(2);
  });

  // ── AC-4: Controller says no retry → immediate fallback ──

  test('reaches fallback immediately when controller denies retry', async () => {
    controller = makeController({
      handleGodFailure: async () => ({
        retry: false,
        notification: { type: 'fallback_activated', message: '[System] God disabled' },
      }),
    });

    const godCall = vi.fn().mockRejectedValue(new Error('fail'));
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod, notification } = await withGodFallback(
      controller, godCall, fallbackCall,
    );

    expect(result).toBe('v1');
    expect(usedGod).toBe(false);
    expect(godCall).toHaveBeenCalledTimes(1); // no retry
    expect(notification?.type).toBe('fallback_activated');
  });

  test('L4 is permanent — God is never called when disabled', async () => {
    controller = makeController({ isGodAvailable: false });

    const godCall = vi.fn().mockResolvedValue('god-result');
    const fallbackCall = vi.fn().mockReturnValue('v1');

    // First call
    const r1 = await withGodFallback(controller, godCall, fallbackCall);
    expect(r1.usedGod).toBe(false);

    // Second call — still disabled
    const r2 = await withGodFallback(controller, godCall, fallbackCall);
    expect(r2.usedGod).toBe(false);

    // God was never invoked
    expect(godCall).not.toHaveBeenCalled();
    // handleGodSuccess was never called
    expect(controller.handleGodSuccess).not.toHaveBeenCalled();
  });

  // ── AC-5: Notification returned ──

  test('returns retrying notification on first failure', async () => {
    let callCount = 0;
    const godCall = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('crash'));
      return Promise.resolve('ok');
    });
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { notification } = await withGodFallback(controller, godCall, fallbackCall);

    expect(notification).toBeDefined();
    expect(notification!.type).toBe('retrying');
    expect(notification!.message).toContain('retrying');
  });

  test('returns fallback_activated notification when retry fails', async () => {
    const godCall = vi.fn().mockRejectedValue(new Error('fail'));
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { notification } = await withGodFallback(controller, godCall, fallbackCall);

    expect(notification).toBeDefined();
    expect(notification!.type).toBe('fallback_activated');
  });

  test('returns god_disabled notification when controller reports it', async () => {
    let failCount = 0;
    controller = makeController({
      handleGodFailure: async () => {
        failCount++;
        if (failCount === 1) {
          return { retry: true, notification: { type: 'retrying', message: '[System] retrying' } };
        }
        // Second failure (retry failed) → return god_disabled
        return {
          retry: false,
          notification: { type: 'god_disabled', message: '[System] God permanently disabled' },
        };
      },
    });

    const godCall = vi.fn().mockRejectedValue(new Error('fail'));
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { notification } = await withGodFallback(controller, godCall, fallbackCall);

    expect(notification).toBeDefined();
    expect(notification!.type).toBe('god_disabled');
  });
});

describe('withGodFallbackSync', () => {
  let guard: GodAvailabilityGuard;

  beforeEach(() => {
    guard = makeGuard(true);
  });

  test('returns God result when call succeeds', () => {
    const godCall = vi.fn().mockReturnValue('god-prompt');
    const fallbackCall = vi.fn().mockReturnValue('v1-prompt');

    const { result, usedGod } = withGodFallbackSync(guard, godCall, fallbackCall);

    expect(result).toBe('god-prompt');
    expect(usedGod).toBe(true);
    expect(fallbackCall).not.toHaveBeenCalled();
  });

  test('falls back when God is disabled', () => {
    guard = makeGuard(false);

    const godCall = vi.fn().mockReturnValue('god');
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod } = withGodFallbackSync(guard, godCall, fallbackCall);

    expect(result).toBe('v1');
    expect(usedGod).toBe(false);
    expect(godCall).not.toHaveBeenCalled();
  });

  test('falls back when God call throws', () => {
    const godCall = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const fallbackCall = vi.fn().mockReturnValue('v1-prompt');

    const { result, usedGod, notification } = withGodFallbackSync(guard, godCall, fallbackCall);

    expect(result).toBe('v1-prompt');
    expect(usedGod).toBe(false);
    expect(notification).toBeDefined();
  });

  test('returns fallback_activated notification on throw', () => {
    const godCall = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { notification } = withGodFallbackSync(guard, godCall, fallbackCall);

    expect(notification).toBeDefined();
    expect(notification!.type).toBe('fallback_activated');
    expect(notification!.message).toContain('Prompt generation failed');
  });
});

describe('GodRetryController + withGodFallback interaction', () => {
  test('handleGodFailure receives error info from failed God call', async () => {
    const controller = makeController();

    const godCall = vi.fn().mockRejectedValue(new Error('specific crash'));
    const fallbackCall = vi.fn().mockReturnValue('v1');

    await withGodFallback(controller, godCall, fallbackCall);

    expect(controller.handleGodFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'specific crash' }),
    );
  });

  test('controller that never retries goes straight to fallback', async () => {
    const controller = makeController({
      handleGodFailure: async () => ({
        retry: false,
        notification: { type: 'fallback_activated', message: '[System] no retry' },
      }),
    });

    const godCall = vi.fn().mockRejectedValue(new Error('fail'));
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod } = await withGodFallback(controller, godCall, fallbackCall);

    expect(result).toBe('v1');
    expect(usedGod).toBe(false);
    expect(godCall).toHaveBeenCalledTimes(1);
  });

  test('controller with God disabled skips God call entirely', async () => {
    const controller = makeController({ isGodAvailable: false });

    const godCall = vi.fn().mockResolvedValue('should-not-reach');
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod } = await withGodFallback(controller, godCall, fallbackCall);

    expect(result).toBe('v1');
    expect(usedGod).toBe(false);
    expect(godCall).not.toHaveBeenCalled();
  });

  test('controller with God available allows God calls', async () => {
    const controller = makeController({ isGodAvailable: true });

    const godCall = vi.fn().mockResolvedValue('god-result');
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod } = await withGodFallback(controller, godCall, fallbackCall);

    expect(result).toBe('god-result');
    expect(usedGod).toBe(true);
  });

  test('handleGodFailure called once per failure attempt', async () => {
    const controller = makeController();

    // God fails every time; controller retries once then gives up
    const godCall = vi.fn().mockRejectedValue(new Error('fail'));
    const fallbackCall = vi.fn().mockReturnValue('v1');

    await withGodFallback(controller, godCall, fallbackCall);

    // First failure + retry failure = 2 calls
    expect(controller.handleGodFailure).toHaveBeenCalledTimes(2);
  });
});

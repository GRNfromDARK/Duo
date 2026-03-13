/**
 * Tests for withGodFallback — unified God call wrapper with retry + degradation.
 * Card C.2: AC-2 (all call points use withGodFallback), AC-3 (retry), AC-4 (L4 disable)
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { withGodFallback, withGodFallbackSync } from '../../ui/god-fallback.js';
import { DegradationManager, type FallbackServices } from '../../god/degradation-manager.js';

function makeFallbackServices(): FallbackServices {
  return {
    contextManager: {} as any,
    convergenceService: {} as any,
    choiceDetector: {} as any,
  };
}

describe('withGodFallback', () => {
  let dm: DegradationManager;

  beforeEach(() => {
    dm = new DegradationManager({ fallbackServices: makeFallbackServices() });
  });

  // ── AC-2: God available → God call succeeds ──

  test('returns God result when call succeeds', async () => {
    const godCall = vi.fn().mockResolvedValue('god-result');
    const fallbackCall = vi.fn().mockReturnValue('v1-result');

    const { result, usedGod } = await withGodFallback(dm, godCall, fallbackCall, 'process_exit');

    expect(result).toBe('god-result');
    expect(usedGod).toBe(true);
    expect(fallbackCall).not.toHaveBeenCalled();
    expect(dm.getState().consecutiveFailures).toBe(0);
  });

  test('calls recordSuccess on God success', async () => {
    // Cause a prior failure to verify success resets it
    dm.handleGodFailure({ kind: 'process_exit', message: 'prior' });
    expect(dm.getState().consecutiveFailures).toBe(1);

    const godCall = vi.fn().mockResolvedValue('ok');
    const fallbackCall = vi.fn().mockReturnValue('v1');

    await withGodFallback(dm, godCall, fallbackCall, 'process_exit');

    expect(dm.getState().consecutiveFailures).toBe(0);
    expect(dm.getState().level).toBe('L1');
  });

  // ── AC-2: God disabled → immediate fallback ──

  test('returns fallback when God is disabled (L4)', async () => {
    // Reach L4 by 3 consecutive failures
    dm.handleGodFailure({ kind: 'process_exit', message: 'e1' });
    dm.handleGodFailure({ kind: 'process_exit', message: 'e2' });
    dm.handleGodFailure({ kind: 'process_exit', message: 'e3' });
    expect(dm.isGodAvailable()).toBe(false);

    const godCall = vi.fn().mockResolvedValue('god-result');
    const fallbackCall = vi.fn().mockReturnValue('v1-result');

    const { result, usedGod } = await withGodFallback(dm, godCall, fallbackCall, 'process_exit');

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
      dm, godCall, fallbackCall, 'process_exit',
    );

    expect(result).toBe('retry-ok');
    expect(usedGod).toBe(true);
    expect(godCall).toHaveBeenCalledTimes(2);
    expect(fallbackCall).not.toHaveBeenCalled();
    expect(notification?.type).toBe('retrying');
    // Success resets counters
    expect(dm.getState().consecutiveFailures).toBe(0);
  });

  test('retries once on timeout and succeeds', async () => {
    let callCount = 0;
    const godCall = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('timeout'));
      return Promise.resolve('retry-ok');
    });
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod } = await withGodFallback(dm, godCall, fallbackCall, 'timeout');

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
      dm, godCall, fallbackCall, 'parse_failure',
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
      dm, godCall, fallbackCall, 'schema_validation',
    );

    expect(result).toBe('fixed');
    expect(usedGod).toBe(true);
  });

  // ── AC-3: Retry fails → fallback ──

  test('falls back to v1 when retry also fails', async () => {
    const godCall = vi.fn().mockRejectedValue(new Error('always fails'));
    const fallbackCall = vi.fn().mockReturnValue('v1-result');

    const { result, usedGod, notification } = await withGodFallback(
      dm, godCall, fallbackCall, 'process_exit',
    );

    expect(result).toBe('v1-result');
    expect(usedGod).toBe(false);
    expect(godCall).toHaveBeenCalledTimes(2); // original + retry
    expect(notification).toBeDefined();
    // 2 consecutive failures recorded
    expect(dm.getState().consecutiveFailures).toBe(2);
  });

  // ── AC-4: 3 consecutive failures → L4 ──

  test('reaches L4 after 3 consecutive failures across calls', async () => {
    const godCall = vi.fn().mockRejectedValue(new Error('fail'));
    const fallbackCall = vi.fn().mockReturnValue('v1');

    // First withGodFallback: fail + retry fail = 2 consecutive failures
    await withGodFallback(dm, godCall, fallbackCall, 'process_exit');
    expect(dm.getState().consecutiveFailures).toBe(2);
    expect(dm.isGodAvailable()).toBe(true);

    // Second withGodFallback: fail = 3rd consecutive → L4
    await withGodFallback(dm, godCall, fallbackCall, 'process_exit');
    expect(dm.isGodAvailable()).toBe(false);
    expect(dm.getState().level).toBe('L4');
    expect(dm.getState().godDisabled).toBe(true);
  });

  test('L4 is permanent — success does not reset', async () => {
    const godCall = vi.fn().mockRejectedValue(new Error('fail'));
    const fallbackCall = vi.fn().mockReturnValue('v1');

    // Reach L4
    await withGodFallback(dm, godCall, fallbackCall, 'process_exit');
    await withGodFallback(dm, godCall, fallbackCall, 'process_exit');
    expect(dm.isGodAvailable()).toBe(false);

    // Now even with a "success" call, God stays disabled
    dm.handleGodSuccess();
    expect(dm.isGodAvailable()).toBe(false);
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

    const { notification } = await withGodFallback(dm, godCall, fallbackCall, 'process_exit');

    expect(notification).toBeDefined();
    expect(notification!.type).toBe('retrying');
    expect(notification!.message).toContain('retrying');
  });

  test('returns fallback_activated notification when retry fails', async () => {
    const godCall = vi.fn().mockRejectedValue(new Error('fail'));
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { notification } = await withGodFallback(dm, godCall, fallbackCall, 'process_exit');

    expect(notification).toBeDefined();
    expect(notification!.type).toBe('fallback_activated');
  });

  test('returns god_disabled notification at L4', async () => {
    const godCall = vi.fn().mockRejectedValue(new Error('fail'));
    const fallbackCall = vi.fn().mockReturnValue('v1');

    // First call: 2 failures
    await withGodFallback(dm, godCall, fallbackCall, 'process_exit');

    // Second call: 3rd failure → L4
    const { notification } = await withGodFallback(dm, godCall, fallbackCall, 'process_exit');

    expect(notification).toBeDefined();
    expect(notification!.type).toBe('god_disabled');
  });
});

describe('withGodFallbackSync', () => {
  let dm: DegradationManager;

  beforeEach(() => {
    dm = new DegradationManager({ fallbackServices: makeFallbackServices() });
  });

  test('returns God result when call succeeds', () => {
    const godCall = vi.fn().mockReturnValue('god-prompt');
    const fallbackCall = vi.fn().mockReturnValue('v1-prompt');

    const { result, usedGod } = withGodFallbackSync(dm, godCall, fallbackCall);

    expect(result).toBe('god-prompt');
    expect(usedGod).toBe(true);
    expect(fallbackCall).not.toHaveBeenCalled();
  });

  test('falls back when God is disabled', () => {
    // Reach L4
    dm.handleGodFailure({ kind: 'process_exit', message: 'e1' });
    dm.handleGodFailure({ kind: 'process_exit', message: 'e2' });
    dm.handleGodFailure({ kind: 'process_exit', message: 'e3' });

    const godCall = vi.fn().mockReturnValue('god');
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod } = withGodFallbackSync(dm, godCall, fallbackCall);

    expect(result).toBe('v1');
    expect(usedGod).toBe(false);
    expect(godCall).not.toHaveBeenCalled();
  });

  test('falls back when God call throws', () => {
    const godCall = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const fallbackCall = vi.fn().mockReturnValue('v1-prompt');

    const { result, usedGod, notification } = withGodFallbackSync(dm, godCall, fallbackCall);

    expect(result).toBe('v1-prompt');
    expect(usedGod).toBe(false);
    expect(notification).toBeDefined();
  });

  test('records failure in DegradationManager', () => {
    const godCall = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const fallbackCall = vi.fn().mockReturnValue('v1');

    withGodFallbackSync(dm, godCall, fallbackCall);

    expect(dm.getState().consecutiveFailures).toBe(1);
  });
});

describe('DegradationManager state persistence (AC-6, AC-7)', () => {
  test('serializeState captures current degradation level', () => {
    const dm = new DegradationManager({ fallbackServices: makeFallbackServices() });

    // Cause a failure
    dm.handleGodFailure({ kind: 'process_exit', message: 'test' });

    const state = dm.serializeState();
    expect(state.level).toBe('L2');
    expect(state.consecutiveFailures).toBe(1);
    expect(state.godDisabled).toBe(false);
  });

  test('restores state from previous session', () => {
    const savedState = {
      level: 'L4' as const,
      consecutiveFailures: 3,
      godDisabled: true,
      fallbackActive: true,
      lastError: 'previous session error',
    };

    const dm = new DegradationManager({
      fallbackServices: makeFallbackServices(),
      restoredState: savedState,
    });

    expect(dm.isGodAvailable()).toBe(false);
    expect(dm.getState().level).toBe('L4');
    expect(dm.getState().consecutiveFailures).toBe(3);
    expect(dm.getState().godDisabled).toBe(true);
  });

  test('restored L4 state keeps God disabled permanently', async () => {
    const dm = new DegradationManager({
      fallbackServices: makeFallbackServices(),
      restoredState: {
        level: 'L4',
        consecutiveFailures: 3,
        godDisabled: true,
        fallbackActive: true,
      },
    });

    const godCall = vi.fn().mockResolvedValue('should-not-reach');
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod } = await withGodFallback(dm, godCall, fallbackCall, 'process_exit');

    expect(result).toBe('v1');
    expect(usedGod).toBe(false);
    expect(godCall).not.toHaveBeenCalled();
  });

  test('restored L1 state allows God calls', async () => {
    const dm = new DegradationManager({
      fallbackServices: makeFallbackServices(),
      restoredState: {
        level: 'L1',
        consecutiveFailures: 0,
        godDisabled: false,
        fallbackActive: false,
      },
    });

    const godCall = vi.fn().mockResolvedValue('god-result');
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod } = await withGodFallback(dm, godCall, fallbackCall, 'process_exit');

    expect(result).toBe('god-result');
    expect(usedGod).toBe(true);
  });

  test('round-trip: serialize → restore → same behavior', () => {
    const dm1 = new DegradationManager({ fallbackServices: makeFallbackServices() });

    // Build up some state
    dm1.handleGodFailure({ kind: 'timeout', message: 'slow' });
    dm1.handleGodFailure({ kind: 'timeout', message: 'slow again' });

    const serialized = dm1.serializeState();

    // Restore in a new instance
    const dm2 = new DegradationManager({
      fallbackServices: makeFallbackServices(),
      restoredState: serialized,
    });

    expect(dm2.getState()).toEqual(serialized);
    expect(dm2.isGodAvailable()).toBe(dm1.isGodAvailable());

    // One more failure should trigger L4
    dm2.handleGodFailure({ kind: 'timeout', message: 'third' });
    expect(dm2.isGodAvailable()).toBe(false);
    expect(dm2.getState().level).toBe('L4');
  });
});

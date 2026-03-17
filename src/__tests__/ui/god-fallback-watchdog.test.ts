/**
 * Tests for the new withGodFallback / withGodFallbackSync — Watchdog-powered.
 * Replaces DegradationManager with GodRetryController / GodAvailabilityGuard.
 */

import { describe, test, expect, vi } from 'vitest';
import {
  withGodFallback,
  withGodFallbackSync,
  type GodRetryController,
  type GodAvailabilityGuard,
} from '../../ui/god-fallback.js';

// ── Helper: build a mock GodRetryController ──

function makeController(overrides?: Partial<GodRetryController>): GodRetryController {
  return {
    isGodAvailable: () => true,
    handleGodSuccess: vi.fn(),
    handleGodFailure: vi.fn().mockResolvedValue({ retry: true }),
    ...overrides,
  };
}

function makeGuard(available = true): GodAvailabilityGuard {
  return { isGodAvailable: () => available };
}

// ── withGodFallback (async) ──

describe('withGodFallback (Watchdog-powered)', () => {
  test('returns God result when call succeeds', async () => {
    const ctrl = makeController();
    const godCall = vi.fn().mockResolvedValue('god-result');
    const fallbackCall = vi.fn().mockReturnValue('v1-result');

    const { result, usedGod } = await withGodFallback(ctrl, godCall, fallbackCall);

    expect(result).toBe('god-result');
    expect(usedGod).toBe(true);
    expect(fallbackCall).not.toHaveBeenCalled();
    expect(ctrl.handleGodSuccess).toHaveBeenCalledOnce();
  });

  test('returns fallback when God is disabled', async () => {
    const ctrl = makeController({ isGodAvailable: () => false });
    const godCall = vi.fn().mockResolvedValue('god-result');
    const fallbackCall = vi.fn().mockReturnValue('v1-result');

    const { result, usedGod } = await withGodFallback(ctrl, godCall, fallbackCall);

    expect(result).toBe('v1-result');
    expect(usedGod).toBe(false);
    expect(godCall).not.toHaveBeenCalled();
  });

  test('retries once when handleGodFailure returns retry=true, retry succeeds', async () => {
    const ctrl = makeController({
      handleGodFailure: vi.fn().mockResolvedValue({
        retry: true,
        notification: { type: 'retrying', message: '◈ Watchdog retrying...' },
      }),
    });
    let callCount = 0;
    const godCall = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('crash'));
      return Promise.resolve('retry-ok');
    });
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod, notification } = await withGodFallback(ctrl, godCall, fallbackCall);

    expect(result).toBe('retry-ok');
    expect(usedGod).toBe(true);
    expect(godCall).toHaveBeenCalledTimes(2);
    expect(ctrl.handleGodSuccess).toHaveBeenCalledOnce();
    expect(notification?.type).toBe('retrying');
  });

  test('falls back when handleGodFailure returns retry=true but retry also fails', async () => {
    const ctrl = makeController({
      handleGodFailure: vi.fn().mockResolvedValue({
        retry: true,
        notification: { type: 'retrying', message: 'retrying' },
      }),
    });
    const godCall = vi.fn().mockRejectedValue(new Error('always fails'));
    const fallbackCall = vi.fn().mockReturnValue('v1-result');

    const { result, usedGod } = await withGodFallback(ctrl, godCall, fallbackCall);

    expect(result).toBe('v1-result');
    expect(usedGod).toBe(false);
    expect(godCall).toHaveBeenCalledTimes(2);
    // handleGodFailure called twice (original + retry failure)
    expect(ctrl.handleGodFailure).toHaveBeenCalledTimes(2);
  });

  test('falls back immediately when handleGodFailure returns retry=false', async () => {
    const ctrl = makeController({
      handleGodFailure: vi.fn().mockResolvedValue({
        retry: false,
        notification: { type: 'fallback_activated', message: 'escalated' },
      }),
    });
    const godCall = vi.fn().mockRejectedValue(new Error('fail'));
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod, notification } = await withGodFallback(ctrl, godCall, fallbackCall);

    expect(result).toBe('v1');
    expect(usedGod).toBe(false);
    expect(godCall).toHaveBeenCalledTimes(1); // No retry
    expect(notification?.type).toBe('fallback_activated');
  });

  test('passes error kind and message to handleGodFailure', async () => {
    const handleGodFailure = vi.fn().mockResolvedValue({ retry: false });
    const ctrl = makeController({ handleGodFailure });
    const godCall = vi.fn().mockRejectedValue(new Error('something broke'));
    const fallbackCall = vi.fn().mockReturnValue('v1');

    await withGodFallback(ctrl, godCall, fallbackCall);

    expect(handleGodFailure).toHaveBeenCalledWith({
      kind: 'process_exit',
      message: 'something broke',
    });
  });

  test('notification from retry failure is returned', async () => {
    let callCount = 0;
    const ctrl = makeController({
      handleGodFailure: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { retry: true, notification: { type: 'retrying', message: 'first' } };
        return { retry: false, notification: { type: 'fallback_activated', message: 'second' } };
      }),
    });
    const godCall = vi.fn().mockRejectedValue(new Error('fail'));
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { notification } = await withGodFallback(ctrl, godCall, fallbackCall);

    // The last notification (from retry failure) is returned
    expect(notification?.type).toBe('fallback_activated');
  });
});

// ── withGodFallbackSync ──

describe('withGodFallbackSync (Watchdog-powered)', () => {
  test('returns God result when call succeeds', () => {
    const guard = makeGuard(true);
    const godCall = vi.fn().mockReturnValue('god-prompt');
    const fallbackCall = vi.fn().mockReturnValue('v1-prompt');

    const { result, usedGod } = withGodFallbackSync(guard, godCall, fallbackCall);

    expect(result).toBe('god-prompt');
    expect(usedGod).toBe(true);
    expect(fallbackCall).not.toHaveBeenCalled();
  });

  test('falls back when God is disabled', () => {
    const guard = makeGuard(false);
    const godCall = vi.fn().mockReturnValue('god');
    const fallbackCall = vi.fn().mockReturnValue('v1');

    const { result, usedGod } = withGodFallbackSync(guard, godCall, fallbackCall);

    expect(result).toBe('v1');
    expect(usedGod).toBe(false);
    expect(godCall).not.toHaveBeenCalled();
  });

  test('falls back when God call throws', () => {
    const guard = makeGuard(true);
    const godCall = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const fallbackCall = vi.fn().mockReturnValue('v1-prompt');

    const { result, usedGod, notification } = withGodFallbackSync(guard, godCall, fallbackCall);

    expect(result).toBe('v1-prompt');
    expect(usedGod).toBe(false);
    expect(notification).toBeDefined();
    expect(notification!.message).toContain('boom');
  });
});

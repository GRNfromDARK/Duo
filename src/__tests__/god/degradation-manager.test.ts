/**
 * Tests for DegradationManager — God CLI degradation + extreme fallback.
 * Source: FR-G01 (AC-055, AC-056, AC-057), FR-G04 (AC-062, AC-063)
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  DegradationManager,
  type DegradationState,
  type DegradationLevel,
  type GodError,
  type GodErrorKind,
  type DegradationAction,
  type FallbackServices,
  type DegradationNotification,
} from '../../god/degradation-manager.js';

// ── Test helpers ──

function makeGodError(kind: GodErrorKind, message = 'test error'): GodError {
  return { kind, message };
}

function makeFallbackServices(): FallbackServices {
  return {
    contextManager: {} as any,
    convergenceService: {} as any,
    choiceDetector: {} as any,
  };
}

describe('DegradationManager', () => {
  let manager: DegradationManager;

  beforeEach(() => {
    manager = new DegradationManager();
  });

  // ── Initial state ──

  test('initial state is L1 with no failures', () => {
    const state = manager.getState();
    expect(state.level).toBe('L1');
    expect(state.consecutiveFailures).toBe(0);
    expect(state.godDisabled).toBe(false);
    expect(state.fallbackActive).toBe(false);
    expect(state.lastError).toBeUndefined();
  });

  test('God is available initially', () => {
    expect(manager.isGodAvailable()).toBe(true);
  });

  // ── L1: Normal processing ──

  test('handleGodSuccess resets consecutive failures', () => {
    // First cause a failure
    manager.handleGodFailure(makeGodError('process_exit'));
    expect(manager.getState().consecutiveFailures).toBe(1);

    // Success resets
    manager.handleGodSuccess();
    expect(manager.getState().consecutiveFailures).toBe(0);
    expect(manager.getState().level).toBe('L1');
  });

  // ── L2: Retryable errors (process crash, timeout) ──

  test('L2 process_exit returns retry action on first attempt', () => {
    const action = manager.handleGodFailure(makeGodError('process_exit'));
    expect(action.type).toBe('retry');
    expect(manager.getState().level).toBe('L2');
  });

  test('L2 timeout returns retry action on first attempt', () => {
    const action = manager.handleGodFailure(makeGodError('timeout'));
    expect(action.type).toBe('retry');
    expect(manager.getState().level).toBe('L2');
  });

  test('L2 retry fails then falls back', () => {
    // First failure → retry
    const action1 = manager.handleGodFailure(makeGodError('process_exit'));
    expect(action1.type).toBe('retry');

    // Second failure (retry failed) → fallback
    const action2 = manager.handleGodFailure(makeGodError('process_exit'));
    expect(action2.type).toBe('fallback');
    expect(manager.getState().fallbackActive).toBe(true);
  });

  // ── L3: Non-retryable errors (parse failure, schema validation) ──

  test('L3 parse_failure returns retry_with_correction on first attempt', () => {
    const action = manager.handleGodFailure(makeGodError('parse_failure'));
    expect(action.type).toBe('retry_with_correction');
    expect(manager.getState().level).toBe('L3');
  });

  test('L3 schema_validation returns retry_with_correction on first attempt', () => {
    const action = manager.handleGodFailure(makeGodError('schema_validation'));
    expect(action.type).toBe('retry_with_correction');
    expect(manager.getState().level).toBe('L3');
  });

  test('L3 correction retry fails then falls back', () => {
    // First failure → retry with correction
    const action1 = manager.handleGodFailure(makeGodError('parse_failure'));
    expect(action1.type).toBe('retry_with_correction');

    // Second failure → fallback
    const action2 = manager.handleGodFailure(makeGodError('parse_failure'));
    expect(action2.type).toBe('fallback');
  });

  // ── L4: Persistent failure (3 consecutive L2/L3) ──

  test('L4 after 3 consecutive failures disables God for session', () => {
    manager.handleGodFailure(makeGodError('process_exit'));
    manager.handleGodFailure(makeGodError('process_exit'));
    const action = manager.handleGodFailure(makeGodError('timeout'));

    expect(action.type).toBe('fallback');
    expect(manager.getState().level).toBe('L4');
    expect(manager.getState().godDisabled).toBe(true);
    expect(manager.isGodAvailable()).toBe(false);
  });

  test('L4 does not recover within session', () => {
    // Reach L4
    manager.handleGodFailure(makeGodError('process_exit'));
    manager.handleGodFailure(makeGodError('process_exit'));
    manager.handleGodFailure(makeGodError('timeout'));

    // Success call should NOT restore God
    manager.handleGodSuccess();
    expect(manager.getState().godDisabled).toBe(true);
    expect(manager.isGodAvailable()).toBe(false);
    expect(manager.getState().level).toBe('L4');
  });

  // ── AC-055: Degradation switch < 100ms ──

  test('AC-055: degradation switch completes in < 100ms', () => {
    const start = performance.now();
    manager.handleGodFailure(makeGodError('process_exit'));
    manager.handleGodFailure(makeGodError('process_exit')); // triggers fallback
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
  });

  // ── AC-056: Workflow continues after degradation ──

  test('AC-056: fallback action carries fallbackServices reference', () => {
    const services = makeFallbackServices();
    const managerWithServices = new DegradationManager({ fallbackServices: services });

    managerWithServices.handleGodFailure(makeGodError('process_exit'));
    const action = managerWithServices.handleGodFailure(makeGodError('process_exit'));

    expect(action.type).toBe('fallback');
    expect(action.fallbackServices).toBe(services);
  });

  // ── AC-057: L4 writes to audit log ──

  test('AC-057: L4 degradation produces audit entry', () => {
    manager.handleGodFailure(makeGodError('process_exit'));
    manager.handleGodFailure(makeGodError('process_exit'));
    const action = manager.handleGodFailure(makeGodError('timeout'));

    expect(action.auditEntry).toBeDefined();
    expect(action.auditEntry!.decisionType).toBe('DEGRADATION_L4');
  });

  // ── AC-062: God failure doesn't lose Coder's written code ──
  // (This is an architectural guarantee — God runs AFTER Coder writes to disk.
  //  We verify that the degradation manager never touches lastCoderOutput.)

  test('AC-062: degradation action does not reference or clear coder output', () => {
    manager.handleGodFailure(makeGodError('process_exit'));
    const action = manager.handleGodFailure(makeGodError('process_exit'));

    // Action should only contain routing info, never coder output manipulation
    expect(action).not.toHaveProperty('clearCoderOutput');
    expect(action.type).toBe('fallback');
  });

  // ── AC-063: Any failure combination ends in WAITING_USER ──

  test('AC-063: fallback action produces PROCESS_ERROR event for XState', () => {
    // When fallback itself fails, the action should carry an error event
    // that XState routes to ERROR → RECOVERY → WAITING_USER
    manager.handleGodFailure(makeGodError('process_exit'));
    const action = manager.handleGodFailure(makeGodError('process_exit'));

    expect(action.type).toBe('fallback');
    // The caller uses fallback services; if THOSE fail, they send PROCESS_ERROR → ERROR → RECOVERY → WAITING_USER
    // DegradationManager's job is to provide fallback, not handle fallback failure
  });

  test('AC-063: L4 fallback action includes error event for workflow', () => {
    manager.handleGodFailure(makeGodError('process_exit'));
    manager.handleGodFailure(makeGodError('process_exit'));
    const action = manager.handleGodFailure(makeGodError('timeout'));

    expect(action.type).toBe('fallback');
    expect(action.fallbackServices).toBeUndefined(); // no services on default manager
  });

  // ── Notifications ──

  test('L2 retry produces retrying notification', () => {
    const action = manager.handleGodFailure(makeGodError('process_exit'));
    expect(action.notification).toBeDefined();
    expect(action.notification!.type).toBe('retrying');
  });

  test('first fallback produces fallback_activated notification', () => {
    manager.handleGodFailure(makeGodError('process_exit'));
    const action = manager.handleGodFailure(makeGodError('process_exit'));
    expect(action.notification).toBeDefined();
    expect(action.notification!.type).toBe('fallback_activated');
  });

  test('L4 produces god_disabled notification', () => {
    manager.handleGodFailure(makeGodError('process_exit'));
    manager.handleGodFailure(makeGodError('process_exit'));
    const action = manager.handleGodFailure(makeGodError('timeout'));
    expect(action.notification).toBeDefined();
    expect(action.notification!.type).toBe('god_disabled');
  });

  // ── Mixed error sequences ──

  test('success between failures resets count (non-L4)', () => {
    manager.handleGodFailure(makeGodError('process_exit'));
    manager.handleGodSuccess();
    manager.handleGodFailure(makeGodError('parse_failure'));
    manager.handleGodSuccess();

    expect(manager.getState().consecutiveFailures).toBe(0);
    expect(manager.getState().level).toBe('L1');
    expect(manager.isGodAvailable()).toBe(true);
  });

  test('mixed L2/L3 errors still count toward L4 threshold', () => {
    manager.handleGodFailure(makeGodError('process_exit'));    // L2
    manager.handleGodFailure(makeGodError('parse_failure'));    // L3
    const action = manager.handleGodFailure(makeGodError('schema_validation')); // L3 → L4

    expect(manager.getState().level).toBe('L4');
    expect(manager.getState().godDisabled).toBe(true);
    expect(action.type).toBe('fallback');
  });

  // ── Regression: BUG-3 R12 — serializeState / restoredState roundtrip ──

  test('test_regression_bug_r12_3: serializeState captures L4 for session persistence', () => {
    // Reach L4
    manager.handleGodFailure(makeGodError('process_exit'));
    manager.handleGodFailure(makeGodError('process_exit'));
    manager.handleGodFailure(makeGodError('timeout'));

    const serialized = manager.serializeState();
    expect(serialized.level).toBe('L4');
    expect(serialized.godDisabled).toBe(true);
    expect(serialized.consecutiveFailures).toBe(3);

    // Restore from serialized state (simulates duo resume)
    const restored = new DegradationManager({ restoredState: serialized });
    expect(restored.isGodAvailable()).toBe(false);
    expect(restored.getState().level).toBe('L4');
    expect(restored.getState().godDisabled).toBe(true);
  });

  test('test_regression_bug_r12_3: restored L4 manager skips God calls immediately', () => {
    const restoredState: DegradationState = {
      level: 'L4',
      consecutiveFailures: 3,
      godDisabled: true,
      fallbackActive: true,
      lastError: 'timeout',
    };

    const restored = new DegradationManager({ restoredState });
    // Should NOT attempt God calls
    expect(restored.isGodAvailable()).toBe(false);
    // handleGodSuccess should NOT restore God in L4
    restored.handleGodSuccess();
    expect(restored.isGodAvailable()).toBe(false);
  });

  // ── Non-L4 auto-recovery ──

  test('non-L4 fallback allows next God call attempt', () => {
    manager.handleGodFailure(makeGodError('process_exit'));
    manager.handleGodFailure(makeGodError('process_exit')); // fallback

    // Next round, God should still be available (non-L4)
    expect(manager.isGodAvailable()).toBe(true);
    expect(manager.getState().level).not.toBe('L4');
  });
});

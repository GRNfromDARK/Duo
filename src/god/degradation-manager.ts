/**
 * DegradationManager — God CLI failure degradation + extreme fallback.
 * Source: FR-G01 (AC-055, AC-056, AC-057), FR-G04 (AC-062, AC-063)
 *
 * Four-level degradation strategy:
 * - L1: Normal processing, no degradation
 * - L2: Retryable errors (process crash, timeout) → retry 1x → fallback
 * - L3: Non-retryable errors (parse/schema failure) → correction retry 1x → fallback
 * - L4: 3 consecutive failures → disable God for session, full fallback
 *
 * Fallback: switch to old components (ContextManager + ConvergenceService + ChoiceDetector).
 * Three-layer safety: God → fallback → ERROR → WAITING_USER → duo resume.
 */

import type { ContextManager } from '../session/context-manager.js';
import type { ConvergenceService } from '../decision/convergence-service.js';
import type { ChoiceDetector } from '../decision/choice-detector.js';
import type { GodAuditEntry } from './god-audit.js';

// ── Types ──

export type DegradationLevel = 'L1' | 'L2' | 'L3' | 'L4';

export type GodErrorKind = 'process_exit' | 'timeout' | 'parse_failure' | 'schema_validation';

export interface GodError {
  kind: GodErrorKind;
  message: string;
}

export interface DegradationState {
  level: DegradationLevel;
  consecutiveFailures: number;
  godDisabled: boolean;
  fallbackActive: boolean;
  lastError?: string;
}

export interface FallbackServices {
  contextManager: ContextManager;
  convergenceService: ConvergenceService;
  choiceDetector: ChoiceDetector;
}

export interface DegradationNotification {
  type: 'retrying' | 'fallback_activated' | 'god_disabled';
  message: string;
}

export interface DegradationAction {
  type: 'retry' | 'retry_with_correction' | 'fallback';
  fallbackServices?: FallbackServices;
  notification?: DegradationNotification;
  auditEntry?: GodAuditEntry;
}

export interface DegradationManagerOptions {
  fallbackServices?: FallbackServices;
  /** Restore state from a previous session (e.g. duo resume) */
  restoredState?: DegradationState;
}

// ── Constants ──

const L4_THRESHOLD = 3;

const RETRYABLE_KINDS: Set<GodErrorKind> = new Set(['process_exit', 'timeout']);
const CORRECTION_KINDS: Set<GodErrorKind> = new Set(['parse_failure', 'schema_validation']);

// ── DegradationManager ──

export class DegradationManager {
  private state: DegradationState;
  private readonly fallbackServices?: FallbackServices;
  private hasNotifiedFallback = false;

  constructor(opts?: DegradationManagerOptions) {
    this.state = opts?.restoredState
      ? { ...opts.restoredState }
      : {
          level: 'L1',
          consecutiveFailures: 0,
          godDisabled: false,
          fallbackActive: false,
        };
    this.fallbackServices = opts?.fallbackServices;
    if (this.state.godDisabled) {
      this.hasNotifiedFallback = true;
    }
  }

  /**
   * Serialize current state for session persistence (duo resume).
   */
  serializeState(): DegradationState {
    return { ...this.state };
  }

  handleGodFailure(error: GodError, context?: { seq: number; round: number }): DegradationAction {
    this.state.consecutiveFailures++;
    this.state.lastError = error.message;

    // Check L4 threshold
    if (this.state.consecutiveFailures >= L4_THRESHOLD) {
      return this.enterL4(error, context);
    }

    // L2: Retryable errors
    if (RETRYABLE_KINDS.has(error.kind)) {
      return this.handleRetryable(error);
    }

    // L3: Non-retryable (parse/schema)
    if (CORRECTION_KINDS.has(error.kind)) {
      return this.handleCorrectable(error);
    }

    // Unknown error kind — treat as retryable
    return this.handleRetryable(error);
  }

  handleGodSuccess(): void {
    // L4 is permanent for the session
    if (this.state.godDisabled) return;

    this.state.consecutiveFailures = 0;
    this.state.level = 'L1';
    this.state.fallbackActive = false;
  }

  isGodAvailable(): boolean {
    return !this.state.godDisabled;
  }

  getState(): DegradationState {
    return { ...this.state };
  }

  // ── Private ──

  private handleRetryable(error: GodError): DegradationAction {
    // Odd failures → retry; even failures → fallback
    if (this.state.consecutiveFailures % 2 === 1) {
      this.state.level = 'L2';
      return {
        type: 'retry',
        notification: {
          type: 'retrying',
          message: '◈ God retrying...',
        },
      };
    }

    return this.activateFallback();
  }

  private handleCorrectable(error: GodError): DegradationAction {
    if (this.state.consecutiveFailures % 2 === 1) {
      this.state.level = 'L3';
      return {
        type: 'retry_with_correction',
        notification: {
          type: 'retrying',
          message: '◈ God retrying with format correction...',
        },
      };
    }

    return this.activateFallback();
  }

  private activateFallback(): DegradationAction {
    this.state.fallbackActive = true;

    const notification: DegradationNotification = this.hasNotifiedFallback
      ? { type: 'fallback_activated', message: '[System] God orchestrator still unavailable. Using local analysis.' }
      : { type: 'fallback_activated', message: '[System] God orchestrator unavailable. Using local analysis. Subsequent rounds will use local components until God recovers.' };

    this.hasNotifiedFallback = true;

    return {
      type: 'fallback',
      fallbackServices: this.fallbackServices,
      notification,
    };
  }

  private enterL4(error: GodError, context?: { seq: number; round: number }): DegradationAction {
    this.state.level = 'L4';
    this.state.godDisabled = true;
    this.state.fallbackActive = true;

    const auditEntry: GodAuditEntry = {
      seq: context?.seq ?? 0,
      timestamp: new Date().toISOString(),
      round: context?.round ?? 0,
      decisionType: 'DEGRADATION_L4',
      inputSummary: `Consecutive failures: ${this.state.consecutiveFailures}`,
      outputSummary: `God disabled for session. Last error: ${error.message}`,
      decision: {
        level: 'L4',
        godDisabled: true,
        consecutiveFailures: this.state.consecutiveFailures,
        lastErrorKind: error.kind,
      },
    };

    return {
      type: 'fallback',
      fallbackServices: this.fallbackServices,
      notification: {
        type: 'god_disabled',
        message: '⚠ Fallback mode',
      },
      auditEntry,
    };
  }
}

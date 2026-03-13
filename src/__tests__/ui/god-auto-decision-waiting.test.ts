/**
 * Card C.1: WAITING_USER God auto-decision integration tests.
 *
 * Tests the God auto-decision logic integrated into the WAITING_USER useEffect.
 * Verifies: AC-1 through AC-7 (auto-decision, rule engine block, escape window,
 * cancel, execute, audit logging, degradation fallback).
 *
 * These tests exercise the God modules directly (same pattern as god-routing-post-code.test.ts),
 * since App.tsx component-level tests are covered by the pure state logic tests and
 * the existing session-runner-state tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CLIAdapter, OutputChunk } from '../../types/adapter.js';
import { makeAutoDecision } from '../../god/auto-decision.js';
import type { AutoDecisionContext } from '../../god/auto-decision.js';
import { evaluateRules } from '../../god/rule-engine.js';
import { DegradationManager } from '../../god/degradation-manager.js';
import { ContextManager } from '../../session/context-manager.js';
import { ConvergenceService } from '../../decision/convergence-service.js';
import { ChoiceDetector } from '../../decision/choice-detector.js';
import * as godAudit from '../../god/god-audit.js';
import {
  createGodDecisionBannerState,
  handleBannerKeyPress,
  tickBannerCountdown,
  ESCAPE_WINDOW_MS,
  TICK_INTERVAL_MS,
} from '../../ui/god-decision-banner.js';

// ── Mock God adapter ──

function createMockGodAdapter(responseJson: Record<string, unknown>): CLIAdapter {
  const jsonBlock = '```json\n' + JSON.stringify(responseJson) + '\n```';
  return {
    execute: vi.fn(async function* (): AsyncGenerator<OutputChunk> {
      yield { type: 'text', content: jsonBlock, timestamp: Date.now() };
    }),
    kill: vi.fn(async () => {}),
  } as unknown as CLIAdapter;
}

function createFailingGodAdapter(error: Error): CLIAdapter {
  return {
    execute: vi.fn(async function* (): AsyncGenerator<OutputChunk> {
      throw error;
    }),
    kill: vi.fn(async () => {}),
  } as unknown as CLIAdapter;
}

// ── Helpers ──

function createDegradationManager(): DegradationManager {
  return new DegradationManager({
    fallbackServices: {
      contextManager: new ContextManager({ contextWindowSize: 200000, promptsDir: '/tmp/prompts' }),
      convergenceService: new ConvergenceService({ maxRounds: 20 }),
      choiceDetector: new ChoiceDetector(),
    },
  });
}

const baseContext: AutoDecisionContext = {
  round: 2,
  maxRounds: 20,
  taskGoal: 'Fix the login bug',
  sessionDir: '/tmp/test-session-auto-decision',
  seq: 1,
  waitingReason: 'awaiting_user_decision',
  projectDir: process.env.HOME + '/Documents/test-project',
};

// ── Spy on audit ──

let auditSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  auditSpy = vi.spyOn(godAudit, 'appendAuditLog').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── AC-1: God makes auto-decision in WAITING_USER ──

describe('AC-1: God auto-decision in WAITING_USER', () => {
  it('returns accept decision from God', async () => {
    const adapter = createMockGodAdapter({
      action: 'accept',
      reasoning: 'All requirements met',
    });

    const result = await makeAutoDecision(adapter, baseContext, evaluateRules);

    expect(result.decision.action).toBe('accept');
    expect(result.blocked).toBe(false);
    expect(result.reasoning).toBe('All requirements met');
  });

  it('returns continue_with_instruction decision', async () => {
    const adapter = createMockGodAdapter({
      action: 'continue_with_instruction',
      reasoning: 'Need null checks',
      instruction: 'Focus on null pointer checks',
    });

    const result = await makeAutoDecision(adapter, baseContext, evaluateRules);

    expect(result.decision.action).toBe('continue_with_instruction');
    expect(result.decision.instruction).toBe('Focus on null pointer checks');
    expect(result.blocked).toBe(false);
  });

  it('returns request_human decision (stays manual)', async () => {
    const adapter = createMockGodAdapter({
      action: 'request_human',
      reasoning: 'Ambiguous requirement',
    });

    const result = await makeAutoDecision(adapter, baseContext, evaluateRules);

    expect(result.decision.action).toBe('request_human');
    expect(result.blocked).toBe(false);
  });
});

// ── AC-2: Rule engine block prevents auto-decision execution ──

describe('AC-2: Rule engine block', () => {
  it('blocks when instruction references system directory', async () => {
    const adapter = createMockGodAdapter({
      action: 'continue_with_instruction',
      reasoning: 'Need to check system config',
      instruction: 'cat /etc/passwd',
    });

    const result = await makeAutoDecision(adapter, baseContext, evaluateRules);

    expect(result.blocked).toBe(true);
  });

  it('does not block accept decisions', async () => {
    const adapter = createMockGodAdapter({
      action: 'accept',
      reasoning: 'Done',
    });

    const result = await makeAutoDecision(adapter, baseContext, evaluateRules);

    expect(result.blocked).toBe(false);
  });
});

// ── AC-3/4/5: Escape window banner state ──

describe('AC-3/4/5: Escape window banner', () => {
  it('AC-3: shows banner with 2s countdown', () => {
    const state = createGodDecisionBannerState({
      action: 'accept',
      reasoning: 'All good',
    });
    expect(state.countdown).toBe(ESCAPE_WINDOW_MS);
    expect(state.executed).toBe(false);
    expect(state.cancelled).toBe(false);
  });

  it('AC-4: Esc cancels to manual mode', () => {
    const state = createGodDecisionBannerState({
      action: 'accept',
      reasoning: 'All good',
    });
    const next = handleBannerKeyPress(state, 'escape');
    expect(next.cancelled).toBe(true);
    expect(next.executed).toBe(false);
  });

  it('AC-5: Space executes immediately', () => {
    const state = createGodDecisionBannerState({
      action: 'accept',
      reasoning: 'All good',
    });
    const next = handleBannerKeyPress(state, 'space');
    expect(next.executed).toBe(true);
  });

  it('AC-5: Countdown to 0 auto-executes', () => {
    let state = createGodDecisionBannerState({
      action: 'accept',
      reasoning: 'All good',
    });
    const totalTicks = ESCAPE_WINDOW_MS / TICK_INTERVAL_MS;
    for (let i = 0; i < totalTicks; i++) {
      state = tickBannerCountdown(state);
    }
    expect(state.executed).toBe(true);
    expect(state.countdown).toBe(0);
  });
});

// ── AC-6: Reasoning written to audit log ──

describe('AC-6: Audit logging', () => {
  it('writes auto-decision reasoning to audit log', async () => {
    const adapter = createMockGodAdapter({
      action: 'accept',
      reasoning: 'All requirements met, tests passing',
    });

    await makeAutoDecision(adapter, baseContext, evaluateRules);

    expect(auditSpy).toHaveBeenCalledTimes(1);
    const logEntry = auditSpy.mock.calls[0][1];
    expect(logEntry.decisionType).toBe('AUTO_DECISION');
    expect(logEntry.outputSummary).toContain('accept');
  });

  it('writes blocked decision to audit log', async () => {
    const adapter = createMockGodAdapter({
      action: 'continue_with_instruction',
      reasoning: 'Check config',
      instruction: 'cat /etc/hosts',
    });

    await makeAutoDecision(adapter, baseContext, evaluateRules);

    expect(auditSpy).toHaveBeenCalledTimes(1);
    const logEntry = auditSpy.mock.calls[0][1];
    expect(logEntry.decision).toHaveProperty('blocked', true);
  });
});

// ── AC-7: God failure → v1 fallback ──

describe('AC-7: Degradation on God failure', () => {
  it('DegradationManager tracks failure when God throws', () => {
    const dm = createDegradationManager();
    expect(dm.isGodAvailable()).toBe(true);

    // Simulate 3 consecutive failures → L4 disables God
    dm.handleGodFailure({ kind: 'process_exit', message: 'crash 1' });
    dm.handleGodFailure({ kind: 'process_exit', message: 'crash 2' });
    const action = dm.handleGodFailure({ kind: 'process_exit', message: 'crash 3' });

    expect(dm.isGodAvailable()).toBe(false);
    expect(action.type).toBe('fallback');
  });

  it('makeAutoDecision throws on adapter failure (caller wraps with DegradationManager)', async () => {
    const adapter = createFailingGodAdapter(new Error('God process crashed'));

    await expect(
      makeAutoDecision(adapter, baseContext, evaluateRules),
    ).rejects.toThrow('God process crashed');
  });

  it('DegradationManager resets on success', () => {
    const dm = createDegradationManager();
    dm.handleGodFailure({ kind: 'process_exit', message: 'crash 1' });
    expect(dm.getState().consecutiveFailures).toBe(1);

    dm.handleGodSuccess();
    expect(dm.getState().consecutiveFailures).toBe(0);
    expect(dm.isGodAvailable()).toBe(true);
  });
});

// ── Integration: End-to-end auto-decision flow ──

describe('Integration: full auto-decision flow', () => {
  it('accept flow: God decides accept → banner executes → CONVERGED event expected', async () => {
    const adapter = createMockGodAdapter({
      action: 'accept',
      reasoning: 'Task complete',
    });
    const dm = createDegradationManager();
    expect(dm.isGodAvailable()).toBe(true);

    const result = await makeAutoDecision(adapter, baseContext, evaluateRules);

    expect(result.blocked).toBe(false);
    expect(result.decision.action).toBe('accept');

    dm.handleGodSuccess();
    expect(dm.getState().consecutiveFailures).toBe(0);

    // Banner state: execute → maps to USER_CONFIRM accept in App.tsx
    const bannerState = createGodDecisionBannerState(result.decision);
    const executed = handleBannerKeyPress(bannerState, 'space');
    expect(executed.executed).toBe(true);
  });

  it('continue flow: God decides continue → banner executes → USER_CONFIRM continue expected', async () => {
    const adapter = createMockGodAdapter({
      action: 'continue_with_instruction',
      reasoning: 'Need edge case testing',
      instruction: 'Add tests for empty input',
    });

    const result = await makeAutoDecision(adapter, baseContext, evaluateRules);

    expect(result.blocked).toBe(false);
    expect(result.decision.action).toBe('continue_with_instruction');
    expect(result.decision.instruction).toBe('Add tests for empty input');

    // Banner timeout flow
    let bannerState = createGodDecisionBannerState(result.decision);
    const totalTicks = ESCAPE_WINDOW_MS / TICK_INTERVAL_MS;
    for (let i = 0; i < totalTicks; i++) {
      bannerState = tickBannerCountdown(bannerState);
    }
    expect(bannerState.executed).toBe(true);
  });

  it('blocked flow: God decides but rule engine blocks → no banner, stay manual', async () => {
    const adapter = createMockGodAdapter({
      action: 'continue_with_instruction',
      reasoning: 'Need system info',
      instruction: 'read /etc/passwd',
    });

    const result = await makeAutoDecision(adapter, baseContext, evaluateRules);

    expect(result.blocked).toBe(true);
    // No banner should be shown — caller checks result.blocked
  });

  it('failure flow: God throws → degradation → v1 manual mode', async () => {
    const adapter = createFailingGodAdapter(new Error('timeout'));
    const dm = createDegradationManager();

    try {
      await makeAutoDecision(adapter, baseContext, evaluateRules);
    } catch {
      dm.handleGodFailure({ kind: 'timeout', message: 'timeout' });
    }

    // First failure → L2, still available
    expect(dm.isGodAvailable()).toBe(true);
    expect(dm.getState().level).toBe('L2');
  });
});

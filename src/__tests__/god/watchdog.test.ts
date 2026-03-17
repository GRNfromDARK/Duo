/**
 * Tests for WatchdogService — AI-powered error triage for God failures.
 */

import { describe, it, expect } from 'vitest';
import type { OutputChunk } from '../../types/adapter.js';
import type { GodExecOptions } from '../../types/god-adapter.js';
import {
  WatchdogService,
  WatchdogDecisionSchema,
  buildEnvelopeFromWatchdogAction,
  type WatchdogDecision,
} from '../../god/watchdog.js';

// ── Mock adapter factory ──

function createWatchdogAdapter(decision: WatchdogDecision) {
  const json = JSON.stringify(decision);
  return {
    name: 'mock-watchdog',
    displayName: 'Mock Watchdog',
    version: '1.0.0',
    isInstalled: async () => true,
    getVersion: async () => '1.0.0',
    execute(_prompt: string, _opts: GodExecOptions): AsyncIterable<OutputChunk> {
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text' as const, content: '```json\n' + json + '\n```', timestamp: Date.now() };
        },
      };
    },
    kill: async () => {},
    isRunning: () => false,
  };
}

function createFailingAdapter() {
  return {
    name: 'failing-watchdog',
    displayName: 'Failing Watchdog',
    version: '1.0.0',
    isInstalled: async () => true,
    getVersion: async () => '1.0.0',
    execute(): AsyncIterable<OutputChunk> {
      return {
        async *[Symbol.asyncIterator]() {
          throw new Error('Adapter crashed');
        },
      };
    },
    kill: async () => {},
    isRunning: () => false,
  };
}

const baseContext = { taskGoal: 'Test task', round: 1, maxRounds: 5 };
const baseError = { kind: 'schema_validation', message: 'actions.0.type: Invalid input' };

// ── Schema tests ──

describe('WatchdogDecisionSchema', () => {
  it('validates a retry_fresh decision', () => {
    const result = WatchdogDecisionSchema.safeParse({
      analysis: 'Session polluted',
      decision: 'retry_fresh',
    });
    expect(result.success).toBe(true);
  });

  it('validates a construct_envelope decision with constructedAction', () => {
    const result = WatchdogDecisionSchema.safeParse({
      analysis: 'God meant accept_task',
      decision: 'construct_envelope',
      constructedAction: {
        actionType: 'accept_task',
        summary: 'Task complete',
        userMessage: 'Done!',
      },
    });
    expect(result.success).toBe(true);
  });

  it('validates a retry_with_hint decision', () => {
    const result = WatchdogDecisionSchema.safeParse({
      analysis: 'Wrong action type',
      decision: 'retry_with_hint',
      hint: 'Use "accept_task" instead of "complete"',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid decision values', () => {
    const result = WatchdogDecisionSchema.safeParse({
      analysis: 'test',
      decision: 'invalid_decision',
    });
    expect(result.success).toBe(false);
  });
});

// ── WatchdogService.diagnose tests ──

describe('WatchdogService.diagnose', () => {
  it('returns the decision from the adapter', async () => {
    const adapter = createWatchdogAdapter({
      analysis: 'Session is polluted',
      decision: 'retry_fresh',
    });
    const watchdog = new WatchdogService(adapter);

    const result = await watchdog.diagnose(baseError, 'raw output', [], baseContext);

    expect(result.decision).toBe('retry_fresh');
    expect(result.analysis).toBe('Session is polluted');
  });

  it('increments consecutiveFailures on each diagnose call', async () => {
    const adapter = createWatchdogAdapter({ analysis: 'test', decision: 'escalate' });
    const watchdog = new WatchdogService(adapter);

    await watchdog.diagnose(baseError, null, [], baseContext);
    expect(watchdog.getState().consecutiveFailures).toBe(1);

    await watchdog.diagnose(baseError, null, [], baseContext);
    expect(watchdog.getState().consecutiveFailures).toBe(2);
  });

  it('auto-escalates after MAX_CONSECUTIVE_FAILURES (5)', async () => {
    const adapter = createWatchdogAdapter({ analysis: 'will not be called', decision: 'retry_fresh' });
    const watchdog = new WatchdogService(adapter);

    // Simulate 4 failures
    for (let i = 0; i < 4; i++) {
      await watchdog.diagnose(baseError, null, [], baseContext);
    }
    expect(watchdog.getState().godDisabled).toBe(false);

    // 5th failure triggers auto-escalate
    const result = await watchdog.diagnose(baseError, null, [], baseContext);
    expect(result.decision).toBe('escalate');
    expect(watchdog.getState().godDisabled).toBe(true);
  });

  it('returns escalate when adapter crashes', async () => {
    const adapter = createFailingAdapter();
    const watchdog = new WatchdogService(adapter);

    const result = await watchdog.diagnose(baseError, 'raw output', [], baseContext);

    expect(result.decision).toBe('escalate');
    expect(result.analysis).toContain('Watchdog adapter error');
  });

  it('returns escalate when adapter returns invalid JSON', async () => {
    const adapter = {
      name: 'bad-json-watchdog',
      displayName: 'Bad JSON',
      version: '1.0.0',
      isInstalled: async () => true,
      getVersion: async () => '1.0.0',
      execute(): AsyncIterable<OutputChunk> {
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'text' as const, content: 'not json at all', timestamp: Date.now() };
          },
        };
      },
      kill: async () => {},
      isRunning: () => false,
    };
    const watchdog = new WatchdogService(adapter);

    const result = await watchdog.diagnose(baseError, null, [], baseContext);

    expect(result.decision).toBe('escalate');
    expect(result.analysis).toContain('Watchdog produced invalid output');
  });
});

// ── handleGodSuccess ──

describe('WatchdogService.handleGodSuccess', () => {
  it('resets consecutiveFailures and godDisabled', async () => {
    const adapter = createWatchdogAdapter({ analysis: 'test', decision: 'escalate' });
    const watchdog = new WatchdogService(adapter);

    await watchdog.diagnose(baseError, null, [], baseContext);
    await watchdog.diagnose(baseError, null, [], baseContext);
    expect(watchdog.getState().consecutiveFailures).toBe(2);

    watchdog.handleGodSuccess();
    expect(watchdog.getState().consecutiveFailures).toBe(0);
    expect(watchdog.getState().godDisabled).toBe(false);
  });
});

// ── serializeState ──

describe('WatchdogService.serializeState', () => {
  it('returns DegradationState-compatible object', async () => {
    const adapter = createWatchdogAdapter({ analysis: 'test', decision: 'escalate' });
    const watchdog = new WatchdogService(adapter);

    await watchdog.diagnose(baseError, null, [], baseContext);

    const state = watchdog.serializeState();
    expect(state.level).toBe('L1');
    expect(state.consecutiveFailures).toBe(1);
    expect(state.godDisabled).toBe(false);
    expect(state.fallbackActive).toBe(false);
  });

  it('serializes L4 state when godDisabled', async () => {
    const adapter = createWatchdogAdapter({ analysis: 'test', decision: 'escalate' });
    const watchdog = new WatchdogService(adapter);

    // Force 5 failures to trigger godDisabled
    for (let i = 0; i < 5; i++) {
      await watchdog.diagnose(baseError, null, [], baseContext);
    }

    const state = watchdog.serializeState();
    expect(state.level).toBe('L4');
    expect(state.godDisabled).toBe(true);
    expect(state.fallbackActive).toBe(true);
  });

  it('restores from DegradationState', () => {
    const adapter = createWatchdogAdapter({ analysis: 'test', decision: 'escalate' });
    const watchdog = new WatchdogService(adapter, {
      restoredState: {
        level: 'L4',
        consecutiveFailures: 3,
        godDisabled: true,
        fallbackActive: true,
        lastError: 'previous error',
      },
    });

    expect(watchdog.getState().consecutiveFailures).toBe(3);
    expect(watchdog.getState().godDisabled).toBe(true);
    expect(watchdog.isGodAvailable()).toBe(false);
  });
});

// ── buildEnvelopeFromWatchdogAction ──

describe('buildEnvelopeFromWatchdogAction', () => {
  const ctx = { taskGoal: 'Count files', currentPhaseId: 'phase-1' };

  it('constructs accept_task envelope', () => {
    const decision: WatchdogDecision = {
      analysis: 'God wanted to accept',
      decision: 'construct_envelope',
      constructedAction: {
        actionType: 'accept_task',
        summary: 'Task complete: 7999 files',
        userMessage: 'Project has 7999 files.',
      },
    };

    const envelope = buildEnvelopeFromWatchdogAction(decision, ctx);

    expect(envelope.actions).toHaveLength(1);
    expect(envelope.actions[0].type).toBe('accept_task');
    expect(envelope.authority.acceptAuthority).toBe('god_override');
    expect(envelope.messages.some(m => m.target === 'user' && m.content.includes('7999'))).toBe(true);
    expect(envelope.messages.some(m => m.target === 'system_log')).toBe(true);
  });

  it('constructs send_to_coder envelope', () => {
    const decision: WatchdogDecision = {
      analysis: 'God wanted to send to coder',
      decision: 'construct_envelope',
      constructedAction: {
        actionType: 'send_to_coder',
        summary: 'Please implement the login feature',
      },
    };

    const envelope = buildEnvelopeFromWatchdogAction(decision, ctx);

    expect(envelope.actions[0].type).toBe('send_to_coder');
    expect(envelope.authority.acceptAuthority).toBe('reviewer_aligned');
  });

  it('constructs wait envelope for unknown action type', () => {
    const decision: WatchdogDecision = {
      analysis: 'Unknown',
      decision: 'construct_envelope',
      constructedAction: {
        actionType: 'unknown_action',
        summary: 'Something',
      },
    };

    const envelope = buildEnvelopeFromWatchdogAction(decision, ctx);

    expect(envelope.actions[0].type).toBe('wait');
  });

  it('returns fallback when constructedAction is missing', () => {
    const decision: WatchdogDecision = {
      analysis: 'No action to construct',
      decision: 'construct_envelope',
    };

    const envelope = buildEnvelopeFromWatchdogAction(decision, ctx);

    expect(envelope.actions[0].type).toBe('wait');
    expect(envelope.diagnosis.summary).toContain('Watchdog escalated');
  });
});

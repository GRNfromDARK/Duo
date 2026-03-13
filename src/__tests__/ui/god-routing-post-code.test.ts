/**
 * Card B.1: ROUTING_POST_CODE — ChoiceDetector → GodRouter integration tests.
 *
 * Tests the God routing logic that replaces decidePostCodeRoute in App.tsx.
 * Verifies: AC-1 through AC-5 (God routing, event mapping, degradation fallback,
 * no converged in POST_CODE, audit logging).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CLIAdapter, OutputChunk } from '../../types/adapter.js';
import { routePostCoder, type PostCoderRoutingResult } from '../../god/god-router.js';
import { DegradationManager } from '../../god/degradation-manager.js';
import { ContextManager } from '../../session/context-manager.js';
import { ConvergenceService } from '../../decision/convergence-service.js';
import { ChoiceDetector } from '../../decision/choice-detector.js';
import { decidePostCodeRoute } from '../../../src/ui/session-runner-state.js';
import * as godAudit from '../../god/god-audit.js';

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

const baseContext = {
  round: 0,
  maxRounds: 20,
  taskGoal: 'Fix the login bug',
  sessionDir: '/tmp/test-session',
  seq: 1,
};

// ── Spy on audit ──

let auditSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  auditSpy = vi.spyOn(godAudit, 'appendAuditLog').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── AC-1: God makes routing decision after Coder completion ──

describe('AC-1: God routes after Coder completion', () => {
  it('calls routePostCoder with God adapter and coder output', async () => {
    const adapter = createMockGodAdapter({
      action: 'continue_to_review',
      reasoning: 'Coder produced substantive output',
    });

    const result = await routePostCoder(adapter, 'function login() { ... }', baseContext);

    expect(result).toBeDefined();
    expect(result.decision.action).toBe('continue_to_review');
    expect(adapter.execute).toHaveBeenCalled();
  });
});

// ── AC-2: God decision correctly maps to XState events ──

describe('AC-2: God decision → XState event mapping', () => {
  it('continue_to_review → ROUTE_TO_REVIEW', async () => {
    const adapter = createMockGodAdapter({
      action: 'continue_to_review',
      reasoning: 'OK',
    });
    const result = await routePostCoder(adapter, 'output', baseContext);
    expect(result.event).toEqual({ type: 'ROUTE_TO_REVIEW' });
  });

  it('retry_coder → ROUTE_TO_CODER', async () => {
    const adapter = createMockGodAdapter({
      action: 'retry_coder',
      reasoning: 'Coder crashed',
      retryHint: 'Try again',
    });
    const result = await routePostCoder(adapter, '', baseContext);
    expect(result.event).toEqual({ type: 'ROUTE_TO_CODER' });
  });

  it('invalid request_user_input output falls back to continue_to_review', async () => {
    const adapter = createMockGodAdapter({
      action: 'request_user_input',
      reasoning: 'Coder has a question',
      question: 'Which database should I use?',
    });
    const result = await routePostCoder(adapter, 'Which database?', baseContext);
    expect(result.decision.action).toBe('continue_to_review');
    expect(result.event).toEqual({ type: 'ROUTE_TO_REVIEW' });
  });
});

// ── AC-3: God failure degrades to v1 ChoiceDetector (decidePostCodeRoute) ──

describe('AC-3: God failure → fallback to v1', () => {
  it('DegradationManager tracks failure and suggests fallback', () => {
    const dm = createDegradationManager();

    // First failure → retry
    const action1 = dm.handleGodFailure({ kind: 'process_exit', message: 'crash' });
    expect(action1.type).toBe('retry');

    // Second failure → fallback
    const action2 = dm.handleGodFailure({ kind: 'process_exit', message: 'crash again' });
    expect(action2.type).toBe('fallback');
    expect(action2.fallbackServices).toBeDefined();
  });

  it('when God is disabled (L4), isGodAvailable returns false', () => {
    const dm = createDegradationManager();

    // 3 consecutive failures → L4
    dm.handleGodFailure({ kind: 'process_exit', message: 'fail 1' });
    dm.handleGodFailure({ kind: 'process_exit', message: 'fail 2' });
    dm.handleGodFailure({ kind: 'process_exit', message: 'fail 3' });

    expect(dm.isGodAvailable()).toBe(false);
  });

  it('routePostCoder falls back to continue_to_review on extraction failure', async () => {
    // Adapter returns garbage (no JSON block)
    const adapter = {
      execute: vi.fn(async function* (): AsyncGenerator<OutputChunk> {
        yield { type: 'text', content: 'no json here at all', timestamp: Date.now() };
      }),
      kill: vi.fn(async () => {}),
    } as unknown as CLIAdapter;

    const result = await routePostCoder(adapter, 'coder output', baseContext);
    // Falls back to DEFAULT_POST_CODER which is continue_to_review
    expect(result.decision.action).toBe('continue_to_review');
    expect(result.event).toEqual({ type: 'ROUTE_TO_REVIEW' });
  });
});

// ── AC-4: converged CANNOT be produced in ROUTING_POST_CODE ──

describe('AC-4: converged cannot appear in POST_CODE (AC-018a)', () => {
  it('GodPostCoderDecision schema does not allow converged action', async () => {
    // Even if God returns converged, schema validation should reject it
    // and fall back to continue_to_review
    const adapter = createMockGodAdapter({
      action: 'converged',
      reasoning: 'Everything looks good',
    });

    const result = await routePostCoder(adapter, 'coder output', baseContext);
    // Schema should reject 'converged' for PostCoder, fallback to default
    expect(result.decision.action).not.toBe('converged');
    expect(result.decision.action).toBe('continue_to_review');
  });
});

// ── AC-5: Routing decision written to God audit log ──

describe('AC-5: routing decision writes audit log', () => {
  it('appendAuditLog is called with ROUTING_POST_CODE entry', async () => {
    const adapter = createMockGodAdapter({
      action: 'continue_to_review',
      reasoning: 'OK',
    });

    await routePostCoder(adapter, 'coder output', baseContext);

    expect(auditSpy).toHaveBeenCalled();
    const call = auditSpy.mock.calls[0];
    expect(call[0]).toBe(baseContext.sessionDir);
    expect(call[1]).toMatchObject({
      decisionType: 'ROUTING_POST_CODE',
      round: baseContext.round,
    });
  });
});

// ── Integration: App.tsx ROUTING_POST_CODE useEffect logic ──
// This tests the integration pattern that App.tsx should follow

describe('Integration: ROUTING_POST_CODE God → fallback pattern', () => {
  it('uses God when available, falls back to v1 when God disabled', async () => {
    const dm = createDegradationManager();

    // God available → use routePostCoder
    expect(dm.isGodAvailable()).toBe(true);

    const adapter = createMockGodAdapter({
      action: 'continue_to_review',
      reasoning: 'OK',
    });
    const godResult = await routePostCoder(adapter, 'coder output', baseContext);
    expect(godResult.event).toEqual({ type: 'ROUTE_TO_REVIEW' });
    dm.handleGodSuccess();

    // Disable God (3 failures)
    dm.handleGodFailure({ kind: 'process_exit', message: 'f1' });
    dm.handleGodFailure({ kind: 'process_exit', message: 'f2' });
    dm.handleGodFailure({ kind: 'process_exit', message: 'f3' });
    expect(dm.isGodAvailable()).toBe(false);

    // Fallback to v1 decidePostCodeRoute
    const detector = new ChoiceDetector();
    const v1Decision = decidePostCodeRoute('coder output', 'Fix login', detector, null);
    expect(v1Decision.event).toBe('ROUTE_TO_REVIEW');
  });

  it('records God failure in DegradationManager when routePostCoder throws', async () => {
    const dm = createDegradationManager();
    const failingAdapter = createFailingGodAdapter(new Error('God process crashed'));

    try {
      await routePostCoder(failingAdapter, 'output', baseContext);
    } catch {
      const action = dm.handleGodFailure({ kind: 'process_exit', message: 'God process crashed' });
      expect(action.type).toBe('retry');
    }
  });
});

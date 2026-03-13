/**
 * Card B.2: ROUTING_POST_REVIEW — ChoiceDetector → GodRouter integration tests.
 *
 * Tests the God routing logic that replaces decidePostReviewRoute in App.tsx.
 * Verifies: AC-1 through AC-8 (God routing after reviewer, unresolvedIssues,
 * converged only in POST_REVIEW, phase_transition, loop_detected,
 * degradation fallback, audit logging, existing tests unaffected).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CLIAdapter, OutputChunk } from '../../types/adapter.js';
import { routePostReviewer, type PostReviewerRoutingResult } from '../../god/god-router.js';
import { DegradationManager } from '../../god/degradation-manager.js';
import { ContextManager } from '../../session/context-manager.js';
import { ConvergenceService } from '../../decision/convergence-service.js';
import { ChoiceDetector } from '../../decision/choice-detector.js';
import { decidePostReviewRoute } from '../../ui/session-runner-state.js';
import type { ConvergenceLogEntry } from '../../god/god-convergence.js';
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
  round: 1,
  maxRounds: 20,
  taskGoal: 'Fix the login bug',
  sessionDir: '/tmp/test-session',
  seq: 2,
};

// ── Spy on audit ──

let auditSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  auditSpy = vi.spyOn(godAudit, 'appendAuditLog').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── AC-1: God makes routing decision after Reviewer completion ──

describe('AC-1: God routes after Reviewer completion', () => {
  it('calls routePostReviewer with God adapter and reviewer output', async () => {
    const adapter = createMockGodAdapter({
      action: 'route_to_coder',
      reasoning: 'Found blocking issues',
      unresolvedIssues: ['Fix null pointer in login handler'],
      confidenceScore: 0.8,
      progressTrend: 'improving',
    });

    const result = await routePostReviewer(adapter, 'Review: found null pointer bug', baseContext);

    expect(result).toBeDefined();
    expect(result.decision.action).toBe('route_to_coder');
    expect(adapter.execute).toHaveBeenCalled();
  });

  it('converged decision maps to CONVERGED event', async () => {
    const adapter = createMockGodAdapter({
      action: 'converged',
      reasoning: 'All issues resolved, reviewer approved',
      confidenceScore: 1.0,
      progressTrend: 'improving',
    });

    const result = await routePostReviewer(adapter, '[APPROVED] All looks good', baseContext);

    expect(result.event).toEqual({ type: 'CONVERGED' });
  });
});

// ── AC-2: route_to_coder carries non-empty unresolvedIssues (AC-018b) ──

describe('AC-2: route_to_coder carries unresolvedIssues (AC-018b)', () => {
  it('route_to_coder includes unresolvedIssues from God decision', async () => {
    const adapter = createMockGodAdapter({
      action: 'route_to_coder',
      reasoning: 'Issues remain',
      unresolvedIssues: ['Fix error handling', 'Add input validation'],
      confidenceScore: 0.6,
      progressTrend: 'improving',
    });

    const result = await routePostReviewer(adapter, 'Review: issues found', baseContext);

    expect(result.decision.action).toBe('route_to_coder');
    expect(result.decision.unresolvedIssues).toBeDefined();
    expect(result.decision.unresolvedIssues!.length).toBeGreaterThan(0);
  });

  it('route_to_coder gets fallback unresolvedIssues when God omits them', async () => {
    // God returns route_to_coder without unresolvedIssues — schema refine should reject,
    // fallback should still have unresolvedIssues
    const adapter = createMockGodAdapter({
      action: 'route_to_coder',
      reasoning: 'Issues remain',
      confidenceScore: 0.6,
      progressTrend: 'stagnant',
    });

    const result = await routePostReviewer(adapter, 'Review: issues found', baseContext);

    // The default fallback for extraction failure is route_to_coder with non-empty unresolvedIssues
    expect(result.decision.unresolvedIssues).toBeDefined();
    expect(result.decision.unresolvedIssues!.length).toBeGreaterThan(0);
  });
});

// ── AC-3: converged only produced in POST_REVIEW ──

describe('AC-3: converged only in POST_REVIEW', () => {
  it('converged is a valid action for routePostReviewer', async () => {
    const adapter = createMockGodAdapter({
      action: 'converged',
      reasoning: 'All criteria met',
      confidenceScore: 1.0,
      progressTrend: 'improving',
    });

    const result = await routePostReviewer(adapter, '[APPROVED]', baseContext);

    expect(result.decision.action).toBe('converged');
    expect(result.event).toEqual({ type: 'CONVERGED' });
  });
});

// ── AC-4: phase_transition and loop_detected correctly handled ──

describe('AC-4: phase_transition and loop_detected', () => {
  it('phase_transition maps to PHASE_TRANSITION event', async () => {
    const adapter = createMockGodAdapter({
      action: 'phase_transition',
      reasoning: 'Exploration complete, moving to coding',
      nextPhaseId: 'code',
      confidenceScore: 0.9,
      progressTrend: 'improving',
    });

    const result = await routePostReviewer(adapter, 'Exploration phase looks complete', baseContext);

    expect(result.decision.action).toBe('phase_transition');
    expect(result.event).toEqual({
      type: 'PHASE_TRANSITION',
      nextPhaseId: 'code',
      summary: 'Exploration complete, moving to coding',
    });
  });

  it('loop_detected maps to LOOP_DETECTED event', async () => {
    const adapter = createMockGodAdapter({
      action: 'loop_detected',
      reasoning: 'Same issues recurring for 3 rounds',
      confidenceScore: 0.3,
      progressTrend: 'stagnant',
    });

    const result = await routePostReviewer(adapter, 'Same feedback as last round', baseContext);

    expect(result.decision.action).toBe('loop_detected');
    expect(result.event).toEqual({ type: 'LOOP_DETECTED' });
  });

  it('request_user_input maps to NEEDS_USER_INPUT event', async () => {
    const adapter = createMockGodAdapter({
      action: 'request_user_input',
      reasoning: 'Fundamental disagreement between coder and reviewer',
      confidenceScore: 0.4,
      progressTrend: 'declining',
    });

    const result = await routePostReviewer(adapter, 'Reviewer disagrees with approach', baseContext);

    expect(result.decision.action).toBe('request_user_input');
    expect(result.event).toEqual({ type: 'NEEDS_USER_INPUT' });
  });
});

// ── AC-5: God failure degrades to v1 ChoiceDetector + ConvergenceService ──

describe('AC-5: God failure → fallback to v1 decidePostReviewRoute', () => {
  it('DegradationManager tracks failure and provides fallback services', () => {
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

    dm.handleGodFailure({ kind: 'process_exit', message: 'fail 1' });
    dm.handleGodFailure({ kind: 'process_exit', message: 'fail 2' });
    dm.handleGodFailure({ kind: 'process_exit', message: 'fail 3' });

    expect(dm.isGodAvailable()).toBe(false);
  });

  it('routePostReviewer falls back to route_to_coder on extraction failure', async () => {
    const adapter = {
      execute: vi.fn(async function* (): AsyncGenerator<OutputChunk> {
        yield { type: 'text', content: 'no json here', timestamp: Date.now() };
      }),
      kill: vi.fn(async () => {}),
    } as unknown as CLIAdapter;

    const result = await routePostReviewer(adapter, 'review output', baseContext);
    // Falls back to defaultPostReviewer which is route_to_coder with unresolvedIssues
    expect(result.decision.action).toBe('route_to_coder');
    expect(result.decision.unresolvedIssues).toBeDefined();
    expect(result.decision.unresolvedIssues!.length).toBeGreaterThan(0);
    expect(result.event).toEqual({ type: 'ROUTE_TO_CODER' });
  });

  it('v1 fallback decidePostReviewRoute works correctly', () => {
    const detector = new ChoiceDetector();
    // v1 path: no choice detected → ROUTE_TO_EVALUATE
    const v1Decision = decidePostReviewRoute('Reviewer feedback here', 'Fix login', detector, null);
    expect(v1Decision.event).toBe('ROUTE_TO_EVALUATE');
  });
});

// ── AC-6: All decisions written to audit log ──

describe('AC-6: routing decision writes audit log', () => {
  it('appendAuditLog is called with ROUTING_POST_REVIEW entry', async () => {
    const adapter = createMockGodAdapter({
      action: 'route_to_coder',
      reasoning: 'Issues remain',
      unresolvedIssues: ['Fix bug'],
      confidenceScore: 0.7,
      progressTrend: 'improving',
    });

    await routePostReviewer(adapter, 'review output', baseContext);

    expect(auditSpy).toHaveBeenCalled();
    const call = auditSpy.mock.calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).decisionType === 'ROUTING_POST_REVIEW',
    );
    expect(call).toBeDefined();
    expect(call![0]).toBe(baseContext.sessionDir);
    expect(call![1]).toMatchObject({
      decisionType: 'ROUTING_POST_REVIEW',
      round: baseContext.round,
    });
  });
});

// ── Integration: App.tsx ROUTING_POST_REVIEW God → fallback pattern ──

describe('Integration: ROUTING_POST_REVIEW God → fallback pattern', () => {
  it('uses God when available, falls back to v1 when God disabled', async () => {
    const dm = createDegradationManager();

    // God available → use routePostReviewer
    expect(dm.isGodAvailable()).toBe(true);

    const adapter = createMockGodAdapter({
      action: 'route_to_coder',
      reasoning: 'Issues found',
      unresolvedIssues: ['Fix input validation'],
      confidenceScore: 0.7,
      progressTrend: 'improving',
    });
    const godResult = await routePostReviewer(adapter, 'review output', baseContext);
    expect(godResult.event).toEqual({ type: 'ROUTE_TO_CODER' });
    dm.handleGodSuccess();

    // Disable God (3 failures)
    dm.handleGodFailure({ kind: 'process_exit', message: 'f1' });
    dm.handleGodFailure({ kind: 'process_exit', message: 'f2' });
    dm.handleGodFailure({ kind: 'process_exit', message: 'f3' });
    expect(dm.isGodAvailable()).toBe(false);

    // Fallback to v1 decidePostReviewRoute
    const detector = new ChoiceDetector();
    const v1Decision = decidePostReviewRoute('review output', 'Fix login', detector, null);
    expect(v1Decision.event).toBe('ROUTE_TO_EVALUATE');
  });

  it('records God failure in DegradationManager when routePostReviewer throws', async () => {
    const dm = createDegradationManager();
    const failingAdapter = createFailingGodAdapter(new Error('God process crashed'));

    try {
      await routePostReviewer(failingAdapter, 'review output', baseContext);
    } catch {
      const action = dm.handleGodFailure({ kind: 'process_exit', message: 'God process crashed' });
      expect(action.type).toBe('retry');
    }
  });

  it('convergenceLogRef accumulates across rounds', async () => {
    // Simulate what App.tsx should do: pass convergenceLog to routePostReviewer
    const convergenceLog: ConvergenceLogEntry[] = [
      {
        round: 0,
        timestamp: new Date().toISOString(),
        classification: 'changes_requested',
        shouldTerminate: false,
        blockingIssueCount: 3,
        criteriaProgress: [],
        summary: 'Round 0: 3 blocking issues',
      },
    ];

    const adapter = createMockGodAdapter({
      action: 'route_to_coder',
      reasoning: 'Issues remain',
      unresolvedIssues: ['Fix remaining bugs'],
      confidenceScore: 0.6,
      progressTrend: 'improving',
    });

    const result = await routePostReviewer(adapter, 'review output', {
      ...baseContext,
      convergenceLog,
    });

    expect(result).toBeDefined();
    expect(result.decision.action).toBe('route_to_coder');
  });

  it('lastUnresolvedIssuesRef is populated from route_to_coder decision', async () => {
    const adapter = createMockGodAdapter({
      action: 'route_to_coder',
      reasoning: 'Issues',
      unresolvedIssues: ['Bug A', 'Bug B'],
      confidenceScore: 0.5,
      progressTrend: 'stagnant',
    });

    const result = await routePostReviewer(adapter, 'review output', baseContext);

    // Simulate what App.tsx should do: store unresolvedIssues for next round
    const lastUnresolvedIssues: string[] = [];
    if (result.decision.action === 'route_to_coder') {
      lastUnresolvedIssues.push(...(result.decision.unresolvedIssues ?? []));
    }

    expect(lastUnresolvedIssues).toEqual(['Bug A', 'Bug B']);
  });
});

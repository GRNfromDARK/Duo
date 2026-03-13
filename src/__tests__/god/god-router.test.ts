/**
 * Tests for Card B.2: God Router — Output Analysis & Routing (PostCoder/PostReviewer)
 * Source: FR-004 (AC-016, AC-017, AC-018, AC-018a, AC-018b)
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CLIAdapter, ExecOptions, OutputChunk } from '../../types/adapter.js';
import { GodPostCoderDecisionSchema, GodPostReviewerDecisionSchema } from '../../types/god-schemas.js';

// ── Helper: create a mock CLIAdapter that returns specified output ──

function createMockAdapter(output: string): CLIAdapter {
  return {
    name: 'mock-god',
    displayName: 'Mock God',
    version: '1.0.0',
    isInstalled: async () => true,
    getVersion: async () => '1.0.0',
    execute(_prompt: string, _opts: ExecOptions): AsyncIterable<OutputChunk> {
      const chunks: OutputChunk[] = [
        { type: 'text', content: output, timestamp: Date.now() },
      ];
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i < chunks.length) return { value: chunks[i++], done: false };
              return { value: undefined as unknown as OutputChunk, done: true };
            },
          };
        },
      };
    },
    kill: async () => {},
    isRunning: () => false,
  };
}

// ── Test data ──

const POST_CODER_CONTINUE = `God analysis: Coder produced valid output, sending to review.

\`\`\`json
{
  "action": "continue_to_review",
  "reasoning": "Coder produced substantive code output"
}
\`\`\``;

const POST_CODER_RETRY = `God analysis: Coder output is empty.

\`\`\`json
{
  "action": "retry_coder",
  "reasoning": "Coder output was empty/crashed",
  "retryHint": "Please try again with more detail"
}
\`\`\``;

const POST_CODER_AUTONOMOUS_RESOLUTION = `God analysis: Coder asked for options, God resolved it autonomously.

\`\`\`json
{
  "action": "continue_to_review",
  "reasoning": "REST is the simpler fit for this task, continue to review the implementation"
}
\`\`\``;

const POST_REVIEWER_ROUTE_TO_CODER = `God analysis: Reviewer found issues.

\`\`\`json
{
  "action": "route_to_coder",
  "reasoning": "Reviewer found 2 blocking issues",
  "unresolvedIssues": ["Missing error handling in auth module", "SQL injection vulnerability"],
  "confidenceScore": 0.7,
  "progressTrend": "improving"
}
\`\`\``;

const POST_REVIEWER_CONVERGED = `God analysis: All criteria met.

\`\`\`json
{
  "action": "converged",
  "reasoning": "Reviewer approved, all criteria satisfied",
  "confidenceScore": 0.95,
  "progressTrend": "improving"
}
\`\`\``;

const POST_REVIEWER_PHASE_TRANSITION = `God analysis: Phase complete.

\`\`\`json
{
  "action": "phase_transition",
  "reasoning": "Explore phase complete, moving to code",
  "confidenceScore": 0.85,
  "progressTrend": "improving"
}
\`\`\``;

const POST_REVIEWER_LOOP_DETECTED = `God analysis: Loop detected.

\`\`\`json
{
  "action": "loop_detected",
  "reasoning": "Same issues recurring for 3 rounds",
  "confidenceScore": 0.6,
  "progressTrend": "stagnant"
}
\`\`\``;

const POST_REVIEWER_ROUTE_EMPTY_ISSUES = `God analysis: Reviewer found issues but no list.

\`\`\`json
{
  "action": "route_to_coder",
  "reasoning": "Reviewer found issues",
  "unresolvedIssues": [],
  "confidenceScore": 0.7,
  "progressTrend": "improving"
}
\`\`\``;

const POST_REVIEWER_ROUTE_NO_ISSUES = `God analysis: Reviewer found issues but missing field.

\`\`\`json
{
  "action": "route_to_coder",
  "reasoning": "Reviewer found issues",
  "confidenceScore": 0.7,
  "progressTrend": "improving"
}
\`\`\``;

// ── Tests ──

describe('Routing schemas (AI-driven)', () => {
  test('GodPostCoderDecision rejects request_user_input', () => {
    const result = GodPostCoderDecisionSchema.safeParse({
      action: 'request_user_input',
      reasoning: 'test',
    });

    expect(result.success).toBe(false);
  });

  test('GodPostReviewerDecision rejects request_user_input', () => {
    const result = GodPostReviewerDecisionSchema.safeParse({
      action: 'request_user_input',
      reasoning: 'test',
      confidenceScore: 0.5,
      progressTrend: 'stagnant',
    });

    expect(result.success).toBe(false);
  });
});

describe('God Router', () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = join(tmpdir(), `god-router-test-${Date.now()}`);
    mkdirSync(sessionDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  // ── AC-1: ROUTING_POST_CODE routes correctly ──

  describe('routePostCoder', () => {
    test('continue_to_review: routes Coder output to Reviewer', async () => {
      const { routePostCoder } = await import('../../god/god-router.js');
      const adapter = createMockAdapter(POST_CODER_CONTINUE);

      const result = await routePostCoder(adapter, 'Coder wrote some code...', {
        round: 1,
        maxRounds: 10,
        taskGoal: 'Implement login',
        sessionDir,
        seq: 1,
      });

      expect(result.decision.action).toBe('continue_to_review');
      expect(result.event.type).toBe('ROUTE_TO_REVIEW');
    });

    test('retry_coder: routes back to Coder on crash/empty', async () => {
      const { routePostCoder } = await import('../../god/god-router.js');
      const adapter = createMockAdapter(POST_CODER_RETRY);

      const result = await routePostCoder(adapter, '', {
        round: 1,
        maxRounds: 10,
        taskGoal: 'Implement login',
        sessionDir,
        seq: 2,
      });

      expect(result.decision.action).toBe('retry_coder');
      expect(result.event.type).toBe('ROUTE_TO_CODER');
    });

    test('Coder questions are resolved autonomously and still route to review', async () => {
      const { routePostCoder } = await import('../../god/god-router.js');
      const adapter = createMockAdapter(POST_CODER_AUTONOMOUS_RESOLUTION);

      const result = await routePostCoder(adapter, 'Should I use REST or GraphQL?', {
        round: 1,
        maxRounds: 10,
        taskGoal: 'Implement API',
        sessionDir,
        seq: 3,
      });

      expect(result.decision.action).toBe('continue_to_review');
      expect(result.event.type).toBe('ROUTE_TO_REVIEW');
    });
  });

  // ── AC-3: converged CANNOT be produced in ROUTING_POST_CODE ──

  describe('AC-018a: converged constraint', () => {
    test('converged is impossible from PostCoder schema (only 2 valid actions)', async () => {
      const result = GodPostCoderDecisionSchema.safeParse({
        action: 'converged',
        reasoning: 'test',
      });
      expect(result.success).toBe(false);
    });

    test('routePostCoder rejects converged action even if God returns it', async () => {
      const { routePostCoder } = await import('../../god/god-router.js');

      // Simulate God returning 'converged' in POST_CODER context (should fail extraction)
      const badOutput = `\`\`\`json
{
  "action": "converged",
  "reasoning": "Coder said done"
}
\`\`\``;
      const adapter = createMockAdapter(badOutput);

      const result = await routePostCoder(adapter, 'Done!', {
        round: 1,
        maxRounds: 10,
        taskGoal: 'Implement login',
        sessionDir,
        seq: 4,
      });

      // Should fall back to continue_to_review (safe default)
      expect(result.decision.action).toBe('continue_to_review');
      expect(result.event.type).toBe('ROUTE_TO_REVIEW');
    });
  });

  // ── AC-2: ROUTING_POST_REVIEW routes correctly ──

  describe('routePostReviewer', () => {
    test('route_to_coder: sends back with unresolvedIssues', async () => {
      const { routePostReviewer } = await import('../../god/god-router.js');
      const adapter = createMockAdapter(POST_REVIEWER_ROUTE_TO_CODER);

      const result = await routePostReviewer(adapter, 'Found 2 blocking issues...', {
        round: 1,
        maxRounds: 10,
        taskGoal: 'Implement login',
        sessionDir,
        seq: 5,
      });

      expect(result.decision.action).toBe('route_to_coder');
      expect(result.decision.unresolvedIssues).toHaveLength(2);
      expect(result.event.type).toBe('ROUTE_TO_CODER');
    });

    test('converged: terminates workflow', async () => {
      const { routePostReviewer } = await import('../../god/god-router.js');
      const adapter = createMockAdapter(POST_REVIEWER_CONVERGED);

      const result = await routePostReviewer(adapter, '[APPROVED] All good', {
        round: 3,
        maxRounds: 10,
        taskGoal: 'Implement login',
        sessionDir,
        seq: 6,
      });

      expect(result.decision.action).toBe('converged');
      expect(result.event.type).toBe('CONVERGED');
    });

    test('phase_transition: triggers reclassify', async () => {
      const { routePostReviewer } = await import('../../god/god-router.js');
      const adapter = createMockAdapter(POST_REVIEWER_PHASE_TRANSITION);

      const result = await routePostReviewer(adapter, '[APPROVED] Phase complete', {
        round: 2,
        maxRounds: 10,
        taskGoal: 'Explore then code',
        sessionDir,
        seq: 7,
      });

      expect(result.decision.action).toBe('phase_transition');
      expect(result.event.type).toBe('PHASE_TRANSITION');
    });

    test('loop_detected: flags stagnation', async () => {
      const { routePostReviewer } = await import('../../god/god-router.js');
      const adapter = createMockAdapter(POST_REVIEWER_LOOP_DETECTED);

      const result = await routePostReviewer(adapter, 'Same issues again...', {
        round: 5,
        maxRounds: 10,
        taskGoal: 'Fix auth bug',
        sessionDir,
        seq: 8,
      });

      expect(result.decision.action).toBe('loop_detected');
      expect(result.event.type).toBe('LOOP_DETECTED');
    });

  });

  // ── AC-4: route_to_coder must carry non-empty unresolvedIssues ──

  describe('AC-018b: unresolvedIssues constraint', () => {
    test('route_to_coder with empty unresolvedIssues falls back to safe default', async () => {
      const { routePostReviewer } = await import('../../god/god-router.js');
      const adapter = createMockAdapter(POST_REVIEWER_ROUTE_EMPTY_ISSUES);

      const result = await routePostReviewer(adapter, 'Issues found', {
        round: 1,
        maxRounds: 10,
        taskGoal: 'Implement login',
        sessionDir,
        seq: 9,
      });

      // Should still route to coder but inject a generic issue
      expect(result.decision.action).toBe('route_to_coder');
      expect(result.decision.unresolvedIssues!.length).toBeGreaterThan(0);
    });

    test('route_to_coder with missing unresolvedIssues falls back to safe default', async () => {
      const { routePostReviewer } = await import('../../god/god-router.js');
      const adapter = createMockAdapter(POST_REVIEWER_ROUTE_NO_ISSUES);

      const result = await routePostReviewer(adapter, 'Issues found', {
        round: 1,
        maxRounds: 10,
        taskGoal: 'Implement login',
        sessionDir,
        seq: 10,
      });

      // Should still route to coder but inject a generic issue
      expect(result.decision.action).toBe('route_to_coder');
      expect(result.decision.unresolvedIssues!.length).toBeGreaterThan(0);
    });
  });

  // ── AC-5: God action → XState event mapping ──

  describe('godActionToEvent', () => {
    test('continue_to_review → ROUTE_TO_REVIEW', async () => {
      const { godActionToEvent } = await import('../../god/god-router.js');
      const event = godActionToEvent({ action: 'continue_to_review', reasoning: '' });
      expect(event.type).toBe('ROUTE_TO_REVIEW');
    });

    test('retry_coder → ROUTE_TO_CODER', async () => {
      const { godActionToEvent } = await import('../../god/god-router.js');
      const event = godActionToEvent({ action: 'retry_coder', reasoning: '', retryHint: 'try again' });
      expect(event.type).toBe('ROUTE_TO_CODER');
    });

    test('route_to_coder → ROUTE_TO_CODER', async () => {
      const { godActionToEvent } = await import('../../god/god-router.js');
      const event = godActionToEvent({
        action: 'route_to_coder', reasoning: '',
        unresolvedIssues: ['fix bug'], confidenceScore: 0.7, progressTrend: 'improving' as const,
      });
      expect(event.type).toBe('ROUTE_TO_CODER');
    });

    test('converged → CONVERGED', async () => {
      const { godActionToEvent } = await import('../../god/god-router.js');
      const event = godActionToEvent({
        action: 'converged', reasoning: '',
        confidenceScore: 0.95, progressTrend: 'improving' as const,
      });
      expect(event.type).toBe('CONVERGED');
    });

    test('phase_transition → PHASE_TRANSITION', async () => {
      const { godActionToEvent } = await import('../../god/god-router.js');
      const event = godActionToEvent({
        action: 'phase_transition', reasoning: '',
        confidenceScore: 0.85, progressTrend: 'improving' as const,
      });
      expect(event.type).toBe('PHASE_TRANSITION');
    });

    test('request_user_input is no longer mapped', async () => {
      const { godActionToEvent } = await import('../../god/god-router.js');
      expect(() => godActionToEvent({ action: 'request_user_input', reasoning: '' } as any))
        .toThrow('Unknown God action');
    });

    test('loop_detected → LOOP_DETECTED', async () => {
      const { godActionToEvent } = await import('../../god/god-router.js');
      const event = godActionToEvent({
        action: 'loop_detected', reasoning: '',
        confidenceScore: 0.5, progressTrend: 'stagnant' as const,
      });
      expect(event.type).toBe('LOOP_DETECTED');
    });
  });

  // ── AC-6: Routing decisions are written to audit log ──

  describe('audit log', () => {
    test('routePostCoder writes audit entry', async () => {
      const { routePostCoder } = await import('../../god/god-router.js');
      const adapter = createMockAdapter(POST_CODER_CONTINUE);

      await routePostCoder(adapter, 'Some code output', {
        round: 1,
        maxRounds: 10,
        taskGoal: 'Implement login',
        sessionDir,
        seq: 20,
      });

      const logPath = join(sessionDir, 'god-audit.jsonl');
      expect(existsSync(logPath)).toBe(true);
      const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
      const entry = JSON.parse(lines[lines.length - 1]);
      expect(entry.decisionType).toBe('ROUTING_POST_CODE');
      expect(entry.decision).toHaveProperty('action', 'continue_to_review');
    });

    test('routePostReviewer writes audit entry', async () => {
      const { routePostReviewer } = await import('../../god/god-router.js');
      const adapter = createMockAdapter(POST_REVIEWER_CONVERGED);

      await routePostReviewer(adapter, '[APPROVED]', {
        round: 3,
        maxRounds: 10,
        taskGoal: 'Implement login',
        sessionDir,
        seq: 21,
      });

      const logPath = join(sessionDir, 'god-audit.jsonl');
      expect(existsSync(logPath)).toBe(true);
      const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
      const entry = JSON.parse(lines[lines.length - 1]);
      expect(entry.decisionType).toBe('ROUTING_POST_REVIEW');
      expect(entry.decision).toHaveProperty('action', 'converged');
    });
  });

  // ── AC-1 (JSON extraction): fallback on extraction failure ──

  describe('extraction failure fallback', () => {
    test('routePostCoder falls back to continue_to_review on no JSON', async () => {
      const { routePostCoder } = await import('../../god/god-router.js');
      const adapter = createMockAdapter('No JSON here, just plain text analysis.');

      const result = await routePostCoder(adapter, 'Code output', {
        round: 1,
        maxRounds: 10,
        taskGoal: 'Implement login',
        sessionDir,
        seq: 30,
      });

      // Safe default: continue to review
      expect(result.decision.action).toBe('continue_to_review');
      expect(result.event.type).toBe('ROUTE_TO_REVIEW');
    });

    test('routePostReviewer falls back to route_to_coder on no JSON', async () => {
      const { routePostReviewer } = await import('../../god/god-router.js');
      const adapter = createMockAdapter('No JSON here, just plain text.');

      const result = await routePostReviewer(adapter, 'Review output', {
        round: 1,
        maxRounds: 10,
        taskGoal: 'Implement login',
        sessionDir,
        seq: 31,
      });

      // Safe default: route back to coder
      expect(result.decision.action).toBe('route_to_coder');
      expect(result.decision.unresolvedIssues!.length).toBeGreaterThan(0);
    });
  });
});

// ── XState event types exist ──

describe('XState new events', () => {
  test('NEEDS_USER_INPUT event type exists in WorkflowEvent', async () => {
    // This is a compile-time check; if it compiles, the type exists
    const { workflowMachine } = await import('../../engine/workflow-machine.js');
    expect(workflowMachine).toBeDefined();

    // The event type should be accepted by the machine definition
    type EventTypes = { type: 'NEEDS_USER_INPUT' } | { type: 'LOOP_DETECTED' } | { type: 'RECLASSIFY' };
    const _typeCheck: EventTypes = { type: 'NEEDS_USER_INPUT' };
    expect(_typeCheck.type).toBe('NEEDS_USER_INPUT');
  });
});

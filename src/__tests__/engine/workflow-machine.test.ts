import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import {
  workflowMachine,
  type WorkflowContext,
} from '../../engine/workflow-machine.js';

/** Helper: create an actor and start it */
function startActor(context?: Partial<WorkflowContext>) {
  const machine = context
    ? workflowMachine.provide({
        // Override initial context via input
      })
    : workflowMachine;
  const actor = createActor(machine, {
    input: context,
  });
  actor.start();
  return actor;
}

/** Helper: send START_TASK and skip TASK_INIT (for tests that don't need TASK_INIT behavior) */
function sendStartAndSkipInit(actor: ReturnType<typeof startActor>, prompt: string) {
  actor.send({ type: 'START_TASK', prompt });
  actor.send({ type: 'TASK_INIT_SKIP' });
}

describe('WorkflowMachine', () => {
  // ──────────────────────────────────────────────
  // AC-1: State machine definition compiles, all states/events/guards correct
  // ──────────────────────────────────────────────
  describe('AC-1: definition correctness', () => {
    it('should start in IDLE state', () => {
      const actor = startActor();
      expect(actor.getSnapshot().value).toBe('IDLE');
      actor.stop();
    });

    it('should have correct initial context', () => {
      const actor = startActor();
      const ctx = actor.getSnapshot().context;
      expect(ctx.round).toBe(0);
      expect(ctx.maxRounds).toBe(10);
      expect(ctx.activeProcess).toBeNull();
      expect(ctx.lastError).toBeNull();
      actor.stop();
    });

    it('should accept custom maxRounds via input', () => {
      const actor = startActor({ maxRounds: 5 });
      expect(actor.getSnapshot().context.maxRounds).toBe(5);
      actor.stop();
    });
  });

  // ──────────────────────────────────────────────
  // AC-2: Normal flow IDLE → CODING → REVIEWING → EVALUATING → CODING (loop)
  // ──────────────────────────────────────────────
  describe('AC-2: normal flow', () => {
    it('IDLE → TASK_INIT → CODING on START_TASK + TASK_INIT_SKIP', () => {
      const actor = startActor();
      actor.send({ type: 'START_TASK', prompt: 'build feature X' });
      expect(actor.getSnapshot().value).toBe('TASK_INIT');
      actor.send({ type: 'TASK_INIT_SKIP' });
      expect(actor.getSnapshot().value).toBe('CODING');
      expect(actor.getSnapshot().context.taskPrompt).toBe('build feature X');
      actor.stop();
    });

    it('CODING → ROUTING_POST_CODE on CODE_COMPLETE', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done coding' });
      expect(actor.getSnapshot().value).toBe('ROUTING_POST_CODE');
      actor.stop();
    });

    it('ROUTING_POST_CODE → REVIEWING on ROUTE_TO_REVIEW', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done coding' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      expect(actor.getSnapshot().value).toBe('REVIEWING');
      actor.stop();
    });

    it('ROUTING_POST_CODE → WAITING_USER on CHOICE_DETECTED', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done coding' });
      actor.send({ type: 'CHOICE_DETECTED', choices: ['A', 'B'] });
      expect(actor.getSnapshot().value).toBe('WAITING_USER');
      actor.stop();
    });

    it('REVIEWING → ROUTING_POST_REVIEW on REVIEW_COMPLETE', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'looks good' });
      expect(actor.getSnapshot().value).toBe('ROUTING_POST_REVIEW');
      actor.stop();
    });

    it('ROUTING_POST_REVIEW → EVALUATING on ROUTE_TO_EVALUATE', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'looks good' });
      actor.send({ type: 'ROUTE_TO_EVALUATE' });
      expect(actor.getSnapshot().value).toBe('EVALUATING');
      actor.stop();
    });

    it('ROUTING_POST_REVIEW → CODING on ROUTE_TO_CODER', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'fix this' });
      actor.send({ type: 'ROUTE_TO_CODER' });
      expect(actor.getSnapshot().value).toBe('CODING');
      actor.stop();
    });

    it('EVALUATING → CODING on NOT_CONVERGED (round < maxRounds)', () => {
      const actor = startActor({ maxRounds: 10 });
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'ok' });
      actor.send({ type: 'ROUTE_TO_EVALUATE' });
      actor.send({ type: 'NOT_CONVERGED' });
      expect(actor.getSnapshot().value).toBe('CODING');
      expect(actor.getSnapshot().context.round).toBe(1);
      actor.stop();
    });

    it('EVALUATING → WAITING_USER on CONVERGED', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'ok' });
      actor.send({ type: 'ROUTE_TO_EVALUATE' });
      actor.send({ type: 'CONVERGED' });
      expect(actor.getSnapshot().value).toBe('WAITING_USER');
      actor.stop();
    });

    it('EVALUATING → WAITING_USER on NOT_CONVERGED when maxRounds reached', () => {
      const actor = startActor({ maxRounds: 1, round: 1 });
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'ok' });
      actor.send({ type: 'ROUTE_TO_EVALUATE' });
      actor.send({ type: 'NOT_CONVERGED' });
      expect(actor.getSnapshot().value).toBe('WAITING_USER');
      actor.stop();
    });

    it('WAITING_USER → CODING on USER_CONFIRM continue', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'ok' });
      actor.send({ type: 'ROUTE_TO_EVALUATE' });
      actor.send({ type: 'CONVERGED' });
      actor.send({ type: 'USER_CONFIRM', action: 'continue' });
      expect(actor.getSnapshot().value).toBe('CODING');
      actor.stop();
    });

    it('WAITING_USER → DONE on USER_CONFIRM accept', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'ok' });
      actor.send({ type: 'ROUTE_TO_EVALUATE' });
      actor.send({ type: 'CONVERGED' });
      actor.send({ type: 'USER_CONFIRM', action: 'accept' });
      expect(actor.getSnapshot().value).toBe('DONE');
      actor.stop();
    });

    it('full loop: IDLE → TASK_INIT → CODING → REVIEWING → EVALUATING → CODING → ... → DONE', () => {
      const actor = startActor();

      // Round 1
      actor.send({ type: 'START_TASK', prompt: 'build it' });
      expect(actor.getSnapshot().value).toBe('TASK_INIT');
      actor.send({ type: 'TASK_INIT_SKIP' });
      expect(actor.getSnapshot().value).toBe('CODING');

      actor.send({ type: 'CODE_COMPLETE', output: 'v1' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      expect(actor.getSnapshot().value).toBe('REVIEWING');

      actor.send({ type: 'REVIEW_COMPLETE', output: 'needs fix' });
      actor.send({ type: 'ROUTE_TO_EVALUATE' });
      expect(actor.getSnapshot().value).toBe('EVALUATING');

      actor.send({ type: 'NOT_CONVERGED' });
      expect(actor.getSnapshot().value).toBe('CODING');
      expect(actor.getSnapshot().context.round).toBe(1);

      // Round 2
      actor.send({ type: 'CODE_COMPLETE', output: 'v2' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'good' });
      actor.send({ type: 'ROUTE_TO_EVALUATE' });
      actor.send({ type: 'CONVERGED' });
      expect(actor.getSnapshot().value).toBe('WAITING_USER');

      actor.send({ type: 'USER_CONFIRM', action: 'accept' });
      expect(actor.getSnapshot().value).toBe('DONE');
      expect(actor.getSnapshot().context.round).toBe(1);

      actor.stop();
    });
  });

  // ──────────────────────────────────────────────
  // AC-3: Serialization/deserialization roundtrip
  // ──────────────────────────────────────────────
  describe('AC-3: serialization roundtrip', () => {
    it('should serialize and restore state correctly', () => {
      const actor1 = startActor();
      sendStartAndSkipInit(actor1, 'serialize test');
      actor1.send({ type: 'CODE_COMPLETE', output: 'v1' });
      actor1.send({ type: 'ROUTE_TO_REVIEW' });

      // Serialize
      const snapshot = actor1.getPersistedSnapshot();
      actor1.stop();

      // Restore
      const actor2 = createActor(workflowMachine, {
        snapshot,
        input: {},
      });
      actor2.start();

      expect(actor2.getSnapshot().value).toBe('REVIEWING');
      expect(actor2.getSnapshot().context.taskPrompt).toBe('serialize test');

      // Continue from restored state
      actor2.send({ type: 'REVIEW_COMPLETE', output: 'ok' });
      actor2.send({ type: 'ROUTE_TO_EVALUATE' });
      expect(actor2.getSnapshot().value).toBe('EVALUATING');

      actor2.stop();
    });

    it('should preserve context through serialization', () => {
      const actor1 = startActor({ maxRounds: 3 });
      sendStartAndSkipInit(actor1, 'ctx test');
      actor1.send({ type: 'CODE_COMPLETE', output: 'v1' });
      actor1.send({ type: 'ROUTE_TO_REVIEW' });
      actor1.send({ type: 'REVIEW_COMPLETE', output: 'fix' });
      actor1.send({ type: 'ROUTE_TO_EVALUATE' });
      actor1.send({ type: 'NOT_CONVERGED' });

      const snapshot = actor1.getPersistedSnapshot();
      actor1.stop();

      const actor2 = createActor(workflowMachine, { snapshot, input: {} });
      actor2.start();

      expect(actor2.getSnapshot().context.round).toBe(1);
      expect(actor2.getSnapshot().context.maxRounds).toBe(3);
      expect(actor2.getSnapshot().context.taskPrompt).toBe('ctx test');
      expect(actor2.getSnapshot().value).toBe('CODING');

      actor2.stop();
    });
  });

  // ──────────────────────────────────────────────
  // AC-4: Only 1 LLM process at a time (concurrency safety)
  // ──────────────────────────────────────────────
  describe('AC-4: concurrency safety', () => {
    it('should track active process: set in CODING, clear on CODE_COMPLETE', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      expect(actor.getSnapshot().context.activeProcess).toBe('coder');

      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      expect(actor.getSnapshot().context.activeProcess).toBeNull();
      actor.stop();
    });

    it('should track active process: set in REVIEWING, clear on REVIEW_COMPLETE', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      expect(actor.getSnapshot().context.activeProcess).toBe('reviewer');

      actor.send({ type: 'REVIEW_COMPLETE', output: 'ok' });
      expect(actor.getSnapshot().context.activeProcess).toBeNull();
      actor.stop();
    });

    it('should not allow START_TASK when already in CODING', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'first');
      expect(actor.getSnapshot().value).toBe('CODING');

      // Sending START_TASK again should be ignored (no valid transition)
      actor.send({ type: 'START_TASK', prompt: 'second' });
      expect(actor.getSnapshot().value).toBe('CODING');
      expect(actor.getSnapshot().context.taskPrompt).toBe('first');
      actor.stop();
    });

    it('activeProcess is null in routing/evaluating states', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      expect(actor.getSnapshot().context.activeProcess).toBeNull();
      expect(actor.getSnapshot().value).toBe('ROUTING_POST_CODE');

      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'ok' });
      expect(actor.getSnapshot().context.activeProcess).toBeNull();
      expect(actor.getSnapshot().value).toBe('ROUTING_POST_REVIEW');

      actor.send({ type: 'ROUTE_TO_EVALUATE' });
      expect(actor.getSnapshot().context.activeProcess).toBeNull();
      expect(actor.getSnapshot().value).toBe('EVALUATING');
      actor.stop();
    });
  });

  // ──────────────────────────────────────────────
  // AC-5: Exception paths (ERROR, TIMEOUT)
  // ──────────────────────────────────────────────
  describe('AC-5: exception paths', () => {
    it('CODING → ERROR on PROCESS_ERROR', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'PROCESS_ERROR', error: 'crash' });
      expect(actor.getSnapshot().value).toBe('ERROR');
      expect(actor.getSnapshot().context.lastError).toBe('crash');
      expect(actor.getSnapshot().context.activeProcess).toBeNull();
      actor.stop();
    });

    it('CODING → ERROR on TIMEOUT', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'TIMEOUT' });
      expect(actor.getSnapshot().value).toBe('ERROR');
      expect(actor.getSnapshot().context.activeProcess).toBeNull();
      actor.stop();
    });

    it('REVIEWING → ERROR on PROCESS_ERROR', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'PROCESS_ERROR', error: 'reviewer crash' });
      expect(actor.getSnapshot().value).toBe('ERROR');
      expect(actor.getSnapshot().context.lastError).toBe('reviewer crash');
      actor.stop();
    });

    it('REVIEWING → ERROR on TIMEOUT', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'TIMEOUT' });
      expect(actor.getSnapshot().value).toBe('ERROR');
      actor.stop();
    });

    it('ERROR → WAITING_USER on RECOVERY', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'PROCESS_ERROR', error: 'crash' });
      actor.send({ type: 'RECOVERY' });
      expect(actor.getSnapshot().value).toBe('WAITING_USER');
      actor.stop();
    });

    it('CODING → INTERRUPTED on USER_INTERRUPT', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'USER_INTERRUPT' });
      expect(actor.getSnapshot().value).toBe('INTERRUPTED');
      expect(actor.getSnapshot().context.activeProcess).toBeNull();
      actor.stop();
    });

    it('REVIEWING → INTERRUPTED on USER_INTERRUPT', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'USER_INTERRUPT' });
      expect(actor.getSnapshot().value).toBe('INTERRUPTED');
      actor.stop();
    });

    it('INTERRUPTED → CODING on USER_INPUT with resume_as=coder', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'USER_INTERRUPT' });
      actor.send({ type: 'USER_INPUT', input: 'continue', resumeAs: 'coder' });
      expect(actor.getSnapshot().value).toBe('CODING');
      actor.stop();
    });

    it('INTERRUPTED → REVIEWING on USER_INPUT with resume_as=reviewer', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'USER_INTERRUPT' });
      actor.send({ type: 'USER_INPUT', input: 'review', resumeAs: 'reviewer' });
      expect(actor.getSnapshot().value).toBe('REVIEWING');
      actor.stop();
    });

    it('INTERRUPTED → WAITING_USER on USER_INPUT with resume_as=decision', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'USER_INTERRUPT' });
      actor.send({ type: 'USER_INPUT', input: 'decide', resumeAs: 'decision' });
      expect(actor.getSnapshot().value).toBe('WAITING_USER');
      actor.stop();
    });
  });

  // ──────────────────────────────────────────────
  // Session resumption (RESUME_SESSION)
  // ──────────────────────────────────────────────
  describe('session resumption', () => {
    it('IDLE → RESUMING on RESUME_SESSION', () => {
      const actor = startActor();
      actor.send({ type: 'RESUME_SESSION', sessionId: 'abc' });
      expect(actor.getSnapshot().value).toBe('RESUMING');
      actor.stop();
    });

    it('RESUMING → CODING on RESTORED_TO_CODING', () => {
      const actor = startActor();
      actor.send({ type: 'RESUME_SESSION', sessionId: 'abc' });
      actor.send({ type: 'RESTORED_TO_CODING' });
      expect(actor.getSnapshot().value).toBe('CODING');
      actor.stop();
    });

    it('RESUMING → REVIEWING on RESTORED_TO_REVIEWING', () => {
      const actor = startActor();
      actor.send({ type: 'RESUME_SESSION', sessionId: 'abc' });
      actor.send({ type: 'RESTORED_TO_REVIEWING' });
      expect(actor.getSnapshot().value).toBe('REVIEWING');
      actor.stop();
    });

    it('RESUMING → WAITING_USER on RESTORED_TO_WAITING', () => {
      const actor = startActor();
      actor.send({ type: 'RESUME_SESSION', sessionId: 'abc' });
      actor.send({ type: 'RESTORED_TO_WAITING' });
      expect(actor.getSnapshot().value).toBe('WAITING_USER');
      actor.stop();
    });
  });

  // ──────────────────────────────────────────────
  // test_regression_bug1: ROUTING_POST_REVIEW → ROUTE_TO_CODER respects maxRounds
  // ──────────────────────────────────────────────
  describe('test_regression_bug1: ROUTING_POST_REVIEW maxRounds guard', () => {
    it('ROUTING_POST_REVIEW → WAITING_USER on ROUTE_TO_CODER when maxRounds reached', () => {
      const actor = startActor({ maxRounds: 1, round: 1 });
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'fix this' });
      // round (1) >= maxRounds (1), should go to WAITING_USER not CODING
      actor.send({ type: 'ROUTE_TO_CODER' });
      expect(actor.getSnapshot().value).toBe('WAITING_USER');
      actor.stop();
    });

    it('ROUTING_POST_REVIEW → CODING on ROUTE_TO_CODER when rounds available', () => {
      const actor = startActor({ maxRounds: 5, round: 0 });
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'fix this' });
      actor.send({ type: 'ROUTE_TO_CODER' });
      expect(actor.getSnapshot().value).toBe('CODING');
      expect(actor.getSnapshot().context.round).toBe(1);
      actor.stop();
    });

    it('ROUTING_POST_REVIEW guard blocks exactly at maxRounds boundary', () => {
      const actor = startActor({ maxRounds: 3, round: 3 });
      sendStartAndSkipInit(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'issues' });
      actor.send({ type: 'ROUTE_TO_CODER' });
      expect(actor.getSnapshot().value).toBe('WAITING_USER');
      // round should NOT have been incremented
      expect(actor.getSnapshot().context.round).toBe(3);
      actor.stop();
    });
  });

  // ──────────────────────────────────────────────
  // test_regression_bug_r12_4: PHASE_TRANSITION saves event data to context
  // ──────────────────────────────────────────────
  describe('test_regression_bug_r12_4: PHASE_TRANSITION assigns pendingPhaseId', () => {
    it('PHASE_TRANSITION saves nextPhaseId and summary to context', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'compound task');
      actor.send({ type: 'CODE_COMPLETE', output: 'done phase 1' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'phase 1 complete' });
      actor.send({ type: 'PHASE_TRANSITION', nextPhaseId: 'p2', summary: 'Moving to implementation phase' });

      expect(actor.getSnapshot().value).toBe('WAITING_USER');
      expect(actor.getSnapshot().context.pendingPhaseId).toBe('p2');
      expect(actor.getSnapshot().context.pendingPhaseSummary).toBe('Moving to implementation phase');
      actor.stop();
    });

    it('pendingPhaseId is null initially', () => {
      const actor = startActor();
      expect(actor.getSnapshot().context.pendingPhaseId).toBeNull();
      expect(actor.getSnapshot().context.pendingPhaseSummary).toBeNull();
      actor.stop();
    });

    it('pendingPhaseId survives serialization roundtrip', () => {
      const actor1 = startActor();
      sendStartAndSkipInit(actor1, 'test');
      actor1.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor1.send({ type: 'ROUTE_TO_REVIEW' });
      actor1.send({ type: 'REVIEW_COMPLETE', output: 'ok' });
      actor1.send({ type: 'PHASE_TRANSITION', nextPhaseId: 'p3', summary: 'Final review' });

      const snapshot = actor1.getPersistedSnapshot();
      actor1.stop();

      const actor2 = createActor(workflowMachine, { snapshot, input: {} });
      actor2.start();

      expect(actor2.getSnapshot().value).toBe('WAITING_USER');
      expect(actor2.getSnapshot().context.pendingPhaseId).toBe('p3');
      expect(actor2.getSnapshot().context.pendingPhaseSummary).toBe('Final review');
      actor2.stop();
    });
  });

  // ──────────────────────────────────────────────
  // test_bug_r14_1: pendingPhaseId consumed on USER_CONFIRM continue
  // ──────────────────────────────────────────────
  describe('test_bug_r14_1: pendingPhaseId consumed on USER_CONFIRM continue', () => {
    it('should consume pendingPhaseId and clear it when user confirms continue', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'compound task');
      actor.send({ type: 'CODE_COMPLETE', output: 'done phase 1' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'phase 1 complete' });
      actor.send({ type: 'PHASE_TRANSITION', nextPhaseId: 'p2', summary: 'Implementation phase' });

      expect(actor.getSnapshot().value).toBe('WAITING_USER');
      expect(actor.getSnapshot().context.pendingPhaseId).toBe('p2');

      // User confirms continue — pendingPhaseId should be consumed and cleared
      actor.send({ type: 'USER_CONFIRM', action: 'continue' });
      expect(actor.getSnapshot().value).toBe('CODING');
      expect(actor.getSnapshot().context.pendingPhaseId).toBeNull();
      expect(actor.getSnapshot().context.pendingPhaseSummary).toBeNull();
      actor.stop();
    });

    it('should update taskPrompt with phase info when pendingPhaseId is consumed', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'original task');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'ok' });
      actor.send({ type: 'PHASE_TRANSITION', nextPhaseId: 'p2', summary: 'Deploy phase' });

      actor.send({ type: 'USER_CONFIRM', action: 'continue' });
      expect(actor.getSnapshot().context.taskPrompt).toContain('p2');
      // BUG-16 fix: taskPrompt preserves original task, not God's reasoning
      expect(actor.getSnapshot().context.taskPrompt).toContain('original task');
      actor.stop();
    });

    it('should NOT modify taskPrompt when no pendingPhaseId on continue', () => {
      const actor = startActor();
      sendStartAndSkipInit(actor, 'simple task');
      actor.send({ type: 'CODE_COMPLETE', output: 'done' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      actor.send({ type: 'REVIEW_COMPLETE', output: 'ok' });
      actor.send({ type: 'CONVERGED' });

      // No PHASE_TRANSITION, so pendingPhaseId is null
      actor.send({ type: 'USER_CONFIRM', action: 'continue' });
      expect(actor.getSnapshot().value).toBe('CODING');
      expect(actor.getSnapshot().context.taskPrompt).toBe('simple task');
      actor.stop();
    });
  });

  // ──────────────────────────────────────────────
  // AC-A2: TASK_INIT state — God intent parsing entry point
  // ──────────────────────────────────────────────
  describe('AC-A2: TASK_INIT state', () => {
    it('IDLE → TASK_INIT on START_TASK', () => {
      const actor = startActor();
      actor.send({ type: 'START_TASK', prompt: 'build feature X' });
      expect(actor.getSnapshot().value).toBe('TASK_INIT');
      expect(actor.getSnapshot().context.taskPrompt).toBe('build feature X');
      actor.stop();
    });

    it('TASK_INIT → CODING on TASK_INIT_COMPLETE', () => {
      const actor = startActor();
      actor.send({ type: 'START_TASK', prompt: 'test' });
      actor.send({ type: 'TASK_INIT_COMPLETE' });
      expect(actor.getSnapshot().value).toBe('CODING');
      expect(actor.getSnapshot().context.activeProcess).toBe('coder');
      actor.stop();
    });

    it('TASK_INIT → CODING on TASK_INIT_SKIP (degradation path)', () => {
      const actor = startActor();
      actor.send({ type: 'START_TASK', prompt: 'test' });
      actor.send({ type: 'TASK_INIT_SKIP' });
      expect(actor.getSnapshot().value).toBe('CODING');
      expect(actor.getSnapshot().context.activeProcess).toBe('coder');
      actor.stop();
    });

    it('TASK_INIT_COMPLETE with maxRounds updates context.maxRounds', () => {
      const actor = startActor({ maxRounds: 20 });
      actor.send({ type: 'START_TASK', prompt: 'test' });
      actor.send({ type: 'TASK_INIT_COMPLETE', maxRounds: 5 });
      expect(actor.getSnapshot().context.maxRounds).toBe(5);
      actor.stop();
    });

    it('TASK_INIT_COMPLETE without maxRounds preserves existing maxRounds', () => {
      const actor = startActor({ maxRounds: 20 });
      actor.send({ type: 'START_TASK', prompt: 'test' });
      actor.send({ type: 'TASK_INIT_COMPLETE' });
      expect(actor.getSnapshot().context.maxRounds).toBe(20);
      actor.stop();
    });

    it('full flow through TASK_INIT: IDLE → TASK_INIT → CODING → ...', () => {
      const actor = startActor();
      actor.send({ type: 'START_TASK', prompt: 'build it' });
      expect(actor.getSnapshot().value).toBe('TASK_INIT');

      actor.send({ type: 'TASK_INIT_COMPLETE', maxRounds: 6 });
      expect(actor.getSnapshot().value).toBe('CODING');
      expect(actor.getSnapshot().context.maxRounds).toBe(6);

      actor.send({ type: 'CODE_COMPLETE', output: 'v1' });
      actor.send({ type: 'ROUTE_TO_REVIEW' });
      expect(actor.getSnapshot().value).toBe('REVIEWING');
      actor.stop();
    });

    it('TASK_INIT ignores invalid events', () => {
      const actor = startActor();
      actor.send({ type: 'START_TASK', prompt: 'test' });
      expect(actor.getSnapshot().value).toBe('TASK_INIT');

      // These should be ignored in TASK_INIT
      actor.send({ type: 'CODE_COMPLETE', output: 'bogus' });
      expect(actor.getSnapshot().value).toBe('TASK_INIT');

      actor.send({ type: 'REVIEW_COMPLETE', output: 'bogus' });
      expect(actor.getSnapshot().value).toBe('TASK_INIT');
      actor.stop();
    });
  });

  // ──────────────────────────────────────────────
  // Invalid transitions (should be ignored)
  // ──────────────────────────────────────────────
  describe('invalid transitions', () => {
    it('should ignore CODE_COMPLETE when not in CODING', () => {
      const actor = startActor();
      actor.send({ type: 'CODE_COMPLETE', output: 'bogus' });
      expect(actor.getSnapshot().value).toBe('IDLE');
      actor.stop();
    });

    it('should ignore REVIEW_COMPLETE when not in REVIEWING', () => {
      const actor = startActor();
      actor.send({ type: 'REVIEW_COMPLETE', output: 'bogus' });
      expect(actor.getSnapshot().value).toBe('IDLE');
      actor.stop();
    });

    it('should ignore CONVERGED when not in EVALUATING', () => {
      const actor = startActor();
      actor.send({ type: 'CONVERGED' });
      expect(actor.getSnapshot().value).toBe('IDLE');
      actor.stop();
    });

    it('should ignore USER_CONFIRM when not in WAITING_USER', () => {
      const actor = startActor();
      actor.send({ type: 'USER_CONFIRM', action: 'accept' });
      expect(actor.getSnapshot().value).toBe('IDLE');
      actor.stop();
    });
  });
});

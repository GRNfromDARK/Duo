/**
 * WorkflowMachine tests — simplified topology.
 * No TASK_INIT, no INTERRUPTED, no circuit breaker, no phases.
 *
 * Flow: IDLE → GOD_DECIDING → EXECUTING → CODING/REVIEWING/DONE
 *       CODING → OBSERVING → GOD_DECIDING → ...
 */
import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import {
  workflowMachine,
  type WorkflowContext,
} from '../../engine/workflow-machine.js';
import type { Observation } from '../../types/observation.js';
import type { GodDecisionEnvelope } from '../../types/god-envelope.js';

function startActor(context?: Partial<WorkflowContext>) {
  const actor = createActor(workflowMachine, { input: context });
  actor.start();
  return actor;
}

function makeObs(type: Observation['type'] = 'work_output', source: Observation['source'] = 'coder'): Observation {
  return { source, type, summary: `test ${type}`, severity: 'info', timestamp: new Date().toISOString()};
}

function makeEnvelope(actions: GodDecisionEnvelope['actions'] = []): GodDecisionEnvelope {
  return {
    diagnosis: { summary: 'test', currentGoal: 'test', notableObservations: [] },
    actions,
    messages: [{ target: 'system_log', content: 'log' }],
  };
}

function advanceToCoding(actor: ReturnType<typeof startActor>, prompt: string) {
  actor.send({ type: 'START_TASK', prompt });
  actor.send({ type: 'DECISION_READY', envelope: makeEnvelope([{ type: 'send_to_coder', dispatchType: 'code', message: 'begin' }]) });
  actor.send({ type: 'EXECUTION_COMPLETE', results: [] });
}

function advanceFromCoding(actor: ReturnType<typeof startActor>, actions: GodDecisionEnvelope['actions']) {
  actor.send({ type: 'CODE_COMPLETE', output: 'done' });
  actor.send({ type: 'OBSERVATIONS_READY', observations: [makeObs()] });
  actor.send({ type: 'DECISION_READY', envelope: makeEnvelope(actions) });
  actor.send({ type: 'EXECUTION_COMPLETE', results: [makeObs('phase_progress_signal', 'runtime')] });
}

describe('WorkflowMachine', () => {
  describe('definition correctness', () => {
    it('should start in IDLE state', () => {
      const actor = startActor();
      expect(actor.getSnapshot().value).toBe('IDLE');
      actor.stop();
    });

    it('should have correct initial context', () => {
      const actor = startActor();
      const ctx = actor.getSnapshot().context;
      expect(ctx.activeProcess).toBeNull();
      expect(ctx.lastError).toBeNull();
      expect(ctx.currentObservations).toEqual([]);
      expect(ctx.lastDecision).toBeNull();
      actor.stop();
    });
  });

  describe('normal flow (Observe → Decide → Act)', () => {
    it('IDLE → GOD_DECIDING on START_TASK', () => {
      const actor = startActor();
      actor.send({ type: 'START_TASK', prompt: 'build feature X' });
      expect(actor.getSnapshot().value).toBe('GOD_DECIDING');
      expect(actor.getSnapshot().context.taskPrompt).toBe('build feature X');
      actor.stop();
    });

    it('GOD_DECIDING → EXECUTING → CODING via send_to_coder', () => {
      const actor = startActor();
      advanceToCoding(actor, 'test');
      expect(actor.getSnapshot().value).toBe('CODING');
      actor.stop();
    });

    it('CODING → OBSERVING on CODE_COMPLETE', () => {
      const actor = startActor();
      advanceToCoding(actor, 'test');
      actor.send({ type: 'CODE_COMPLETE', output: 'done coding' });
      expect(actor.getSnapshot().value).toBe('OBSERVING');
      actor.stop();
    });

    it('EXECUTING → REVIEWING on send_to_reviewer', () => {
      const actor = startActor();
      advanceToCoding(actor, 'test');
      advanceFromCoding(actor, [{ type: 'send_to_reviewer', message: 'review' }]);
      expect(actor.getSnapshot().value).toBe('REVIEWING');
      actor.stop();
    });

    it('GOD_DECIDING → DONE via accept_task', () => {
      const actor = startActor();
      advanceToCoding(actor, 'test');
      advanceFromCoding(actor, [{ type: 'accept_task', summary: 'done' }]);
      expect(actor.getSnapshot().value).toBe('DONE');
      actor.stop();
    });

    it('full loop: code → review → iterate → accept', () => {
      const actor = startActor();
      advanceToCoding(actor, 'build it');
      advanceFromCoding(actor, [{ type: 'send_to_reviewer', message: 'review' }]);
      expect(actor.getSnapshot().value).toBe('REVIEWING');

      actor.send({ type: 'REVIEW_COMPLETE', output: 'needs fix' });
      actor.send({ type: 'OBSERVATIONS_READY', observations: [makeObs('review_output', 'reviewer')] });
      actor.send({ type: 'DECISION_READY', envelope: makeEnvelope([{ type: 'send_to_coder', dispatchType: 'code', message: 'fix' }]) });
      actor.send({ type: 'EXECUTION_COMPLETE', results: [makeObs('phase_progress_signal', 'runtime')] });
      expect(actor.getSnapshot().value).toBe('CODING');

      advanceFromCoding(actor, [{ type: 'accept_task', summary: 'done' }]);
      expect(actor.getSnapshot().value).toBe('DONE');
      actor.stop();
    });

    it('GOD_DECIDING → PAUSED on PAUSE_REQUIRED', () => {
      const actor = startActor();
      actor.send({ type: 'START_TASK', prompt: 'test' });
      actor.send({ type: 'PAUSE_REQUIRED' });
      expect(actor.getSnapshot().value).toBe('PAUSED');
      actor.stop();
    });
  });

  describe('serialization roundtrip', () => {
    it('should serialize and restore state correctly', () => {
      const actor1 = startActor();
      advanceToCoding(actor1, 'serialize test');
      actor1.send({ type: 'CODE_COMPLETE', output: 'v1' });

      const snapshot = actor1.getPersistedSnapshot();
      actor1.stop();

      const actor2 = createActor(workflowMachine, { snapshot, input: {} });
      actor2.start();
      expect(actor2.getSnapshot().value).toBe('OBSERVING');
      expect(actor2.getSnapshot().context.taskPrompt).toBe('serialize test');
      actor2.stop();
    });
  });

  describe('exception paths', () => {
    it('CODING → ERROR on PROCESS_ERROR', () => {
      const actor = startActor();
      advanceToCoding(actor, 'test');
      actor.send({ type: 'PROCESS_ERROR', error: 'crash' });
      expect(actor.getSnapshot().value).toBe('ERROR');
      actor.stop();
    });

    it('ERROR → GOD_DECIDING on RECOVERY', () => {
      const actor = startActor();
      advanceToCoding(actor, 'test');
      actor.send({ type: 'PROCESS_ERROR', error: 'crash' });
      actor.send({ type: 'RECOVERY' });
      expect(actor.getSnapshot().value).toBe('GOD_DECIDING');
      actor.stop();
    });

    it('CLARIFYING + OBSERVATIONS_READY → GOD_DECIDING', () => {
      const actor = startActor();
      advanceToCoding(actor, 'test');
      advanceFromCoding(actor, [{ type: 'request_user_input', question: 'what?' }]);
      expect(actor.getSnapshot().value).toBe('CLARIFYING');
      actor.send({ type: 'OBSERVATIONS_READY', observations: [makeObs('human_message', 'human')] });
      expect(actor.getSnapshot().value).toBe('GOD_DECIDING');
      actor.stop();
    });
  });

  describe('session resumption', () => {
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

    it('RESUMING → GOD_DECIDING on RESTORED_TO_WAITING', () => {
      const actor = startActor();
      actor.send({ type: 'RESUME_SESSION', sessionId: 'abc' });
      actor.send({ type: 'RESTORED_TO_WAITING' });
      expect(actor.getSnapshot().value).toBe('GOD_DECIDING');
      actor.stop();
    });
  });

  describe('PAUSED simplified transitions', () => {
    it('PAUSED → GOD_DECIDING on USER_CONFIRM continue', () => {
      const actor = startActor();
      actor.send({ type: 'START_TASK', prompt: 'test' });
      actor.send({ type: 'PAUSE_REQUIRED' });
      actor.send({ type: 'USER_CONFIRM', action: 'continue' });
      expect(actor.getSnapshot().value).toBe('GOD_DECIDING');
      actor.stop();
    });

    it('PAUSED → DONE on USER_CONFIRM accept', () => {
      const actor = startActor();
      actor.send({ type: 'START_TASK', prompt: 'test' });
      actor.send({ type: 'PAUSE_REQUIRED' });
      actor.send({ type: 'USER_CONFIRM', action: 'accept' });
      expect(actor.getSnapshot().value).toBe('DONE');
      actor.stop();
    });
  });
});

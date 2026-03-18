/**
 * God workflow end-to-end integration test — simplified.
 *
 * Tests the full God-orchestrated workflow through XState,
 * verifying normal path, degradation, and session resume.
 *
 * Flow: IDLE → GOD_DECIDING → EXECUTING → CODING/REVIEWING/DONE
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createActor } from 'xstate';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  workflowMachine,
  type WorkflowContext,
} from '../../engine/workflow-machine.js';
import type { Observation } from '../../types/observation.js';
import type { GodDecisionEnvelope } from '../../types/god-envelope.js';
import { withRetry, isPaused } from '../../ui/god-fallback.js';
import { WatchdogService } from '../../god/watchdog.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'duo-god-integ-'));
  mkdirSync(join(tmpDir, 'session'), { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

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

function startActor(context?: Partial<WorkflowContext>) {
  const actor = createActor(workflowMachine, { input: context });
  actor.start();
  return actor;
}

function advanceToCoding(actor: ReturnType<typeof startActor>, prompt: string) {
  actor.send({ type: 'START_TASK', prompt });
  actor.send({ type: 'DECISION_READY', envelope: makeEnvelope([{ type: 'send_to_coder', dispatchType: 'code', message: 'begin' }]) });
  actor.send({ type: 'EXECUTION_COMPLETE', results: [] });
}

describe('Scenario 1: Normal God workflow path', () => {
  it('full workflow: GOD_DECIDING → CODING → OBSERVING → GOD_DECIDING → REVIEWING → DONE', () => {
    const actor = startActor();

    // Start → GOD_DECIDING
    actor.send({ type: 'START_TASK', prompt: 'implement user login' });
    expect(actor.getSnapshot().value).toBe('GOD_DECIDING');

    // God decides: send to coder
    actor.send({ type: 'DECISION_READY', envelope: makeEnvelope([{ type: 'send_to_coder', dispatchType: 'code', message: 'implement login' }]) });
    actor.send({ type: 'EXECUTION_COMPLETE', results: [makeObs('phase_progress_signal', 'runtime')] });
    expect(actor.getSnapshot().value).toBe('CODING');

    // Coder completes → OBSERVING
    actor.send({ type: 'CODE_COMPLETE', output: 'function login() { /* auth logic */ }' });
    expect(actor.getSnapshot().value).toBe('OBSERVING');

    // Observations → GOD_DECIDING
    actor.send({ type: 'OBSERVATIONS_READY', observations: [makeObs('work_output', 'coder')] });
    expect(actor.getSnapshot().value).toBe('GOD_DECIDING');

    // God decides: send to reviewer
    actor.send({ type: 'DECISION_READY', envelope: makeEnvelope([{ type: 'send_to_reviewer', message: 'Review the login implementation' }]) });
    actor.send({ type: 'EXECUTION_COMPLETE', results: [makeObs('phase_progress_signal', 'runtime')] });
    expect(actor.getSnapshot().value).toBe('REVIEWING');

    // Reviewer → OBSERVING → GOD_DECIDING → accept
    actor.send({ type: 'REVIEW_COMPLETE', output: 'All issues resolved. [APPROVED]' });
    actor.send({ type: 'OBSERVATIONS_READY', observations: [makeObs('review_output', 'reviewer')] });
    actor.send({ type: 'DECISION_READY', envelope: makeEnvelope([{ type: 'accept_task', summary: 'All criteria met.' }]) });
    actor.send({ type: 'EXECUTION_COMPLETE', results: [makeObs('phase_progress_signal', 'runtime')] });
    expect(actor.getSnapshot().value).toBe('DONE');

    actor.stop();
  });
});

describe('Scenario 2: God degradation path', () => {
  it('full degradation workflow through state machine', () => {
    const actor = startActor();

    actor.send({ type: 'START_TASK', prompt: 'task' });
    expect(actor.getSnapshot().value).toBe('GOD_DECIDING');

    // God fails → PAUSED for user confirmation
    actor.send({ type: 'PAUSE_REQUIRED' });
    expect(actor.getSnapshot().value).toBe('PAUSED');

    // User accepts → DONE
    actor.send({ type: 'USER_CONFIRM', action: 'accept' });
    expect(actor.getSnapshot().value).toBe('DONE');

    actor.stop();
  });

  it('consecutive failures → God paused for session', async () => {
    vi.useFakeTimers();
    try {
      const w = new WatchdogService();
      const promise = withRetry(
        async () => { throw new Error('God crash'); },
        w,
      );
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(20_000);
      const result = await promise;
      expect(isPaused(result)).toBe(true);
      expect(w.isGodAvailable()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Scenario 5: duo resume', () => {
  it('full resume flow: RESUMING → CODING with restored state', () => {
    const actor1 = startActor({});
    advanceToCoding(actor1, 'original task');

    // CODING → OBSERVING → GOD_DECIDING → EXECUTING → REVIEWING
    actor1.send({ type: 'CODE_COMPLETE', output: 'v1' });
    actor1.send({ type: 'OBSERVATIONS_READY', observations: [makeObs('work_output', 'coder')] });
    actor1.send({ type: 'DECISION_READY', envelope: makeEnvelope([{ type: 'send_to_reviewer', message: 'Review v1' }]) });
    actor1.send({ type: 'EXECUTION_COMPLETE', results: [makeObs('phase_progress_signal', 'runtime')] });
    expect(actor1.getSnapshot().value).toBe('REVIEWING');

    // REVIEWING → CODING (via iterate)
    actor1.send({ type: 'REVIEW_COMPLETE', output: 'fix issues' });
    actor1.send({ type: 'OBSERVATIONS_READY', observations: [makeObs('review_output', 'reviewer')] });
    actor1.send({ type: 'DECISION_READY', envelope: makeEnvelope([{ type: 'send_to_coder', dispatchType: 'code', message: 'Fix issues' }]) });
    actor1.send({ type: 'EXECUTION_COMPLETE', results: [makeObs('phase_progress_signal', 'runtime')] });
    expect(actor1.getSnapshot().value).toBe('CODING');

    const snapshot = actor1.getPersistedSnapshot();
    actor1.stop();

    // Restore
    const actor2 = createActor(workflowMachine, { snapshot, input: {} });
    actor2.start();
    expect(actor2.getSnapshot().value).toBe('CODING');
    expect(actor2.getSnapshot().context.taskPrompt).toBe('original task');

    // Continue → DONE
    actor2.send({ type: 'CODE_COMPLETE', output: 'v2' });
    actor2.send({ type: 'OBSERVATIONS_READY', observations: [makeObs('work_output', 'coder')] });
    actor2.send({ type: 'DECISION_READY', envelope: makeEnvelope([{ type: 'accept_task', summary: 'Approved' }]) });
    actor2.send({ type: 'EXECUTION_COMPLETE', results: [makeObs('phase_progress_signal', 'runtime')] });
    expect(actor2.getSnapshot().value).toBe('DONE');

    actor2.stop();
  });

  it('resume via RESUME_SESSION event path', () => {
    const actor = startActor();
    actor.send({ type: 'RESUME_SESSION', sessionId: 'session-123' });
    expect(actor.getSnapshot().value).toBe('RESUMING');
    actor.send({ type: 'RESTORED_TO_CODING' });
    expect(actor.getSnapshot().value).toBe('CODING');
    actor.send({ type: 'CODE_COMPLETE', output: 'resumed code' });
    expect(actor.getSnapshot().value).toBe('OBSERVING');
    actor.stop();
  });
});

describe('Cross-cutting: withRetry integration', () => {
  it('God success → result returned, watchdog reset', async () => {
    const w = new WatchdogService();
    const r = await withRetry(
      async () => ({
        event: { type: 'ROUTE_TO_REVIEW' as const },
        decision: { action: 'continue_to_review' as const, reasoning: 'OK' },
        rawOutput: '',
      }),
      w,
    );
    expect(isPaused(r)).toBe(false);
    expect(w.getConsecutiveFailures()).toBe(0);
  });
});

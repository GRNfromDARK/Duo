/**
 * Regression tests for BUG-17 and BUG-18.
 *
 * BUG-17 [P1]: REVIEWING useEffect God prompt path drops interruptInstruction
 * BUG-18 [P2]: XState taskPrompt accumulates [Phase: ...] prefixes across transitions
 */
import { describe, it, expect, vi } from 'vitest';
import { createActor } from 'xstate';
import {
  generateReviewerPrompt,
} from '../../god/god-prompt-generator.js';
import {
  workflowMachine,
} from '../../engine/workflow-machine.js';

vi.mock('../../god/god-audit.js', () => ({
  appendAuditLog: vi.fn(),
}));

// ══════════════════════════════════════════════════════════════════
// BUG-17: generateReviewerPrompt must accept and use instruction
// ══════════════════════════════════════════════════════════════════

describe('BUG-17 regression: generateReviewerPrompt instruction support', () => {
  it('includes instruction in reviewer prompt when provided', () => {
    const prompt = generateReviewerPrompt({
      taskType: 'code',
      round: 2,
      maxRounds: 5,
      taskGoal: 'Build API',
      lastCoderOutput: 'Added endpoint',
      instruction: 'Focus on error handling in the auth module',
    });

    expect(prompt).toContain('Focus on error handling in the auth module');
    expect(prompt).toContain('God Instruction (HIGHEST PRIORITY)');
  });

  it('omits instruction section when instruction is undefined', () => {
    const prompt = generateReviewerPrompt({
      taskType: 'code',
      round: 1,
      maxRounds: 5,
      taskGoal: 'Build API',
      lastCoderOutput: 'code output',
    });

    expect(prompt).not.toContain('God Instruction');
  });

  it('instruction appears before review instructions (high priority)', () => {
    const prompt = generateReviewerPrompt({
      taskType: 'code',
      round: 2,
      maxRounds: 5,
      taskGoal: 'Build API',
      lastCoderOutput: 'Added endpoint',
      instruction: 'User wants to skip security checks',
    });

    const instructionIdx = prompt.indexOf('User wants to skip security checks');
    const reviewIdx = prompt.indexOf('Review Instructions');
    expect(instructionIdx).toBeGreaterThan(-1);
    expect(reviewIdx).toBeGreaterThan(-1);
    expect(instructionIdx).toBeLessThan(reviewIdx);
  });

  it('instruction works with compound task and phaseType', () => {
    const prompt = generateReviewerPrompt({
      taskType: 'compound',
      round: 1,
      maxRounds: 5,
      taskGoal: 'Multi-phase project',
      lastCoderOutput: 'exploration results',
      phaseId: 'explore-phase',
      phaseType: 'explore',
      instruction: 'Pay attention to missing test coverage',
    });

    expect(prompt).toContain('Pay attention to missing test coverage');
    expect(prompt).toContain('Current Phase');
    expect(prompt).toContain('explore-phase');
  });
});

// ══════════════════════════════════════════════════════════════════
// BUG-18: taskPrompt must not accumulate [Phase: ...] prefixes
// ══════════════════════════════════════════════════════════════════

function startActor() {
  const actor = createActor(workflowMachine, { input: {} });
  actor.start();
  return actor;
}

function advanceToPhaseTransition(
  actor: ReturnType<typeof startActor>,
  phaseId: string,
  summary: string,
) {
  actor.send({ type: 'CODE_COMPLETE', output: 'done' });
  actor.send({ type: 'ROUTE_TO_REVIEW' });
  actor.send({ type: 'REVIEW_COMPLETE', output: 'ok' });
  actor.send({ type: 'PHASE_TRANSITION', nextPhaseId: phaseId, summary });
  actor.send({ type: 'USER_CONFIRM', action: 'continue' });
}

describe('BUG-18 regression: taskPrompt phase prefix accumulation', () => {
  it('does not accumulate multiple [Phase: ...] prefixes after repeated transitions', () => {
    const originalTask = 'multi-phase project';
    const actor = startActor();
    actor.send({ type: 'START_TASK', prompt: originalTask });
    actor.send({ type: 'TASK_INIT_SKIP' });

    // First phase transition
    advanceToPhaseTransition(actor, 'phase-2', 'Phase 1 done');
    const after1 = actor.getSnapshot().context.taskPrompt!;
    expect(after1).toBe('[Phase: phase-2] multi-phase project');

    // Second phase transition
    advanceToPhaseTransition(actor, 'phase-3', 'Phase 2 done');
    const after2 = actor.getSnapshot().context.taskPrompt!;
    expect(after2).toBe('[Phase: phase-3] multi-phase project');
    // Must NOT be '[Phase: phase-3] [Phase: phase-2] multi-phase project'
    expect(after2).not.toContain('phase-2');

    // Third phase transition
    advanceToPhaseTransition(actor, 'phase-4', 'Phase 3 done');
    const after3 = actor.getSnapshot().context.taskPrompt!;
    expect(after3).toBe('[Phase: phase-4] multi-phase project');
    expect(after3).not.toContain('phase-3');
    expect(after3).not.toContain('phase-2');

    actor.stop();
  });

  it('preserves original task without prefix when no phase transition occurs', () => {
    const actor = startActor();
    actor.send({ type: 'START_TASK', prompt: 'simple task' });
    actor.send({ type: 'TASK_INIT_SKIP' });
    actor.send({ type: 'CODE_COMPLETE', output: 'done' });
    actor.send({ type: 'ROUTE_TO_REVIEW' });
    actor.send({ type: 'REVIEW_COMPLETE', output: 'ok' });
    actor.send({ type: 'CONVERGED' });
    actor.send({ type: 'USER_CONFIRM', action: 'continue' });

    expect(actor.getSnapshot().context.taskPrompt).toBe('simple task');
    actor.stop();
  });
});

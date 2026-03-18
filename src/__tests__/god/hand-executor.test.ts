/**
 * Tests for Hand Executor — simplified to 5 actions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { GodAction } from '../../types/god-actions.js';
import { GodAuditLogger } from '../../god/god-audit.js';
import {
  executeActions,
  type HandExecutionContext,
} from '../../god/hand-executor.js';

function createContext(overrides: Partial<HandExecutionContext> = {}): HandExecutionContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-hand-exec-'));
  return {
    pendingCoderMessage: null,
    pendingCoderDispatchType: null,
    pendingReviewerMessage: null,
    taskCompleted: false,
    waitState: { active: false, reason: null, estimatedSeconds: null },
    clarificationState: { active: false, question: null },
    auditLogger: new GodAuditLogger(tmpDir),
    sessionDir: tmpDir,
    cwd: tmpDir,
    ...overrides,
  };
}

function cleanupContext(ctx: HandExecutionContext): void {
  try {
    fs.rmSync(ctx.sessionDir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

describe('HandExecutor', () => {
  let ctx: HandExecutionContext;

  beforeEach(() => {
    ctx = createContext();
  });

  afterEach(() => {
    cleanupContext(ctx);
  });

  describe('all 5 action types have executor logic', () => {
    it('send_to_coder sets pendingCoderMessage and pendingCoderDispatchType', async () => {
      const actions: GodAction[] = [
        { type: 'send_to_coder', dispatchType: 'code', message: 'Implement the login page' },
      ];
      const results = await executeActions(actions, ctx);
      expect(ctx.pendingCoderMessage).toBe('Implement the login page');
      expect(ctx.pendingCoderDispatchType).toBe('code');
      expect(results).toHaveLength(1);
    });

    it('send_to_reviewer sets pendingReviewerMessage', async () => {
      const actions: GodAction[] = [
        { type: 'send_to_reviewer', message: 'Review the implementation' },
      ];
      const results = await executeActions(actions, ctx);
      expect(ctx.pendingReviewerMessage).toBe('Review the implementation');
      expect(results).toHaveLength(1);
    });

    it('accept_task marks task completed', async () => {
      const actions: GodAction[] = [
        { type: 'accept_task', summary: 'All checks passed' },
      ];
      const results = await executeActions(actions, ctx);
      expect(ctx.taskCompleted).toBe(true);
      expect(results).toHaveLength(1);
    });

    it('wait sets waitState', async () => {
      const actions: GodAction[] = [
        { type: 'wait', reason: 'Rate limited', estimatedSeconds: 300 },
      ];
      const results = await executeActions(actions, ctx);
      expect(ctx.waitState.active).toBe(true);
      expect(ctx.waitState.reason).toBe('Rate limited');
      expect(ctx.waitState.estimatedSeconds).toBe(300);
      expect(results).toHaveLength(1);
    });

    it('request_user_input sets clarificationState', async () => {
      const actions: GodAction[] = [
        { type: 'request_user_input', question: 'Which approach do you prefer?' },
      ];
      const results = await executeActions(actions, ctx);
      expect(ctx.clarificationState.active).toBe(true);
      expect(ctx.clarificationState.question).toBe('Which approach do you prefer?');
      expect(results).toHaveLength(1);
    });
  });

  describe('returns result observations', () => {
    it('each action returns an observation with source=runtime, type=phase_progress_signal', async () => {
      const actions: GodAction[] = [
        { type: 'send_to_coder', dispatchType: 'code', message: 'do work' },
        { type: 'wait', reason: 'pause' },
      ];
      const results = await executeActions(actions, ctx);
      expect(results).toHaveLength(2);
      for (const obs of results) {
        expect(obs.source).toBe('runtime');
        expect(obs.type).toBe('phase_progress_signal');
        expect(obs.timestamp).toBeDefined();
      }
    });

    it('observation summary describes the executed action', async () => {
      const actions: GodAction[] = [
        { type: 'send_to_coder', dispatchType: 'explore', message: 'implement feature' },
      ];
      const results = await executeActions(actions, ctx);
      expect(results[0].summary).toContain('send_to_coder');
    });
  });

  describe('accept_task records to audit', () => {
    it('logs summary to audit on accept_task', async () => {
      const appendSpy = vi.spyOn(ctx.auditLogger!, 'append');
      await executeActions(
        [{ type: 'accept_task', summary: 'God decided to accept' }],
        ctx,
      );
      expect(appendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionType: 'accept_task',
          outputSummary: expect.stringContaining('God decided to accept'),
        }),
      );
    });
  });

  describe('sequential execution', () => {
    it('executes actions in order', async () => {
      const actions: GodAction[] = [
        { type: 'send_to_coder', dispatchType: 'code', message: 'work' },
        { type: 'accept_task', summary: 'done' },
      ];
      const results = await executeActions(actions, ctx);
      expect(results).toHaveLength(2);
      expect(ctx.pendingCoderMessage).toBe('work');
      expect(ctx.taskCompleted).toBe(true);
    });

    it('returns empty array for empty actions', async () => {
      const results = await executeActions([], ctx);
      expect(results).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('wait without estimatedSeconds', async () => {
      await executeActions([{ type: 'wait', reason: 'Waiting for user' }], ctx);
      expect(ctx.waitState.active).toBe(true);
      expect(ctx.waitState.reason).toBe('Waiting for user');
      expect(ctx.waitState.estimatedSeconds).toBeNull();
    });
  });

  describe('regression: auditLogger null does not crash', () => {
    it('accept_task succeeds with null auditLogger', async () => {
      const nullCtx = createContext({ auditLogger: null });
      const results = await executeActions(
        [{ type: 'accept_task', summary: 'Done' }],
        nullCtx,
      );
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('phase_progress_signal');
      expect(nullCtx.taskCompleted).toBe(true);
      cleanupContext(nullCtx);
    });
  });
});

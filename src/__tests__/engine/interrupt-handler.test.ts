import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { InterruptHandler, type InterruptHandlerDeps } from '../../engine/interrupt-handler.js';

/**
 * Mock ProcessManager — only needs kill(), isRunning(), getBufferedOutput()
 */
function createMockProcessManager() {
  return {
    kill: vi.fn().mockResolvedValue(undefined) as ReturnType<typeof vi.fn> & (() => Promise<void>),
    isRunning: vi.fn().mockReturnValue(true) as ReturnType<typeof vi.fn> & (() => boolean),
    getBufferedOutput: vi.fn().mockReturnValue('partial output so far') as ReturnType<typeof vi.fn> & (() => string),
  };
}

/**
 * Mock SessionManager — only needs saveState()
 */
function createMockSessionManager() {
  return {
    saveState: vi.fn(),
  };
}

/**
 * Mock workflow actor — send() and getSnapshot()
 */
function createMockActor(state: string = 'CODING') {
  return {
    send: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue({
      value: state,
      context: {
        sessionId: 'test-session-123',
        round: 1,
        activeProcess: state === 'CODING' ? 'coder' : state === 'REVIEWING' ? 'reviewer' : null,
      },
    }),
  };
}

function createDeps(overrides?: Partial<InterruptHandlerDeps>): InterruptHandlerDeps {
  return {
    processManager: createMockProcessManager(),
    sessionManager: createMockSessionManager(),
    actor: createMockActor(),
    onExit: vi.fn(),
    onInterrupted: vi.fn(),
    ...overrides,
  };
}

describe('InterruptHandler', () => {
  let handler: InterruptHandler;

  afterEach(() => {
    handler?.dispose();
  });

  // ──────────────────────────────────────────────
  // AC-1: Ctrl+C kills LLM process within ≤1 second
  // ──────────────────────────────────────────────
  describe('AC-1: Ctrl+C kills LLM process', () => {
    it('should call processManager.kill() on handleSigint', async () => {
      const deps = createDeps();
      handler = new InterruptHandler(deps);

      await handler.handleSigint();

      expect(deps.processManager.kill).toHaveBeenCalledOnce();
    });

    it('should send USER_INTERRUPT event to actor', async () => {
      const deps = createDeps();
      handler = new InterruptHandler(deps);

      await handler.handleSigint();

      expect(deps.actor.send).toHaveBeenCalledWith({ type: 'USER_INTERRUPT' });
    });

    it('should call onInterrupted callback with buffered output', async () => {
      const deps = createDeps();
      handler = new InterruptHandler(deps);

      await handler.handleSigint();

      expect(deps.onInterrupted).toHaveBeenCalledWith(
        expect.objectContaining({
          bufferedOutput: 'partial output so far',
          interrupted: true,
        }),
      );
    });

    it('should not kill process if not running', async () => {
      const pm = createMockProcessManager();
      pm.isRunning.mockReturnValue(false);
      const deps = createDeps({ processManager: pm });
      handler = new InterruptHandler(deps);

      await handler.handleSigint();

      expect(pm.kill).not.toHaveBeenCalled();
    });

    it('should not send USER_INTERRUPT if actor is not in active state', async () => {
      const actor = createMockActor('IDLE');
      const deps = createDeps({ actor });
      handler = new InterruptHandler(deps);

      await handler.handleSigint();

      expect(actor.send).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // AC-2: Buffered output preserved and marked interrupted
  // ──────────────────────────────────────────────
  describe('AC-2: output preserved with interrupted marker', () => {
    it('should capture buffered output before kill', async () => {
      const pm = createMockProcessManager();
      pm.getBufferedOutput.mockReturnValue('line 1\nline 2\npartial line 3');
      const deps = createDeps({ processManager: pm });
      handler = new InterruptHandler(deps);

      await handler.handleSigint();

      expect(deps.onInterrupted).toHaveBeenCalledWith(
        expect.objectContaining({
          bufferedOutput: 'line 1\nline 2\npartial line 3',
          interrupted: true,
        }),
      );
    });

    it('should include interrupted flag in callback', async () => {
      const deps = createDeps();
      handler = new InterruptHandler(deps);

      await handler.handleSigint();

      const call = (deps.onInterrupted as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.interrupted).toBe(true);
    });
  });

  // ──────────────────────────────────────────────
  // AC-3: User input after interrupt becomes new context
  // ──────────────────────────────────────────────
  describe('AC-3: user input after interrupt as context', () => {
    it('should send USER_INPUT event with user instruction', async () => {
      const deps = createDeps();
      handler = new InterruptHandler(deps);

      // First, interrupt
      await handler.handleSigint();

      // Then user types input
      handler.handleUserInput('fix the bug instead', 'coder');

      expect(deps.actor.send).toHaveBeenCalledWith({
        type: 'USER_INPUT',
        input: 'fix the bug instead',
        resumeAs: 'coder',
      });
    });
  });

  // ──────────────────────────────────────────────
  // AC-4: Text interrupt — typing during LLM run = interrupt with instruction
  // ──────────────────────────────────────────────
  describe('AC-4: text interrupt', () => {
    it('should kill process and send USER_INTERRUPT then USER_INPUT', async () => {
      const deps = createDeps();
      handler = new InterruptHandler(deps);

      await handler.handleTextInterrupt('use a different approach', 'coder');

      // Should kill process
      expect(deps.processManager.kill).toHaveBeenCalledOnce();
      // Should send USER_INTERRUPT to transition to INTERRUPTED state
      expect(deps.actor.send).toHaveBeenCalledWith({ type: 'USER_INTERRUPT' });
      // Should notify about interruption
      expect(deps.onInterrupted).toHaveBeenCalled();
    });

    it('should include user text in the interrupted callback', async () => {
      const deps = createDeps();
      handler = new InterruptHandler(deps);

      await handler.handleTextInterrupt('use a different approach', 'coder');

      expect(deps.onInterrupted).toHaveBeenCalledWith(
        expect.objectContaining({
          userInstruction: 'use a different approach',
        }),
      );
    });

    it('should not interrupt if process is not running', async () => {
      const pm = createMockProcessManager();
      pm.isRunning.mockReturnValue(false);
      const deps = createDeps({ processManager: pm });
      handler = new InterruptHandler(deps);

      await handler.handleTextInterrupt('hello', 'coder');

      expect(pm.kill).not.toHaveBeenCalled();
      expect(deps.actor.send).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // AC-5: Double Ctrl+C (<500ms) exits and saves session
  // ──────────────────────────────────────────────
  describe('AC-5: double Ctrl+C exit with session save', () => {
    it('should exit on second Ctrl+C within 500ms', async () => {
      const deps = createDeps();
      handler = new InterruptHandler(deps);

      await handler.handleSigint();
      await handler.handleSigint(); // within 500ms

      expect(deps.sessionManager.saveState).toHaveBeenCalledWith(
        'test-session-123',
        expect.objectContaining({ status: 'interrupted' }),
      );
      expect(deps.onExit).toHaveBeenCalled();
    });

    it('should NOT exit on second Ctrl+C after 500ms', async () => {
      vi.useFakeTimers();
      const deps = createDeps();
      handler = new InterruptHandler(deps);

      await handler.handleSigint();
      vi.advanceTimersByTime(600); // > 500ms
      await handler.handleSigint();

      expect(deps.onExit).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should save session state before exit', async () => {
      const deps = createDeps();
      handler = new InterruptHandler(deps);

      await handler.handleSigint();
      await handler.handleSigint();

      // saveState called before onExit
      const saveOrder = (deps.sessionManager.saveState as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      const exitOrder = (deps.onExit as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      expect(saveOrder).toBeLessThan(exitOrder);
    });

    it('should still exit even if session save fails', async () => {
      const sm = createMockSessionManager();
      sm.saveState.mockImplementation(() => { throw new Error('disk full'); });
      const deps = createDeps({ sessionManager: sm });
      handler = new InterruptHandler(deps);

      await handler.handleSigint();
      await handler.handleSigint();

      expect(deps.onExit).toHaveBeenCalled();
    });

    it('should skip session save if no sessionId', async () => {
      const actor = createMockActor('CODING');
      actor.getSnapshot.mockReturnValue({
        value: 'CODING',
        context: { sessionId: null, round: 0, activeProcess: 'coder' },
      });
      const deps = createDeps({ actor });
      handler = new InterruptHandler(deps);

      await handler.handleSigint();
      await handler.handleSigint();

      expect(deps.sessionManager.saveState).not.toHaveBeenCalled();
      expect(deps.onExit).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // Edge cases
  // ──────────────────────────────────────────────
  describe('edge cases', () => {
    it('should handle kill() throwing gracefully', async () => {
      const pm = createMockProcessManager();
      pm.kill.mockRejectedValue(new Error('already dead'));
      const deps = createDeps({ processManager: pm });
      handler = new InterruptHandler(deps);

      // Should not throw
      await expect(handler.handleSigint()).resolves.not.toThrow();
      // Should still send USER_INTERRUPT
      expect(deps.actor.send).toHaveBeenCalledWith({ type: 'USER_INTERRUPT' });
    });

    it('dispose should clean up', () => {
      const deps = createDeps();
      handler = new InterruptHandler(deps);
      handler.dispose();
      // No error on second dispose
      handler.dispose();
    });
  });
});

/**
 * InterruptHandler — manages Ctrl+C, text interrupt, and double-Ctrl+C exit.
 * Source: FR-007 (AC-024, AC-025, AC-026, AC-027, AC-028)
 *
 * Responsibilities:
 * - Single Ctrl+C: kill current LLM process → INTERRUPTED state → preserve output
 * - Text interrupt: user types during LLM run → kill + instruction
 * - Double Ctrl+C (<500ms): save session → exit app
 */

const DOUBLE_CTRLC_THRESHOLD_MS = 500;

/** States that have an active LLM process running */
const ACTIVE_STATES = new Set(['CODING', 'REVIEWING']);

export interface InterruptedInfo {
  bufferedOutput: string;
  interrupted: true;
  userInstruction?: string;
}

export interface InterruptHandlerDeps {
  processManager: {
    kill(): Promise<void>;
    isRunning(): boolean;
    getBufferedOutput(): string;
  };
  sessionManager: {
    saveState(sessionId: string, state: Record<string, unknown>): void;
  };
  actor: {
    send(event: Record<string, unknown>): void;
    getSnapshot(): {
      value: string;
      context: {
        sessionId: string | null;
        round: number;
        activeProcess: string | null;
      };
    };
  };
  onExit: () => void;
  onInterrupted: (info: InterruptedInfo) => void;
}

export class InterruptHandler {
  private deps: InterruptHandlerDeps;
  private lastSigintTime = 0;
  private hasPendingSigint = false;
  private disposed = false;

  constructor(deps: InterruptHandlerDeps) {
    this.deps = deps;
  }

  /**
   * Handle a SIGINT (Ctrl+C) signal.
   * - First press: kill LLM process, enter INTERRUPTED state
   * - Second press within 500ms: save session and exit
   */
  async handleSigint(): Promise<void> {
    if (this.disposed) return;
    const now = Date.now();
    const timeSinceLast = now - this.lastSigintTime;
    this.lastSigintTime = now;

    // Double Ctrl+C detection: second press within threshold
    if (this.hasPendingSigint && timeSinceLast <= DOUBLE_CTRLC_THRESHOLD_MS) {
      this.hasPendingSigint = false;
      this.saveAndExit();
      return;
    }

    this.hasPendingSigint = true;
    await this.interruptCurrentProcess();
  }

  /**
   * Handle text interrupt — user typed during LLM execution and pressed enter.
   * Equivalent to Ctrl+C + immediate user input.
   */
  async handleTextInterrupt(text: string, resumeAs: 'coder' | 'reviewer'): Promise<void> {
    if (this.disposed) return;
    if (!this.deps.processManager.isRunning()) {
      return;
    }

    const snapshot = this.deps.actor.getSnapshot();
    if (!ACTIVE_STATES.has(snapshot.value)) {
      return;
    }

    const bufferedOutput = this.deps.processManager.getBufferedOutput();

    try {
      await this.deps.processManager.kill();
    } catch {
      // Process may have already exited — continue
    }

    this.deps.actor.send({ type: 'USER_INTERRUPT' });

    this.deps.onInterrupted({
      bufferedOutput,
      interrupted: true,
      userInstruction: text,
    });
  }

  /**
   * Send USER_INPUT event to actor after an interrupt.
   * The user's instruction becomes additional context for the next LLM call.
   */
  handleUserInput(input: string, resumeAs: 'coder' | 'reviewer' | 'decision'): void {
    if (this.disposed) return;
    this.deps.actor.send({
      type: 'USER_INPUT',
      input,
      resumeAs,
    });
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.disposed = true;
  }

  // ── Private ──

  private async interruptCurrentProcess(): Promise<void> {
    const snapshot = this.deps.actor.getSnapshot();

    // Only interrupt if in an active LLM state
    if (!ACTIVE_STATES.has(snapshot.value)) {
      return;
    }

    const bufferedOutput = this.deps.processManager.getBufferedOutput();

    if (this.deps.processManager.isRunning()) {
      try {
        await this.deps.processManager.kill();
      } catch {
        // Process may have already exited — continue
      }
    }

    this.deps.actor.send({ type: 'USER_INTERRUPT' });

    this.deps.onInterrupted({
      bufferedOutput,
      interrupted: true,
    });
  }

  private saveAndExit(): void {
    const snapshot = this.deps.actor.getSnapshot();
    const sessionId = snapshot.context.sessionId;

    if (sessionId) {
      try {
        this.deps.sessionManager.saveState(sessionId, {
          round: snapshot.context.round,
          status: 'interrupted',
          currentRole: snapshot.context.activeProcess ?? 'coder',
        });
      } catch {
        // Best effort — still exit even if save fails
      }
    }

    this.deps.onExit();
  }
}

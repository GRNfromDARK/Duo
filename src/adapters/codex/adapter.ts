/**
 * CodexAdapter — Codex CLI adapter implementation.
 * Source: FR-010 (AC-036, AC-037, AC-038)
 *
 * Key behaviors:
 * - Coder mode: codex exec <prompt> --json --full-auto
 * - Reviewer mode: codex exec <prompt> --json --full-auto
 * - Captures thread_id from thread.started events for session resume
 * - Uses JsonlParser for JSONL output parsing
 * - Warns when not in a git repository
 */

import { execFile } from 'node:child_process';
import type { CLIAdapter, ExecOptions, OutputChunk } from '../../types/adapter.js';
import { ProcessManager, ProcessTimeoutError } from '../process-manager.js';
import { JsonlParser } from '../../parsers/jsonl-parser.js';
import { buildAdapterEnv } from '../env-builder.js';

export interface CodexSessionOptions {
  role?: 'coder' | 'reviewer';
  resumeSessionId?: string;
}

export class CodexAdapter implements CLIAdapter {
  readonly name = 'codex';
  readonly displayName = 'Codex';
  readonly version = '0.0.0';

  private processManager: ProcessManager;
  private parser: JsonlParser;
  /** Thread ID captured from the most recent thread.started event */
  private lastSessionId: string | null = null;

  constructor() {
    this.processManager = new ProcessManager();
    this.parser = new JsonlParser();
  }

  /** Returns true if this adapter has a captured session to resume */
  hasActiveSession(): boolean {
    return this.lastSessionId !== null;
  }

  /** Expose last captured session/thread ID */
  getLastSessionId(): string | null {
    return this.lastSessionId;
  }

  /** Restore a previously persisted session ID (e.g. after `duo resume`) */
  restoreSessionId(id: string): void {
    this.lastSessionId = id;
  }

  async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('codex', ['--version'], { timeout: 5000 }, (err) => {
        resolve(!err);
      });
    });
  }

  async getVersion(): Promise<string> {
    return new Promise((resolve) => {
      execFile('codex', ['--version'], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          resolve('unknown');
          return;
        }
        const match = stdout.trim().match(/(\d+\.\d+\.\d+)/);
        resolve(match ? match[1] : 'unknown');
      });
    });
  }

  /**
   * Build CLI arguments for codex command.
   * Exposed for testing.
   *
   * Both modes use `codex exec <prompt> --json` for structured output.
   * --full-auto enables sandboxed auto-execution (replaces deprecated --yolo).
   */
  buildArgs(
    prompt: string,
    opts: ExecOptions,
    extra?: { skipGitCheck?: boolean; resumeSessionId?: string },
  ): string[] {
    const args: string[] = extra?.resumeSessionId
      ? ['exec', 'resume', extra.resumeSessionId, prompt, '--json']
      : ['exec', prompt, '--json'];

    if (opts.permissionMode === 'skip' || opts.permissionMode === undefined) {
      args.push('--full-auto');
    }

    if (extra?.skipGitCheck) {
      args.push('--skip-git-repo-check');
    }

    if (opts.model) {
      args.push('--model', opts.model);
    }

    return args;
  }

  async *execute(
    prompt: string,
    opts: ExecOptions,
    sessionOpts?: CodexSessionOptions,
  ): AsyncIterable<OutputChunk> {
    // AC-038: Check if cwd is a git repo, warn if not
    const isGitRepo = await this.checkGitRepo(opts.cwd);
    if (!isGitRepo) {
      yield {
        type: 'status',
        content: 'Warning: Not a git repository. Codex works best in git repositories.',
        timestamp: Date.now(),
      };
    }

    // Auto-resume: use captured thread_id from previous execution
    const resumeSessionId = sessionOpts?.resumeSessionId ?? this.lastSessionId ?? undefined;

    const args = this.buildArgs(prompt, opts, {
      skipGitCheck: !isGitRepo,
      resumeSessionId,
    });

    const { env, replaceEnv } = buildAdapterEnv({
      requiredPrefixes: ['OPENAI_'],
      extraEnv: opts.env,
    });

    const execOpts: ExecOptions = { ...opts, env, replaceEnv };

    const child = this.processManager.spawn('codex', args, execOpts);

    const stdout = child.stdout;
    if (!stdout) {
      return;
    }

    // Convert Node.js Readable stdout to Web ReadableStream<string>
    const pm = this.processManager;
    const stderr = child.stderr;
    let onProcessComplete: ((payload: { timedOut?: boolean }) => void) | null = null;
    const cleanupListeners = () => {
      if (onProcessComplete) pm.removeListener('process-complete', onProcessComplete);
    };
    const stream = new ReadableStream<string>({
      start(controller) {
        onProcessComplete = (payload: { timedOut?: boolean }) => {
          cleanupListeners();
          if (payload?.timedOut) {
            try { controller.error(new ProcessTimeoutError()); } catch { /* stream may already be closed */ }
          } else {
            try { controller.close(); } catch { /* stream may already be closed */ }
          }
        };
        pm.once('process-complete', onProcessComplete);

        stdout.on('data', (data: Buffer) => {
          try { controller.enqueue(data.toString()); } catch { /* stream closed */ }
        });
        stderr?.on('data', (data: Buffer) => {
          const msg = data.toString().trim();
          if (msg) {
            try { controller.enqueue(JSON.stringify({ type: 'status', content: msg, source: 'stderr' }) + '\n'); } catch { /* stream closed */ }
          }
        });
        stdout.on('error', (err: Error) => {
          cleanupListeners();
          controller.error(err);
        });
        stderr?.on('error', () => { /* ignore stderr pipe errors */ });
      },
      cancel() {
        cleanupListeners();
      },
    });

    let sessionIdUpdated = false;
    try {
      for await (const chunk of this.parser.parse(stream)) {
        // Capture thread_id from thread.started events (metadata preserved by JsonlParser)
        if (chunk.type === 'status' && chunk.metadata?.thread_id) {
          this.lastSessionId = chunk.metadata.thread_id as string;
          sessionIdUpdated = true;
        }
        yield chunk;
      }
    } catch (err) {
      // If we were resuming and it failed, clear the stale session ID so next call starts fresh
      if (resumeSessionId) {
        this.lastSessionId = null;
      }
      throw err;
    } finally {
      // If we were resuming but no new session_id was captured, clear the stale ID
      if (resumeSessionId && !sessionIdUpdated) {
        this.lastSessionId = null;
      }
      if (this.processManager.isRunning()) {
        await this.processManager.kill();
      }
    }
  }

  async kill(): Promise<void> {
    await this.processManager.kill();
  }

  isRunning(): boolean {
    return this.processManager.isRunning();
  }

  /**
   * Check if the given directory is inside a git repository.
   */
  private checkGitRepo(cwd: string): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd, timeout: 3000 }, (err) => {
        resolve(!err);
      });
    });
  }
}

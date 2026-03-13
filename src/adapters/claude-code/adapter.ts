/**
 * ClaudeCodeAdapter — Claude Code CLI adapter implementation.
 * Source: FR-009 (AC-033, AC-034, AC-035)
 *
 * Key behaviors:
 * - Calls: claude -p <prompt> --output-format stream-json --dangerously-skip-permissions
 * - Deletes env.CLAUDECODE to prevent nesting restriction
 * - Uses --add-dir to specify project directory
 * - Captures session_id from result events for --resume on subsequent calls
 * - Parses NDJSON via StreamJsonParser
 */

import { execFile } from 'node:child_process';
import type { CLIAdapter, ExecOptions, OutputChunk } from '../../types/adapter.js';
import { ProcessManager, ProcessTimeoutError } from '../process-manager.js';
import { StreamJsonParser } from '../../parsers/stream-json-parser.js';
import { buildAdapterEnv } from '../env-builder.js';

export interface ClaudeCodeSessionOptions {
  continue?: boolean;
  resumeSessionId?: string;
}

export class ClaudeCodeAdapter implements CLIAdapter {
  readonly name = 'claude-code';
  readonly displayName = 'Claude Code';
  readonly version = '0.0.0';

  private processManager: ProcessManager;
  private parser: StreamJsonParser;
  /** Session ID captured from the most recent result event */
  private lastSessionId: string | null = null;

  constructor() {
    this.processManager = new ProcessManager();
    this.parser = new StreamJsonParser();
  }

  /** Returns true if this adapter has a captured session to resume */
  hasActiveSession(): boolean {
    return this.lastSessionId !== null;
  }

  /** Expose last captured session ID */
  getLastSessionId(): string | null {
    return this.lastSessionId;
  }

  /** Restore a previously persisted session ID (e.g. after `duo resume`) */
  restoreSessionId(id: string): void {
    this.lastSessionId = id;
  }

  async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('claude', ['--version'], { timeout: 5000 }, (err) => {
        resolve(!err);
      });
    });
  }

  async getVersion(): Promise<string> {
    return new Promise((resolve) => {
      execFile('claude', ['--version'], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          resolve('unknown');
          return;
        }
        // Parse version from output like "claude 1.2.3"
        const match = stdout.trim().match(/(\d+\.\d+\.\d+)/);
        resolve(match ? match[1] : 'unknown');
      });
    });
  }

  /**
   * Build CLI arguments for claude command.
   * Exposed for testing.
   */
  buildArgs(
    prompt: string,
    opts: ExecOptions,
    sessionOpts?: ClaudeCodeSessionOptions,
  ): string[] {
    const args: string[] = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
    ];

    if (opts.permissionMode === 'skip' || opts.permissionMode === undefined) {
      args.push('--dangerously-skip-permissions');
    }

    // Skip --system-prompt when resuming — session already has it
    const isResuming = sessionOpts?.continue || sessionOpts?.resumeSessionId;
    if (opts.systemPrompt && !isResuming) {
      args.push('--system-prompt', opts.systemPrompt);
    }

    // Disable all tools for stateless JSON-only callers (e.g. God orchestrator)
    if (opts.disableTools) {
      args.push('--tools', '');
    }

    args.push('--add-dir', opts.cwd);

    if (sessionOpts?.continue) {
      args.push('--continue');
    }

    if (sessionOpts?.resumeSessionId) {
      args.push('--resume', sessionOpts.resumeSessionId);
    }

    return args;
  }

  async *execute(
    prompt: string,
    opts: ExecOptions,
    sessionOpts?: ClaudeCodeSessionOptions,
  ): AsyncIterable<OutputChunk> {
    // Session continuation: use --resume with captured session_id (never --continue to avoid cross-contamination)
    const effectiveSessionOpts: ClaudeCodeSessionOptions = { ...sessionOpts };
    if (!effectiveSessionOpts.continue && !effectiveSessionOpts.resumeSessionId && this.lastSessionId) {
      effectiveSessionOpts.resumeSessionId = this.lastSessionId;
    }

    const args = this.buildArgs(prompt, opts, effectiveSessionOpts);

    // AC-034: Build minimal env with only required vars, delete CLAUDECODE
    const { env, replaceEnv } = buildAdapterEnv({
      requiredPrefixes: ['ANTHROPIC_', 'CLAUDE_'],
      extraEnv: opts.env,
    });
    delete env.CLAUDECODE;

    const execOpts: ExecOptions = {
      ...opts,
      env,
      replaceEnv,
    };

    const child = this.processManager.spawn('claude', args, execOpts);

    // Convert Node.js Readable stdout to Web ReadableStream<string>
    const stdout = child.stdout;
    if (!stdout) {
      return;
    }

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
            try { controller.enqueue(JSON.stringify({ type: 'error', content: msg }) + '\n'); } catch { /* stream closed */ }
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
        // Capture session_id from result events (metadata preserved by StreamJsonParser)
        if (chunk.type === 'status' && chunk.metadata?.session_id) {
          this.lastSessionId = chunk.metadata.session_id as string;
          sessionIdUpdated = true;
        }
        yield chunk;
      }
    } catch (err) {
      // If we were resuming and it failed, clear the stale session ID so next call starts fresh
      if (effectiveSessionOpts.resumeSessionId) {
        this.lastSessionId = null;
      }
      throw err;
    } finally {
      // If we were resuming but no new session_id was captured, clear the stale ID
      if (effectiveSessionOpts.resumeSessionId && !sessionIdUpdated) {
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
}

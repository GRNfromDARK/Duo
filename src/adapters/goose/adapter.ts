/**
 * GooseAdapter — Goose CLI adapter implementation.
 * Source: FR-011b
 *
 * Key behaviors:
 * - Calls: goose run -t <prompt>
 * - YOLO mode via env var GOOSE_MODE=auto (not a CLI flag)
 * - Uses TextStreamParser for plain text output parsing
 */

import { execFile } from 'node:child_process';
import type { CLIAdapter, ExecOptions, OutputChunk } from '../../types/adapter.js';
import { ProcessManager, ProcessTimeoutError } from '../process-manager.js';
import { TextStreamParser } from '../../parsers/text-stream-parser.js';
import { buildAdapterEnv } from '../env-builder.js';

export class GooseAdapter implements CLIAdapter {
  readonly name = 'goose';
  readonly displayName = 'Goose';
  readonly version = '0.0.0';

  private processManager: ProcessManager;
  private parser: TextStreamParser;

  constructor() {
    this.processManager = new ProcessManager();
    this.parser = new TextStreamParser();
  }

  async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('goose', ['--version'], { timeout: 5000 }, (err) => {
        resolve(!err);
      });
    });
  }

  async getVersion(): Promise<string> {
    return new Promise((resolve) => {
      execFile('goose', ['--version'], { timeout: 5000 }, (err, stdout) => {
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
   * Build CLI arguments for goose command.
   * Exposed for testing.
   */
  buildArgs(prompt: string): string[] {
    return ['run', '-t', prompt];
  }

  /**
   * Build environment variables for goose.
   * GOOSE_MODE=auto is set via env, not CLI flag.
   * Exposed for testing.
   */
  buildEnv(opts: ExecOptions): { env: Record<string, string>; replaceEnv: true } {
    const extra: Record<string, string> = { ...(opts.env ?? {}) };
    if (opts.permissionMode === 'skip' || opts.permissionMode === undefined) {
      extra.GOOSE_MODE = 'auto';
    }
    return buildAdapterEnv({
      requiredPrefixes: ['GOOSE_'],
      extraEnv: extra,
    });
  }

  async *execute(
    prompt: string,
    opts: ExecOptions,
  ): AsyncIterable<OutputChunk> {
    const args = this.buildArgs(prompt);
    const { env, replaceEnv } = this.buildEnv(opts);

    const execOpts: ExecOptions = { ...opts, env, replaceEnv };

    const child = this.processManager.spawn('goose', args, execOpts);

    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout) {
      return;
    }

    const pm = this.processManager;
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
            try { controller.enqueue(`Error: ${msg}\n`); } catch { /* stream closed */ }
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

    try {
      yield* this.parser.parse(stream);
    } finally {
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

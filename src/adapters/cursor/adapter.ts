/**
 * CursorAdapter — Cursor CLI adapter implementation.
 * Source: FR-011b
 *
 * Key behaviors:
 * - Calls: cursor agent -p <prompt> --auto-approve
 * - Uses JsonlParser for JSON output parsing
 */

import { execFile } from 'node:child_process';
import type { CLIAdapter, ExecOptions, OutputChunk } from '../../types/adapter.js';
import { ProcessManager, ProcessTimeoutError } from '../process-manager.js';
import { JsonlParser } from '../../parsers/jsonl-parser.js';
import { buildAdapterEnv } from '../env-builder.js';

export class CursorAdapter implements CLIAdapter {
  readonly name = 'cursor';
  readonly displayName = 'Cursor';
  readonly version = '0.0.0';

  private processManager: ProcessManager;
  private parser: JsonlParser;

  constructor() {
    this.processManager = new ProcessManager();
    this.parser = new JsonlParser();
  }

  async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('cursor', ['--version'], { timeout: 5000 }, (err) => {
        resolve(!err);
      });
    });
  }

  async getVersion(): Promise<string> {
    return new Promise((resolve) => {
      execFile('cursor', ['--version'], { timeout: 5000 }, (err, stdout) => {
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
   * Build CLI arguments for cursor command.
   * Exposed for testing.
   */
  buildArgs(prompt: string, opts: ExecOptions): string[] {
    const args: string[] = ['agent', '-p', prompt];

    if (opts.permissionMode === 'skip' || opts.permissionMode === undefined) {
      args.push('--auto-approve');
    }

    if (opts.model) {
      args.push('--model', opts.model);
    }

    return args;
  }

  async *execute(
    prompt: string,
    opts: ExecOptions,
  ): AsyncIterable<OutputChunk> {
    const args = this.buildArgs(prompt, opts);

    const { env, replaceEnv } = buildAdapterEnv({
      requiredPrefixes: ['CURSOR_'],
      extraEnv: opts.env,
    });

    const execOpts: ExecOptions = { ...opts, env, replaceEnv };

    const child = this.processManager.spawn('cursor', args, execOpts);

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

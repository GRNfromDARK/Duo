/**
 * AmpAdapter — Amp CLI adapter implementation.
 * Source: FR-011b
 *
 * Key behaviors:
 * - Calls: amp -x <prompt>
 * - Uses StreamJsonParser for stream-json output parsing
 * - Amp has built-in auto mode (no yolo flag needed)
 */

import { execFile } from 'node:child_process';
import type { CLIAdapter, ExecOptions, OutputChunk } from '../../types/adapter.js';
import { ProcessManager, ProcessTimeoutError } from '../process-manager.js';
import { StreamJsonParser } from '../../parsers/stream-json-parser.js';
import { buildAdapterEnv } from '../env-builder.js';

export class AmpAdapter implements CLIAdapter {
  readonly name = 'amp';
  readonly displayName = 'Amp';
  readonly version = '0.0.0';

  private processManager: ProcessManager;
  private parser: StreamJsonParser;

  constructor() {
    this.processManager = new ProcessManager();
    this.parser = new StreamJsonParser();
  }

  async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('amp', ['--version'], { timeout: 5000 }, (err) => {
        resolve(!err);
      });
    });
  }

  async getVersion(): Promise<string> {
    return new Promise((resolve) => {
      execFile('amp', ['--version'], { timeout: 5000 }, (err, stdout) => {
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
   * Build CLI arguments for amp command.
   * Exposed for testing.
   */
  buildArgs(prompt: string, _opts: ExecOptions): string[] {
    // SPEC-DECISION: chose empty yoloFlag because Amp has built-in auto mode
    return ['-x', prompt];
  }

  async *execute(
    prompt: string,
    opts: ExecOptions,
  ): AsyncIterable<OutputChunk> {
    const args = this.buildArgs(prompt, opts);

    const { env, replaceEnv } = buildAdapterEnv({
      requiredPrefixes: ['AMP_'],
      extraEnv: opts.env,
    });

    const execOpts: ExecOptions = { ...opts, env, replaceEnv };

    const child = this.processManager.spawn('amp', args, execOpts);

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

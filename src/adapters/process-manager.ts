/**
 * ProcessManager — manages CLI subprocess lifecycle.
 * Source: FR-012 (AC-041, AC-042, AC-043, AC-044)
 *
 * Responsibilities:
 * - spawn with detached process group + independent env
 * - graceful kill: SIGTERM → 5s wait → SIGKILL (process group -pid)
 * - configurable timeout (default 10 minutes)
 * - heartbeat detection (30s interval, 60s no-output warning)
 * - error/crash events
 */

import { spawn as cpSpawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { ExecOptions } from '../types/adapter.js';

/**
 * Error thrown when a process is terminated due to timeout.
 * Adapters throw this so the orchestration layer can dispatch TIMEOUT to the state machine.
 */
export class ProcessTimeoutError extends Error {
  constructor(message = 'Process timed out') {
    super(message);
    this.name = 'ProcessTimeoutError';
  }
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const SIGTERM_GRACE_MS = 5000;
const SIGKILL_TIMEOUT_MS = 3000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER_BYTES = 50 * 1024 * 1024; // 50MB

export interface HeartbeatOptions {
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}

export interface ProcessErrorInfo {
  exitCode: number | null;
  signal: string | null;
  message: string;
}

export interface ProcessManagerOptions {
  maxBufferBytes?: number;
}

export class ProcessManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private running = false;
  private outputBuffer: string[] = [];
  private outputBufferBytes = 0;
  private readonly maxBufferBytes: number;

  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastOutputTime = 0;
  private heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS;

  private exitPromiseResolve: ((code: number | null) => void) | null = null;
  private exitPromise: Promise<number | null> | null = null;

  private parentExitHandler: (() => void) | null = null;
  private timedOut = false;

  constructor(opts?: ProcessManagerOptions) {
    super();
    this.maxBufferBytes = opts?.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  }

  /**
   * Spawn a child process with detached process group and independent env/CWD.
   */
  spawn(
    command: string,
    args: string[],
    opts: ExecOptions,
    heartbeatOpts?: HeartbeatOptions,
  ): ChildProcess {
    if (this.running) {
      throw new Error('ProcessManager: a process is already running');
    }

    const env: Record<string, string> = opts.replaceEnv && opts.env
      ? { ...opts.env }
      : { ...process.env as Record<string, string>, ...(opts.env ?? {}) };

    this.outputBuffer = [];
    this.outputBufferBytes = 0;
    this.lastOutputTime = Date.now();
    this.timedOut = false;

    this.child = cpSpawn(command, args, {
      cwd: opts.cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.running = true;

    // Set up exit promise
    this.exitPromise = new Promise<number | null>((resolve) => {
      this.exitPromiseResolve = resolve;
    });

    // Capture stdout
    this.child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.appendOutput(text);
      this.lastOutputTime = Date.now();
    });

    // Capture stderr
    this.child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.appendOutput(text);
      this.lastOutputTime = Date.now();
    });

    // Handle close (fires after all stdio streams are closed, unlike 'exit')
    this.child.on('close', (code, signal) => {
      this.running = false;
      this.clearTimers();

      if (code !== null && code !== 0) {
        const errorInfo: ProcessErrorInfo = {
          exitCode: code,
          signal: signal ?? null,
          message: `Process exited with code ${code}`,
        };
        this.emit('process-error', errorInfo);
      }

      // Always emit process-complete so adapters can finalize streams
      // after all stdio is closed and exit code is known.
      this.emit('process-complete', { exitCode: code, signal: signal ?? null, timedOut: this.timedOut });

      this.exitPromiseResolve?.(code);
    });

    // Handle spawn error (e.g. command not found)
    this.child.on('error', (err) => {
      this.running = false;
      this.clearTimers();

      const errorInfo: ProcessErrorInfo = {
        exitCode: null,
        signal: null,
        message: err.message,
      };
      this.emit('process-error', errorInfo);
      this.emit('process-complete', { exitCode: null, signal: null, timedOut: this.timedOut });

      this.exitPromiseResolve?.(null);
    });

    // Set up timeout
    const timeoutMs = opts.timeout ?? DEFAULT_TIMEOUT_MS;
    this.timeoutTimer = setTimeout(() => {
      if (this.running) {
        this.timedOut = true;
        this.emit('timeout');
        void this.kill();
      }
    }, timeoutMs);

    // Set up heartbeat
    const hbInterval = heartbeatOpts?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = heartbeatOpts?.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;

    this.heartbeatTimer = setInterval(() => {
      if (!this.running) {
        this.clearHeartbeat();
        return;
      }
      const elapsed = Date.now() - this.lastOutputTime;
      if (elapsed >= this.heartbeatTimeoutMs) {
        this.emit('heartbeat-warning', { silentMs: elapsed });
      }
    }, hbInterval);

    // Register parent process exit handler to kill detached child
    this.parentExitHandler = () => {
      if (this.child?.pid && this.running) {
        try { process.kill(-this.child.pid, 'SIGKILL'); } catch { /* already exited */ }
      }
    };
    process.on('exit', this.parentExitHandler);

    return this.child;
  }

  /**
   * Graceful kill: SIGTERM → wait 5s → SIGKILL, using process group (-pid).
   */
  async kill(): Promise<void> {
    if (!this.child || !this.running) {
      return;
    }

    const pid = this.child.pid;
    if (pid === undefined) {
      return;
    }

    // Clear timeout and heartbeat timers but keep parentExitHandler
    // until child process is confirmed dead
    this.clearTimeoutAndHeartbeat();

    // Send SIGTERM to process group
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // Process may have already exited
      this.running = false;
      this.clearParentExitHandler();
      return;
    }

    // Wait for graceful exit or escalate to SIGKILL
    const exited = await Promise.race([
      this.waitForExitInternal().then(() => true),
      new Promise<false>((resolve) =>
        setTimeout(() => resolve(false), SIGTERM_GRACE_MS),
      ),
    ]);

    if (!exited && this.running) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Already dead
      }
      // Wait for SIGKILL to take effect, with hard timeout
      await Promise.race([
        this.waitForExitInternal(),
        new Promise<void>(resolve => setTimeout(resolve, SIGKILL_TIMEOUT_MS)),
      ]).catch(() => {});
    }

    this.running = false;
    this.clearParentExitHandler();
  }

  /**
   * Check if the managed process is still running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Check if the last process was terminated due to a timeout.
   */
  wasTimedOut(): boolean {
    return this.timedOut;
  }

  /**
   * Wait for the process to exit. Returns exit code (null if killed by signal).
   */
  async waitForExit(): Promise<number | null> {
    if (!this.exitPromise) {
      return null;
    }
    return this.exitPromise;
  }

  /**
   * Collect all output from the process (waits for exit).
   */
  async collectOutput(): Promise<string> {
    await this.waitForExit();
    return this.outputBuffer.join('');
  }

  /**
   * Get currently buffered output without waiting.
   */
  getBufferedOutput(): string {
    return this.outputBuffer.join('');
  }

  /**
   * Clean up all timers and listeners. Kills the process first if still running.
   * Call when done with this ProcessManager instance.
   */
  async dispose(): Promise<void> {
    this.clearTimeoutAndHeartbeat(); // Only clear timeout/heartbeat, keep parentExitHandler
    if (this.running && this.child?.pid) {
      await this.kill(); // kill() preserves parentExitHandler until child exits
    }
    this.clearParentExitHandler(); // Now safe to remove after kill completes
    if (this.child) {
      this.child.stdout?.removeAllListeners();
      this.child.stderr?.removeAllListeners();
      this.child.removeAllListeners();
    }
    this.removeAllListeners();
    this.running = false;
  }

  private clearTimers(): void {
    this.clearTimeoutAndHeartbeat();
    this.clearParentExitHandler();
  }

  private clearTimeoutAndHeartbeat(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.clearHeartbeat();
  }

  private clearParentExitHandler(): void {
    if (this.parentExitHandler) {
      process.removeListener('exit', this.parentExitHandler);
      this.parentExitHandler = null;
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private waitForExitInternal(): Promise<void> {
    if (!this.running || !this.exitPromise) {
      return Promise.resolve();
    }

    return this.exitPromise.then(() => {});
  }

  private appendOutput(text: string): void {
    if (!text) {
      return;
    }

    this.outputBuffer.push(text);
    this.outputBufferBytes += Buffer.byteLength(text, 'utf-8');

    if (this.outputBufferBytes > this.maxBufferBytes) {
      // Join all chunks and keep only the newest maxBufferBytes bytes
      const joined = this.outputBuffer.join('');
      const buf = Buffer.from(joined, 'utf-8');
      let sliced = buf.slice(-this.maxBufferBytes);
      // Skip truncated UTF-8 leading bytes (continuation bytes: 0x80-0xBF)
      let start = 0;
      while (start < sliced.length && (sliced[start] & 0xC0) === 0x80) {
        start++;
      }
      if (start > 0) {
        sliced = sliced.slice(start);
      }
      const slicedStr = sliced.toString('utf-8');
      this.outputBuffer.length = 0;
      this.outputBuffer.push(slicedStr);
      this.outputBufferBytes = Buffer.byteLength(slicedStr, 'utf-8');
    }
  }
}

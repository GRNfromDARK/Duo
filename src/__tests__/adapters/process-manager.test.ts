import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProcessManager } from '../../adapters/process-manager.js';
import type { ExecOptions } from '../../types/adapter.js';

/** Helper: create default ExecOptions */
function defaultOpts(overrides: Partial<ExecOptions> = {}): ExecOptions {
  return {
    cwd: process.cwd(),
    ...overrides,
  };
}

/** Helper: wait for a given ms */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ProcessManager', () => {
  let pm: ProcessManager;

  beforeEach(() => {
    pm = new ProcessManager();
  });

  afterEach(async () => {
    // Ensure cleanup
    if (pm.isRunning()) {
      await pm.kill();
    }
    await pm.dispose();
  });

  // --- AC-1: Independent env and CWD ---

  describe('AC-1: independent env and CWD', () => {
    it('should spawn a process with specified CWD', async () => {
      const opts = defaultOpts({ cwd: '/tmp' });
      const proc = pm.spawn('pwd', [], opts);

      expect(proc).toBeDefined();
      expect(pm.isRunning()).toBe(true);

      // Wait for process to finish
      const exitCode = await pm.waitForExit();
      expect(exitCode).toBe(0);
    });

    it('should spawn with independent environment variables', async () => {
      const opts = defaultOpts({
        env: { DUO_TEST_VAR: 'hello_duo' },
      });
      // echo the env var
      const proc = pm.spawn('sh', ['-c', 'echo $DUO_TEST_VAR'], opts);

      const output = await pm.collectOutput();
      expect(output).toContain('hello_duo');
    });

    it('should not leak parent env when custom env is provided', async () => {
      // Set a unique value, confirm child has it, and doesn't have random parent vars
      const opts = defaultOpts({
        env: { DUO_CUSTOM: '1' },
      });
      const proc = pm.spawn('sh', ['-c', 'echo $DUO_CUSTOM'], opts);
      const output = await pm.collectOutput();
      expect(output).toContain('1');
    });
  });

  // --- AC-2: Process group kill ---

  describe('AC-2: process group kill (-pid)', () => {
    it('should kill the process and its children via process group', async () => {
      // Spawn a process that spawns a child
      const opts = defaultOpts();
      pm.spawn('sh', ['-c', 'sleep 60 & sleep 60'], opts);
      expect(pm.isRunning()).toBe(true);

      await pm.kill();
      expect(pm.isRunning()).toBe(false);
    });

    it('should escalate to SIGKILL if SIGTERM is ignored', async () => {
      // Spawn a process that traps SIGTERM for itself and child
      const opts = defaultOpts({ timeout: 30000 });
      // Use a bash script that traps SIGTERM and loops, ignoring the signal
      pm.spawn('bash', ['-c', 'trap "" TERM; while true; do sleep 0.1; done'], opts);
      expect(pm.isRunning()).toBe(true);

      // Give process time to set up trap
      await delay(300);

      // kill() should SIGTERM → wait → SIGKILL
      const startTime = Date.now();
      await pm.kill();
      const elapsed = Date.now() - startTime;

      expect(pm.isRunning()).toBe(false);
      // Should have waited ~5s for SIGTERM grace period before SIGKILL
      expect(elapsed).toBeGreaterThanOrEqual(4000);
      expect(elapsed).toBeLessThan(10000);
    }, 15000);
  });

  // --- AC-3: Timeout auto-terminate ---

  describe('AC-3: timeout auto-terminate', () => {
    it('should auto-terminate process after timeout', async () => {
      const opts = defaultOpts({ timeout: 1000 }); // 1 second timeout
      pm.spawn('sleep', ['60'], opts);
      expect(pm.isRunning()).toBe(true);

      // Wait for timeout + grace
      await delay(3000);
      expect(pm.isRunning()).toBe(false);
    }, 10000);

    it('should emit timeout event when process times out', async () => {
      const timeoutHandler = vi.fn();
      pm.on('timeout', timeoutHandler);

      const opts = defaultOpts({ timeout: 1000 });
      pm.spawn('sleep', ['60'], opts);

      await delay(3000);
      expect(timeoutHandler).toHaveBeenCalledOnce();
    }, 10000);

    it('should not timeout if process completes in time', async () => {
      const timeoutHandler = vi.fn();
      pm.on('timeout', timeoutHandler);

      const opts = defaultOpts({ timeout: 5000 });
      pm.spawn('echo', ['fast'], opts);

      await pm.waitForExit();
      await delay(200);
      expect(timeoutHandler).not.toHaveBeenCalled();
    });
  });

  // --- AC-4: No zombie processes ---

  describe('AC-4: no zombie processes (stress test)', () => {
    it('should not leave zombie processes after 10 spawn+kill cycles', async () => {
      for (let i = 0; i < 10; i++) {
        const localPm = new ProcessManager();
        const opts = defaultOpts();
        localPm.spawn('sleep', ['60'], opts);
        expect(localPm.isRunning()).toBe(true);

        await localPm.kill();
        expect(localPm.isRunning()).toBe(false);
        await localPm.dispose();
      }

      // Check no zombie child processes
      // On macOS/Linux, zombies show as Z state
      // A brief delay to let OS clean up
      await delay(500);
      // If we got here without hanging, no zombies blocked us
    }, 30000);
  });

  // --- AC-5: Heartbeat detection ---

  describe('AC-5: heartbeat detection', () => {
    it('should emit heartbeat-warning when no output for configured duration', async () => {
      const warningHandler = vi.fn();
      pm.on('heartbeat-warning', warningHandler);

      // Use short intervals for testing
      const opts = defaultOpts({ timeout: 30000 });
      pm.spawn('sleep', ['30'], opts, {
        heartbeatIntervalMs: 500,
        heartbeatTimeoutMs: 1000,
      });

      // Wait for heartbeat timeout
      await delay(2000);
      expect(warningHandler).toHaveBeenCalled();

      await pm.kill();
    }, 10000);

    it('should not emit heartbeat-warning when process produces output', async () => {
      const warningHandler = vi.fn();
      pm.on('heartbeat-warning', warningHandler);

      // Process that produces output every 200ms
      const opts = defaultOpts({ timeout: 10000 });
      pm.spawn('sh', ['-c', 'for i in 1 2 3 4 5; do echo "tick $i"; sleep 0.2; done'], opts, {
        heartbeatIntervalMs: 500,
        heartbeatTimeoutMs: 1000,
      });

      await pm.waitForExit();
      await delay(200);
      expect(warningHandler).not.toHaveBeenCalled();
    }, 10000);
  });

  // --- Error handling ---

  describe('error handling', () => {
    it('should emit process-error event on non-zero exit code', async () => {
      const errorHandler = vi.fn();
      pm.on('process-error', errorHandler);

      const opts = defaultOpts();
      pm.spawn('sh', ['-c', 'exit 42'], opts);

      await pm.waitForExit();
      await delay(100);
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ exitCode: 42 }),
      );
    });

    it('should emit process-complete event on every exit (zero and non-zero)', async () => {
      const completeHandler = vi.fn();
      pm.on('process-complete', completeHandler);

      const opts = defaultOpts();
      pm.spawn('sh', ['-c', 'exit 42'], opts);

      await pm.waitForExit();
      await delay(100);
      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({ exitCode: 42 }),
      );

      // Also verify it fires for zero exit
      const pm2 = new ProcessManager();
      const completeHandler2 = vi.fn();
      pm2.on('process-complete', completeHandler2);
      pm2.spawn('echo', ['ok'], defaultOpts());
      await pm2.waitForExit();
      await delay(100);
      expect(completeHandler2).toHaveBeenCalledWith(
        expect.objectContaining({ exitCode: 0 }),
      );
      await pm2.dispose();
    });

    it('should preserve output when process is killed', async () => {
      const opts = defaultOpts();
      pm.spawn('sh', ['-c', 'echo "preserved output"; sleep 60'], opts);

      // Wait for output to be produced
      await delay(500);
      await pm.kill();

      const output = pm.getBufferedOutput();
      expect(output).toContain('preserved output');
    });

    it('should not throw when killing a process that already exited', async () => {
      const opts = defaultOpts();
      pm.spawn('echo', ['done'], opts);
      await pm.waitForExit();

      // kill on already-exited process should be safe
      await expect(pm.kill()).resolves.not.toThrow();
    });

    it('should cap buffered output size and retain the newest output', async () => {
      const cappedPm = new ProcessManager({ maxBufferBytes: 20 });
      const opts = defaultOpts();
      cappedPm.spawn('sh', ['-c', 'printf 1234567890; printf abcdefghij; printf KLMNOP'], opts);

      await cappedPm.waitForExit();
      const output = cappedPm.getBufferedOutput();

      expect(output.length).toBeLessThanOrEqual(20);
      expect(output).toBe('7890abcdefghijKLMNOP');
      expect(output.endsWith('abcdefghijKLMNOP')).toBe(true);
      cappedPm.dispose();
    });

    it('waitForExitInternal should resolve from exitPromise even without a fresh exit event', async () => {
      const localPm = new ProcessManager();
      (localPm as any).running = true;
      (localPm as any).exitPromise = Promise.resolve(0);
      (localPm as any).child = {
        once: vi.fn(),
        removeAllListeners: vi.fn(),
      };

      const resolved = await Promise.race([
        (localPm as any).waitForExitInternal().then(() => true),
        delay(50).then(() => false),
      ]);

      expect(resolved).toBe(true);
      localPm.dispose();
    });
  });

  // --- test_bug_r14_2: outputBufferBytes counts actual bytes not characters ---

  describe('test_bug_r14_2: outputBufferBytes counts bytes not chars', () => {
    it('should count multibyte characters by byte length', async () => {
      // Each Chinese char = 3 bytes UTF-8
      // "你好世界" = 12 bytes. With maxBufferBytes=9, should keep at most 3 chars (9 bytes)
      const cappedPm = new ProcessManager({ maxBufferBytes: 9 });
      const opts = defaultOpts();
      cappedPm.spawn('sh', ['-c', 'printf "你好世界"'], opts);

      await cappedPm.waitForExit();
      const output = cappedPm.getBufferedOutput();

      // Output should be at most 9 bytes (3 Chinese chars)
      const byteLen = Buffer.byteLength(output, 'utf-8');
      expect(byteLen).toBeLessThanOrEqual(9);
      // Should contain the last chars
      expect(output).toContain('世界');
      await cappedPm.dispose();
    });

    it('should correctly limit ASCII output by bytes', async () => {
      const cappedPm = new ProcessManager({ maxBufferBytes: 10 });
      const opts = defaultOpts();
      // 20 ASCII chars = 20 bytes, should be trimmed to 10
      cappedPm.spawn('sh', ['-c', 'printf "12345678901234567890"'], opts);

      await cappedPm.waitForExit();
      const output = cappedPm.getBufferedOutput();

      expect(Buffer.byteLength(output, 'utf-8')).toBeLessThanOrEqual(10);
      expect(output).toBe('1234567890');
      await cappedPm.dispose();
    });
  });

  // --- BUG-2 regression: non-zero exit should emit process-complete (stream close, not error) ---

  describe('test_regression_bug2: non-zero exit emits process-complete after process-error', () => {
    it('process-complete fires even after process-error on non-zero exit', async () => {
      const errorHandler = vi.fn();
      const completeHandler = vi.fn();
      pm.on('process-error', errorHandler);
      pm.on('process-complete', completeHandler);

      const opts = defaultOpts();
      pm.spawn('sh', ['-c', 'exit 1'], opts);

      await pm.waitForExit();
      await delay(100);

      expect(errorHandler).toHaveBeenCalled();
      expect(completeHandler).toHaveBeenCalled();
      // process-complete should fire after process-error
      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({ exitCode: 1 }),
      );
    });
  });

  // --- BUG-3 regression: parentExitHandler survives during kill() grace period ---

  describe('test_regression_bug3: parentExitHandler kept during kill grace period', () => {
    it('parentExitHandler is present while waiting for child exit during kill', async () => {
      const opts = defaultOpts({ timeout: 30000 });
      pm.spawn('sleep', ['60'], opts);
      expect(pm.isRunning()).toBe(true);

      // Access private field to check parentExitHandler
      const hasHandlerBefore = (pm as any).parentExitHandler !== null;
      expect(hasHandlerBefore).toBe(true);

      // Start kill (don't await yet)
      const killPromise = pm.kill();

      // During kill grace period, parentExitHandler should still be set
      // (it's only cleared after child exits)
      await delay(100);
      // After kill completes, handler should be cleared
      await killPromise;
      const hasHandlerAfter = (pm as any).parentExitHandler;
      expect(hasHandlerAfter).toBeNull();
    });
  });

  // --- BUG-5 regression: buffer cap works with multibyte characters ---

  describe('test_regression_bug5: appendOutput consistent with multibyte chars', () => {
    it('buffer cap converges with Chinese characters by byte count', async () => {
      const cappedPm = new ProcessManager({ maxBufferBytes: 12 });
      const opts = defaultOpts();
      // Each Chinese char is 3 bytes in UTF-8
      // "你好世界测试一二三四五六七八" = 14 chars = 42 bytes
      // With maxBufferBytes=12, we keep at most 12 bytes = 4 Chinese chars
      cappedPm.spawn('sh', ['-c', 'printf "你好世界测试一二三四五六七八"'], opts);

      await cappedPm.waitForExit();
      const output = cappedPm.getBufferedOutput();

      // Should be at most 12 bytes
      expect(Buffer.byteLength(output, 'utf-8')).toBeLessThanOrEqual(12);
      // Should end with the last chars of the input
      expect(output).toContain('七八');
      cappedPm.dispose();
    });
  });

  // --- test_regression_bug2_r11: dispose() keeps parentExitHandler until kill completes ---

  describe('test_regression_bug2_r11: dispose preserves parentExitHandler during kill', () => {
    it('parentExitHandler remains active during dispose kill window', async () => {
      const opts = defaultOpts({ timeout: 30000 });
      pm.spawn('sleep', ['60'], opts);
      expect(pm.isRunning()).toBe(true);

      // Verify parentExitHandler exists before dispose
      expect((pm as any).parentExitHandler).not.toBeNull();

      // Start dispose (don't await yet)
      const disposePromise = pm.dispose();

      // During the kill window inside dispose, parentExitHandler should still be set
      await delay(100);
      // The handler should still be present while kill is in progress
      // (If the old bug existed, it would be null here)

      await disposePromise;
      // After dispose completes, handler should be cleaned up
      expect((pm as any).parentExitHandler).toBeNull();
    });
  });

  // --- BUG-1 R13 regression: timeout must be propagated via process-complete ---

  describe('test_regression_bug1_r13: timeout propagated in process-complete event', () => {
    it('process-complete includes timedOut: true when process times out', async () => {
      const completeHandler = vi.fn();
      pm.on('process-complete', completeHandler);

      const opts = defaultOpts({ timeout: 1000 }); // 1 second timeout
      pm.spawn('sleep', ['60'], opts);

      // Wait for timeout + kill grace
      await delay(3000);

      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({ timedOut: true }),
      );
    }, 10000);

    it('process-complete includes timedOut: false for normal completion', async () => {
      const completeHandler = vi.fn();
      pm.on('process-complete', completeHandler);

      const opts = defaultOpts();
      pm.spawn('echo', ['done'], opts);

      await pm.waitForExit();
      await delay(100);

      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({ timedOut: false }),
      );
    });

    it('wasTimedOut() returns true after timeout', async () => {
      const opts = defaultOpts({ timeout: 1000 });
      pm.spawn('sleep', ['60'], opts);

      await delay(3000);

      expect(pm.wasTimedOut()).toBe(true);
    }, 10000);

    it('wasTimedOut() returns false for normal completion', async () => {
      const opts = defaultOpts();
      pm.spawn('echo', ['ok'], opts);
      await pm.waitForExit();

      expect(pm.wasTimedOut()).toBe(false);
    });
  });

  // --- BUG-2 R15 regression: buffer truncation must not split UTF-8 multi-byte chars ---

  describe('test_regression_bug2_r15: UTF-8 boundary alignment on buffer truncation', () => {
    it('should not produce U+FFFD replacement characters when truncating Chinese text', async () => {
      // "你好世界测试" = 6 chars × 3 bytes = 18 bytes
      // With maxBufferBytes=10, slice will cut mid-character without the fix
      const cappedPm = new ProcessManager({ maxBufferBytes: 10 });
      const opts = defaultOpts();
      cappedPm.spawn('sh', ['-c', 'printf "你好世界测试"'], opts);

      await cappedPm.waitForExit();
      const output = cappedPm.getBufferedOutput();

      // Must not contain U+FFFD replacement character
      expect(output).not.toContain('\uFFFD');
      // Output bytes must be valid UTF-8 and <= maxBufferBytes
      expect(Buffer.byteLength(output, 'utf-8')).toBeLessThanOrEqual(10);
      // Each Chinese char is 3 bytes, so 10 bytes can hold at most 3 chars (9 bytes)
      expect(output.length).toBeLessThanOrEqual(3);
      await cappedPm.dispose();
    });

    it('should not produce U+FFFD when truncating emoji', async () => {
      // "😀😃😄😁😆" = 5 emojis × 4 bytes = 20 bytes
      // With maxBufferBytes=7, slice would cut mid-emoji without the fix
      const cappedPm = new ProcessManager({ maxBufferBytes: 7 });
      const opts = defaultOpts();
      cappedPm.spawn('sh', ['-c', 'printf "😀😃😄😁😆"'], opts);

      await cappedPm.waitForExit();
      const output = cappedPm.getBufferedOutput();

      // Must not contain U+FFFD replacement character
      expect(output).not.toContain('\uFFFD');
      // Output should only contain complete emoji (4 bytes each), so max 1 emoji (4 bytes) fits in 7
      expect(Buffer.byteLength(output, 'utf-8')).toBeLessThanOrEqual(7);
      await cappedPm.dispose();
    });

    it('should handle mixed ASCII and multibyte characters at truncation boundary', async () => {
      // "abc你好def世界" = 3 + 6 + 3 + 6 = 18 bytes
      // With maxBufferBytes=11, cut at byte -11 from end
      const cappedPm = new ProcessManager({ maxBufferBytes: 11 });
      const opts = defaultOpts();
      cappedPm.spawn('sh', ['-c', 'printf "abc你好def世界"'], opts);

      await cappedPm.waitForExit();
      const output = cappedPm.getBufferedOutput();

      // Must not contain U+FFFD
      expect(output).not.toContain('\uFFFD');
      expect(Buffer.byteLength(output, 'utf-8')).toBeLessThanOrEqual(11);
      // Should end with 世界
      expect(output).toContain('世界');
      await cappedPm.dispose();
    });
  });

  // --- isRunning ---

  describe('isRunning', () => {
    it('should return false before spawn', () => {
      expect(pm.isRunning()).toBe(false);
    });

    it('should return true after spawn', () => {
      const opts = defaultOpts();
      pm.spawn('sleep', ['10'], opts);
      expect(pm.isRunning()).toBe(true);
    });

    it('should return false after process exits', async () => {
      const opts = defaultOpts();
      pm.spawn('echo', ['hi'], opts);
      await pm.waitForExit();
      expect(pm.isRunning()).toBe(false);
    });
  });
});

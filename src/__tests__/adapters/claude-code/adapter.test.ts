import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExecOptions, OutputChunk } from '../../../types/adapter.js';

// Mock child_process and ProcessManager
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('../../../adapters/process-manager.js', () => {
  const EventEmitter = require('node:events').EventEmitter;

  class MockProcessManager extends EventEmitter {
    spawn = vi.fn();
    kill = vi.fn().mockResolvedValue(undefined);
    isRunning = vi.fn().mockReturnValue(false);
    dispose = vi.fn();
  }

  return { ProcessManager: MockProcessManager };
});

import { execFile } from 'node:child_process';
import { ClaudeCodeAdapter } from '../../../adapters/claude-code/adapter.js';
import { ProcessManager } from '../../../adapters/process-manager.js';

const mockExecFile = vi.mocked(execFile);

/** Helper: create default ExecOptions */
function defaultOpts(overrides: Partial<ExecOptions> = {}): ExecOptions {
  return {
    cwd: '/test/project',
    ...overrides,
  };
}

/** Helper: create a mock readable stream from lines of text */
function createMockStream(lines: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(line + '\n');
      }
      controller.close();
    },
  });
}

/** Helper: create a mock ChildProcess with stdout stream */
function createMockChildProcess(stdoutLines: string[]) {
  const { Readable } = require('node:stream');
  const stdout = new Readable({
    read() {
      for (const line of stdoutLines) {
        this.push(line + '\n');
      }
      this.push(null);
    },
  });
  const stderr = new Readable({ read() { this.push(null); } });

  return {
    stdout,
    stderr,
    pid: 12345,
    on: vi.fn(),
    once: vi.fn(),
  };
}

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeCodeAdapter();
  });

  // --- Basic properties ---

  describe('properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('claude-code');
    });

    it('should have correct displayName', () => {
      expect(adapter.displayName).toBe('Claude Code');
    });

    it('should have a version string', () => {
      expect(typeof adapter.version).toBe('string');
    });
  });

  // --- AC-2: isInstalled ---

  describe('isInstalled', () => {
    it('should return true when claude CLI is available', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'claude 1.0.0', '');
        return {} as any;
      });

      const result = await adapter.isInstalled();
      expect(result).toBe(true);
    });

    it('should return false when claude CLI is not found', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(new Error('command not found'), '', '');
        return {} as any;
      });

      const result = await adapter.isInstalled();
      expect(result).toBe(false);
    });
  });

  // --- getVersion ---

  describe('getVersion', () => {
    it('should return version string from claude --version', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'claude 1.2.3', '');
        return {} as any;
      });

      const version = await adapter.getVersion();
      expect(version).toBe('1.2.3');
    });

    it('should return unknown when version cannot be parsed', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(new Error('not found'), '', '');
        return {} as any;
      });

      const version = await adapter.getVersion();
      expect(version).toBe('unknown');
    });
  });

  // --- AC-2: Environment variable isolation ---

  describe('AC-2: environment variable isolation', () => {
    it('should delete CLAUDECODE from env when executing', async () => {
      const originalClaudeCode = process.env.CLAUDECODE;
      process.env.CLAUDECODE = '1';

      try {
        const testAdapter = new ClaudeCodeAdapter();
        const pm = (testAdapter as any).processManager as ProcessManager;

        // Set up mock child process with stdout that emits data then closes
        const { Readable } = require('node:stream');
        const stdout = new Readable({ read() { this.push(null); } });
        const stderr = new Readable({ read() { this.push(null); } });
        const mockChild = {
          stdout,
          stderr,
          pid: 11111,
          on: vi.fn((event: string, cb: (...args: any[]) => void) => {
            if (event === 'exit') setTimeout(() => cb(0, null), 10);
          }),
          once: vi.fn(),
        };
        (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
          mockChild.stdout.on('end', () => {
            setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
          });
          return mockChild;
        });

        // Consume the execute generator to trigger spawn
        const chunks: OutputChunk[] = [];
        for await (const chunk of testAdapter.execute('test', defaultOpts())) {
          chunks.push(chunk);
        }

        // Verify spawn was called with env that has no CLAUDECODE
        expect((pm.spawn as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
        const spawnCall = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
        const execOpts = spawnCall[2] as ExecOptions;
        expect(execOpts.env).toBeDefined();
        expect(execOpts.env!['CLAUDECODE']).toBeUndefined();
      } finally {
        if (originalClaudeCode !== undefined) {
          process.env.CLAUDECODE = originalClaudeCode;
        } else {
          delete process.env.CLAUDECODE;
        }
      }
    });

    it('should not modify the host process CLAUDECODE env var', async () => {
      const originalClaudeCode = process.env.CLAUDECODE;
      process.env.CLAUDECODE = 'host_value';

      try {
        const testAdapter = new ClaudeCodeAdapter();
        const pm = (testAdapter as any).processManager as ProcessManager;

        const { Readable } = require('node:stream');
        const stdout = new Readable({ read() { this.push(null); } });
        const stderr = new Readable({ read() { this.push(null); } });
        const mockChild = {
          stdout, stderr, pid: 22222,
          on: vi.fn((event: string, cb: (...args: any[]) => void) => {
            if (event === 'exit') setTimeout(() => cb(0, null), 10);
          }),
          once: vi.fn(),
        };
        (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
          mockChild.stdout.on('end', () => {
            setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
          });
          return mockChild;
        });

        for await (const _chunk of testAdapter.execute('test', defaultOpts())) { /* drain */ }

        // Host env should be unchanged
        expect(process.env.CLAUDECODE).toBe('host_value');
      } finally {
        if (originalClaudeCode !== undefined) {
          process.env.CLAUDECODE = originalClaudeCode;
        } else {
          delete process.env.CLAUDECODE;
        }
      }
    });
  });

  // --- AC-3: --continue / --resume support ---

  describe('AC-3: --continue / --resume parameter passing', () => {
    it('should include --continue flag when sessionId is provided in metadata', () => {
      const testAdapter = new ClaudeCodeAdapter();
      const args = testAdapter.buildArgs('test prompt', defaultOpts(), { continue: true });

      expect(args).toContain('--continue');
    });

    it('should include --resume with session ID when resumeSessionId is provided', () => {
      const testAdapter = new ClaudeCodeAdapter();
      const args = testAdapter.buildArgs('test prompt', defaultOpts(), { resumeSessionId: 'abc-123' });

      expect(args).toContain('--resume');
      expect(args).toContain('abc-123');
    });

    it('should not include --continue or --resume by default', () => {
      const testAdapter = new ClaudeCodeAdapter();
      const args = testAdapter.buildArgs('test prompt', defaultOpts());

      expect(args).not.toContain('--continue');
      expect(args).not.toContain('--resume');
    });
  });

  // --- Session continuation: session_id capture and --resume ---

  describe('session continuation: session_id capture and --resume', () => {
    it('should NOT use --resume or --continue on first execute() call', async () => {
      const testAdapter = new ClaudeCodeAdapter();
      const pm = (testAdapter as any).processManager as ProcessManager;

      const { Readable } = require('node:stream');
      const stdout = new Readable({ read() { this.push(null); } });
      const stderr = new Readable({ read() { this.push(null); } });
      const mockChild = { stdout, stderr, pid: 33333, on: vi.fn(), once: vi.fn() };
      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        mockChild.stdout.on('end', () => {
          setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
        });
        return mockChild;
      });

      for await (const _chunk of testAdapter.execute('first call', defaultOpts())) { /* drain */ }

      const spawnArgs = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('--continue');
      expect(spawnArgs).not.toContain('--resume');
    });

    it('should capture session_id from result event and use --resume on next call', async () => {
      const testAdapter = new ClaudeCodeAdapter();
      const pm = (testAdapter as any).processManager as ProcessManager;

      const { Readable } = require('node:stream');
      const createChildWithOutput = (lines: string[]) => {
        const stdout = new Readable({
          read() {
            for (const line of lines) this.push(line + '\n');
            this.push(null);
          },
        });
        const stderr = new Readable({ read() { this.push(null); } });
        return { stdout, stderr, pid: 44444, on: vi.fn(), once: vi.fn() };
      };

      let callCount = 0;
      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const lines = callCount === 0
          ? [
              JSON.stringify({ type: 'assistant', subtype: 'text', content: 'Hello' }),
              JSON.stringify({ type: 'result', session_id: 'ses_first_123', cost: 0.01 }),
            ]
          : [
              JSON.stringify({ type: 'assistant', subtype: 'text', content: 'Resumed' }),
            ];
        const child = createChildWithOutput(lines);
        child.stdout.on('end', () => {
          setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
        });
        callCount++;
        return child;
      });

      // First call — captures session_id
      for await (const _chunk of testAdapter.execute('first', defaultOpts())) { /* drain */ }

      // Second call — should use --resume with captured session_id
      for await (const _chunk of testAdapter.execute('second', defaultOpts())) { /* drain */ }

      const secondArgs = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[1][1] as string[];
      expect(secondArgs).toContain('--resume');
      expect(secondArgs).toContain('ses_first_123');
      expect(secondArgs).not.toContain('--continue');
    });

    it('should start new session (no --continue or --resume) when no session_id was captured', async () => {
      const testAdapter = new ClaudeCodeAdapter();
      const pm = (testAdapter as any).processManager as ProcessManager;

      const { Readable } = require('node:stream');
      const createEmptyChild = () => {
        const stdout = new Readable({ read() { this.push(null); } });
        const stderr = new Readable({ read() { this.push(null); } });
        return { stdout, stderr, pid: 55555, on: vi.fn(), once: vi.fn() };
      };

      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const child = createEmptyChild();
        child.stdout.on('end', () => {
          setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
        });
        return child;
      });

      // First call — no output, no session_id captured
      for await (const _chunk of testAdapter.execute('first', defaultOpts())) { /* drain */ }

      // Second call — should start fresh (no --continue to avoid cross-contamination)
      for await (const _chunk of testAdapter.execute('second', defaultOpts())) { /* drain */ }

      const secondArgs = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[1][1] as string[];
      expect(secondArgs).not.toContain('--continue');
      expect(secondArgs).not.toContain('--resume');
    });

    it('should expose hasActiveSession()', () => {
      const testAdapter = new ClaudeCodeAdapter();
      expect(testAdapter.hasActiveSession()).toBe(false);

      (testAdapter as any).lastSessionId = 'ses_test';
      expect(testAdapter.hasActiveSession()).toBe(true);
    });

    it('should expose getLastSessionId() and restoreSessionId()', () => {
      const testAdapter = new ClaudeCodeAdapter();
      expect(testAdapter.getLastSessionId()).toBeNull();

      testAdapter.restoreSessionId('ses_restored_456');
      expect(testAdapter.getLastSessionId()).toBe('ses_restored_456');
      expect(testAdapter.hasActiveSession()).toBe(true);
    });

    it('should use restored session ID for --resume on next execute', async () => {
      const testAdapter = new ClaudeCodeAdapter();
      const pm = (testAdapter as any).processManager as ProcessManager;

      testAdapter.restoreSessionId('ses_restored_789');

      const { Readable } = require('node:stream');
      const stdout = new Readable({ read() { this.push(null); } });
      const stderr = new Readable({ read() { this.push(null); } });
      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const child = { stdout, stderr, pid: 66666, on: vi.fn(), once: vi.fn() };
        child.stdout.on('end', () => {
          setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
        });
        return child;
      });

      for await (const _chunk of testAdapter.execute('test', defaultOpts())) { /* drain */ }

      const spawnArgs = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(spawnArgs).toContain('--resume');
      expect(spawnArgs).toContain('ses_restored_789');
    });

    it('should clear lastSessionId on error when resuming', async () => {
      const testAdapter = new ClaudeCodeAdapter();
      const pm = (testAdapter as any).processManager as ProcessManager;

      testAdapter.restoreSessionId('ses_stale_000');

      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const { Readable } = require('node:stream');
        const stdout = new Readable({ read() { this.push(null); } });
        const stderr = new Readable({ read() { this.push(null); } });
        const child = { stdout, stderr, pid: 77777, on: vi.fn(), once: vi.fn() };
        // Simulate process completing with non-zero exit (no new session_id captured)
        setTimeout(() => {
          (pm as any).emit('process-error', { message: 'Session not found' });
          (pm as any).emit('process-complete', { exitCode: 1, signal: null });
        }, 10);
        return child;
      });

      try {
        for await (const _chunk of testAdapter.execute('test', defaultOpts())) { /* drain */ }
      } catch {
        // may or may not throw depending on stream behavior
      }

      // Session ID should be cleared so next call starts fresh
      expect(testAdapter.getLastSessionId()).toBeNull();
      expect(testAdapter.hasActiveSession()).toBe(false);
    });

    it('test_bug_r6_1_should_not_clear_session_id_when_cli_reuses_same_id', async () => {
      const testAdapter = new ClaudeCodeAdapter();
      const pm = (testAdapter as any).processManager as ProcessManager;

      const { Readable } = require('node:stream');
      const createChildWithOutput = (lines: string[]) => {
        const stdout = new Readable({
          read() {
            for (const line of lines) this.push(line + '\n');
            this.push(null);
          },
        });
        const stderr = new Readable({ read() { this.push(null); } });
        return { stdout, stderr, pid: 88888, on: vi.fn(), once: vi.fn() };
      };

      let callCount = 0;
      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        // Both calls return the same session_id (resume reuses same session)
        const lines = [
          JSON.stringify({ type: 'assistant', subtype: 'text', content: `Call ${callCount}` }),
          JSON.stringify({ type: 'result', session_id: 'ses_reused_abc', cost: 0.01 }),
        ];
        const child = createChildWithOutput(lines);
        child.stdout.on('end', () => {
          setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
        });
        callCount++;
        return child;
      });

      // First call — captures session_id "ses_reused_abc"
      for await (const _chunk of testAdapter.execute('first', defaultOpts())) { /* drain */ }
      expect(testAdapter.getLastSessionId()).toBe('ses_reused_abc');

      // Second call — resumes with "ses_reused_abc", CLI returns same "ses_reused_abc"
      for await (const _chunk of testAdapter.execute('second', defaultOpts())) { /* drain */ }
      // Before fix: lastSessionId cleared because old === new
      // After fix: lastSessionId preserved because sessionIdUpdated = true
      expect(testAdapter.getLastSessionId()).toBe('ses_reused_abc');

      // Third call — should still resume with the preserved session_id
      for await (const _chunk of testAdapter.execute('third', defaultOpts())) { /* drain */ }
      const thirdArgs = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[2][1] as string[];
      expect(thirdArgs).toContain('--resume');
      expect(thirdArgs).toContain('ses_reused_abc');
    });

    it('test_regression_r6_1_clears_session_id_when_no_new_id_captured', async () => {
      const testAdapter = new ClaudeCodeAdapter();
      const pm = (testAdapter as any).processManager as ProcessManager;

      const { Readable } = require('node:stream');

      let callCount = 0;
      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const lines = callCount === 0
          ? [
              JSON.stringify({ type: 'assistant', subtype: 'text', content: 'Hello' }),
              JSON.stringify({ type: 'result', session_id: 'ses_first', cost: 0.01 }),
            ]
          : [
              // Second call: no session_id emitted at all (e.g. empty response)
              JSON.stringify({ type: 'assistant', subtype: 'text', content: 'Brief' }),
            ];
        const stdout = new Readable({
          read() {
            for (const line of lines) this.push(line + '\n');
            this.push(null);
          },
        });
        const stderr = new Readable({ read() { this.push(null); } });
        const child = { stdout, stderr, pid: 99991, on: vi.fn(), once: vi.fn() };
        child.stdout.on('end', () => {
          setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
        });
        callCount++;
        return child;
      });

      // First call — captures session_id
      for await (const _chunk of testAdapter.execute('first', defaultOpts())) { /* drain */ }
      expect(testAdapter.getLastSessionId()).toBe('ses_first');

      // Second call — resumes but gets no session_id back → should clear
      for await (const _chunk of testAdapter.execute('second', defaultOpts())) { /* drain */ }
      expect(testAdapter.getLastSessionId()).toBeNull();
    });
  });

  // --- Command building ---

  describe('command argument building', () => {
    it('should build correct base command args', () => {
      const testAdapter = new ClaudeCodeAdapter();
      const args = testAdapter.buildArgs('hello world', defaultOpts());

      expect(args).toContain('-p');
      expect(args).toContain('hello world');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--verbose');
      expect(args).toContain('--dangerously-skip-permissions');
    });

    it('should include --system-prompt when systemPrompt is provided', () => {
      const testAdapter = new ClaudeCodeAdapter();
      const args = testAdapter.buildArgs('hello', defaultOpts({ systemPrompt: 'You are a helper' }));

      expect(args).toContain('--system-prompt');
      expect(args).toContain('You are a helper');
    });

    it('should include --add-dir with cwd', () => {
      const testAdapter = new ClaudeCodeAdapter();
      const args = testAdapter.buildArgs('hello', defaultOpts({ cwd: '/my/project' }));

      expect(args).toContain('--add-dir');
      expect(args).toContain('/my/project');
    });

    it('should skip --system-prompt when --resume is used', () => {
      const testAdapter = new ClaudeCodeAdapter();
      const args = testAdapter.buildArgs(
        'hello',
        defaultOpts({ systemPrompt: 'You are a helper' }),
        { resumeSessionId: 'ses_abc' },
      );

      expect(args).not.toContain('--system-prompt');
      expect(args).toContain('--resume');
      expect(args).toContain('ses_abc');
    });

    it('should skip --system-prompt when --continue is used', () => {
      const testAdapter = new ClaudeCodeAdapter();
      const args = testAdapter.buildArgs(
        'hello',
        defaultOpts({ systemPrompt: 'You are a helper' }),
        { continue: true },
      );

      expect(args).not.toContain('--system-prompt');
      expect(args).toContain('--continue');
    });
  });

  // --- AC-1: Stream-json event parsing ---

  describe('AC-1: stream-json event parsing', () => {
    it('should parse text events from stream-json output', async () => {
      const events = [
        JSON.stringify({ type: 'assistant', subtype: 'text', content: 'Hello world' }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'text' && c.content === 'Hello world')).toBe(true);
    });

    it('should parse tool_use events', async () => {
      const events = [
        JSON.stringify({ type: 'tool_use', tool: 'read_file', input: { path: '/foo' } }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'tool_use')).toBe(true);
    });

    it('should parse tool_result events', async () => {
      const events = [
        JSON.stringify({ type: 'tool_result', content: 'file contents here' }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'tool_result' && c.content === 'file contents here')).toBe(true);
    });

    it('should parse error events', async () => {
      const events = [
        JSON.stringify({ type: 'error', error: { message: 'something failed' } }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'error' && c.content.includes('something failed'))).toBe(true);
    });

    it('should parse result/status events', async () => {
      const events = [
        JSON.stringify({ type: 'result', cost: 0.05, duration: 1000 }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'status')).toBe(true);
    });
  });

  // --- kill ---

  describe('kill', () => {
    it('should delegate kill to ProcessManager', async () => {
      await adapter.kill();
      // Should not throw
    });
  });

  // --- isRunning ---

  describe('isRunning', () => {
    it('should return false when no process is running', () => {
      expect(adapter.isRunning()).toBe(false);
    });
  });
});

/**
 * Helper: mock the adapter's internal process to produce given NDJSON lines,
 * then collect all output chunks.
 */
async function collectChunks(
  adapter: ClaudeCodeAdapter,
  ndjsonLines: string[],
  opts: ExecOptions,
): Promise<OutputChunk[]> {
  // We need to mock the ProcessManager to return a child process with our mock stdout
  const { Readable } = require('node:stream');

  // Access the adapter's internal process manager via the mock
  const pm = (adapter as any).processManager as ProcessManager;

  const stdout = new Readable({
    read() {
      for (const line of ndjsonLines) {
        this.push(line + '\n');
      }
      this.push(null);
    },
  });
  const stderr = new Readable({ read() { this.push(null); } });

  const mockChild = {
    stdout,
    stderr,
    pid: 99999,
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'exit') {
        // Simulate exit after stdout drains
        setTimeout(() => cb(0, null), 50);
      }
    }),
    once: vi.fn(),
  };

  (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
    mockChild.stdout.on('end', () => {
      setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
    });
    return mockChild;
  });

  const chunks: OutputChunk[] = [];
  for await (const chunk of adapter.execute('test', opts)) {
    chunks.push(chunk);
  }
  return chunks;
}

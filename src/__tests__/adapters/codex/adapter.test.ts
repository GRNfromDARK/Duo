import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    dispose = vi.fn().mockResolvedValue(undefined);
  }

  return { ProcessManager: MockProcessManager };
});

import { execFile } from 'node:child_process';
import { CodexAdapter } from '../../../adapters/codex/adapter.js';
import { ProcessManager } from '../../../adapters/process-manager.js';

const mockExecFile = vi.mocked(execFile);

/** Helper: create default ExecOptions */
function defaultOpts(overrides: Partial<ExecOptions> = {}): ExecOptions {
  return {
    cwd: '/test/project',
    ...overrides,
  };
}

/** Helper: create a mock ChildProcess with stdout that emits given lines */
function createMockChildWithLines(lines: string[]) {
  const { Readable } = require('node:stream');
  const stdout = new Readable({
    read() {
      for (const line of lines) {
        this.push(line + '\n');
      }
      this.push(null);
    },
  });
  const stderr = new Readable({ read() { this.push(null); } });

  return {
    stdout,
    stderr,
    pid: 99999,
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'exit') {
        setTimeout(() => cb(0, null), 50);
      }
    }),
    once: vi.fn(),
  };
}

function createMockChildWithStdoutAndStderr(
  stdoutLines: string[],
  stderrLines: string[],
) {
  const { Readable } = require('node:stream');
  const stdout = new Readable({
    read() {
      for (const line of stdoutLines) {
        this.push(line + '\n');
      }
      this.push(null);
    },
  });
  const stderr = new Readable({
    read() {
      for (const line of stderrLines) {
        this.push(line + '\n');
      }
      this.push(null);
    },
  });

  return {
    stdout,
    stderr,
    pid: 99999,
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'exit') {
        setTimeout(() => cb(0, null), 50);
      }
    }),
    once: vi.fn(),
  };
}

/** Helper: collect all chunks from adapter.execute() with mocked process */
async function collectChunks(
  adapter: CodexAdapter,
  ndjsonLines: string[],
  opts: ExecOptions,
  role?: 'coder' | 'reviewer',
): Promise<OutputChunk[]> {
  const pm = (adapter as any).processManager as ProcessManager;
  const mockChild = createMockChildWithLines(ndjsonLines);
  (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
    mockChild.stdout.on('end', () => {
      process.nextTick(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }));
    });
    return mockChild;
  });

  const chunks: OutputChunk[] = [];
  for await (const chunk of adapter.execute('test prompt', opts, { role })) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new CodexAdapter();
  });

  // --- Basic properties ---

  describe('properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('codex');
    });

    it('should have correct displayName', () => {
      expect(adapter.displayName).toBe('Codex');
    });

    it('should have a version string', () => {
      expect(typeof adapter.version).toBe('string');
    });
  });

  // --- isInstalled ---

  describe('isInstalled', () => {
    it('should return true when codex CLI is available', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'codex 1.0.0', '');
        return {} as any;
      });

      const result = await adapter.isInstalled();
      expect(result).toBe(true);
    });

    it('should return false when codex CLI is not found', async () => {
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
    it('should return version string from codex --version', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'codex 0.1.2', '');
        return {} as any;
      });

      const version = await adapter.getVersion();
      expect(version).toBe('0.1.2');
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

  // --- AC-1: exec and review modes ---

  describe('AC-1: exec and review modes', () => {
    it('should build exec mode args with --full-auto', () => {
      const args = adapter.buildArgs('implement login', defaultOpts());

      expect(args[0]).toBe('exec');
      expect(args).toContain('implement login');
      expect(args).toContain('--json');
      expect(args).toContain('--full-auto');
    });

    it('should add --skip-git-repo-check when requested', () => {
      const args = adapter.buildArgs('review the code', defaultOpts(), { skipGitCheck: true });

      expect(args[0]).toBe('exec');
      expect(args).toContain('--skip-git-repo-check');
      expect(args).toContain('--json');
    });

    it('should default to exec mode when no role specified', () => {
      const args = adapter.buildArgs('do something', defaultOpts());

      expect(args[0]).toBe('exec');
      expect(args).toContain('do something');
    });

    it('should not include --full-auto when permissionMode is safe', () => {
      const args = adapter.buildArgs('test', defaultOpts({ permissionMode: 'safe' }));

      expect(args).not.toContain('--full-auto');
    });

    it('should include --full-auto by default (permissionMode skip)', () => {
      const args = adapter.buildArgs('test', defaultOpts({ permissionMode: 'skip' }));

      expect(args).toContain('--full-auto');
    });
  });

  // --- AC-2: JSONL output parsing ---

  describe('AC-2: JSONL output parsing', () => {
    it('should parse text events from JSONL output', async () => {
      const events = [
        JSON.stringify({ type: 'message', content: 'Hello from Codex' }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'text' && c.content === 'Hello from Codex')).toBe(true);
    });

    it('should parse code/patch events', async () => {
      const events = [
        JSON.stringify({ type: 'patch', content: 'diff --git a/foo.ts' }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'code')).toBe(true);
    });

    it('should parse tool_use events', async () => {
      const events = [
        JSON.stringify({ type: 'function_call', name: 'apply_patch', arguments: '{}' }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'tool_use')).toBe(true);
    });

    it('should parse error events', async () => {
      const events = [
        JSON.stringify({ type: 'error', message: 'something went wrong' }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'error' && c.content.includes('something went wrong'))).toBe(true);
    });

    it('should parse Codex item.completed agent_message events', async () => {
      const events = [
        JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'Hello from Codex' } }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'text' && c.content === 'Hello from Codex')).toBe(true);
    });

    it('should parse Codex item.completed command_execution events', async () => {
      const events = [
        JSON.stringify({ type: 'item.completed', item: { id: 'item_2', type: 'command_execution', command: 'ls -la', aggregated_output: 'file1\nfile2' } }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'tool_result' && c.content.includes('file1'))).toBe(true);
    });

    it('should parse Codex item.started command_execution events', async () => {
      const events = [
        JSON.stringify({ type: 'item.started', item: { id: 'item_3', type: 'command_execution', command: 'cat foo.ts', status: 'in_progress' } }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'tool_use' && c.content.includes('cat foo.ts'))).toBe(true);
    });

    it('should treat stderr transport warnings as non-fatal status events', async () => {
      const pm = (adapter as any).processManager as ProcessManager;
      const mockChild = createMockChildWithStdoutAndStderr(
        [
          JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'OK' } }),
        ],
        [
          'Falling back from WebSockets to HTTPS transport. stream disconnected before completion.',
        ],
      );
      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        mockChild.stdout.on('end', () => {
          process.nextTick(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }));
        });
        return mockChild;
      });

      const chunks: OutputChunk[] = [];
      for await (const chunk of adapter.execute('test prompt', defaultOpts())) {
        chunks.push(chunk);
      }

      expect(chunks.some(c => c.type === 'text' && c.content === 'OK')).toBe(true);
      expect(chunks.some(c => c.type === 'status' && c.content.includes('WebSockets'))).toBe(true);
      expect(chunks.some(c => c.type === 'error')).toBe(false);
    });

    it('should treat Codex reconnect JSON errors as non-fatal status events', async () => {
      const events = [
        JSON.stringify({ type: 'error', message: 'Reconnecting... 2/5 (stream disconnected before completion: tls handshake eof)' }),
        JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'OK' } }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'status' && c.content.includes('Reconnecting...'))).toBe(true);
      expect(chunks.some(c => c.type === 'text' && c.content === 'OK')).toBe(true);
      expect(chunks.some(c => c.type === 'error')).toBe(false);
    });

    it('should treat Codex websocket fallback item errors as non-fatal status events', async () => {
      const events = [
        JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Falling back from WebSockets to HTTPS transport. stream disconnected before completion: tls handshake eof' } }),
        JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'OK after fallback' } }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'status' && c.content.includes('Falling back from WebSockets'))).toBe(true);
      expect(chunks.some(c => c.type === 'text' && c.content === 'OK after fallback')).toBe(true);
      expect(chunks.some(c => c.type === 'error')).toBe(false);
    });
  });

  // --- AC-3: git repo detection ---

  describe('AC-3: git repo detection', () => {
    it('should emit warning chunk when not in a git repo', async () => {
      // Mock execFile for git check to fail (not a git repo)
      mockExecFile.mockImplementation((cmd: any, args: any, opts: any, callback: any) => {
        if (cmd === 'git') {
          callback(new Error('not a git repository'), '', '');
        } else {
          callback(null, '', '');
        }
        return {} as any;
      });

      const pm = (adapter as any).processManager as ProcessManager;
      const mockChild = createMockChildWithLines([
        JSON.stringify({ type: 'message', content: 'done' }),
      ]);
      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        mockChild.stdout.on('end', () => {
          process.nextTick(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }));
        });
        return mockChild;
      });

      const chunks: OutputChunk[] = [];
      for await (const chunk of adapter.execute('test', defaultOpts())) {
        chunks.push(chunk);
      }

      // Should have a warning chunk before the actual output
      const warningChunk = chunks.find(
        c => c.type === 'status' && c.content.toLowerCase().includes('git'),
      );
      expect(warningChunk).toBeDefined();
    });

    it('should not emit warning when in a git repo', async () => {
      mockExecFile.mockImplementation((cmd: any, args: any, opts: any, callback: any) => {
        if (cmd === 'git') {
          callback(null, 'true', '');
        } else {
          callback(null, '', '');
        }
        return {} as any;
      });

      const pm = (adapter as any).processManager as ProcessManager;
      const mockChild = createMockChildWithLines([
        JSON.stringify({ type: 'message', content: 'done' }),
      ]);
      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        mockChild.stdout.on('end', () => {
          process.nextTick(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }));
        });
        return mockChild;
      });

      const chunks: OutputChunk[] = [];
      for await (const chunk of adapter.execute('test', defaultOpts())) {
        chunks.push(chunk);
      }

      const warningChunk = chunks.find(
        c => c.type === 'status' && c.content.toLowerCase().includes('git'),
      );
      expect(warningChunk).toBeUndefined();
    });
  });

  // --- AC-4: kill and isRunning ---

  describe('kill and isRunning', () => {
    it('should delegate kill to ProcessManager', async () => {
      await adapter.kill();
      // Should not throw
    });

    it('should return false when no process is running', () => {
      expect(adapter.isRunning()).toBe(false);
    });
  });

  // --- Session continuation: thread_id capture and resume ---

  describe('session continuation: thread_id capture and resume', () => {
    it('should build resume args when resumeSessionId is provided', () => {
      const args = adapter.buildArgs('continue working', defaultOpts(), {
        resumeSessionId: 'th_abc123',
      });

      expect(args[0]).toBe('exec');
      expect(args[1]).toBe('resume');
      expect(args[2]).toBe('th_abc123');
      expect(args[3]).toBe('continue working');
      expect(args).toContain('--json');
      expect(args).toContain('--full-auto');
    });

    it('should build normal exec args when no resumeSessionId', () => {
      const args = adapter.buildArgs('do something', defaultOpts());

      expect(args[0]).toBe('exec');
      expect(args[1]).toBe('do something');
      expect(args).not.toContain('resume');
    });

    it('should capture thread_id from thread.started event and use it for resume', async () => {
      mockExecFile.mockImplementation((cmd: any, _a: any, _o: any, cb: any) => {
        if (cmd === 'git') cb(null, 'true', '');
        return {} as any;
      });

      const pm = (adapter as any).processManager as ProcessManager;
      let callCount = 0;

      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const lines = callCount === 0
          ? [
              JSON.stringify({ type: 'thread.started', thread_id: 'th_captured_001' }),
              JSON.stringify({ type: 'message', content: 'Done' }),
            ]
          : [
              JSON.stringify({ type: 'message', content: 'Resumed' }),
            ];
        const child = createMockChildWithLines(lines);
        child.stdout.on('end', () => {
          process.nextTick(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }));
        });
        callCount++;
        return child;
      });

      // First call — captures thread_id
      for await (const _chunk of adapter.execute('first', defaultOpts())) { /* drain */ }
      expect(adapter.getLastSessionId()).toBe('th_captured_001');

      // Second call — should use resume with captured thread_id
      for await (const _chunk of adapter.execute('second', defaultOpts())) { /* drain */ }

      const secondArgs = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[1][1] as string[];
      expect(secondArgs).toContain('resume');
      expect(secondArgs).toContain('th_captured_001');
    });

    it('should NOT resume on first call (no thread_id)', async () => {
      mockExecFile.mockImplementation((cmd: any, _a: any, _o: any, cb: any) => {
        if (cmd === 'git') cb(null, 'true', '');
        return {} as any;
      });

      const pm = (adapter as any).processManager as ProcessManager;
      const mockChild = createMockChildWithLines([
        JSON.stringify({ type: 'message', content: 'first run' }),
      ]);
      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        mockChild.stdout.on('end', () => {
          process.nextTick(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }));
        });
        return mockChild;
      });

      for await (const _chunk of adapter.execute('first', defaultOpts())) { /* drain */ }

      const spawnArgs = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(spawnArgs).not.toContain('resume');
      expect(spawnArgs[0]).toBe('exec');
      expect(spawnArgs[1]).toBe('first');
    });

    it('should use explicit resumeSessionId over captured thread_id', async () => {
      (adapter as any).lastSessionId = 'th_old';
      mockExecFile.mockImplementation((cmd: any, _a: any, _o: any, cb: any) => {
        if (cmd === 'git') cb(null, 'true', '');
        return {} as any;
      });

      const pm = (adapter as any).processManager as ProcessManager;
      const mockChild = createMockChildWithLines([]);
      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        mockChild.stdout.on('end', () => {
          process.nextTick(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }));
        });
        return mockChild;
      });

      for await (const _chunk of adapter.execute('t', defaultOpts(), { resumeSessionId: 'th_explicit' })) { /* drain */ }

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(args).toContain('th_explicit');
      expect(args).not.toContain('th_old');
    });

    it('should expose hasActiveSession() and getLastSessionId()', () => {
      expect(adapter.hasActiveSession()).toBe(false);
      expect(adapter.getLastSessionId()).toBeNull();

      (adapter as any).lastSessionId = 'th_test';
      expect(adapter.hasActiveSession()).toBe(true);
      expect(adapter.getLastSessionId()).toBe('th_test');
    });

    it('should restore session ID via restoreSessionId()', () => {
      const testAdapter = new CodexAdapter();
      expect(testAdapter.getLastSessionId()).toBeNull();

      testAdapter.restoreSessionId('th_restored_456');
      expect(testAdapter.getLastSessionId()).toBe('th_restored_456');
      expect(testAdapter.hasActiveSession()).toBe(true);
    });

    it('should clear lastSessionId on error when resuming', async () => {
      const testAdapter = new CodexAdapter();
      const pm = (testAdapter as any).processManager as ProcessManager;

      testAdapter.restoreSessionId('th_stale_000');

      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const { Readable } = require('node:stream');
        const stdout = new Readable({ read() { this.push(null); } });
        const stderr = new Readable({ read() { this.push(null); } });
        const child = { stdout, stderr, pid: 88888, on: vi.fn(), once: vi.fn() };
        // Simulate process completing with non-zero exit (no new session_id captured)
        setTimeout(() => {
          (pm as any).emit('process-error', { message: 'Thread not found' });
          (pm as any).emit('process-complete', { exitCode: 1, signal: null });
        }, 10);
        return child;
      });

      try {
        for await (const _chunk of testAdapter.execute('test', defaultOpts())) { /* drain */ }
      } catch {
        // may or may not throw depending on stream behavior
      }

      expect(testAdapter.getLastSessionId()).toBeNull();
      expect(testAdapter.hasActiveSession()).toBe(false);
    });
  });

  // --- CWD passing ---

  describe('cwd handling', () => {
    it('should pass cwd to ProcessManager via ExecOptions', async () => {
      const pm = (adapter as any).processManager as ProcessManager;
      const mockChild = createMockChildWithLines([]);

      // Mock git check to succeed
      mockExecFile.mockImplementation((cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'true', '');
        return {} as any;
      });

      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        mockChild.stdout.on('end', () => {
          process.nextTick(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }));
        });
        return mockChild;
      });

      const opts = defaultOpts({ cwd: '/my/repo' });
      // Drain the generator
      for await (const _chunk of adapter.execute('test', opts)) { /* drain */ }

      expect(pm.spawn).toHaveBeenCalled();
      const spawnCall = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
      const execOpts = spawnCall[2] as ExecOptions;
      expect(execOpts.cwd).toBe('/my/repo');
    });
  });
});

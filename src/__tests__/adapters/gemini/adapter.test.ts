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
    dispose = vi.fn();
  }

  return { ProcessManager: MockProcessManager };
});

import { execFile } from 'node:child_process';
import { GeminiAdapter } from '../../../adapters/gemini/adapter.js';
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

/** Helper: collect all chunks from adapter.execute() with mocked process */
async function collectChunks(
  adapter: GeminiAdapter,
  ndjsonLines: string[],
  opts: ExecOptions,
): Promise<OutputChunk[]> {
  const pm = (adapter as any).processManager as ProcessManager;
  const mockChild = createMockChildWithLines(ndjsonLines);
  (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
    mockChild.stdout.on('end', () => {
      setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
    });
    return mockChild;
  });

  const chunks: OutputChunk[] = [];
  for await (const chunk of adapter.execute('test prompt', opts)) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GeminiAdapter();
  });

  // --- Basic properties ---

  describe('properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('gemini');
    });

    it('should have correct displayName', () => {
      expect(adapter.displayName).toBe('Gemini CLI');
    });

    it('should have a version string', () => {
      expect(typeof adapter.version).toBe('string');
    });
  });

  // --- AC-1: isInstalled ---

  describe('isInstalled', () => {
    it('should return true when gemini CLI is available', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'gemini 1.0.0', '');
        return {} as any;
      });

      const result = await adapter.isInstalled();
      expect(result).toBe(true);
    });

    it('should return false when gemini CLI is not found', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(new Error('command not found'), '', '');
        return {} as any;
      });

      const result = await adapter.isInstalled();
      expect(result).toBe(false);
    });
  });

  // --- AC-1: getVersion ---

  describe('getVersion', () => {
    it('should return version string from gemini --version', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'gemini 0.3.5', '');
        return {} as any;
      });

      const version = await adapter.getVersion();
      expect(version).toBe('0.3.5');
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

  // --- AC-1: buildArgs ---

  describe('AC-1: buildArgs', () => {
    it('should build correct args with prompt and stream-json format', () => {
      const args = adapter.buildArgs('fix the bug', defaultOpts());

      expect(args).toContain('-p');
      expect(args).toContain('fix the bug');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--non-interactive');
    });

    it('should include --yolo when permissionMode is skip (AC-3)', () => {
      const args = adapter.buildArgs('test', defaultOpts({ permissionMode: 'skip' }));

      expect(args).toContain('--yolo');
    });

    it('should include --yolo by default (permissionMode undefined)', () => {
      const args = adapter.buildArgs('test', defaultOpts());

      expect(args).toContain('--yolo');
    });

    it('should not include --yolo when permissionMode is safe', () => {
      const args = adapter.buildArgs('test', defaultOpts({ permissionMode: 'safe' }));

      expect(args).not.toContain('--yolo');
    });
  });

  // --- AC-2: stream-json parsing via StreamJsonParser ---

  describe('AC-2: stream-json output parsing', () => {
    it('should parse text events from stream-json output', async () => {
      const events = [
        JSON.stringify({ type: 'assistant', content: 'Hello from Gemini' }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'text' && c.content === 'Hello from Gemini')).toBe(true);
    });

    it('should parse tool_use events', async () => {
      const events = [
        JSON.stringify({ type: 'tool_use', tool: 'edit_file', input: { path: 'foo.ts' } }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'tool_use')).toBe(true);
    });

    it('should parse error events', async () => {
      const events = [
        JSON.stringify({ type: 'error', error: { message: 'rate limited' } }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'error' && c.content.includes('rate limited'))).toBe(true);
    });
  });

  // --- AC-4: kill and isRunning ---

  describe('kill and isRunning', () => {
    it('should delegate kill to ProcessManager', async () => {
      await adapter.kill();
      const pm = (adapter as any).processManager as ProcessManager;
      expect(pm.kill).toHaveBeenCalled();
    });

    it('should return false when no process is running', () => {
      expect(adapter.isRunning()).toBe(false);
    });
  });

  // --- AC-1: execute spawns gemini with correct args ---

  describe('execute integration', () => {
    it('should spawn gemini with correct command and args', async () => {
      const pm = (adapter as any).processManager as ProcessManager;
      const mockChild = createMockChildWithLines([]);
      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        mockChild.stdout.on('end', () => {
          setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
        });
        return mockChild;
      });

      const opts = defaultOpts({ cwd: '/my/project' });
      for await (const _chunk of adapter.execute('do something', opts)) { /* drain */ }

      expect(pm.spawn).toHaveBeenCalledWith(
        'gemini',
        expect.arrayContaining(['-p', 'do something', '--output-format', 'stream-json', '--non-interactive', '--yolo']),
        expect.objectContaining({ cwd: '/my/project' }),
      );
    });

    it('should not require git repository (no git warning)', async () => {
      const pm = (adapter as any).processManager as ProcessManager;
      const mockChild = createMockChildWithLines([
        JSON.stringify({ type: 'assistant', content: 'done' }),
      ]);
      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        mockChild.stdout.on('end', () => {
          setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
        });
        return mockChild;
      });

      const chunks: OutputChunk[] = [];
      for await (const chunk of adapter.execute('test', defaultOpts())) {
        chunks.push(chunk);
      }

      // Should NOT have any git-related warning
      const warningChunk = chunks.find(
        c => c.type === 'status' && c.content.toLowerCase().includes('git'),
      );
      expect(warningChunk).toBeUndefined();
    });
  });
});

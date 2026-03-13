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
import { ContinueAdapter } from '../../../adapters/continue/adapter.js';
import { ProcessManager } from '../../../adapters/process-manager.js';

const mockExecFile = vi.mocked(execFile);

function defaultOpts(overrides: Partial<ExecOptions> = {}): ExecOptions {
  return {
    cwd: '/test/project',
    ...overrides,
  };
}

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

async function collectChunks(
  adapter: ContinueAdapter,
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

describe('ContinueAdapter', () => {
  let adapter: ContinueAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ContinueAdapter();
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('continue');
    });

    it('should have correct displayName', () => {
      expect(adapter.displayName).toBe('Continue');
    });

    it('should have a version string', () => {
      expect(typeof adapter.version).toBe('string');
    });
  });

  describe('isInstalled', () => {
    it('should return true when cn CLI is available', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'cn 1.0.0', '');
        return {} as any;
      });

      const result = await adapter.isInstalled();
      expect(result).toBe(true);
    });

    it('should return false when cn CLI is not found', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(new Error('command not found'), '', '');
        return {} as any;
      });

      const result = await adapter.isInstalled();
      expect(result).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('should return version string from cn --version', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'cn 1.2.3', '');
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

  describe('buildArgs', () => {
    it('should build correct args with prompt and --format json', () => {
      const args = adapter.buildArgs('fix the bug', defaultOpts());

      expect(args).toContain('-p');
      expect(args).toContain('fix the bug');
      expect(args).toContain('--format');
      expect(args).toContain('json');
    });

    it('should include --allow when permissionMode is skip', () => {
      const args = adapter.buildArgs('test', defaultOpts({ permissionMode: 'skip' }));

      expect(args).toContain('--allow');
    });

    it('should include --allow by default (permissionMode undefined)', () => {
      const args = adapter.buildArgs('test', defaultOpts());

      expect(args).toContain('--allow');
    });

    it('should not include --allow when permissionMode is safe', () => {
      const args = adapter.buildArgs('test', defaultOpts({ permissionMode: 'safe' }));

      expect(args).not.toContain('--allow');
    });
  });

  describe('JSONL output parsing', () => {
    it('should parse text output from JSONL', async () => {
      const lines = [
        JSON.stringify({ type: 'text', content: 'Hello from Continue' }),
      ];

      const chunks = await collectChunks(adapter, lines, defaultOpts());
      expect(chunks.some(c => c.type === 'text' && c.content === 'Hello from Continue')).toBe(true);
    });

    it('should parse error output', async () => {
      const lines = [
        JSON.stringify({ type: 'error', content: 'something went wrong' }),
      ];

      const chunks = await collectChunks(adapter, lines, defaultOpts());
      expect(chunks.some(c => c.type === 'error')).toBe(true);
    });
  });

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

  describe('execute integration', () => {
    it('should spawn cn with correct command and args', async () => {
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
        'cn',
        expect.arrayContaining(['-p', 'do something', '--format', 'json', '--allow']),
        expect.objectContaining({ cwd: '/my/project' }),
      );
    });
  });
});

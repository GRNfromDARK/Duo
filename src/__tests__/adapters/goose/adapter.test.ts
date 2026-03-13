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
import { GooseAdapter } from '../../../adapters/goose/adapter.js';
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
  adapter: GooseAdapter,
  textLines: string[],
  opts: ExecOptions,
): Promise<OutputChunk[]> {
  const pm = (adapter as any).processManager as ProcessManager;
  const mockChild = createMockChildWithLines(textLines);
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

describe('GooseAdapter', () => {
  let adapter: GooseAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GooseAdapter();
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('goose');
    });

    it('should have correct displayName', () => {
      expect(adapter.displayName).toBe('Goose');
    });

    it('should have a version string', () => {
      expect(typeof adapter.version).toBe('string');
    });
  });

  describe('isInstalled', () => {
    it('should return true when goose CLI is available', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'goose 1.0.0', '');
        return {} as any;
      });

      const result = await adapter.isInstalled();
      expect(result).toBe(true);
    });

    it('should return false when goose CLI is not found', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(new Error('command not found'), '', '');
        return {} as any;
      });

      const result = await adapter.isInstalled();
      expect(result).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('should return version string from goose --version', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'goose 0.9.0', '');
        return {} as any;
      });

      const version = await adapter.getVersion();
      expect(version).toBe('0.9.0');
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
    it('should build correct args with run -t and prompt', () => {
      const args = adapter.buildArgs('fix the bug');

      expect(args).toEqual(['run', '-t', 'fix the bug']);
    });
  });

  describe('buildEnv', () => {
    it('should set GOOSE_MODE=auto when permissionMode is skip', () => {
      const envConfig = adapter.buildEnv(defaultOpts({ permissionMode: 'skip' }));

      expect(envConfig.env.GOOSE_MODE).toBe('auto');
      expect(envConfig.replaceEnv).toBe(true);
    });

    it('should set GOOSE_MODE=auto by default (permissionMode undefined)', () => {
      const envConfig = adapter.buildEnv(defaultOpts());

      expect(envConfig.env.GOOSE_MODE).toBe('auto');
    });

    it('should not set GOOSE_MODE when permissionMode is safe', () => {
      const envConfig = adapter.buildEnv(defaultOpts({ permissionMode: 'safe' }));

      expect(envConfig.env.GOOSE_MODE).toBeUndefined();
    });

    it('should merge with existing env vars', () => {
      const envConfig = adapter.buildEnv(defaultOpts({ env: { FOO: 'bar' } }));

      expect(envConfig.env.FOO).toBe('bar');
      expect(envConfig.env.GOOSE_MODE).toBe('auto');
    });
  });

  describe('text output parsing', () => {
    it('should parse plain text output', async () => {
      const lines = [
        'I will fix the bug in foo.ts',
        'Done!',
      ];

      const chunks = await collectChunks(adapter, lines, defaultOpts());
      expect(chunks.some(c => c.type === 'text')).toBe(true);
    });

    it('should detect error lines', async () => {
      const lines = [
        'Error: file not found',
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
    it('should spawn goose with correct command and args', async () => {
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
        'goose',
        ['run', '-t', 'do something'],
        expect.objectContaining({
          cwd: '/my/project',
          replaceEnv: true,
        }),
      );
      expect((pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][2].env.GOOSE_MODE).toBe('auto');
    });

    it('should pass GOOSE_MODE=auto env to ProcessManager', async () => {
      const pm = (adapter as any).processManager as ProcessManager;
      const mockChild = createMockChildWithLines([]);
      (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        mockChild.stdout.on('end', () => {
          setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
        });
        return mockChild;
      });

      const opts = defaultOpts();
      for await (const _chunk of adapter.execute('test', opts)) { /* drain */ }

      const spawnCall = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(spawnCall[2].env.GOOSE_MODE).toBe('auto');
      expect(spawnCall[2].replaceEnv).toBe(true);
    });
  });
});

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
import { AmazonQAdapter } from '../../../adapters/amazon-q/adapter.js';
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
  adapter: AmazonQAdapter,
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

describe('AmazonQAdapter', () => {
  let adapter: AmazonQAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new AmazonQAdapter();
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('amazon-q');
    });

    it('should have correct displayName', () => {
      expect(adapter.displayName).toBe('Amazon Q');
    });

    it('should have a version string', () => {
      expect(typeof adapter.version).toBe('string');
    });
  });

  describe('isInstalled', () => {
    it('should return true when q CLI is available', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'q 1.0.0', '');
        return {} as any;
      });

      const result = await adapter.isInstalled();
      expect(result).toBe(true);
    });

    it('should return false when q CLI is not found', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(new Error('command not found'), '', '');
        return {} as any;
      });

      const result = await adapter.isInstalled();
      expect(result).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('should return version string from q version', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'q 2.0.1', '');
        return {} as any;
      });

      const version = await adapter.getVersion();
      expect(version).toBe('2.0.1');
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
    it('should build correct args with chat --no-interactive and prompt at end', () => {
      const args = adapter.buildArgs('fix the bug', defaultOpts());

      expect(args[0]).toBe('chat');
      expect(args[1]).toBe('--no-interactive');
      expect(args[args.length - 1]).toBe('fix the bug');
    });

    it('should include --trust-all-tools when permissionMode is skip', () => {
      const args = adapter.buildArgs('test', defaultOpts({ permissionMode: 'skip' }));

      expect(args).toContain('--trust-all-tools');
    });

    it('should include --trust-all-tools by default (permissionMode undefined)', () => {
      const args = adapter.buildArgs('test', defaultOpts());

      expect(args).toContain('--trust-all-tools');
    });

    it('should not include --trust-all-tools when permissionMode is safe', () => {
      const args = adapter.buildArgs('test', defaultOpts({ permissionMode: 'safe' }));

      expect(args).not.toContain('--trust-all-tools');
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
    it('should spawn q with correct command and args', async () => {
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
        'q',
        expect.arrayContaining(['chat', '--no-interactive', '--trust-all-tools', 'do something']),
        expect.objectContaining({ cwd: '/my/project' }),
      );
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecOptions, OutputChunk } from '../../../types/adapter.js';

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
import { QwenAdapter } from '../../../adapters/qwen/adapter.js';
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
  adapter: QwenAdapter,
  jsonLines: string[],
  opts: ExecOptions,
): Promise<OutputChunk[]> {
  const pm = (adapter as any).processManager as ProcessManager;
  const mockChild = createMockChildWithLines(jsonLines);
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

describe('QwenAdapter', () => {
  let adapter: QwenAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new QwenAdapter();
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('qwen');
    });

    it('should have correct displayName', () => {
      expect(adapter.displayName).toBe('Qwen');
    });

    it('should have a version string', () => {
      expect(typeof adapter.version).toBe('string');
    });
  });

  describe('isInstalled', () => {
    it('should return true when qwen CLI is available', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'qwen 1.0.0', '');
        return {} as any;
      });

      const result = await adapter.isInstalled();
      expect(result).toBe(true);
    });

    it('should return false when qwen CLI is not found', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(new Error('command not found'), '', '');
        return {} as any;
      });

      const result = await adapter.isInstalled();
      expect(result).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('should return version string from qwen --version', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'qwen 1.5.0', '');
        return {} as any;
      });

      const version = await adapter.getVersion();
      expect(version).toBe('1.5.0');
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
    it('should build correct args with prompt and stream-json format', () => {
      const args = adapter.buildArgs('fix the bug', defaultOpts());

      expect(args).toContain('-p');
      expect(args).toContain('fix the bug');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
    });

    it('should include --yolo when permissionMode is skip', () => {
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

  describe('stream-json output parsing', () => {
    it('should parse text events from stream-json output', async () => {
      const events = [
        JSON.stringify({ type: 'assistant', content: 'Hello from Qwen' }),
      ];

      const chunks = await collectChunks(adapter, events, defaultOpts());
      expect(chunks.some(c => c.type === 'text' && c.content === 'Hello from Qwen')).toBe(true);
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
    it('should spawn qwen with correct command and args', async () => {
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
        'qwen',
        expect.arrayContaining(['-p', 'do something', '--output-format', 'stream-json', '--yolo']),
        expect.objectContaining({ cwd: '/my/project' }),
      );
    });
  });
});

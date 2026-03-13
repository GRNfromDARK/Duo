import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputChunk } from '../../types/adapter.js';
import type { GodExecOptions } from '../../types/god-adapter.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('../../adapters/process-manager.js', () => {
  const EventEmitter = require('node:events').EventEmitter;

  class MockProcessManager extends EventEmitter {
    spawn = vi.fn();
    kill = vi.fn().mockResolvedValue(undefined);
    isRunning = vi.fn().mockReturnValue(false);
  }

  return { ProcessManager: MockProcessManager };
});

import { execFile } from 'node:child_process';
import { ProcessManager } from '../../adapters/process-manager.js';
import { CodexGodAdapter } from '../../god/adapters/codex-god-adapter.js';

const mockExecFile = vi.mocked(execFile);

function defaultOpts(overrides: Partial<GodExecOptions> = {}): GodExecOptions {
  return {
    cwd: '/test/project',
    systemPrompt: 'You are the God orchestrator.',
    timeoutMs: 30_000,
    ...overrides,
  };
}

function createMockChild(lines: string[]) {
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
    on: vi.fn(),
    once: vi.fn(),
  };
}

async function collectChunks(
  adapter: CodexGodAdapter,
  lines: string[],
  opts: GodExecOptions,
): Promise<OutputChunk[]> {
  const pm = (adapter as any).processManager as ProcessManager;
  const mockChild = createMockChild(lines);

  (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
    mockChild.stdout.on('end', () => {
      process.nextTick(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }));
    });
    return mockChild;
  });

  const chunks: OutputChunk[] = [];
  for await (const chunk of adapter.execute('Return JSON', opts)) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('CodexGodAdapter', () => {
  let adapter: CodexGodAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new CodexGodAdapter();
  });

  it('builds a stateless read-only Codex God command', () => {
    const args = adapter.buildArgs('Return JSON', defaultOpts(), { skipGitCheck: true });

    expect(args[0]).toBe('exec');
    expect(args).toContain('--json');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('--sandbox');
    expect(args).toContain('read-only');
    expect(args).toContain('--skip-git-repo-check');
    expect(args.join(' ')).toContain('SYSTEM ROLE');
    expect(args.join(' ')).toContain('USER TASK');
    expect(args).not.toContain('--full-auto');
  });

  it('uses timeoutMs for the spawned God process', async () => {
    mockExecFile.mockImplementation((cmd: any, _args: any, _opts: any, callback: any) => {
      if (cmd === 'git') {
        callback(null, 'true', '');
      }
      return {} as any;
    });

    await collectChunks(adapter, [
      JSON.stringify({ type: 'message', content: 'ok' }),
    ], defaultOpts({ timeoutMs: 12_345 }));

    const pm = (adapter as any).processManager as ProcessManager;
    const execOpts = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][2] as GodExecOptions;
    expect(execOpts.timeoutMs).toBe(12_345);
  });
});

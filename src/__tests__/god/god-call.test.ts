import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OutputChunk } from '../../types/adapter.js';
import type { GodAdapter, GodExecOptions } from '../../types/god-adapter.js';
import { collectGodAdapterOutput } from '../../god/god-call.js';

interface MockAdapterState {
  adapter: GodAdapter;
  getKillCount(): number;
  getLastPrompt(): string | undefined;
  getLastOptions(): GodExecOptions | undefined;
}

function createMockAdapter(
  chunks: OutputChunk[],
  name = 'codex',
): MockAdapterState {
  let killCount = 0;
  let lastPrompt: string | undefined;
  let lastOptions: GodExecOptions | undefined;

  return {
    adapter: {
      name,
      displayName: 'Mock God',
      version: '1.0.0',
      isInstalled: async () => true,
      getVersion: async () => '1.0.0',
      execute(prompt: string, opts: GodExecOptions): AsyncIterable<OutputChunk> {
        lastPrompt = prompt;
        lastOptions = opts;
        return {
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
              yield chunk;
            }
          },
        };
      },
      kill: async () => {
        killCount++;
      },
      isRunning: () => false,
    },
    getKillCount: () => killCount,
    getLastPrompt: () => lastPrompt,
    getLastOptions: () => lastOptions,
  };
}

describe('collectGodAdapterOutput', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the timeout after a successful response', async () => {
    vi.useFakeTimers();
    const { adapter, getKillCount } = createMockAdapter([
      { type: 'text', content: 'ok', timestamp: Date.now() },
    ]);

    const promise = collectGodAdapterOutput({
      adapter,
      prompt: 'user prompt',
      systemPrompt: 'system prompt',
      timeoutMs: 30_000,
    });

    await expect(promise).resolves.toBe('ok');
    await vi.runAllTimersAsync();

    expect(getKillCount()).toBe(0);
  });

  it('passes God execution options through to the adapter', async () => {
    const { adapter, getLastPrompt, getLastOptions } = createMockAdapter([
      { type: 'text', content: 'ok', timestamp: Date.now() },
    ], 'codex');

    await expect(
      collectGodAdapterOutput({
        adapter,
        prompt: 'user prompt',
        systemPrompt: 'system prompt',
        timeoutMs: 30_000,
        projectDir: '/tmp/project',
      }),
    ).resolves.toBe('ok');

    expect(getLastPrompt()).toBe('user prompt');
    expect(getLastOptions()).toEqual({
      cwd: '/tmp/project',
      systemPrompt: 'system prompt',
      timeoutMs: 30_000,
    });
  });

  it('passes systemPrompt separately for Claude adapters', async () => {
    const { adapter, getLastPrompt, getLastOptions } = createMockAdapter([
      { type: 'text', content: 'ok', timestamp: Date.now() },
    ], 'claude-code');

    await expect(
      collectGodAdapterOutput({
        adapter,
        prompt: 'user prompt',
        systemPrompt: 'system prompt',
        timeoutMs: 30_000,
      }),
    ).resolves.toBe('ok');

    expect(getLastPrompt()).toBe('user prompt');
    expect(getLastOptions()).toEqual({
      cwd: process.cwd(),
      systemPrompt: 'system prompt',
      timeoutMs: 30_000,
    });
  });

  it('rejects God adapters that attempt tool use', async () => {
    const { adapter } = createMockAdapter([
      { type: 'tool_use', content: 'ls -la', timestamp: Date.now() },
    ]);

    await expect(
      collectGodAdapterOutput({
        adapter,
        prompt: 'user prompt',
        systemPrompt: 'system prompt',
        timeoutMs: 30_000,
      }),
    ).rejects.toThrow(/attempted tool use/i);
  });
});

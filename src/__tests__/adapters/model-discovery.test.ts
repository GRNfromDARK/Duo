/**
 * Tests for dynamic model discovery.
 *
 * We mock fs, child_process, and module to isolate each discovery path
 * without requiring the actual CLIs to be installed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';

// ── Mocks ──

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    default: {
      ...real,
      readFileSync: vi.fn(real.readFileSync),
      realpathSync: vi.fn(real.realpathSync),
    },
    readFileSync: vi.fn(real.readFileSync),
    realpathSync: vi.fn(real.realpathSync),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  return {
    ...real,
    default: { ...real, execSync: vi.fn(real.execSync) },
    execSync: vi.fn(real.execSync),
  };
});

vi.mock('node:module', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:module')>();
  return {
    ...real,
    default: { ...real, createRequire: vi.fn(real.createRequire) },
    createRequire: vi.fn(real.createRequire),
  };
});

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  discoverModels,
  discoverCodexModels,
  discoverGeminiModels,
  discoverClaudeCodeModels,
  _resetModelCache,
} from '../../adapters/model-discovery.js';
import { CUSTOM_MODEL_SENTINEL } from '../../adapters/registry.js';

const mockedReadFileSync = vi.mocked(fs.readFileSync);
const mockedRealpathSync = vi.mocked(fs.realpathSync);
const mockedExecSync = vi.mocked(execSync);
const mockedCreateRequire = vi.mocked(createRequire);

beforeEach(() => {
  vi.clearAllMocks();
  _resetModelCache();
});

// ── Codex Discovery ──

describe('discoverCodexModels', () => {
  const cachePath = path.join(os.homedir(), '.codex', 'models_cache.json');

  function mockCacheFile(content: unknown): void {
    mockedReadFileSync.mockImplementation((p: unknown, ..._args: unknown[]) => {
      if (String(p) === cachePath) return JSON.stringify(content);
      throw new Error(`ENOENT: no such file ${p}`);
    });
  }

  it('returns visible models sorted by priority and deduped', () => {
    mockCacheFile({
      models: [
        { slug: 'model-b', display_name: 'Model B', visibility: 'list', priority: 5 },
        { slug: 'model-a', display_name: 'Model A', visibility: 'list', priority: 1 },
        { slug: 'model-c', display_name: 'Model C', visibility: 'hide', priority: 0 },
        { slug: 'model-a', display_name: 'Model A Dup', visibility: 'list', priority: 2 },
      ],
    });
    const result = discoverCodexModels();
    expect(result).toEqual([
      { id: 'model-a', label: 'Model A' },
      { id: 'model-b', label: 'Model B' },
    ]);
  });

  it('uses slug as label when display_name is missing', () => {
    mockCacheFile({
      models: [{ slug: 'test-model', visibility: 'list', priority: 0 }],
    });
    const result = discoverCodexModels();
    expect(result).toEqual([{ id: 'test-model', label: 'test-model' }]);
  });

  it('returns empty array when cache file does not exist', () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(discoverCodexModels()).toEqual([]);
  });

  it('returns empty array on corrupt JSON', () => {
    mockedReadFileSync.mockReturnValue('not json{{{' as never);
    expect(discoverCodexModels()).toEqual([]);
  });

  it('returns empty array when models field is not an array', () => {
    mockCacheFile({ models: 'bad' });
    expect(discoverCodexModels()).toEqual([]);
  });

  it('returns empty array when no models have visibility=list', () => {
    mockCacheFile({
      models: [
        { slug: 'hidden', display_name: 'Hidden', visibility: 'hide', priority: 0 },
      ],
    });
    expect(discoverCodexModels()).toEqual([]);
  });

  it('treats missing priority as 999 (sorts last)', () => {
    mockCacheFile({
      models: [
        { slug: 'no-priority', display_name: 'No Prio', visibility: 'list' },
        { slug: 'with-priority', display_name: 'With Prio', visibility: 'list', priority: 1 },
      ],
    });
    const result = discoverCodexModels();
    expect(result[0].id).toBe('with-priority');
    expect(result[1].id).toBe('no-priority');
  });
});

// ── Gemini Discovery ──

describe('discoverGeminiModels', () => {
  function mockGeminiInstalled(
    validModels: Set<string>,
    getDisplayString?: (m: string) => string,
  ): void {
    mockedExecSync.mockReturnValue('/usr/bin/gemini\n' as never);
    mockedRealpathSync.mockReturnValue(
      '/opt/lib/node_modules/@google/gemini-cli/dist/index.js' as never,
    );

    const fakeRequire = Object.assign(
      (modPath: string) => {
        if (modPath.includes('models.js') || modPath.includes('models')) {
          return {
            VALID_GEMINI_MODELS: validModels,
            getDisplayString: getDisplayString ?? ((m: string) => m),
          };
        }
        throw new Error(`Cannot find module '${modPath}'`);
      },
      {
        resolve: (spec: string) => {
          if (spec.includes('models.js')) {
            return '/opt/lib/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/config/models.js';
          }
          throw new Error(`Cannot resolve '${spec}'`);
        },
      },
    );

    mockedCreateRequire.mockReturnValue(fakeRequire as never);
  }

  it('returns all valid models from VALID_GEMINI_MODELS set', () => {
    const models = new Set(['gemini-2.5-pro', 'gemini-2.5-flash']);
    mockGeminiInstalled(models);
    const result = discoverGeminiModels();
    expect(result).toEqual([
      { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    ]);
  });

  it('uses getDisplayString for labels when available', () => {
    const models = new Set(['gemini-3-pro-preview']);
    mockGeminiInstalled(models, (m) =>
      m === 'gemini-3-pro-preview' ? 'Gemini 3 Pro' : m,
    );
    const result = discoverGeminiModels();
    expect(result).toEqual([{ id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro' }]);
  });

  it('returns empty array when gemini is not installed', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('command not found');
    });
    expect(discoverGeminiModels()).toEqual([]);
  });

  it('returns empty array when createRequire fails', () => {
    mockedExecSync.mockReturnValue('/usr/bin/gemini\n' as never);
    mockedRealpathSync.mockReturnValue('/some/path' as never);
    mockedCreateRequire.mockImplementation(() => {
      throw new Error('createRequire failed');
    });
    expect(discoverGeminiModels()).toEqual([]);
  });

  it('returns empty array when VALID_GEMINI_MODELS is not a Set', () => {
    mockedExecSync.mockReturnValue('/usr/bin/gemini\n' as never);
    mockedRealpathSync.mockReturnValue('/some/path' as never);
    const fakeRequire = Object.assign(
      () => ({ VALID_GEMINI_MODELS: ['not-a-set'] }),
      { resolve: () => '/fake/models.js' },
    );
    mockedCreateRequire.mockReturnValue(fakeRequire as never);
    expect(discoverGeminiModels()).toEqual([]);
  });
});

// ── Claude Code Discovery ──

describe('discoverClaudeCodeModels', () => {
  it('returns the three stable CLI aliases', () => {
    const result = discoverClaudeCodeModels();
    expect(result).toEqual([
      { id: 'sonnet', label: 'Sonnet (latest)' },
      { id: 'opus', label: 'Opus (latest)' },
      { id: 'haiku', label: 'Haiku (latest)' },
    ]);
  });

  it('does not include any full model IDs', () => {
    const result = discoverClaudeCodeModels();
    for (const m of result) {
      expect(m.id).not.toContain('claude-');
    }
  });
});

// ── discoverModels (unified + memoization) ──

describe('discoverModels', () => {
  it('always appends __custom__ sentinel as last entry', () => {
    // Claude Code is static, so no mocking needed
    const result = discoverModels('claude-code');
    const last = result[result.length - 1];
    expect(last.id).toBe(CUSTOM_MODEL_SENTINEL);
    expect(last.label).toBe('Custom model…');
  });

  it('returns only __custom__ for unknown adapter', () => {
    const result = discoverModels('unknown-adapter');
    expect(result).toEqual([{ id: CUSTOM_MODEL_SENTINEL, label: 'Custom model…' }]);
  });

  it('memoizes results — second call returns same array reference', () => {
    const first = discoverModels('claude-code');
    const second = discoverModels('claude-code');
    expect(first).toBe(second);
  });

  it('_resetModelCache clears memoization', () => {
    const first = discoverModels('claude-code');
    _resetModelCache();
    const second = discoverModels('claude-code');
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('codex fallback returns only __custom__ on error', () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = discoverModels('codex');
    expect(result).toEqual([{ id: CUSTOM_MODEL_SENTINEL, label: 'Custom model…' }]);
  });

  it('gemini fallback returns only __custom__ on error', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('command not found');
    });
    const result = discoverModels('gemini');
    expect(result).toEqual([{ id: CUSTOM_MODEL_SENTINEL, label: 'Custom model…' }]);
  });
});

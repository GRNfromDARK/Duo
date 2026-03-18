import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { detectInstalledCLIs, loadAdaptersConfig } from '../../adapters/detect.js';

const mockExecFile = vi.mocked(execFile);
const mockReadFile = vi.mocked(readFile);

describe('detectInstalledCLIs', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('should return an array of DetectedCLI objects', async () => {
    mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
      callback(new Error('not found'), '', '');
      return {} as any;
    });

    const result = await detectInstalledCLIs();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
  });

  it('should detect installed CLIs', async () => {
    mockExecFile.mockImplementation((cmd: any, args: any, _opts: any, callback: any) => {
      if (cmd === 'which') {
        if (args[0] === 'claude') {
          callback(null, '/usr/local/bin/claude', '');
        } else {
          callback(new Error('not found'), '', '');
        }
      } else if (cmd === 'claude') {
        callback(null, 'claude 1.2.3', '');
      } else {
        callback(new Error('not found'), '', '');
      }
      return {} as any;
    });

    const result = await detectInstalledCLIs();
    const claude = result.find((r) => r.name === 'claude-code');
    expect(claude).toBeDefined();
    expect(claude!.installed).toBe(true);
    expect(claude!.version).toContain('1.2.3');
  });

  it('should complete within timeout (3 seconds)', async () => {
    mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
      setTimeout(() => callback(new Error('timeout'), '', ''), 10);
      return {} as any;
    });

    const start = Date.now();
    await detectInstalledCLIs();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });

  it('should exclude disabled adapters from detection', async () => {
    mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
      callback(new Error('not found'), '', '');
      return {} as any;
    });

    const result = await detectInstalledCLIs([], ['claude-code', 'codex']);
    expect(result.length).toBe(1);
    expect(result.find((r) => r.name === 'claude-code')).toBeUndefined();
    expect(result.find((r) => r.name === 'codex')).toBeUndefined();
    expect(result.find((r) => r.name === 'gemini')).toBeDefined();
  });

  it('should handle mixed installed/not-installed results', async () => {
    const installedTools = new Set(['claude', 'codex']);

    mockExecFile.mockImplementation((cmd: any, args: any, _opts: any, callback: any) => {
      if (cmd === 'which') {
        if (installedTools.has(args[0])) {
          callback(null, `/usr/local/bin/${args[0]}`, '');
        } else {
          callback(new Error('not found'), '', '');
        }
      } else if (installedTools.has(cmd)) {
        callback(null, `${cmd} 2.0.0`, '');
      } else {
        callback(new Error('not found'), '', '');
      }
      return {} as any;
    });

    const result = await detectInstalledCLIs();
    const installed = result.filter((r) => r.installed);
    const notInstalled = result.filter((r) => !r.installed);
    expect(installed.length).toBe(2);
    expect(notInstalled.length).toBe(1);
  });
});

describe('loadAdaptersConfig', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it('should parse object format with custom and disabled fields', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      custom: [
        {
          name: 'my-tool',
          displayName: 'My Tool',
          command: 'mytool',
          detectCommand: 'mytool --version',
          execCommand: 'mytool run',
          outputFormat: 'text',
          yoloFlag: '--yes',
          parserType: 'text',
        },
      ],
      disabled: ['gemini', 'codex'],
    }) as any);

    const config = await loadAdaptersConfig('/project');
    expect(config.custom).toHaveLength(1);
    expect(config.custom[0].name).toBe('my-tool');
    expect(config.disabled).toEqual(['gemini', 'codex']);
  });

  it('should treat array format as custom-only (backward compat)', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify([
      {
        name: 'legacy-tool',
        displayName: 'Legacy',
        command: 'legacy',
        detectCommand: 'legacy --version',
        execCommand: 'legacy run',
        outputFormat: 'text',
        yoloFlag: '',
        parserType: 'text',
      },
    ]) as any);

    const config = await loadAdaptersConfig('/project');
    expect(config.custom).toHaveLength(1);
    expect(config.disabled).toEqual([]);
  });

  it('should support disabled-only config (no custom adapters)', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      disabled: ['claude-code', 'gemini'],
    }) as any);

    const config = await loadAdaptersConfig('/project');
    expect(config.custom).toEqual([]);
    expect(config.disabled).toEqual(['claude-code', 'gemini']);
  });

  it('should return defaults if file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const config = await loadAdaptersConfig('/project');
    expect(config.custom).toEqual([]);
    expect(config.disabled).toEqual([]);
  });
});

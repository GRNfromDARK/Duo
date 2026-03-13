import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  CLIAdapter,
  ExecOptions,
  OutputChunk,
  CLIRegistryEntry,
  CLIRegistry,
} from '../../types/adapter.js';

describe('CLIAdapter Interface', () => {
  it('should define CLIAdapter with required properties and methods', () => {
    const adapter: CLIAdapter = {
      name: 'claude-code',
      displayName: 'Claude Code',
      version: '1.0.0',
      isInstalled: async () => true,
      getVersion: async () => '1.0.0',
      execute: async function* (_prompt: string, _opts: ExecOptions) {
        yield { type: 'text', content: 'hello', timestamp: Date.now() } satisfies OutputChunk;
      },
      kill: async () => {},
      isRunning: () => false,
    };

    expect(adapter.name).toBe('claude-code');
    expect(adapter.displayName).toBe('Claude Code');
    expect(adapter.version).toBe('1.0.0');
    expect(typeof adapter.isInstalled).toBe('function');
    expect(typeof adapter.getVersion).toBe('function');
    expect(typeof adapter.execute).toBe('function');
    expect(typeof adapter.kill).toBe('function');
    expect(typeof adapter.isRunning).toBe('function');
  });

  it('should define ExecOptions with required and optional fields', () => {
    const minimalOpts: ExecOptions = { cwd: '/project' };
    expect(minimalOpts.cwd).toBe('/project');

    const fullOpts: ExecOptions = {
      cwd: '/project',
      systemPrompt: 'You are a coder',
      env: { NODE_ENV: 'test' },
      timeout: 60000,
      permissionMode: 'skip',
    };
    expect(fullOpts.permissionMode).toBe('skip');
  });

  it('should define OutputChunk with all valid types', () => {
    const types: OutputChunk['type'][] = ['text', 'code', 'tool_use', 'tool_result', 'error', 'status'];
    types.forEach((type) => {
      const chunk: OutputChunk = { type, content: 'test', timestamp: Date.now() };
      expect(chunk.type).toBe(type);
    });
  });

  it('should allow metadata on OutputChunk', () => {
    const chunk: OutputChunk = {
      type: 'tool_use',
      content: 'running command',
      metadata: { tool: 'bash', args: ['ls'] },
      timestamp: Date.now(),
    };
    expect(chunk.metadata?.tool).toBe('bash');
  });
});

describe('CLIRegistryEntry', () => {
  it('should define registry entry with all required fields', () => {
    const entry: CLIRegistryEntry = {
      name: 'claude-code',
      displayName: 'Claude Code',
      command: 'claude',
      detectCommand: 'claude --version',
      execCommand: 'claude -p',
      outputFormat: 'stream-json',
      yoloFlag: '--dangerously-skip-permissions',
      parserType: 'stream-json',
    };
    expect(entry.name).toBe('claude-code');
    expect(entry.command).toBe('claude');
    expect(entry.parserType).toBe('stream-json');
  });
});

describe('CLIRegistry', () => {
  it('should be a map-like structure keyed by adapter name', () => {
    const registry: CLIRegistry = {
      'claude-code': {
        name: 'claude-code',
        displayName: 'Claude Code',
        command: 'claude',
        detectCommand: 'claude --version',
        execCommand: 'claude -p',
        outputFormat: 'stream-json',
        yoloFlag: '--dangerously-skip-permissions',
        parserType: 'stream-json',
      },
    };
    expect(registry['claude-code']).toBeDefined();
    expect(registry['claude-code'].command).toBe('claude');
  });
});

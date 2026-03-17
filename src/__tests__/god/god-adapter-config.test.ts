/**
 * Tests for dedicated God adapter config and selection.
 */

import { describe, expect, test } from 'vitest';
import type { DetectedCLI } from '../../adapters/detect.js';
import { createGodAdapter } from '../../god/god-adapter-factory.js';
import {
  parseStartArgs,
  createSessionConfig,
} from '../../session/session-starter.js';

describe('parseStartArgs with --god', () => {
  test('parses --god option from argv', () => {
    const argv = [
      'start',
      '--dir', '/tmp/myapp',
      '--coder', 'claude-code',
      '--reviewer', 'codex',
      '--god', 'codex',
      '--task', 'implement login',
    ];
    const result = parseStartArgs(argv);
    expect(result.god).toBe('codex');
    expect(result.coder).toBe('claude-code');
    expect(result.reviewer).toBe('codex');
  });

  test('god is undefined when --god is not provided', () => {
    const argv = ['start', '--coder', 'claude-code', '--reviewer', 'codex', '--task', 'test'];
    const result = parseStartArgs(argv);
    expect(result.god).toBeUndefined();
  });
});

describe('createSessionConfig God resolution', () => {
  const supportedDetected: DetectedCLI[] = [
    { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: true, version: '1.0.0' },
    { name: 'codex', displayName: 'Codex', command: 'codex', installed: true, version: '2.0.0' },
    { name: 'gemini', displayName: 'Gemini CLI', command: 'gemini', installed: true, version: '1.0.0' },
  ];

  test('god defaults to reviewer when reviewer is a supported God adapter', async () => {
    const result = await createSessionConfig(
      { dir: '/tmp', coder: 'claude-code', reviewer: 'codex', task: 'fix bug' },
      supportedDetected,
    );

    expect(result.config).not.toBeNull();
    expect(result.config!.god).toBe('codex');
  });

  test('god uses explicit supported value when --god is provided', async () => {
    const result = await createSessionConfig(
      { dir: '/tmp', coder: 'claude-code', reviewer: 'codex', god: 'claude-code', task: 'fix bug' },
      supportedDetected,
    );

    expect(result.config).not.toBeNull();
    expect(result.config!.god).toBe('claude-code');
  });

  test('god defaults to gemini when reviewer is gemini (now a supported God adapter)', async () => {
    const result = await createSessionConfig(
      { dir: '/tmp', coder: 'codex', reviewer: 'gemini', task: 'fix bug' },
      [
        { name: 'codex', displayName: 'Codex', command: 'codex', installed: true, version: '2.0.0' },
        { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: true, version: '1.0.0' },
        { name: 'gemini', displayName: 'Gemini CLI', command: 'gemini', installed: true, version: '1.0.0' },
      ],
    );

    expect(result.config).not.toBeNull();
    expect(result.config!.god).toBe('gemini');
    // No God-related warnings (may have git directory warning)
    const godWarnings = result.validation.warnings.filter(w => w.includes('God'));
    expect(godWarnings).toHaveLength(0);
  });

  test('accepts gemini as explicit God adapter', async () => {
    const result = await createSessionConfig(
      { dir: '/tmp', coder: 'claude-code', reviewer: 'codex', god: 'gemini', task: 'fix bug' },
      supportedDetected,
    );

    expect(result.config).not.toBeNull();
    expect(result.config!.god).toBe('gemini');
    expect(result.validation.valid).toBe(true);
  });
});

describe('Dedicated God adapter instances', () => {
  test('God and coder using the same CLI still create isolated adapter instances', () => {
    const godAdapter = createGodAdapter('claude-code');
    const anotherGodAdapter = createGodAdapter('claude-code');

    expect(godAdapter).not.toBe(anotherGodAdapter);
    expect(godAdapter.name).toBe(anotherGodAdapter.name);
  });

  test('dedicated God adapters expose the required runtime methods', () => {
    const godAdapter = createGodAdapter('codex');

    expect(godAdapter.name).toBe('codex');
    expect(typeof godAdapter.isInstalled).toBe('function');
    expect(typeof godAdapter.execute).toBe('function');
    expect(typeof godAdapter.kill).toBe('function');
    expect(typeof godAdapter.isRunning).toBe('function');
  });
});

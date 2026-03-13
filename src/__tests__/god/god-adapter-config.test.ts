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

  test('falls back to an installed supported God adapter when reviewer cannot act as God', async () => {
    const result = await createSessionConfig(
      { dir: '/tmp', coder: 'codex', reviewer: 'gemini', task: 'fix bug' },
      [
        { name: 'codex', displayName: 'Codex', command: 'codex', installed: true, version: '2.0.0' },
        { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: true, version: '1.0.0' },
        { name: 'gemini', displayName: 'Gemini CLI', command: 'gemini', installed: true, version: '1.0.0' },
      ],
    );

    expect(result.config).not.toBeNull();
    expect(result.config!.god).toBe('claude-code');
    expect(result.validation.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("Reviewer 'gemini' cannot act as God"),
    ]));
  });

  test('rejects unsupported explicit God adapters', async () => {
    const result = await createSessionConfig(
      { dir: '/tmp', coder: 'claude-code', reviewer: 'codex', god: 'gemini', task: 'fix bug' },
      supportedDetected,
    );

    expect(result.config).toBeNull();
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("God adapter 'gemini' is not supported"),
    ]));
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

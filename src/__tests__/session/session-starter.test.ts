/**
 * Tests for session-starter — Card C.2
 * Source: FR-001 (AC-001, AC-002, AC-003, AC-004)
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  parseStartArgs,
  validateProjectDir,
  validateCLIChoices,
  createSessionConfig,
} from '../../session/session-starter.js';
import type { DetectedCLI } from '../../adapters/detect.js';

// ─── AC-1: CLI 参数模式正确解析所有选项 ───

describe('parseStartArgs', () => {
  test('parses all options from argv', () => {
    const argv = [
      'start',
      '--dir', '/tmp/myapp',
      '--coder', 'claude-code',
      '--reviewer', 'codex',
      '--task', 'implement login',
    ];
    const result = parseStartArgs(argv);
    expect(result).toEqual({
      dir: '/tmp/myapp',
      coder: 'claude-code',
      reviewer: 'codex',
      task: 'implement login',
    });
  });

  test('returns empty fields when no options provided', () => {
    const argv = ['start'];
    const result = parseStartArgs(argv);
    expect(result).toEqual({
      dir: undefined,
      coder: undefined,
      reviewer: undefined,
      task: undefined,
    });
  });

  test('handles partial options', () => {
    const argv = ['start', '--dir', '/tmp/myapp', '--coder', 'gemini'];
    const result = parseStartArgs(argv);
    expect(result.dir).toBe('/tmp/myapp');
    expect(result.coder).toBe('gemini');
    expect(result.reviewer).toBeUndefined();
    expect(result.task).toBeUndefined();
  });

  test('ignores unknown flags', () => {
    const argv = ['start', '--dir', '/tmp/myapp', '--verbose', '--coder', 'claude-code'];
    const result = parseStartArgs(argv);
    expect(result.dir).toBe('/tmp/myapp');
    expect(result.coder).toBe('claude-code');
  });

  test('test_regression_bug8_trailing_flag_without_value_does_not_crash', () => {
    const argv = ['start', '--dir', '/tmp', '--coder'];
    const result = parseStartArgs(argv);
    expect(result.dir).toBe('/tmp');
    expect(result.coder).toBeUndefined();
  });

  test('test_regression_bug8_trailing_flag_does_not_swallow_next_arg', () => {
    const argv = ['start', '--coder', 'claude-code', '--task'];
    const result = parseStartArgs(argv);
    expect(result.coder).toBe('claude-code');
    expect(result.task).toBeUndefined();
  });
});

// ─── AC-4: 非法目录（不存在/无权限）给出错误提示 ───

describe('validateProjectDir', () => {
  test('returns error for non-existent directory', async () => {
    const result = await validateProjectDir('/nonexistent/path/that/does/not/exist');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('does not exist');
  });

  test('returns warning for non-git directory', async () => {
    // Use /tmp which exists but is likely not a git repo
    const result = await validateProjectDir('/tmp');
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('git');
  });

  test('returns valid for existing directory', async () => {
    const result = await validateProjectDir('/tmp');
    expect(result.valid).toBe(true);
  });
});

// ─── AC-3: 未安装的 CLI 工具给出友好提示 ───

describe('validateCLIChoices', () => {
  const mockDetected: DetectedCLI[] = [
    { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: true, version: '1.0.0' },
    { name: 'codex', displayName: 'Codex', command: 'codex', installed: true, version: '2.0.0' },
    { name: 'gemini', displayName: 'Gemini CLI', command: 'gemini', installed: false, version: null },
  ];

  test('returns valid when both coder and reviewer are installed', () => {
    const result = validateCLIChoices('claude-code', 'codex', mockDetected);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('returns error when coder is not installed', () => {
    const result = validateCLIChoices('gemini', 'codex', mockDetected);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Gemini CLI');
    expect(result.errors[0]).toContain('not installed');
  });

  test('returns error when reviewer is not installed', () => {
    const result = validateCLIChoices('claude-code', 'gemini', mockDetected);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Gemini CLI');
  });

  test('returns error when CLI name is not in registry', () => {
    const result = validateCLIChoices('unknown-cli', 'codex', mockDetected);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('unknown-cli');
    expect(result.errors[0]).toContain('not found');
  });

  test('returns error when coder and reviewer are the same', () => {
    const result = validateCLIChoices('claude-code', 'claude-code', mockDetected);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('same');
  });
});

// ─── AC-2: 交互式模式引导流程 & 综合 createSessionConfig ───

describe('createSessionConfig', () => {
  test('creates config from complete args and detected CLIs', async () => {
    const mockDetected: DetectedCLI[] = [
      { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: true, version: '1.0.0' },
      { name: 'codex', displayName: 'Codex', command: 'codex', installed: true, version: '2.0.0' },
    ];

    const result = await createSessionConfig(
      { dir: '/tmp', coder: 'claude-code', reviewer: 'codex', task: 'fix bug' },
      mockDetected,
    );

    expect(result.config).toEqual({
      projectDir: '/tmp',
      coder: 'claude-code',
      reviewer: 'codex',
      god: 'codex',
      task: 'fix bug',
    });
    expect(result.validation.valid).toBe(true);
  });

  test('returns errors when dir is invalid', async () => {
    const mockDetected: DetectedCLI[] = [
      { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: true, version: '1.0.0' },
      { name: 'codex', displayName: 'Codex', command: 'codex', installed: true, version: '2.0.0' },
    ];

    const result = await createSessionConfig(
      { dir: '/nonexistent/path/xyz', coder: 'claude-code', reviewer: 'codex', task: 'test' },
      mockDetected,
    );

    expect(result.config).toBeNull();
    expect(result.validation.valid).toBe(false);
  });

  test('returns errors when required args are missing', async () => {
    const result = await createSessionConfig(
      { dir: '/tmp' },
      [],
    );

    expect(result.config).toBeNull();
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.some(e => e.includes('coder'))).toBe(true);
    expect(result.validation.errors.some(e => e.includes('reviewer'))).toBe(true);
    expect(result.validation.errors.some(e => e.includes('task'))).toBe(true);
  });

  test('returns list of detected CLIs for onboarding', async () => {
    const mockDetected: DetectedCLI[] = [
      { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: true, version: '1.0.0' },
      { name: 'gemini', displayName: 'Gemini CLI', command: 'gemini', installed: false, version: null },
    ];

    const result = await createSessionConfig(
      { dir: '/tmp', coder: 'claude-code', reviewer: 'claude-code', task: 'test' },
      mockDetected,
    );

    expect(result.detectedCLIs).toContain('claude-code');
    expect(result.detectedCLIs).not.toContain('gemini');
  });
});

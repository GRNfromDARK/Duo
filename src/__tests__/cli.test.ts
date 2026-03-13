/**
 * Tests for CLI entry point — Card C.2
 * Source: FR-001 (AC-001, AC-002, AC-003, AC-004)
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { handleStart } from '../cli-commands.js';
import type { DetectedCLI } from '../adapters/detect.js';

// Mock detectInstalledCLIs
vi.mock('../adapters/detect.js', () => ({
  detectInstalledCLIs: vi.fn(),
}));

import { detectInstalledCLIs } from '../adapters/detect.js';
const mockDetect = vi.mocked(detectInstalledCLIs);

describe('handleStart', () => {
  let output: string[];

  beforeEach(() => {
    output = [];
    vi.clearAllMocks();
  });

  const log = (msg: string) => output.push(msg);

  test('succeeds with valid args and installed CLIs', async () => {
    const detected: DetectedCLI[] = [
      { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: true, version: '1.0.0' },
      { name: 'codex', displayName: 'Codex', command: 'codex', installed: true, version: '2.0.0' },
    ];
    mockDetect.mockResolvedValue(detected);

    const result = await handleStart(
      ['start', '--dir', '/tmp', '--coder', 'claude-code', '--reviewer', 'codex', '--task', 'fix bug'],
      log,
    );

    expect(result.success).toBe(true);
    expect(result.config?.coder).toBe('claude-code');
    expect(result.config?.reviewer).toBe('codex');
    expect(result.config?.task).toBe('fix bug');
    // Onboarding: should show detected CLIs
    expect(output.some(line => line.includes('Claude Code'))).toBe(true);
  });

  test('fails with non-existent directory', async () => {
    mockDetect.mockResolvedValue([]);

    const result = await handleStart(
      ['start', '--dir', '/nonexistent/xyz', '--coder', 'claude-code', '--reviewer', 'codex', '--task', 'test'],
      log,
    );

    expect(result.success).toBe(false);
    expect(output.some(line => line.includes('does not exist'))).toBe(true);
  });

  test('fails when coder CLI is not installed', async () => {
    const detected: DetectedCLI[] = [
      { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: false, version: null },
      { name: 'codex', displayName: 'Codex', command: 'codex', installed: true, version: '2.0.0' },
    ];
    mockDetect.mockResolvedValue(detected);

    const result = await handleStart(
      ['start', '--dir', '/tmp', '--coder', 'claude-code', '--reviewer', 'codex', '--task', 'test'],
      log,
    );

    expect(result.success).toBe(false);
    expect(output.some(line => line.includes('not installed'))).toBe(true);
  });

  test('shows onboarding with detected CLI tools', async () => {
    const detected: DetectedCLI[] = [
      { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: true, version: '1.0.0' },
      { name: 'codex', displayName: 'Codex', command: 'codex', installed: true, version: '2.0.0' },
      { name: 'gemini', displayName: 'Gemini CLI', command: 'gemini', installed: false, version: null },
    ];
    mockDetect.mockResolvedValue(detected);

    const result = await handleStart(
      ['start', '--dir', '/tmp', '--coder', 'claude-code', '--reviewer', 'codex', '--task', 'test'],
      log,
    );

    // Should show installed CLIs with checkmarks
    expect(output.some(line => line.includes('Claude Code') && line.includes('✓'))).toBe(true);
    expect(output.some(line => line.includes('Codex') && line.includes('✓'))).toBe(true);
    // Should show not installed CLIs with X
    expect(output.some(line => line.includes('Gemini CLI') && line.includes('✗'))).toBe(true);
  });

  test('shows quick tips in onboarding', async () => {
    const detected: DetectedCLI[] = [
      { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: true, version: '1.0.0' },
      { name: 'codex', displayName: 'Codex', command: 'codex', installed: true, version: '2.0.0' },
    ];
    mockDetect.mockResolvedValue(detected);

    await handleStart(
      ['start', '--dir', '/tmp', '--coder', 'claude-code', '--reviewer', 'codex', '--task', 'test'],
      log,
    );

    expect(output.some(line => line.toLowerCase().includes('tip'))).toBe(true);
  });

  test('returns interactive flag when required args are missing', async () => {
    const detected: DetectedCLI[] = [
      { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: true, version: '1.0.0' },
    ];
    mockDetect.mockResolvedValue(detected);

    const result = await handleStart(['start'], log);

    expect(result.success).toBe(false);
    expect(result.needsInteractive).toBe(true);
  });
});

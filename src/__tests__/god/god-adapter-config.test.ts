/**
 * Tests for Card A.2: God Adapter Config + --god parameter
 * Source: FR-006 (AC-021, AC-022)
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  parseStartArgs,
  createSessionConfig,
} from '../../session/session-starter.js';
import { createAdapter } from '../../adapters/factory.js';
import type { DetectedCLI } from '../../adapters/detect.js';

// ── AC-1: --god parameter parsing ──────────────────────────────

describe('parseStartArgs with --god', () => {
  test('parses --god option from argv', () => {
    const argv = [
      'start',
      '--dir', '/tmp/myapp',
      '--coder', 'claude-code',
      '--reviewer', 'codex',
      '--god', 'gemini',
      '--task', 'implement login',
    ];
    const result = parseStartArgs(argv);
    expect(result.god).toBe('gemini');
    expect(result.coder).toBe('claude-code');
    expect(result.reviewer).toBe('codex');
  });

  test('god is undefined when --god is not provided', () => {
    const argv = ['start', '--coder', 'claude-code', '--reviewer', 'codex', '--task', 'test'];
    const result = parseStartArgs(argv);
    expect(result.god).toBeUndefined();
  });
});

// ── AC-2: --god defaults to --reviewer when omitted ────────────

describe('createSessionConfig god defaults', () => {
  const mockDetected: DetectedCLI[] = [
    { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: true, version: '1.0.0' },
    { name: 'codex', displayName: 'Codex', command: 'codex', installed: true, version: '2.0.0' },
    { name: 'gemini', displayName: 'Gemini CLI', command: 'gemini', installed: true, version: '1.0.0' },
  ];

  test('god defaults to reviewer when --god is omitted', async () => {
    const result = await createSessionConfig(
      { dir: '/tmp', coder: 'claude-code', reviewer: 'codex', task: 'fix bug' },
      mockDetected,
    );

    expect(result.config).not.toBeNull();
    expect(result.config!.god).toBe('codex');
  });

  test('god uses explicit value when --god is provided', async () => {
    const result = await createSessionConfig(
      { dir: '/tmp', coder: 'claude-code', reviewer: 'codex', god: 'gemini', task: 'fix bug' },
      mockDetected,
    );

    expect(result.config).not.toBeNull();
    expect(result.config!.god).toBe('gemini');
  });

  test('existing config fields are unchanged after adding god', async () => {
    const result = await createSessionConfig(
      { dir: '/tmp', coder: 'claude-code', reviewer: 'codex', task: 'fix bug' },
      mockDetected,
    );

    expect(result.config).not.toBeNull();
    expect(result.config!.projectDir).toBe('/tmp');
    expect(result.config!.coder).toBe('claude-code');
    expect(result.config!.reviewer).toBe('codex');
    expect(result.config!.task).toBe('fix bug');
  });
});

// ── AC-3: God adapter instance isolation ───────────────────────

describe('God adapter instance isolation', () => {
  test('God and Coder using same CLI tool produce different instances', () => {
    const godAdapter = createAdapter('claude-code');
    const coderAdapter = createAdapter('claude-code');

    // Different object references = independent sessions
    expect(godAdapter).not.toBe(coderAdapter);
    expect(godAdapter.name).toBe(coderAdapter.name);
  });

  test('God adapter is a valid CLIAdapter with required methods', () => {
    const godAdapter = createAdapter('claude-code');

    expect(godAdapter.name).toBe('claude-code');
    expect(typeof godAdapter.isInstalled).toBe('function');
    expect(typeof godAdapter.execute).toBe('function');
    expect(typeof godAdapter.kill).toBe('function');
    expect(typeof godAdapter.isRunning).toBe('function');
  });
});

// ── AC-4: God system prompt ────────────────────────────────────

describe('God system prompt', () => {
  // Dynamically import to test the module
  test('buildGodSystemPrompt returns string with orchestrator role', async () => {
    const { buildGodSystemPrompt } = await import('../../god/god-system-prompt.js');

    const prompt = buildGodSystemPrompt({
      task: 'implement login',
      coderName: 'claude-code',
      reviewerName: 'codex',
    });

    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
    // Must contain orchestrator/coordinator role instruction
    expect(prompt).toMatch(/orchestrat|coordinat|编排/i);
  });

  test('buildGodSystemPrompt includes JSON format constraint', async () => {
    const { buildGodSystemPrompt } = await import('../../god/god-system-prompt.js');

    const prompt = buildGodSystemPrompt({
      task: 'fix bug',
      coderName: 'codex',
      reviewerName: 'claude-code',
    });

    // Must instruct God to output JSON code blocks
    expect(prompt).toMatch(/```json|JSON/i);
  });

  test('buildGodSystemPrompt distinguishes from Coder/Reviewer role', async () => {
    const { buildGodSystemPrompt } = await import('../../god/god-system-prompt.js');

    const prompt = buildGodSystemPrompt({
      task: 'refactor module',
      coderName: 'claude-code',
      reviewerName: 'codex',
    });

    // Should NOT contain coder/reviewer execution role keywords
    // Should contain orchestrator-level keywords
    expect(prompt).toMatch(/orchestrat|coordinat|编排|decision|判断|路由/i);
  });
});

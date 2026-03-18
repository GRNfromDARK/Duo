import { describe, it, expect } from 'vitest';
import {
  buildObservationsSection,
  SYSTEM_PROMPT,
  GodDecisionService,
} from '../../god/god-decision-service.js';
import { createMockWatchdog } from '../helpers/mock-watchdog.js';
import type { GodAdapter, GodExecOptions } from '../../types/god-adapter.js';
import type { OutputChunk } from '../../types/adapter.js';
import type { GodDecisionContext } from '../../god/god-decision-service.js';
import type { Observation } from '../../types/observation.js';

describe('Resume prompt slimming — baseline', () => {
  const mockObservations: Observation[] = [
    {
      source: 'coder',
      type: 'work_output',
      summary: 'Implemented feature X with tests',
      severity: 'info',
      timestamp: '2026-03-16T10:00:00Z',
    },
  ];

  it('buildObservationsSection still works for resume prompt', () => {
    const section = buildObservationsSection(mockObservations);
    expect(section).toContain('Recent Observations');
    expect(section).toContain('Implemented feature X');
  });

  it('SYSTEM_PROMPT contains format instructions', () => {
    expect(SYSTEM_PROMPT).toContain('JSON');
  });
});

function createResumeAdapter(capturedPrompts: string[]): GodAdapter {
  return {
    name: 'mock-god',
    displayName: 'Mock God',
    version: '1.0.0',
    toolUsePolicy: 'forbid',
    isInstalled: async () => true,
    getVersion: async () => '1.0.0',
    execute: async function* (prompt: string, _opts: GodExecOptions): AsyncIterable<OutputChunk> {
      capturedPrompts.push(prompt);
      yield {
        type: 'text',
        content: '```json\n' + JSON.stringify({
          diagnosis: { summary: 'test', currentGoal: 'test', notableObservations: [] },
          actions: [{ type: 'wait', reason: 'test' }],
          messages: [],
        }) + '\n```',
        metadata: {},
        timestamp: Date.now(),
      };
    },
    kill: async () => {},
    isRunning: () => false,
  };
}

describe('GodDecisionService.makeDecision with isResuming', () => {
  const baseContext: GodDecisionContext = {
    taskGoal: 'Implement login feature',
    availableAdapters: ['claude-code', 'codex'],
    activeRole: 'coder',
    sessionDir: '/tmp/test-session',
  };

  it('first round (isResuming=false) includes full prompt', async () => {
    const capturedPrompts: string[] = [];
    const adapter = createResumeAdapter(capturedPrompts);
    const service = new GodDecisionService(adapter, createMockWatchdog());
    await service.makeDecision(
      [{ source: 'coder', type: 'work_output', summary: 'code output', severity: 'info', timestamp: '2026-03-16T10:00:00Z'}],
      baseContext,
      false,
    );
    const prompt = capturedPrompts[0];
    expect(prompt).toContain('Task Goal');
    expect(prompt).toContain('Available Hand Actions');
    expect(prompt).toContain('Implement login feature');
  });

  it('resume round (isResuming=true) sends slim prompt', async () => {
    const capturedPrompts: string[] = [];
    const adapter = createResumeAdapter(capturedPrompts);
    const service = new GodDecisionService(adapter, createMockWatchdog());
    await service.makeDecision(
      [{ source: 'coder', type: 'work_output', summary: 'code output', severity: 'info', timestamp: '2026-03-16T10:00:00Z'}],
      baseContext,
      true,
    );
    const prompt = capturedPrompts[0];
    expect(prompt).not.toContain('Task Goal');
    expect(prompt).not.toContain('Available Hand Actions');
    expect(prompt).toContain('Recent Observations');
    expect(prompt).toContain('Reminder:');
  });
});

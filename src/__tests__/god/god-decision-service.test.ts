/**
 * Tests for God Decision Service — simplified.
 * No authority, no phases, no previousDecisions.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { OutputChunk } from '../../types/adapter.js';
import type { GodAdapter, GodExecOptions } from '../../types/god-adapter.js';
import type { Observation } from '../../types/observation.js';
import {
  GodDecisionService,
  type GodDecisionContext,
  SYSTEM_PROMPT,
} from '../../god/god-decision-service.js';
import { WatchdogService } from '../../god/watchdog.js';

function createMockWatchdog(): WatchdogService {
  return new WatchdogService();
}

function createMockAdapter(
  responseText: string,
  name = 'mock-god',
): { adapter: GodAdapter; getLastPrompt(): string | undefined; getLastSystemPrompt(): string | undefined } {
  let lastPrompt: string | undefined;
  let lastSystemPrompt: string | undefined;
  return {
    adapter: {
      name,
      displayName: 'Mock God',
      version: '1.0.0',
      toolUsePolicy: 'forbid' as const,
      isInstalled: async () => true,
      getVersion: async () => '1.0.0',
      execute(prompt: string, opts: GodExecOptions): AsyncIterable<OutputChunk> {
        lastPrompt = prompt;
        lastSystemPrompt = opts.systemPrompt;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'text' as const, content: responseText, timestamp: Date.now() };
          },
        };
      },
      kill: async () => {},
      isRunning: () => false,
    },
    getLastPrompt: () => lastPrompt,
    getLastSystemPrompt: () => lastSystemPrompt,
  };
}

function makeValidEnvelopeJson(): string {
  const envelope = {
    diagnosis: {
      summary: 'Coder produced valid output, send to reviewer',
      currentGoal: 'Implement feature X',
      notableObservations: ['work_output from coder'],
    },
    actions: [
      { type: 'send_to_reviewer', message: 'Please review the implementation' },
    ],
    messages: [
      { target: 'system_log', content: 'Routing to reviewer after coder output' },
    ],
  };
  return '```json\n' + JSON.stringify(envelope, null, 2) + '\n```';
}

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    source: 'coder',
    type: 'work_output',
    summary: 'Coder completed implementation',
    severity: 'info',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeContext(overrides: Partial<GodDecisionContext> = {}): GodDecisionContext {
  return {
    taskGoal: 'Implement feature X',
    availableAdapters: ['claude-code', 'codex'],
    activeRole: 'coder',
    sessionDir: '/tmp/test-session',
    ...overrides,
  };
}

describe('GodDecisionService', () => {
  let tmpDir: string;
  let sessionDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-god-decision-'));
    sessionDir = path.join(tmpDir, 'session');
    fs.mkdirSync(sessionDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('makeDecision returns GodDecisionEnvelope', () => {
    it('returns a valid GodDecisionEnvelope when God outputs valid JSON', async () => {
      const { adapter } = createMockAdapter(makeValidEnvelopeJson());
      const service = new GodDecisionService(adapter, createMockWatchdog());
      const result = await service.makeDecision([makeObservation()], makeContext({ sessionDir }));
      expect(result.diagnosis).toBeDefined();
      expect(result.diagnosis.summary).toBe('Coder produced valid output, send to reviewer');
      expect(result.actions).toBeInstanceOf(Array);
      expect(result.messages).toBeInstanceOf(Array);
    });
  });

  describe('prompt includes Hand action catalog', () => {
    it('includes Hand action types in the prompt', async () => {
      const { adapter, getLastPrompt } = createMockAdapter(makeValidEnvelopeJson());
      const service = new GodDecisionService(adapter, createMockWatchdog());
      await service.makeDecision([makeObservation()], makeContext({ sessionDir }));
      const prompt = getLastPrompt()!;
      expect(prompt).toContain('send_to_coder');
      expect(prompt).toContain('send_to_reviewer');
      expect(prompt).toContain('accept_task');
      expect(prompt).toContain('wait');
      expect(prompt).toContain('request_user_input');
    });
  });

  describe('system prompt content', () => {
    it('system prompt instructs God to output JSON', async () => {
      const { adapter, getLastSystemPrompt } = createMockAdapter(makeValidEnvelopeJson());
      const service = new GodDecisionService(adapter, createMockWatchdog());
      await service.makeDecision([makeObservation()], makeContext({ sessionDir }));
      const systemPrompt = getLastSystemPrompt()!;
      expect(systemPrompt).toContain('diagnosis');
      expect(systemPrompt).toContain('actions');
      expect(systemPrompt).toContain('messages');
      expect(systemPrompt).toContain('JSON');
    });

    it('system prompt contains request_user_input guidance', () => {
      expect(SYSTEM_PROMPT).toContain('request_user_input');
    });
  });

  describe('degradation fallback', () => {
    it('returns fallback envelope when God returns no JSON', async () => {
      const { adapter } = createMockAdapter('I am thinking...');
      const watchdog = createMockWatchdog();
      const service = new GodDecisionService(adapter, watchdog);
      const result = await service.makeDecision([makeObservation()], makeContext({ sessionDir }));
      expect(result.diagnosis).toBeDefined();
      expect(result.actions).toBeInstanceOf(Array);
    });
  });

  describe('observations sorted by severity', () => {
    it('error severity appears before info in prompt', async () => {
      const { adapter, getLastPrompt } = createMockAdapter(makeValidEnvelopeJson());
      const service = new GodDecisionService(adapter, createMockWatchdog());
      const observations = [
        makeObservation({ summary: 'Low priority info', severity: 'info', timestamp: '2026-01-01T00:00:01Z' }),
        makeObservation({ summary: 'Critical error detected', severity: 'error', timestamp: '2026-01-01T00:00:02Z' }),
      ];
      await service.makeDecision(observations, makeContext({ sessionDir }));
      const prompt = getLastPrompt()!;
      const errorIdx = prompt.indexOf('Critical error detected');
      const infoIdx = prompt.indexOf('Low priority info');
      expect(errorIdx).toBeLessThan(infoIdx);
    });
  });

  describe('Watchdog integration', () => {
    it('keeps failures at 0 on success', async () => {
      const { adapter } = createMockAdapter(makeValidEnvelopeJson());
      const watchdog = createMockWatchdog();
      const service = new GodDecisionService(adapter, watchdog);
      await service.makeDecision([makeObservation()], makeContext({ sessionDir }));
      expect(watchdog.getConsecutiveFailures()).toBe(0);
    });
  });
});

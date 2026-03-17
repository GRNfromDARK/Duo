/**
 * Test helper: creates a WatchdogService with a mock adapter
 * that returns a predetermined decision.
 */

import type { OutputChunk } from '../../types/adapter.js';
import type { GodExecOptions } from '../../types/god-adapter.js';
import { WatchdogService, type WatchdogDecision } from '../../god/watchdog.js';

export function createMockWatchdog(
  decision: WatchdogDecision = { analysis: 'test escalation', decision: 'escalate' },
): WatchdogService {
  const json = JSON.stringify(decision);
  const mockAdapter = {
    name: 'mock-watchdog',
    displayName: 'Mock Watchdog',
    version: '1.0.0',
    isInstalled: async () => true,
    getVersion: async () => '1.0.0',
    execute(_prompt: string, _opts: GodExecOptions): AsyncIterable<OutputChunk> {
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text' as const, content: '```json\n' + json + '\n```', timestamp: Date.now() };
        },
      };
    },
    kill: async () => {},
    isRunning: () => false,
  };
  return new WatchdogService(mockAdapter);
}

/**
 * Adapter factory — creates CLIAdapter instances by name.
 */

import type { CLIAdapter } from '../types/adapter.js';
import { ClaudeCodeAdapter } from './claude-code/adapter.js';
import { CodexAdapter } from './codex/adapter.js';
import { GeminiAdapter } from './gemini/adapter.js';

const ADAPTER_CONSTRUCTORS: Record<string, () => CLIAdapter> = {
  'claude-code': () => new ClaudeCodeAdapter(),
  'codex': () => new CodexAdapter(),
  'gemini': () => new GeminiAdapter(),
};

export function createAdapter(name: string): CLIAdapter {
  const ctor = ADAPTER_CONSTRUCTORS[name];
  if (!ctor) {
    throw new Error(
      `Unknown adapter: ${name}. Available: ${Object.keys(ADAPTER_CONSTRUCTORS).join(', ')}`,
    );
  }
  return ctor();
}

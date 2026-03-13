/**
 * Adapter factory — creates CLIAdapter instances by name.
 */

import type { CLIAdapter } from '../types/adapter.js';
import { ClaudeCodeAdapter } from './claude-code/adapter.js';
import { CodexAdapter } from './codex/adapter.js';
import { GeminiAdapter } from './gemini/adapter.js';
import { CopilotAdapter } from './copilot/adapter.js';
import { AiderAdapter } from './aider/adapter.js';
import { AmpAdapter } from './amp/adapter.js';
import { ClineAdapter } from './cline/adapter.js';
import { QwenAdapter } from './qwen/adapter.js';
import { CursorAdapter } from './cursor/adapter.js';
import { ContinueAdapter } from './continue/adapter.js';
import { AmazonQAdapter } from './amazon-q/adapter.js';
import { GooseAdapter } from './goose/adapter.js';

const ADAPTER_CONSTRUCTORS: Record<string, () => CLIAdapter> = {
  'claude-code': () => new ClaudeCodeAdapter(),
  'codex': () => new CodexAdapter(),
  'gemini': () => new GeminiAdapter(),
  'copilot': () => new CopilotAdapter(),
  'aider': () => new AiderAdapter(),
  'amazon-q': () => new AmazonQAdapter(),
  'cursor': () => new CursorAdapter(),
  'cline': () => new ClineAdapter(),
  'continue': () => new ContinueAdapter(),
  'goose': () => new GooseAdapter(),
  'amp': () => new AmpAdapter(),
  'qwen': () => new QwenAdapter(),
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

import type { GodAdapter } from '../types/god-adapter.js';
import {
  SUPPORTED_GOD_ADAPTERS,
  isSupportedGodAdapterName,
} from './god-adapter-config.js';
import { ClaudeCodeGodAdapter } from './adapters/claude-code-god-adapter.js';
import { CodexGodAdapter } from './adapters/codex-god-adapter.js';

export { SUPPORTED_GOD_ADAPTERS, isSupportedGodAdapterName } from './god-adapter-config.js';

export function createGodAdapter(name: string): GodAdapter {
  if (name === 'claude-code') {
    return new ClaudeCodeGodAdapter();
  }
  if (name === 'codex') {
    return new CodexGodAdapter();
  }

  throw new Error(
    `Unsupported God adapter: ${name}. Supported God adapters: ${SUPPORTED_GOD_ADAPTERS.join(', ')}`,
  );
}

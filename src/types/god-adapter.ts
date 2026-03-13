import type { OutputChunk } from './adapter.js';

export type GodAdapterName = 'claude-code' | 'codex';

export interface GodExecOptions {
  cwd: string;
  systemPrompt: string;
  timeoutMs: number;
}

export interface GodAdapter {
  readonly name: string;
  readonly displayName: string;
  readonly version: string;

  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string>;
  execute(prompt: string, opts: GodExecOptions): AsyncIterable<OutputChunk>;
  kill(): Promise<void>;
  isRunning(): boolean;
}

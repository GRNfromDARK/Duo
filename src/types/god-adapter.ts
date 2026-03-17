import type { OutputChunk } from './adapter.js';

export type GodAdapterName = 'claude-code' | 'codex' | 'gemini';
export type GodToolUsePolicy = 'forbid' | 'allow-readonly';

export interface GodExecOptions {
  cwd: string;
  systemPrompt: string;
  timeoutMs: number;
  /** Optional model override for the God adapter (e.g. 'opus', 'gemini-2.5-pro'). */
  model?: string;
}

export interface GodAdapter {
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly toolUsePolicy?: GodToolUsePolicy;
  readonly minimumTimeoutMs?: number;

  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string>;
  execute(prompt: string, opts: GodExecOptions): AsyncIterable<OutputChunk>;
  kill(): Promise<void>;
  isRunning(): boolean;
  /** Clear session state to force a fresh call on next execute. */
  clearSession?(): void;
}

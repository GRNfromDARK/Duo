/**
 * Core CLIAdapter interfaces for Duo's plugin architecture.
 * Source: FR-008 (AC-029, AC-030, AC-031, AC-032, AC-033-new)
 */

export interface ExecOptions {
  cwd: string;
  systemPrompt?: string;
  env?: Record<string, string>;
  /** If true, env replaces process.env entirely instead of merging with it. */
  replaceEnv?: boolean;
  timeout?: number;
  permissionMode?: 'skip' | 'safe';
  /** If true, disable all tools (Claude Code: --tools ""). Used for God orchestrator. */
  disableTools?: boolean;
  /** Optional model override to pass to the CLI tool (e.g. 'sonnet', 'gpt-5.4'). */
  model?: string;
}

export interface OutputChunk {
  type: 'text' | 'code' | 'tool_use' | 'tool_result' | 'error' | 'status';
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface CLIAdapter {
  readonly name: string;
  readonly displayName: string;
  readonly version: string;

  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string>;
  execute(prompt: string, opts: ExecOptions): AsyncIterable<OutputChunk>;
  kill(): Promise<void>;
  isRunning(): boolean;
}

export type ParserType = 'stream-json' | 'jsonl' | 'text';

export interface CLIRegistryEntry {
  name: string;
  displayName: string;
  command: string;
  detectCommand: string;
  execCommand: string;
  outputFormat: string;
  yoloFlag: string;
  parserType: ParserType;
  /** CLI flag name used to specify a model (e.g. '--model'). Undefined means not supported. */
  modelFlag?: string;
}

export type CLIRegistry = Record<string, CLIRegistryEntry>;

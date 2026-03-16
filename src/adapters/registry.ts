/**
 * CLI tool registry — 12 mainstream AI coding assistants.
 * Source: FR-008 design table
 */

import type { CLIRegistry, CLIRegistryEntry } from '../types/adapter.js';

export const CLI_REGISTRY: CLIRegistry = {
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    command: 'claude',
    detectCommand: 'claude --version',
    execCommand: 'claude -p',
    outputFormat: 'stream-json',
    yoloFlag: '--dangerously-skip-permissions',
    parserType: 'stream-json',
    modelFlag: '--model',
  },
  codex: {
    name: 'codex',
    displayName: 'Codex',
    command: 'codex',
    detectCommand: 'codex --version',
    execCommand: 'codex exec',
    outputFormat: '--json',
    yoloFlag: '--yolo',
    parserType: 'jsonl',
    modelFlag: '--model',
  },
  gemini: {
    name: 'gemini',
    displayName: 'Gemini CLI',
    command: 'gemini',
    detectCommand: 'gemini --version',
    execCommand: 'gemini -p',
    outputFormat: 'stream-json',
    yoloFlag: '--yolo',
    parserType: 'stream-json',
    modelFlag: '--model',
  },
  copilot: {
    name: 'copilot',
    displayName: 'GitHub Copilot',
    command: 'copilot',
    detectCommand: 'copilot --version',
    execCommand: 'copilot -p',
    outputFormat: 'JSON',
    yoloFlag: '--allow-all-tools',
    parserType: 'jsonl',
    modelFlag: '--model',
  },
  aider: {
    name: 'aider',
    displayName: 'Aider',
    command: 'aider',
    detectCommand: 'aider --version',
    execCommand: 'aider -m',
    outputFormat: 'text',
    yoloFlag: '--yes-always',
    parserType: 'text',
    modelFlag: '--model',
  },
  'amazon-q': {
    name: 'amazon-q',
    displayName: 'Amazon Q',
    command: 'q',
    detectCommand: 'q version',
    execCommand: 'q chat --no-interactive',
    outputFormat: 'text',
    yoloFlag: '--trust-all-tools',
    parserType: 'text',
  },
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    command: 'cursor',
    detectCommand: 'cursor --version',
    execCommand: 'cursor agent -p',
    outputFormat: 'JSON',
    yoloFlag: '--auto-approve',
    parserType: 'jsonl',
    modelFlag: '--model',
  },
  cline: {
    name: 'cline',
    displayName: 'Cline',
    command: 'cline',
    detectCommand: 'cline --version',
    execCommand: 'cline -y',
    outputFormat: '--json',
    yoloFlag: '-y',
    parserType: 'jsonl',
  },
  continue: {
    name: 'continue',
    displayName: 'Continue',
    command: 'cn',
    detectCommand: 'cn --version',
    execCommand: 'cn -p',
    outputFormat: '--format json',
    yoloFlag: '--allow',
    parserType: 'jsonl',
  },
  goose: {
    name: 'goose',
    displayName: 'Goose',
    command: 'goose',
    detectCommand: 'goose --version',
    execCommand: 'goose run -t',
    outputFormat: 'text',
    yoloFlag: 'GOOSE_MODE=auto',
    parserType: 'text',
  },
  amp: {
    name: 'amp',
    displayName: 'Amp',
    command: 'amp',
    detectCommand: 'amp --version',
    execCommand: 'amp -x',
    outputFormat: 'stream-json',
    yoloFlag: '',
    parserType: 'stream-json',
  },
  qwen: {
    name: 'qwen',
    displayName: 'Qwen',
    command: 'qwen',
    detectCommand: 'qwen --version',
    execCommand: 'qwen -p',
    outputFormat: 'stream-json',
    yoloFlag: '--yolo',
    parserType: 'stream-json',
    modelFlag: '--model',
  },
};

/**
 * Known models per adapter. The first entry is the recommended default.
 * Each entry: { id: CLI model identifier, label: human-friendly name }.
 *
 * Use CUSTOM_MODEL_SENTINEL as the id for a "type your own" fallback entry.
 */
export interface ModelOption {
  id: string;
  label: string;
}

/** Sentinel id that triggers a free-text fallback in the ModelSelector UI. */
export const CUSTOM_MODEL_SENTINEL = '__custom__';

export const ADAPTER_MODELS: Record<string, ModelOption[]> = {
  // Claude Code CLI accepts alias-style identifiers via --model.
  'claude-code': [
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (latest sonnet)' },
    { id: 'claude-opus-4-5', label: 'Claude Opus 4.5 (latest opus)' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (latest haiku)' },
  ],
  // Codex CLI supports codex-mini-latest, o4-mini, and o3.
  codex: [
    { id: 'codex-mini-latest', label: 'Codex Mini Latest (recommended)' },
    { id: 'o4-mini', label: 'o4-mini' },
    { id: 'o3', label: 'o3' },
  ],
  // Gemini CLI — current production models (ai.google.dev/gemini-api/docs/models).
  gemini: [
    { id: 'gemini-2.5-pro-preview', label: 'Gemini 2.5 Pro Preview' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { id: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B' },
  ],
  // GitHub Copilot CLI — models are runtime/policy-driven; common defaults + custom fallback.
  copilot: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
    { id: 'o3', label: 'o3' },
    { id: CUSTOM_MODEL_SENTINEL, label: 'Enter custom model…' },
  ],
  // Aider — inventory is provider-dependent; common defaults + custom fallback.
  aider: [
    { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'gemini/gemini-2.0-flash', label: 'Gemini 2.0 Flash (via Gemini)' },
    { id: CUSTOM_MODEL_SENTINEL, label: 'Enter custom model…' },
  ],
  // Cursor — frontier models from docs.cursor.com/models + custom fallback.
  cursor: [
    { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'o4-mini', label: 'o4-mini' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: CUSTOM_MODEL_SENTINEL, label: 'Enter custom model…' },
  ],
  // Qwen Code — supports arbitrary OpenAI-compatible models via OPENAI_MODEL; common defaults + custom fallback.
  qwen: [
    { id: 'qwen-coder-plus', label: 'Qwen Coder Plus' },
    { id: 'qwen3-235b-a22b', label: 'Qwen3 235B-A22B' },
    { id: 'qwq-32b', label: 'QwQ 32B' },
    { id: CUSTOM_MODEL_SENTINEL, label: 'Enter custom model…' },
  ],
};

export function getAdapterModels(adapterName: string): ModelOption[] {
  return ADAPTER_MODELS[adapterName] ?? [];
}

export function getRegistryEntries(): CLIRegistryEntry[] {
  return Object.values(CLI_REGISTRY);
}

export function getRegistryEntry(name: string): CLIRegistryEntry | undefined {
  return CLI_REGISTRY[name];
}

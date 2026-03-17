/**
 * CLI tool registry — supported AI coding assistants.
 * Source: FR-008 design table
 */

import type { CLIRegistry, CLIRegistryEntry } from '../types/adapter.js';
import { discoverModels } from './model-discovery.js';

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
};

/**
 * Model option for an adapter.
 * { id: CLI model identifier, label: human-friendly name }.
 * Use CUSTOM_MODEL_SENTINEL as the id for a "type your own" fallback entry.
 */
export interface ModelOption {
  id: string;
  label: string;
}

/** Sentinel id that triggers a free-text fallback in the ModelSelector UI. */
export const CUSTOM_MODEL_SENTINEL = '__custom__';

/**
 * Return the available models for an adapter.
 * Models are discovered dynamically from each CLI tool's own data sources
 * (cache files, installed packages, or validated aliases). Results are
 * memoized at module scope so discovery runs at most once per adapter.
 * Every returned list ends with the __custom__ sentinel entry.
 */
export function getAdapterModels(adapterName: string): ModelOption[] {
  return discoverModels(adapterName);
}

export function getRegistryEntries(): CLIRegistryEntry[] {
  return Object.values(CLI_REGISTRY);
}

export function getRegistryEntry(name: string): CLIRegistryEntry | undefined {
  return CLI_REGISTRY[name];
}

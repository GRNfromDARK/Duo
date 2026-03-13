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
  },
};

export function getRegistryEntries(): CLIRegistryEntry[] {
  return Object.values(CLI_REGISTRY);
}

export function getRegistryEntry(name: string): CLIRegistryEntry | undefined {
  return CLI_REGISTRY[name];
}

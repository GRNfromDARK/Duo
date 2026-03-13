/**
 * CLI auto-detection — parallel scan of registered CLI tools.
 * Source: FR-008 (AC-030, AC-032)
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CLIRegistryEntry } from '../types/adapter.js';
import { getRegistryEntries } from './registry.js';

export interface DetectedCLI {
  name: string;
  displayName: string;
  command: string;
  installed: boolean;
  version: string | null;
}

const DETECT_TIMEOUT_MS = 3000;

function execFilePromise(
  cmd: string,
  args: string[],
  timeout: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve((stdout || stderr).toString().trim());
      }
    });
  });
}

async function detectOne(entry: CLIRegistryEntry): Promise<DetectedCLI> {
  const result: DetectedCLI = {
    name: entry.name,
    displayName: entry.displayName,
    command: entry.command,
    installed: false,
    version: null,
  };

  try {
    await execFilePromise('which', [entry.command], DETECT_TIMEOUT_MS);
    result.installed = true;

    // Parse detect command to get version
    const parts = entry.detectCommand.split(' ');
    const versionOutput = await execFilePromise(
      parts[0],
      parts.slice(1),
      DETECT_TIMEOUT_MS,
    );
    result.version = versionOutput;
  } catch {
    // CLI not installed or version check failed
  }

  return result;
}

/**
 * Parallel scan all registered CLI tools.
 * Returns within DETECT_TIMEOUT_MS (3 seconds).
 * @param additionalEntries - extra CLI entries to include
 * @param disabledNames - adapter names to exclude from detection
 */
export async function detectInstalledCLIs(
  additionalEntries: CLIRegistryEntry[] = [],
  disabledNames: string[] = [],
): Promise<DetectedCLI[]> {
  const disabledSet = new Set(disabledNames);
  const entries = [...getRegistryEntries(), ...additionalEntries].filter(
    (entry) => !disabledSet.has(entry.name),
  );

  const results = await Promise.all(entries.map((entry) => detectOne(entry)));

  return results;
}

export interface AdaptersConfig {
  custom: CLIRegistryEntry[];
  disabled: string[];
}

/**
 * Load user-defined adapter config from .duo/adapters.json
 * Supports both array format (backward compat) and object format:
 *   { "custom": [...], "disabled": ["adapter-name", ...] }
 */
export async function loadAdaptersConfig(
  projectDir: string,
): Promise<AdaptersConfig> {
  try {
    const configPath = join(projectDir, '.duo', 'adapters.json');
    const content = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    if (Array.isArray(parsed)) {
      return { custom: parsed, disabled: [] };
    }

    return {
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      disabled: Array.isArray(parsed.disabled) ? parsed.disabled : [],
    };
  } catch {
    return { custom: [], disabled: [] };
  }
}

/**
 * Load user-defined custom adapters from .duo/adapters.json
 * @deprecated Use loadAdaptersConfig() instead
 */
export async function loadCustomAdapters(
  projectDir: string,
): Promise<CLIRegistryEntry[]> {
  const config = await loadAdaptersConfig(projectDir);
  return config.custom;
}

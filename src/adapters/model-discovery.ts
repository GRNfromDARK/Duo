/**
 * Dynamic model discovery for each CLI adapter.
 *
 * - Codex:      reads ~/.codex/models_cache.json (maintained by the Codex CLI)
 * - Gemini:     imports VALID_GEMINI_MODELS from the installed @google/gemini-cli-core package
 * - Claude Code: uses CLI-validated stable aliases (sonnet, opus, haiku)
 *
 * All discovery is synchronous (called from React render path).
 * Results are memoized at module scope so each adapter is discovered at most once.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

import type { ModelOption } from './registry.js';
import { CUSTOM_MODEL_SENTINEL } from './registry.js';

// ── Module-scope memoization ──

const _cache = new Map<string, ModelOption[]>();

/** Reset memoization cache — exposed for testing only. */
export function _resetModelCache(): void {
  _cache.clear();
}

/**
 * Discover available models for an adapter.
 * Returns cached result on subsequent calls for the same adapter.
 * Every returned list ends with the __custom__ sentinel entry.
 */
export function discoverModels(adapterName: string): ModelOption[] {
  if (_cache.has(adapterName)) return _cache.get(adapterName)!;

  let models: ModelOption[];
  switch (adapterName) {
    case 'codex':
      models = discoverCodexModels();
      break;
    case 'gemini':
      models = discoverGeminiModels();
      break;
    case 'claude-code':
      models = discoverClaudeCodeModels();
      break;
    default:
      models = [];
      break;
  }

  // Always append __custom__ sentinel as the last entry.
  models.push({ id: CUSTOM_MODEL_SENTINEL, label: 'Custom model…' });

  _cache.set(adapterName, models);
  return models;
}

// ── Codex: read ~/.codex/models_cache.json ──

/**
 * Codex CLI maintains a local models cache at ~/.codex/models_cache.json.
 * The file contains a { models: [...] } array with slug, display_name,
 * visibility, and priority fields. We filter to visibility === 'list',
 * sort by ascending priority, and dedup by slug.
 */
export function discoverCodexModels(): ModelOption[] {
  try {
    const cachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
    const raw = fs.readFileSync(cachePath, 'utf8');
    const data = JSON.parse(raw) as {
      models?: Array<{
        slug?: string;
        display_name?: string;
        visibility?: string;
        priority?: number;
      }>;
    };

    if (!Array.isArray(data.models)) return [];

    const visible = data.models
      .filter(
        (m): m is typeof m & { slug: string } =>
          typeof m.slug === 'string' && m.visibility === 'list',
      )
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

    // Dedup by slug
    const seen = new Set<string>();
    const result: ModelOption[] = [];
    for (const m of visible) {
      if (seen.has(m.slug)) continue;
      seen.add(m.slug);
      result.push({
        id: m.slug,
        label: m.display_name ?? m.slug,
      });
    }
    return result;
  } catch {
    // Cache missing, corrupt, or unreadable — return empty (caller appends __custom__).
    return [];
  }
}

// ── Gemini: import from installed @google/gemini-cli-core ──

/**
 * Resolves the gemini binary → its real entry point → and uses createRequire
 * to synchronously load @google/gemini-cli-core/dist/src/config/models.js.
 * Reads VALID_GEMINI_MODELS Set and getDisplayString() for labels.
 */
export function discoverGeminiModels(): ModelOption[] {
  try {
    // Step 1: locate the gemini binary
    const geminiBin = execSync('command -v gemini', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    if (!geminiBin) return [];

    // Step 2: resolve to real path (follow symlinks)
    const geminiReal = fs.realpathSync(geminiBin);

    // Step 3: create a require function rooted at the gemini entry point
    const req = createRequire(geminiReal);
    const modelsPath = req.resolve(
      '@google/gemini-cli-core/dist/src/config/models.js',
    );

    // Step 4: synchronous require
    const mod = req(modelsPath) as {
      VALID_GEMINI_MODELS?: Set<string>;
      getDisplayString?: (model: string) => string;
    };

    const validModels = mod.VALID_GEMINI_MODELS;
    if (!validModels || !(validModels instanceof Set)) return [];

    const getDisplay =
      typeof mod.getDisplayString === 'function'
        ? mod.getDisplayString
        : (m: string) => m;

    const result: ModelOption[] = [];
    for (const modelId of validModels) {
      const display = getDisplay(modelId);
      result.push({ id: modelId, label: display });
    }

    return result;
  } catch {
    // Gemini CLI not installed, package structure changed, or require failed.
    return [];
  }
}

// ── Claude Code: CLI-validated stable aliases ──

/**
 * Claude Code CLI has no programmatic model enumeration command.
 * We expose only the three CLI-validated stable aliases that the Claude CLI
 * resolves server-side to the latest version of each model family:
 *   sonnet → claude-sonnet-4-6 (as of 2026-03)
 *   opus   → claude-opus-4-6
 *   haiku  → claude-haiku-4-5-20251001
 *
 * Users can always enter a full model ID via the __custom__ fallback.
 */
export function discoverClaudeCodeModels(): ModelOption[] {
  return [
    { id: 'sonnet', label: 'Sonnet (latest)' },
    { id: 'opus', label: 'Opus (latest)' },
    { id: 'haiku', label: 'Haiku (latest)' },
  ];
}

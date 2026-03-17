import { describe, it, expect } from 'vitest';
import { CLI_REGISTRY, getRegistryEntries, getRegistryEntry, getAdapterModels, CUSTOM_MODEL_SENTINEL } from '../../adapters/registry.js';
import type { CLIRegistryEntry } from '../../types/adapter.js';

describe('CLI Registry', () => {
  it('should contain exactly 3 CLI tool entries', () => {
    const entries = getRegistryEntries();
    expect(entries).toHaveLength(3);
  });

  it('should have all required fields for every entry', () => {
    const requiredKeys: (keyof CLIRegistryEntry)[] = [
      'name', 'displayName', 'command', 'detectCommand',
      'execCommand', 'outputFormat', 'yoloFlag', 'parserType',
    ];
    const entries = getRegistryEntries();
    for (const entry of entries) {
      for (const key of requiredKeys) {
        expect(entry[key], `${entry.name} missing ${key}`).toBeDefined();
        expect(typeof entry[key], `${entry.name}.${key} should be string`).toBe('string');
      }
    }
  });

  it('should include all 3 expected CLI tools', () => {
    const expectedNames = ['claude-code', 'codex', 'gemini'];
    const names = getRegistryEntries().map((e) => e.name);
    for (const name of expectedNames) {
      expect(names, `missing ${name}`).toContain(name);
    }
  });

  it('should return entry by name', () => {
    const entry = getRegistryEntry('claude-code');
    expect(entry).toBeDefined();
    expect(entry!.command).toBe('claude');
  });

  it('should return undefined for unknown name', () => {
    expect(getRegistryEntry('unknown-tool')).toBeUndefined();
  });

  it('should have correct parser types per design doc', () => {
    const streamJsonTools = ['claude-code', 'gemini'];
    const jsonlTools = ['codex'];

    for (const name of streamJsonTools) {
      expect(getRegistryEntry(name)!.parserType, `${name} should be stream-json`).toBe('stream-json');
    }
    for (const name of jsonlTools) {
      expect(getRegistryEntry(name)!.parserType, `${name} should be jsonl`).toBe('jsonl');
    }
  });

  it('should export CLI_REGISTRY as a Record', () => {
    expect(typeof CLI_REGISTRY).toBe('object');
    expect(CLI_REGISTRY['claude-code']).toBeDefined();
  });

  it('getAdapterModels delegates to discoverModels and returns array', () => {
    const models = getAdapterModels('claude-code');
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    // Must always end with __custom__
    expect(models[models.length - 1].id).toBe(CUSTOM_MODEL_SENTINEL);
  });

  it('getAdapterModels returns only __custom__ for unknown adapter', () => {
    const models = getAdapterModels('nonexistent');
    expect(models).toEqual([{ id: CUSTOM_MODEL_SENTINEL, label: 'Custom model…' }]);
  });
});

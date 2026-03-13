import { describe, expect, it } from 'vitest';

import { createGodAdapter, isSupportedGodAdapterName, SUPPORTED_GOD_ADAPTERS } from '../../god/god-adapter-factory.js';

describe('God adapter factory', () => {
  it('only advertises claude-code and codex as supported God adapters', () => {
    expect(SUPPORTED_GOD_ADAPTERS).toEqual(['claude-code', 'codex']);
    expect(isSupportedGodAdapterName('claude-code')).toBe(true);
    expect(isSupportedGodAdapterName('codex')).toBe(true);
    expect(isSupportedGodAdapterName('gemini')).toBe(false);
  });

  it('creates a Claude Code God adapter', () => {
    const adapter = createGodAdapter('claude-code');

    expect(adapter.name).toBe('claude-code');
    expect(typeof adapter.execute).toBe('function');
    expect(typeof adapter.kill).toBe('function');
  });

  it('creates a Codex God adapter', () => {
    const adapter = createGodAdapter('codex');

    expect(adapter.name).toBe('codex');
    expect(typeof adapter.execute).toBe('function');
    expect(typeof adapter.kill).toBe('function');
  });

  it('rejects unsupported God adapters', () => {
    expect(() => createGodAdapter('gemini')).toThrow(/Unsupported God adapter/);
  });
});

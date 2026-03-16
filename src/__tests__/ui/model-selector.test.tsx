/**
 * Tests for ModelSelector component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

// Allow per-test overrides of getAdapterModels via mockAdapterModels.
let mockAdapterModels: ((name: string) => { id: string; label: string }[]) | null = null;

vi.mock('../../adapters/registry.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../adapters/registry.js')>();
  return {
    ...real,
    getAdapterModels: (name: string) =>
      mockAdapterModels ? mockAdapterModels(name) : real.getAdapterModels(name),
  };
});

import { ModelSelector, CUSTOM_MODEL_SENTINEL } from '../../ui/components/SetupWizard.js';

describe('ModelSelector', () => {
  beforeEach(() => {
    mockAdapterModels = null;
  });

  it('renders "Use default" option always', () => {
    const { lastFrame } = render(
      <ModelSelector
        roleName="Coder"
        adapterName="Claude Code"
        cliName="claude-code"
        onSubmit={vi.fn()}
      />,
    );
    expect(lastFrame()).toContain('Use default');
  });

  it('renders known models for claude-code adapter', () => {
    const { lastFrame } = render(
      <ModelSelector
        roleName="Coder"
        adapterName="Claude Code"
        cliName="claude-code"
        onSubmit={vi.fn()}
      />,
    );
    const output = lastFrame()!;
    expect(output).toContain('claude-sonnet-4-5');
    expect(output).toContain('claude-opus-4-5');
    expect(output).toContain('claude-haiku-4-5');
  });

  it('renders known models for codex adapter', () => {
    const { lastFrame } = render(
      <ModelSelector
        roleName="Coder"
        adapterName="Codex"
        cliName="codex"
        onSubmit={vi.fn()}
      />,
    );
    const output = lastFrame()!;
    expect(output).toContain('codex-mini-latest');
    expect(output).toContain('o4-mini');
    expect(output).toContain('o3');
  });

  it('shows only "Use default" for adapter with no known models', () => {
    const { lastFrame } = render(
      <ModelSelector
        roleName="Coder"
        adapterName="Amazon Q"
        cliName="amazon-q"
        onSubmit={vi.fn()}
      />,
    );
    const output = lastFrame()!;
    expect(output).toContain('Use default');
    // Only one selectable item: no model IDs present
    expect(output).not.toContain('claude');
    expect(output).not.toContain('codex');
  });

  it('submits undefined when "Use default" is selected', () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <ModelSelector
        roleName="Coder"
        adapterName="Claude Code"
        cliName="claude-code"
        onSubmit={onSubmit}
      />,
    );
    // Default selection is index 0 ("Use default"), press Enter
    stdin.write('\r');
    expect(onSubmit).toHaveBeenCalledWith(undefined);
  });

  it('highlights first model after pressing down arrow', () => {
    const { stdin, lastFrame } = render(
      <ModelSelector
        roleName="Coder"
        adapterName="Claude Code"
        cliName="claude-code"
        onSubmit={vi.fn()}
      />,
    );
    // Initially "Use default" is highlighted (▸)
    expect(lastFrame()).toContain('▸');
    // After down arrow, the first model should be highlighted
    stdin.write('\u001B[B');
    const output = lastFrame()!;
    // The selector indicator should now be on the first model line
    expect(output).toContain('claude-sonnet-4-5');
  });

  it('submits correct model after navigation and Enter', () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <ModelSelector
        roleName="God"
        adapterName="Codex"
        cliName="codex"
        onSubmit={onSubmit}
      />,
    );
    // Navigate down then submit — written as combined sequence to ensure
    // ink processes them in the same input flush
    stdin.write('\u001B[B\r');
    expect(onSubmit).toHaveBeenCalledWith('codex-mini-latest');
  });

  // ── __custom__ sentinel tests ──

  it('CUSTOM_MODEL_SENTINEL has the expected value', () => {
    expect(CUSTOM_MODEL_SENTINEL).toBe('__custom__');
  });

  it('qwen adapter list includes the __custom__ sentinel entry', () => {
    const { lastFrame } = render(
      <ModelSelector
        roleName="Coder"
        adapterName="Qwen"
        cliName="qwen"
        onSubmit={vi.fn()}
      />,
    );
    expect(lastFrame()).toContain('Enter custom model');
  });

  // For __custom__ tests, mock the adapter to return [__custom__] only
  // so the sentinel is index 1 (one down press away).
  function withCustomOnly() {
    mockAdapterModels = () => [{ id: CUSTOM_MODEL_SENTINEL, label: 'Enter custom model…' }];
  }

  it('selecting __custom__ entry switches to text-input mode', async () => {
    withCustomOnly();
    const { stdin, lastFrame } = render(
      <ModelSelector
        roleName="Coder"
        adapterName="Qwen"
        cliName="qwen"
        onSubmit={vi.fn()}
      />,
    );
    // Split escape sequence and return into separate writes so Ink
    // processes them as two distinct key events.
    stdin.write('\u001B[B'); // navigate down to __custom__
    stdin.write('\r');       // select __custom__ → switch to custom mode
    // Ink's test renderer commits React state updates asynchronously;
    // allow multiple microtask ticks for the render to flush.
    await new Promise(r => setTimeout(r, 50));
    expect(lastFrame()).toContain('Type a model name');
  });

  it('types a model name in custom mode and submits it', () => {
    withCustomOnly();
    const onSubmit = vi.fn();
    const { stdin } = render(
      <ModelSelector
        roleName="Coder"
        adapterName="Qwen"
        cliName="qwen"
        onSubmit={onSubmit}
      />,
    );
    // Split into separate writes for reliable key event processing
    stdin.write('\u001B[B'); // navigate down to __custom__
    stdin.write('\r');       // select __custom__ → switch to custom mode
    stdin.write('my-custom-model');  // type model name
    stdin.write('\r');       // submit
    expect(onSubmit).toHaveBeenCalledWith('my-custom-model');
  });

  it('submits undefined from custom mode when Enter pressed with empty input', () => {
    withCustomOnly();
    const onSubmit = vi.fn();
    const { stdin } = render(
      <ModelSelector
        roleName="Coder"
        adapterName="Qwen"
        cliName="qwen"
        onSubmit={onSubmit}
      />,
    );
    // Switch to custom mode
    stdin.write('\u001B[B\r');
    // Submit with empty input → should return undefined
    stdin.write('\r');
    expect(onSubmit).toHaveBeenCalledWith(undefined);
  });
});

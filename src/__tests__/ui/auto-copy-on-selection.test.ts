/**
 * Tests for auto-copy-on-selection behavior in App.tsx.
 *
 * When the renderer emits a 'selection' event (mouse drag finished),
 * the onSelectionFinish handler should immediately call
 * renderer.copyToClipboardOSC52(text) if text is non-empty.
 *
 * Key behaviors:
 * 1. Selection with text → auto-copy via OSC52 (no keypress needed)
 * 2. Selection with empty text → no copy attempt
 * 3. Selection with null → no copy attempt
 * 4. Cache is still populated for Ctrl/Cmd+C fallback
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the onSelectionFinish logic from App.tsx
// ---------------------------------------------------------------------------

interface MockRenderer {
  copyToClipboardOSC52: ReturnType<typeof vi.fn>;
}

interface SelectionEvent {
  getSelectedText?: () => string;
}

/**
 * Mirrors the onSelectionFinish callback in App.tsx useEffect.
 * Returns the cached text and selection ref for verification.
 */
function simulateSelectionFinish(
  renderer: MockRenderer,
  selection: SelectionEvent | null,
): { cachedText: string; cachedSelection: object | null } {
  const text = selection?.getSelectedText?.() ?? '';
  const cachedText = text;
  const cachedSelection = selection;

  // Auto-copy on selection
  if (text) {
    renderer.copyToClipboardOSC52(text);
  }

  return { cachedText, cachedSelection };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Auto-copy on selection (mouse drag finish)', () => {
  it('copies text via OSC52 when selection has non-empty text', () => {
    const renderer: MockRenderer = { copyToClipboardOSC52: vi.fn() };
    const selection = { getSelectedText: () => 'hello world' };

    const result = simulateSelectionFinish(renderer, selection);

    expect(renderer.copyToClipboardOSC52).toHaveBeenCalledOnce();
    expect(renderer.copyToClipboardOSC52).toHaveBeenCalledWith('hello world');
    expect(result.cachedText).toBe('hello world');
    expect(result.cachedSelection).toBe(selection);
  });

  it('does NOT call OSC52 when selection text is empty', () => {
    const renderer: MockRenderer = { copyToClipboardOSC52: vi.fn() };
    const selection = { getSelectedText: () => '' };

    const result = simulateSelectionFinish(renderer, selection);

    expect(renderer.copyToClipboardOSC52).not.toHaveBeenCalled();
    expect(result.cachedText).toBe('');
  });

  it('does NOT call OSC52 when selection is null', () => {
    const renderer: MockRenderer = { copyToClipboardOSC52: vi.fn() };

    const result = simulateSelectionFinish(renderer, null);

    expect(renderer.copyToClipboardOSC52).not.toHaveBeenCalled();
    expect(result.cachedText).toBe('');
    expect(result.cachedSelection).toBeNull();
  });

  it('does NOT call OSC52 when getSelectedText is undefined', () => {
    const renderer: MockRenderer = { copyToClipboardOSC52: vi.fn() };
    const selection = {}; // no getSelectedText method

    const result = simulateSelectionFinish(renderer, selection);

    expect(renderer.copyToClipboardOSC52).not.toHaveBeenCalled();
    expect(result.cachedText).toBe('');
  });

  it('populates cache even when auto-copy succeeds (for Ctrl/Cmd+C fallback)', () => {
    const renderer: MockRenderer = { copyToClipboardOSC52: vi.fn() };
    const selection = { getSelectedText: () => 'cached for later' };

    const result = simulateSelectionFinish(renderer, selection);

    expect(result.cachedText).toBe('cached for later');
    expect(result.cachedSelection).toBe(selection);
    // OSC52 also called
    expect(renderer.copyToClipboardOSC52).toHaveBeenCalledWith('cached for later');
  });

  it('handles multiline selected text', () => {
    const renderer: MockRenderer = { copyToClipboardOSC52: vi.fn() };
    const multiline = 'line 1\nline 2\nline 3';
    const selection = { getSelectedText: () => multiline };

    simulateSelectionFinish(renderer, selection);

    expect(renderer.copyToClipboardOSC52).toHaveBeenCalledWith(multiline);
  });
});

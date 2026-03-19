/**
 * Tests for the Ctrl+C / Cmd+C copy-on-selection behavior in App.tsx.
 *
 * The logic under test lives inside the useInput handler. The decision tree
 * is pure enough to be validated with mock objects without mounting the
 * full React component tree.
 *
 * Key behaviors:
 * 1. Selection with text → copy via OSC52, no interrupt
 * 2. Selection with empty text but valid cached text (same selection) → copy cached via OSC52
 * 3. Selection with empty text, stale cache (different selection) → silent no-op
 * 4. No selection, Ctrl+C → interrupt
 * 5. No selection, Cmd+C (super) → no-op (macOS copy without selection)
 * 6. Stale cache from old selection does NOT leak to new selection
 * 7. Command+C (key.super) with selection → copy, no interrupt
 */

import { describe, it, expect, vi } from 'vitest';
import type { Key } from '../../tui/primitives.js';

// ---------------------------------------------------------------------------
// Minimal mock types that mirror the CliRenderer surface we rely on.
// ---------------------------------------------------------------------------

interface MockSelection {
  getSelectedText(): string;
}

interface MockRenderer {
  hasSelection: boolean;
  getSelection(): MockSelection | null;
  copyToClipboardOSC52: ReturnType<typeof vi.fn>;
}

function makeRenderer(opts: {
  hasSelection: boolean;
  selectedText?: string;
}): MockRenderer {
  const selection: MockSelection | null = opts.hasSelection
    ? { getSelectedText: () => opts.selectedText ?? '' }
    : null;

  return {
    hasSelection: opts.hasSelection,
    getSelection: () => selection,
    copyToClipboardOSC52: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Replicate the decision logic from App.tsx so we can test it in isolation.
//
// On macOS with kitty keyboard protocol, Command maps to key.super while
// Option maps to key.meta. The handler must check all three modifiers
// (ctrl, meta, super) so that both Ctrl+C and Command+C work.
//
// Identity-based cache: cachedText is only used when cachedSelection
// matches the current selection (prevents stale cache leaks).
// ---------------------------------------------------------------------------

type CopyKey = Pick<Key, 'ctrl' | 'meta' | 'super'>;

function handleCopyOrInterrupt(
  input: string,
  key: CopyKey,
  renderer: MockRenderer,
  onInterrupt: () => void,
  cache: { text: string; selection: MockSelection | null } = { text: '', selection: null },
): void {
  const isCopyKey = (key.ctrl || key.meta || key.super) && input === 'c';
  if (!isCopyKey) return;

  if (renderer.hasSelection) {
    const currentSel = renderer.getSelection();
    const liveText = currentSel?.getSelectedText() ?? '';
    const cacheValid = currentSel != null && currentSel === cache.selection;
    const text = liveText || (cacheValid ? cache.text : '');
    if (text) {
      renderer.copyToClipboardOSC52(text);
    }
    return;
  }

  // Cmd+C (meta/super only, no ctrl) without a selection: do nothing.
  if (!key.ctrl) return;

  // Ctrl+C without selection: interrupt.
  onInterrupt();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function baseKey(overrides: Partial<CopyKey> = {}): CopyKey {
  return { ctrl: false, meta: false, super: false, ...overrides };
}

describe('Ctrl+C / Cmd+C copy-on-selection behavior', () => {
  describe('Ctrl+C with active text selection', () => {
    it('calls copyToClipboardOSC52 with selected text', () => {
      const renderer = makeRenderer({ hasSelection: true, selectedText: 'hello world' });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ ctrl: true }), renderer, onInterrupt);

      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledOnce();
      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledWith('hello world');
    });

    it('does NOT trigger interrupt when selection exists', () => {
      const renderer = makeRenderer({ hasSelection: true, selectedText: 'text' });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ ctrl: true }), renderer, onInterrupt);

      expect(onInterrupt).not.toHaveBeenCalled();
    });
  });

  describe('Command+C (key.super — macOS Command key via kitty protocol)', () => {
    it('calls copyToClipboardOSC52 with selected text', () => {
      const renderer = makeRenderer({ hasSelection: true, selectedText: 'mac copy' });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ super: true }), renderer, onInterrupt);

      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledOnce();
      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledWith('mac copy');
    });

    it('does NOT trigger interrupt for Command+C with selection', () => {
      const renderer = makeRenderer({ hasSelection: true, selectedText: 'text' });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ super: true }), renderer, onInterrupt);

      expect(onInterrupt).not.toHaveBeenCalled();
    });

    it('does NOT trigger interrupt for Command+C without selection', () => {
      const renderer = makeRenderer({ hasSelection: false });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ super: true }), renderer, onInterrupt);

      expect(onInterrupt).not.toHaveBeenCalled();
    });

    it('does NOT copy for Command+C without selection', () => {
      const renderer = makeRenderer({ hasSelection: false });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ super: true }), renderer, onInterrupt);

      expect(renderer.copyToClipboardOSC52).not.toHaveBeenCalled();
    });
  });

  describe('Option+C (key.meta — macOS Option key)', () => {
    it('calls copyToClipboardOSC52 with selected text', () => {
      const renderer = makeRenderer({ hasSelection: true, selectedText: 'option copy' });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ meta: true }), renderer, onInterrupt);

      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledOnce();
      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledWith('option copy');
    });

    it('does NOT trigger interrupt for Option+C without selection', () => {
      const renderer = makeRenderer({ hasSelection: false });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ meta: true }), renderer, onInterrupt);

      expect(onInterrupt).not.toHaveBeenCalled();
    });
  });

  describe('Ctrl+C without selection', () => {
    it('triggers interrupt', () => {
      const renderer = makeRenderer({ hasSelection: false });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ ctrl: true }), renderer, onInterrupt);

      expect(onInterrupt).toHaveBeenCalledOnce();
    });

    it('does NOT call copyToClipboardOSC52', () => {
      const renderer = makeRenderer({ hasSelection: false });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ ctrl: true }), renderer, onInterrupt);

      expect(renderer.copyToClipboardOSC52).not.toHaveBeenCalled();
    });
  });

  describe('selection with empty live text but valid cached text (same selection)', () => {
    it('copies cached text when live extraction returns empty (Ctrl+C)', () => {
      const renderer = makeRenderer({ hasSelection: true, selectedText: '' });
      const sel = renderer.getSelection()!;
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ ctrl: true }), renderer, onInterrupt,
        { text: 'cached hello', selection: sel });

      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledOnce();
      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledWith('cached hello');
      expect(onInterrupt).not.toHaveBeenCalled();
    });

    it('copies cached text when live extraction returns empty (Command+C)', () => {
      const renderer = makeRenderer({ hasSelection: true, selectedText: '' });
      const sel = renderer.getSelection()!;
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ super: true }), renderer, onInterrupt,
        { text: 'cached mac', selection: sel });

      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledOnce();
      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledWith('cached mac');
      expect(onInterrupt).not.toHaveBeenCalled();
    });

    it('prefers live text over cached text when both available', () => {
      const renderer = makeRenderer({ hasSelection: true, selectedText: 'live text' });
      const sel = renderer.getSelection()!;
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ ctrl: true }), renderer, onInterrupt,
        { text: 'stale cached', selection: sel });

      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledWith('live text');
    });
  });

  describe('stale cache from different selection does NOT leak', () => {
    it('does NOT copy stale cache when selection object differs (Ctrl+C)', () => {
      const renderer = makeRenderer({ hasSelection: true, selectedText: '' });
      const oldSelection = { getSelectedText: () => 'old text A' };
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ ctrl: true }), renderer, onInterrupt,
        { text: 'old text A', selection: oldSelection });

      expect(renderer.copyToClipboardOSC52).not.toHaveBeenCalled();
      expect(onInterrupt).not.toHaveBeenCalled();
    });

    it('does NOT copy stale cache when cache selection is null', () => {
      const renderer = makeRenderer({ hasSelection: true, selectedText: '' });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ ctrl: true }), renderer, onInterrupt,
        { text: 'stale text', selection: null });

      expect(renderer.copyToClipboardOSC52).not.toHaveBeenCalled();
      expect(onInterrupt).not.toHaveBeenCalled();
    });
  });

  describe('selection with empty text AND no cached text', () => {
    it('does NOT trigger interrupt (Ctrl+C) — user intended copy, not interrupt', () => {
      const renderer = makeRenderer({ hasSelection: true, selectedText: '' });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey({ ctrl: true }), renderer, onInterrupt,
        { text: '', selection: null });

      expect(renderer.copyToClipboardOSC52).not.toHaveBeenCalled();
      expect(onInterrupt).not.toHaveBeenCalled();
    });
  });

  describe('cached text does not leak to no-selection path', () => {
    it('Ctrl+C without selection still interrupts even if cache has text', () => {
      const renderer = makeRenderer({ hasSelection: false });
      const onInterrupt = vi.fn();
      const staleCache = { text: 'stale cached', selection: { getSelectedText: () => '' } };

      handleCopyOrInterrupt('c', baseKey({ ctrl: true }), renderer, onInterrupt, staleCache);

      expect(onInterrupt).toHaveBeenCalledOnce();
      expect(renderer.copyToClipboardOSC52).not.toHaveBeenCalled();
    });
  });

  describe('unrelated keys', () => {
    it('does nothing for Ctrl+D', () => {
      const renderer = makeRenderer({ hasSelection: true, selectedText: 'text' });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('d', baseKey({ ctrl: true }), renderer, onInterrupt);

      expect(renderer.copyToClipboardOSC52).not.toHaveBeenCalled();
      expect(onInterrupt).not.toHaveBeenCalled();
    });

    it('does nothing for plain "c" (no modifier)', () => {
      const renderer = makeRenderer({ hasSelection: true, selectedText: 'text' });
      const onInterrupt = vi.fn();

      handleCopyOrInterrupt('c', baseKey(), renderer, onInterrupt);

      expect(renderer.copyToClipboardOSC52).not.toHaveBeenCalled();
      expect(onInterrupt).not.toHaveBeenCalled();
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  filterMouseTrackingInput,
} from '../../ui/mouse-input.js';

describe('filterMouseTrackingInput()', () => {
  it('passes regular keyboard input through unchanged', () => {
    const result = filterMouseTrackingInput('abc\x1b[A\x1b[B');
    expect(result).toEqual({ output: 'abc\x1b[A\x1b[B', pending: '' });
  });

  it('translates wheel-up SGR mouse events into repeated up arrows', () => {
    const result = filterMouseTrackingInput('\x1b[<64;94;31M');
    expect(result).toEqual({ output: '\x1b[A\x1b[A\x1b[A', pending: '' });
  });

  it('translates wheel-down SGR mouse events with modifiers into repeated down arrows', () => {
    const result = filterMouseTrackingInput('\x1b[<69;94;31M');
    expect(result).toEqual({ output: '\x1b[B\x1b[B\x1b[B', pending: '' });
  });

  it('buffers split SGR mouse payloads across chunks before translating them', () => {
    const first = filterMouseTrackingInput('\x1b[<64;94', '');
    expect(first).toEqual({ output: '', pending: '\x1b[<64;94' });

    const second = filterMouseTrackingInput(';31Mtail', first.pending);
    expect(second).toEqual({ output: '\x1b[A\x1b[A\x1b[Atail', pending: '' });
  });

  it('swallows non-wheel mouse reports so they do not leak as terminal garbage', () => {
    const result = filterMouseTrackingInput('\x1b[<0;82;23mhello');
    expect(result).toEqual({ output: 'hello', pending: '' });
  });
});

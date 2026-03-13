/**
 * Tests for ConvergenceCard component.
 * Source: FR-026 (AC-082, AC-084)
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ConvergenceCard } from '../../ui/components/ConvergenceCard.js';

describe('ConvergenceCard', () => {
  it('renders convergence header with round count', () => {
    const { lastFrame } = render(
      <ConvergenceCard
        roundCount={4}
        filesChanged={2}
        insertions={100}
        deletions={20}
        onAction={vi.fn()}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('CONVERGED');
    expect(frame).toContain('4');
  });

  it('displays file change statistics (AC-082)', () => {
    const { lastFrame } = render(
      <ConvergenceCard
        roundCount={3}
        filesChanged={4}
        insertions={182}
        deletions={23}
        onAction={vi.fn()}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('4');
    expect(frame).toContain('+182');
    expect(frame).toContain('-23');
  });

  it('displays agreement message', () => {
    const { lastFrame } = render(
      <ConvergenceCard
        roundCount={2}
        filesChanged={1}
        insertions={10}
        deletions={0}
        onAction={vi.fn()}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('agree');
  });

  it('displays action shortcuts (AC-084)', () => {
    const { lastFrame } = render(
      <ConvergenceCard
        roundCount={1}
        filesChanged={0}
        insertions={0}
        deletions={0}
        onAction={vi.fn()}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('[A]');
    expect(frame).toContain('Accept');
    expect(frame).toContain('[C]');
    expect(frame).toContain('Continue');
    expect(frame).toContain('[R]');
    expect(frame).toContain('Review');
  });

  it('calls onAction with accept when a is pressed', () => {
    const onAction = vi.fn();
    const { stdin } = render(
      <ConvergenceCard
        roundCount={1}
        filesChanged={0}
        insertions={0}
        deletions={0}
        onAction={onAction}
      />,
    );
    stdin.write('a');
    expect(onAction).toHaveBeenCalledWith('accept');
  });

  it('calls onAction with continue when c is pressed', () => {
    const onAction = vi.fn();
    const { stdin } = render(
      <ConvergenceCard
        roundCount={1}
        filesChanged={0}
        insertions={0}
        deletions={0}
        onAction={onAction}
      />,
    );
    stdin.write('c');
    expect(onAction).toHaveBeenCalledWith('continue');
  });

  it('calls onAction with review when r is pressed', () => {
    const onAction = vi.fn();
    const { stdin } = render(
      <ConvergenceCard
        roundCount={1}
        filesChanged={0}
        insertions={0}
        deletions={0}
        onAction={onAction}
      />,
    );
    stdin.write('r');
    expect(onAction).toHaveBeenCalledWith('review');
  });

  it('ignores irrelevant keys', () => {
    const onAction = vi.fn();
    const { stdin } = render(
      <ConvergenceCard
        roundCount={1}
        filesChanged={0}
        insertions={0}
        deletions={0}
        onAction={onAction}
      />,
    );
    stdin.write('x');
    stdin.write('z');
    expect(onAction).not.toHaveBeenCalled();
  });
});

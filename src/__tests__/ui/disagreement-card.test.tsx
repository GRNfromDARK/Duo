/**
 * Tests for DisagreementCard component.
 * Source: FR-026 (AC-083, AC-084)
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { DisagreementCard } from '../../ui/components/DisagreementCard.js';

describe('DisagreementCard', () => {
  it('renders disagreement header with round number', () => {
    const { lastFrame } = render(
      <DisagreementCard
        currentRound={6}
        agreedPoints={1}
        totalPoints={3}
        onAction={vi.fn()}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('DISAGREEMENT');
    expect(frame).toContain('6');
  });

  it('displays agreed/disputed point counts (AC-083)', () => {
    const { lastFrame } = render(
      <DisagreementCard
        currentRound={5}
        agreedPoints={1}
        totalPoints={3}
        onAction={vi.fn()}
      />,
    );
    const frame = lastFrame()!;
    // Agreed: 1/3  Disputed: 2/3
    expect(frame).toContain('1/3');
    expect(frame).toContain('2/3');
  });

  it('displays all action shortcuts (AC-084)', () => {
    const { lastFrame } = render(
      <DisagreementCard
        currentRound={5}
        agreedPoints={0}
        totalPoints={0}
        onAction={vi.fn()}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('[C]');
    expect(frame).toContain('Continue');
    expect(frame).toContain('[D]');
    expect(frame).toContain('Decide');
    expect(frame).toContain('[A]');
    expect(frame).toContain("Coder");
    expect(frame).toContain('[B]');
    expect(frame).toContain("Reviewer");
  });

  it('calls onAction with continue when c is pressed', () => {
    const onAction = vi.fn();
    const { stdin } = render(
      <DisagreementCard
        currentRound={5}
        agreedPoints={0}
        totalPoints={0}
        onAction={onAction}
      />,
    );
    stdin.write('c');
    expect(onAction).toHaveBeenCalledWith('continue');
  });

  it('calls onAction with decide when d is pressed', () => {
    const onAction = vi.fn();
    const { stdin } = render(
      <DisagreementCard
        currentRound={5}
        agreedPoints={0}
        totalPoints={0}
        onAction={onAction}
      />,
    );
    stdin.write('d');
    expect(onAction).toHaveBeenCalledWith('decide');
  });

  it('calls onAction with accept_coder when a is pressed', () => {
    const onAction = vi.fn();
    const { stdin } = render(
      <DisagreementCard
        currentRound={5}
        agreedPoints={0}
        totalPoints={0}
        onAction={onAction}
      />,
    );
    stdin.write('a');
    expect(onAction).toHaveBeenCalledWith('accept_coder');
  });

  it('calls onAction with accept_reviewer when b is pressed', () => {
    const onAction = vi.fn();
    const { stdin } = render(
      <DisagreementCard
        currentRound={5}
        agreedPoints={0}
        totalPoints={0}
        onAction={onAction}
      />,
    );
    stdin.write('b');
    expect(onAction).toHaveBeenCalledWith('accept_reviewer');
  });

  it('ignores irrelevant keys', () => {
    const onAction = vi.fn();
    const { stdin } = render(
      <DisagreementCard
        currentRound={5}
        agreedPoints={0}
        totalPoints={0}
        onAction={onAction}
      />,
    );
    stdin.write('x');
    stdin.write('z');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('handles zero total points gracefully', () => {
    const { lastFrame } = render(
      <DisagreementCard
        currentRound={3}
        agreedPoints={0}
        totalPoints={0}
        onAction={vi.fn()}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('0/0');
  });
});

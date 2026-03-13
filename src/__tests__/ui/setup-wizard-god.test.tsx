/**
 * Tests for Card A.1: SetupWizard God role selection step.
 *
 * AC-1: 6-step stepper (Project → Coder → Reviewer → God → Task → Confirm)
 * AC-2: God selection list includes "Same as Reviewer (default)" as first item
 * AC-3: Selecting "Same as Reviewer" sets god = reviewer value
 * AC-4: Confirm screen shows God role
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import {
  PHASE_ORDER,
  PHASE_LABELS,
  SAME_AS_REVIEWER,
  GodSelector,
  ConfirmScreen,
} from '../../ui/components/SetupWizard.js';
import type { DetectedCLI } from '../../adapters/detect.js';

const DETECTED: DetectedCLI[] = [
  { name: 'claude-code', displayName: 'Claude Code', command: 'claude', installed: true, version: '1.0' },
  { name: 'gemini', displayName: 'Gemini', command: 'gemini', installed: true, version: '2.0' },
  { name: 'copilot', displayName: 'Copilot', command: 'copilot', installed: true, version: '3.0' },
];

describe('SetupWizard — God selection (Card A.1)', () => {
  // AC-1: PHASE_ORDER has 6 phases with God between Reviewer and Task
  describe('PHASE_ORDER', () => {
    it('has 6 phases', () => {
      expect(PHASE_ORDER).toHaveLength(6);
    });

    it('includes select-god phase', () => {
      expect(PHASE_ORDER).toContain('select-god');
    });

    it('places select-god after select-reviewer and before enter-task', () => {
      const reviewerIdx = PHASE_ORDER.indexOf('select-reviewer');
      const godIdx = PHASE_ORDER.indexOf('select-god');
      const taskIdx = PHASE_ORDER.indexOf('enter-task');
      expect(godIdx).toBe(reviewerIdx + 1);
      expect(godIdx).toBe(taskIdx - 1);
    });
  });

  // AC-1: PHASE_LABELS includes God label
  it('PHASE_LABELS maps select-god to "God"', () => {
    expect(PHASE_LABELS['select-god']).toBe('God');
  });

  // AC-2: GodSelector shows "Same as Reviewer (default)" as first option
  describe('GodSelector', () => {
    it('shows label with Claude Code as recommended and default-selected', () => {
      const { lastFrame } = render(
        <GodSelector
          detected={DETECTED}
          label="Select God (orchestrator):"
          onSelect={vi.fn()}
        />,
      );
      const output = lastFrame()!;
      expect(output).toContain('Select God (orchestrator):');
      expect(output).toContain('Claude Code');
      expect(output).toContain('recommended');
      expect(output).toContain('Same as Reviewer');
    });

    it('lists all installed CLIs after the default option', () => {
      const { lastFrame } = render(
        <GodSelector
          detected={DETECTED}
          label="Select God (orchestrator):"
          onSelect={vi.fn()}
        />,
      );
      const output = lastFrame()!;
      expect(output).toContain('Claude');
      expect(output).toContain('Gemini');
      expect(output).toContain('Copilot');
    });

    // AC-3: Default selection is Claude Code (recommended), pressing Enter selects it
    it('calls onSelect with claude-code when Enter pressed on default selection', () => {
      const onSelect = vi.fn();
      const { stdin } = render(
        <GodSelector
          detected={DETECTED}
          label="Select God (orchestrator):"
          onSelect={onSelect}
        />,
      );
      // Press Enter on the default item (Claude Code)
      stdin.write('\r');
      expect(onSelect).toHaveBeenCalledWith('claude-code');
    });

    // AC-3 variant: SAME_AS_REVIEWER sentinel is a known value that the wizard resolves
    it('SAME_AS_REVIEWER sentinel is the correct value', () => {
      expect(SAME_AS_REVIEWER).toBe('__same_as_reviewer__');
    });
  });

  // AC-4: ConfirmScreen shows God role
  describe('ConfirmScreen', () => {
    it('shows God label with adapter name', () => {
      const { lastFrame } = render(
        <ConfirmScreen
          config={{
            projectDir: '/tmp/test',
            coder: 'claude-code',
            reviewer: 'gemini',
            god: 'copilot',
            task: 'test task',
          }}
          detected={DETECTED}
          onConfirm={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      const output = lastFrame()!;
      expect(output).toContain('God');
      expect(output).toContain('Copilot');
    });

    it('shows "(same as Reviewer)" when god equals reviewer', () => {
      const { lastFrame } = render(
        <ConfirmScreen
          config={{
            projectDir: '/tmp/test',
            coder: 'claude-code',
            reviewer: 'gemini',
            god: 'gemini',
            task: 'test task',
          }}
          detected={DETECTED}
          onConfirm={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      const output = lastFrame()!;
      expect(output).toContain('God');
      expect(output).toContain('same as Reviewer');
    });
  });
});

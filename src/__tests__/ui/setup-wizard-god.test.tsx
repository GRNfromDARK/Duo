/**
 * Tests for Card A.1: SetupWizard God role selection step.
 *
 * AC-1: 6-step stepper (Project → Coder → Reviewer → God → Task → Confirm)
 * AC-2: God selection list includes only supported God adapters, plus reviewer reuse when valid
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
  { name: 'codex', displayName: 'Codex', command: 'codex', installed: true, version: '1.1' },
  { name: 'gemini', displayName: 'Gemini', command: 'gemini', installed: true, version: '2.0' },
  { name: 'copilot', displayName: 'Copilot', command: 'copilot', installed: true, version: '3.0' },
];

describe('SetupWizard — God selection (Card A.1)', () => {
  // AC-1: PHASE_ORDER has 9 phases (includes model sub-phases) with God between Reviewer and Task
  describe('PHASE_ORDER', () => {
    it('has 9 phases (including model selection sub-phases)', () => {
      expect(PHASE_ORDER).toHaveLength(9);
    });

    it('includes select-god phase', () => {
      expect(PHASE_ORDER).toContain('select-god');
    });

    it('places select-god after reviewer-model and before god-model', () => {
      const reviewerModelIdx = PHASE_ORDER.indexOf('reviewer-model');
      const godIdx = PHASE_ORDER.indexOf('select-god');
      const godModelIdx = PHASE_ORDER.indexOf('god-model');
      const taskIdx = PHASE_ORDER.indexOf('enter-task');
      expect(godIdx).toBe(reviewerModelIdx + 1);
      expect(godModelIdx).toBe(godIdx + 1);
      expect(taskIdx).toBe(godModelIdx + 1);
    });
  });

  // AC-1: PHASE_LABELS includes God label
  it('PHASE_LABELS maps select-god to "God"', () => {
    expect(PHASE_LABELS['select-god']).toBe('God');
  });

  // AC-2: GodSelector only shows supported God adapters
  describe('GodSelector', () => {
    it('shows label with supported God adapters and reviewer reuse when reviewer is supported', () => {
      const { lastFrame } = render(
        <GodSelector
          detected={DETECTED}
          reviewer="codex"
          label="Select God (orchestrator):"
          onSelect={vi.fn()}
        />,
      );
      const output = lastFrame()!;
      expect(output).toContain('Select God (orchestrator):');
      expect(output).toContain('Claude Code');
      expect(output).toContain('Codex');
      expect(output).toContain('Same as Reviewer');
    });

    it('does not list unsupported CLIs as God options', () => {
      const { lastFrame } = render(
        <GodSelector
          detected={DETECTED}
          reviewer="gemini"
          label="Select God (orchestrator):"
          onSelect={vi.fn()}
        />,
      );
      const output = lastFrame()!;
      expect(output).toContain('Claude');
      expect(output).toContain('Codex');
      expect(output).not.toContain('Gemini');
      expect(output).not.toContain('Copilot');
      expect(output).toContain("Reviewer 'gemini' cannot act as God");
    });

    it('calls onSelect with SAME_AS_REVIEWER when reviewer is the default selection', () => {
      const onSelect = vi.fn();
      const { stdin } = render(
        <GodSelector
          detected={DETECTED}
          reviewer="codex"
          label="Select God (orchestrator):"
          onSelect={onSelect}
        />,
      );
      stdin.write('\r');
      expect(onSelect).toHaveBeenCalledWith(SAME_AS_REVIEWER);
    });

    it('defaults to Claude Code when reviewer is unsupported for God', () => {
      const onSelect = vi.fn();
      const { stdin } = render(
        <GodSelector
          detected={DETECTED}
          reviewer="gemini"
          label="Select God (orchestrator):"
          onSelect={onSelect}
        />,
      );
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
            god: 'codex',
            task: 'test task',
          }}
          detected={DETECTED}
          onConfirm={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      const output = lastFrame()!;
      expect(output).toContain('God');
      expect(output).toContain('Codex');
    });

    it('shows "(same as Reviewer)" when god equals reviewer', () => {
      const { lastFrame } = render(
        <ConfirmScreen
          config={{
            projectDir: '/tmp/test',
            coder: 'claude-code',
            reviewer: 'codex',
            god: 'codex',
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

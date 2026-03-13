import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { SystemMessage } from '../../ui/components/SystemMessage.js';
import type { DisplayMode } from '../../ui/display-mode.js';

describe('SystemMessage', () => {
  // ── Routing messages (FR-024) ──

  describe('routing message', () => {
    it('renders minimal routing message in one line', () => {
      const { lastFrame } = render(
        <SystemMessage
          type="routing"
          agentName="Codex"
          displayMode="minimal"
        />
      );
      const output = lastFrame()!;
      expect(output).toContain('·');
      expect(output).toContain('[Router]');
      expect(output).toContain('Choice detected');
      expect(output).toContain('Forwarding to Codex');
    });

    it('renders verbose routing message with detection reason', () => {
      const { lastFrame } = render(
        <SystemMessage
          type="routing"
          agentName="Claude"
          displayMode="verbose"
          routingDetails={{
            question: 'Which approach should we use?',
            choices: ['Option A: refactor', 'Option B: rewrite'],
          }}
        />
      );
      const output = lastFrame()!;
      expect(output).toContain('[Router]');
      expect(output).toContain('Choice detected');
      expect(output).toContain('Forwarding to Claude');
      expect(output).toContain('Which approach should we use?');
      expect(output).toContain('Option A: refactor');
      expect(output).toContain('Option B: rewrite');
    });

    it('renders verbose routing without details gracefully', () => {
      const { lastFrame } = render(
        <SystemMessage
          type="routing"
          agentName="Gemini"
          displayMode="verbose"
        />
      );
      const output = lastFrame()!;
      expect(output).toContain('[Router]');
      expect(output).toContain('Forwarding to Gemini');
    });
  });

  // ── Interrupt messages (FR-025) ──

  describe('interrupt message', () => {
    it('renders interrupt with agent name and output char count (AC-080)', () => {
      const { lastFrame } = render(
        <SystemMessage
          type="interrupt"
          agentName="Claude"
          outputChars={847}
        />
      );
      const output = lastFrame()!;
      expect(output).toContain('INTERRUPTED');
      expect(output).toContain('Claude');
      expect(output).toContain('847 chars');
    });

    it('renders interrupt with zero output chars', () => {
      const { lastFrame } = render(
        <SystemMessage
          type="interrupt"
          agentName="Codex"
          outputChars={0}
        />
      );
      const output = lastFrame()!;
      expect(output).toContain('INTERRUPTED');
      expect(output).toContain('Codex');
      expect(output).toContain('0 chars');
    });
  });

  // ── Waiting messages (AC-081) ──

  describe('waiting message', () => {
    it('renders waiting prompt clearly (AC-081)', () => {
      const { lastFrame } = render(
        <SystemMessage type="waiting" />
      );
      const output = lastFrame()!;
      expect(output).toContain('Waiting for your instructions');
    });

    it('uses user border marker for waiting prompt', () => {
      const { lastFrame } = render(
        <SystemMessage type="waiting" />
      );
      const output = lastFrame()!;
      expect(output).toContain('>');
    });
  });

  // ── Display mode filtering ──

  describe('display mode integration', () => {
    it('minimal routing shows single-line format', () => {
      const { lastFrame } = render(
        <SystemMessage
          type="routing"
          agentName="Claude"
          displayMode="minimal"
          routingDetails={{
            question: 'Which option?',
            choices: ['A', 'B'],
          }}
        />
      );
      const output = lastFrame()!;
      // Minimal should NOT show question/choices details
      expect(output).not.toContain('Which option?');
      expect(output).toContain('Choice detected');
      expect(output).toContain('Forwarding to Claude');
    });
  });
});

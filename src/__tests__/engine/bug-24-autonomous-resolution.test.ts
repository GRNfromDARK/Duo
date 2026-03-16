/**
 * Regression tests for BUG-24: God should intercept worker questions
 * and make autonomous decisions instead of forwarding to human.
 *
 * BUG-24 [P1]: God uses request_user_input for design questions.
 *   When workers (coder/reviewer) raise questions that would normally
 *   go to a human, God should intercept them and make autonomous
 *   decisions with a two-step process: choice + reflection.
 *
 *   Fix: (a) Add autonomousResolutions field to GodDecisionEnvelope
 *   (b) Update God system prompt with proxy decision-making instructions
 *   (c) Include autonomous resolutions in previous decision context
 */

import { describe, it, expect } from 'vitest';
import { GodDecisionEnvelopeSchema } from '../../types/god-envelope.js';
import { SYSTEM_PROMPT, buildPreviousDecisionSection } from '../../god/god-decision-service.js';
import type { GodDecisionEnvelope } from '../../types/god-envelope.js';

// ── Shared helpers ──

function makeValidEnvelope(overrides?: Partial<GodDecisionEnvelope>): Record<string, unknown> {
  return {
    diagnosis: {
      summary: 'test',
      currentGoal: 'test goal',
      currentPhaseId: 'p1',
      notableObservations: [],
    },
    authority: {
      userConfirmation: 'not_required',
      reviewerOverride: false,
      acceptAuthority: 'reviewer_aligned',
    },
    actions: [{ type: 'send_to_coder', message: 'proceed' }],
    messages: [{ target: 'system_log', content: 'log' }],
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// BUG-24 Part A: autonomousResolutions schema field
// ══════════════════════════════════════════════════════════════════

describe('BUG-24 Part A: GodDecisionEnvelope autonomousResolutions field', () => {
  it('accepts envelope with autonomousResolutions containing choice and reflection', () => {
    const envelope = makeValidEnvelope({
      autonomousResolutions: [
        {
          question: 'Which CLI parameter format?',
          choice: '--coder-model as independent parameter',
          reflection: 'Independent parameters are clearer and more consistent with existing --coder flag',
          finalChoice: '--coder-model as independent parameter',
        },
      ],
    } as Partial<GodDecisionEnvelope>);

    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autonomousResolutions).toHaveLength(1);
      expect(result.data.autonomousResolutions![0].question).toBe('Which CLI parameter format?');
      expect(result.data.autonomousResolutions![0].finalChoice).toBe('--coder-model as independent parameter');
    }
  });

  it('accepts envelope with multiple autonomous resolutions', () => {
    const envelope = makeValidEnvelope({
      autonomousResolutions: [
        {
          question: 'Scope priority?',
          choice: 'Track A first',
          reflection: 'Track A modules are already implemented, lower risk',
          finalChoice: 'Track A first',
        },
        {
          question: 'Model list source?',
          choice: 'Hardcoded registry',
          reflection: 'Actually, combining hardcoded + free input is more flexible',
          finalChoice: 'Hardcoded registry with free input fallback',
        },
      ],
    } as Partial<GodDecisionEnvelope>);

    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it('accepts envelope without autonomousResolutions (field is optional)', () => {
    const envelope = makeValidEnvelope();
    // No autonomousResolutions field at all
    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it('accepts envelope with empty autonomousResolutions array', () => {
    const envelope = makeValidEnvelope({
      autonomousResolutions: [],
    } as Partial<GodDecisionEnvelope>);

    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it('rejects autonomousResolution missing required fields', () => {
    const envelope = makeValidEnvelope({
      autonomousResolutions: [
        {
          question: 'Some question',
          // missing choice, reflection, finalChoice
        },
      ],
    } as Partial<GodDecisionEnvelope>);

    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// BUG-24 Part B: God system prompt contains proxy decision instructions
// ══════════════════════════════════════════════════════════════════

describe('BUG-24 Part B: God system prompt proxy decision instructions', () => {
  it('instructs God to intercept worker questions instead of forwarding to human', () => {
    expect(SYSTEM_PROMPT).toContain('request_user_input');
    // Must tell God NOT to forward worker questions to human
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/do not.*forward|do not.*request_user_input.*worker|intercept.*question/i);
  });

  it('instructs God to fill autonomousResolutions with choice and reflection', () => {
    expect(SYSTEM_PROMPT).toContain('autonomousResolutions');
    expect(SYSTEM_PROMPT).toContain('choice');
    expect(SYSTEM_PROMPT).toContain('reflection');
    expect(SYSTEM_PROMPT).toContain('finalChoice');
  });

  it('restricts request_user_input to genuine human-only blocks', () => {
    // The prompt should explicitly say when request_user_input IS allowed
    expect(SYSTEM_PROMPT).toMatch(/request_user_input.*only/i);
  });
});

// ══════════════════════════════════════════════════════════════════
// BUG-24 Part C: Previous decision section includes autonomous resolutions
// ══════════════════════════════════════════════════════════════════

describe('BUG-24 Part C: buildPreviousDecisionSection with autonomousResolutions', () => {
  it('includes autonomous resolutions in previous decision summary', () => {
    const decisions: GodDecisionEnvelope[] = [
      {
        diagnosis: {
          summary: 'Coder raised design questions',
          currentGoal: 'implement model selection',
          currentPhaseId: 'phase-2',
          notableObservations: ['Coder identified 4 design questions'],
        },
        authority: {
          userConfirmation: 'not_required',
          reviewerOverride: false,
          acceptAuthority: 'reviewer_aligned',
        },
        actions: [{ type: 'send_to_coder', message: 'Proceed with decided approach' }],
        messages: [{ target: 'system_log', content: 'Resolved worker questions autonomously' }],
        autonomousResolutions: [
          {
            question: 'Which parameter format?',
            choice: '--coder-model',
            reflection: 'Consistent with existing --coder pattern',
            finalChoice: '--coder-model',
          },
        ],
      },
    ];

    const section = buildPreviousDecisionSection(decisions);
    expect(section).toContain('--coder-model');
    expect(section).toContain('parameter format');
  });

  it('returns normal section when no autonomous resolutions', () => {
    const decisions: GodDecisionEnvelope[] = [
      {
        diagnosis: {
          summary: 'Normal decision',
          currentGoal: 'test',
          currentPhaseId: 'p1',
          notableObservations: [],
        },
        authority: {
          userConfirmation: 'not_required',
          reviewerOverride: false,
          acceptAuthority: 'reviewer_aligned',
        },
        actions: [{ type: 'send_to_coder', message: 'go' }],
        messages: [{ target: 'system_log', content: 'log' }],
      },
    ];

    const section = buildPreviousDecisionSection(decisions);
    expect(section).toContain('Last Decision Summary');
    expect(section).not.toContain('Autonomous Resolution');
  });
});

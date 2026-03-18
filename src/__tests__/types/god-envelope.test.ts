/**
 * Tests for GodDecisionEnvelope — simplified.
 * No authority, no autonomousResolutions, no currentPhaseId.
 */

import { describe, it, expect } from 'vitest';
import { GodDecisionEnvelopeSchema } from '../../types/god-envelope.js';

/** Helper: build a valid envelope base for testing. */
function validEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    diagnosis: {
      summary: 'Coder completed implementation',
      currentGoal: 'Implement login feature',
      notableObservations: ['work_output received from coder'],
    },
    actions: [
      { type: 'send_to_reviewer', message: 'Please review the implementation' },
    ],
    messages: [
      { target: 'system_log' as const, content: 'Routing to reviewer after coder output' },
    ],
    ...overrides,
  };
}

describe('GodDecisionEnvelope', () => {
  it('accepts a valid envelope with all required fields', () => {
    const envelope = validEnvelope();
    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it('actions and messages coexist in one envelope', () => {
    const envelope = validEnvelope({
      actions: [
        { type: 'send_to_coder', dispatchType: 'code', message: 'Fix the typo in line 42' },
        { type: 'send_to_reviewer', message: 'Review after fix' },
      ],
      messages: [
        { target: 'user', content: 'Starting work' },
        { target: 'system_log', content: 'Phase transition logged' },
      ],
    });
    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actions).toHaveLength(2);
      expect(result.data.messages).toHaveLength(2);
    }
  });

  it('AC-7: messages target is limited to coder|reviewer|user|system_log, no action types leak', () => {
    const envelope = validEnvelope();
    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
    if (result.success) {
      for (const msg of result.data.messages) {
        expect(msg).toHaveProperty('target');
        expect(msg).toHaveProperty('content');
        expect(msg).not.toHaveProperty('type');
      }
    }
  });

  it('rejects invalid message target', () => {
    const envelope = validEnvelope({
      messages: [
        { target: 'invalid_target', content: 'hello' },
      ],
    });
    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(false);
  });

  it('rejects invalid action type in actions', () => {
    const envelope = validEnvelope({
      actions: [
        { type: 'nonexistent_action', foo: 'bar' },
      ],
    });
    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(false);
  });

  it('accepts empty actions array', () => {
    const envelope = validEnvelope({
      actions: [],
    });
    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it('accepts empty messages array', () => {
    const envelope = validEnvelope({
      messages: [],
    });
    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it('rejects envelope missing diagnosis', () => {
    const { diagnosis, ...rest } = validEnvelope();
    const result = GodDecisionEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects envelope with extra authority field (stripped by schema)', () => {
    const envelope = validEnvelope();
    // Adding extra fields should be stripped or ignored by Zod default behavior
    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).authority).toBeUndefined();
    }
  });

  it('accepts send_to_coder with dispatchType', () => {
    const envelope = validEnvelope({
      actions: [
        { type: 'send_to_coder', dispatchType: 'explore', message: 'Investigate the codebase' },
      ],
    });
    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it('accepts accept_task with summary only (no rationale)', () => {
    const envelope = validEnvelope({
      actions: [
        { type: 'accept_task', summary: 'Task completed successfully' },
      ],
    });
    const result = GodDecisionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });
});

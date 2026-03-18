import { describe, it, expect } from 'vitest';
import {
  SendToCoderSchema,
  SendToReviewerSchema,
  AcceptTaskSchema,
  WaitSchema,
  RequestUserInputSchema,
  GodActionSchema,
} from '../../types/god-actions.js';
import type { GodAction } from '../../types/god-actions.js';

describe('Individual GodAction schemas', () => {
  it('should validate send_to_coder with dispatchType', () => {
    const action = { type: 'send_to_coder', dispatchType: 'code', message: 'Implement the login page' };
    expect(() => SendToCoderSchema.parse(action)).not.toThrow();
  });

  it('should validate send_to_coder with all dispatchTypes', () => {
    for (const dt of ['explore', 'code', 'debug', 'discuss'] as const) {
      const action = { type: 'send_to_coder', dispatchType: dt, message: 'test' };
      expect(() => SendToCoderSchema.parse(action)).not.toThrow();
    }
  });

  it('should reject send_to_coder without dispatchType', () => {
    const action = { type: 'send_to_coder', message: 'test' };
    expect(() => SendToCoderSchema.parse(action)).toThrow();
  });

  it('should validate send_to_reviewer', () => {
    const action = { type: 'send_to_reviewer', message: 'Review the implementation' };
    expect(() => SendToReviewerSchema.parse(action)).not.toThrow();
  });

  it('should validate accept_task with summary only', () => {
    const action = { type: 'accept_task', summary: 'Task done' };
    expect(() => AcceptTaskSchema.parse(action)).not.toThrow();
  });

  it('should validate wait with estimatedSeconds', () => {
    const action = { type: 'wait', reason: 'Rate limited', estimatedSeconds: 300 };
    const parsed = WaitSchema.parse(action);
    expect(parsed.estimatedSeconds).toBe(300);
  });

  it('should validate wait without estimatedSeconds', () => {
    const action = { type: 'wait', reason: 'Rate limited' };
    expect(() => WaitSchema.parse(action)).not.toThrow();
  });

  it('should validate request_user_input', () => {
    const action = { type: 'request_user_input', question: 'Which approach do you prefer?' };
    expect(() => RequestUserInputSchema.parse(action)).not.toThrow();
  });
});

describe('AC-5: GodAction discriminated union', () => {
  const validActions: GodAction[] = [
    { type: 'send_to_coder', dispatchType: 'code', message: 'code this' },
    { type: 'send_to_reviewer', message: 'review this' },
    { type: 'accept_task', summary: 'approved' },
    { type: 'wait', reason: 'rate limited' },
    { type: 'request_user_input', question: 'what next?' },
  ];

  it('should have exactly 5 action types', () => {
    expect(validActions).toHaveLength(5);
  });

  it.each(validActions.map((a) => [a.type, a]))('should validate %s via union schema', (_type, action) => {
    expect(() => GodActionSchema.parse(action)).not.toThrow();
  });

  it('should reject unknown action type', () => {
    expect(() => GodActionSchema.parse({ type: 'unknown_action' })).toThrow();
  });

  it('should reject removed action types', () => {
    expect(() => GodActionSchema.parse({ type: 'set_phase', phaseId: 'p1' })).toThrow();
    expect(() => GodActionSchema.parse({ type: 'stop_role', role: 'coder', reason: 'test' })).toThrow();
    expect(() => GodActionSchema.parse({ type: 'retry_role', role: 'coder' })).toThrow();
    expect(() => GodActionSchema.parse({ type: 'switch_adapter', role: 'coder', adapter: 'x', reason: 'y' })).toThrow();
    expect(() => GodActionSchema.parse({ type: 'resume_after_interrupt', resumeStrategy: 'continue' })).toThrow();
    expect(() => GodActionSchema.parse({ type: 'emit_summary', content: 'text' })).toThrow();
  });

  it('should reject action with wrong type field value', () => {
    expect(() => GodActionSchema.parse({ type: 'send_to_coder' })).toThrow(); // missing message + dispatchType
  });
});

describe('AC-8: Structural schema prevents implicit completion', () => {
  it('accept_task requires summary — cannot be triggered by just a message', () => {
    expect(() => AcceptTaskSchema.parse({ type: 'accept_task' })).toThrow();
    expect(() => AcceptTaskSchema.parse({ type: 'accept_task', message: 'accept it' })).toThrow();
  });
});

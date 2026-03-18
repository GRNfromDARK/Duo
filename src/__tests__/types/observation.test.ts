import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ObservationTypeSchema,
  ObservationSourceSchema,
  ObservationSeveritySchema,
  ObservationSchema,
  isWorkObservation,
  OBSERVATION_TYPES,
} from '../../types/observation.js';
import type { Observation } from '../../types/observation.js';

describe('ObservationType', () => {
  const allTypes = [
    'work_output',
    'review_output',
    'human_message',
    'human_interrupt',
    'runtime_error',
    'phase_progress_signal',
  ] as const;

  it('should define exactly 6 observation types', () => {
    expect(OBSERVATION_TYPES).toHaveLength(6);
  });

  it.each(allTypes)('should accept valid type: %s', (type) => {
    expect(() => ObservationTypeSchema.parse(type)).not.toThrow();
  });

  it('should reject invalid type', () => {
    expect(() => ObservationTypeSchema.parse('invalid_type')).toThrow();
  });

  it('should reject removed observation types', () => {
    const removedTypes = [
      'quota_exhausted', 'auth_failed', 'adapter_unavailable',
      'empty_output', 'meta_output', 'tool_failure',
      'clarification_answer', 'runtime_invariant_violation',
    ];
    for (const type of removedTypes) {
      expect(() => ObservationTypeSchema.parse(type)).toThrow();
    }
  });
});

describe('ObservationSchema', () => {
  const validObservation: Observation = {
    source: 'coder',
    type: 'work_output',
    summary: 'Coder produced implementation',
    severity: 'info',
    timestamp: '2026-03-13T10:00:00.000Z',
  };

  it('AC-1: should validate all 6 observation types', () => {
    const types = [
      'work_output', 'review_output', 'human_message',
      'human_interrupt', 'runtime_error', 'phase_progress_signal',
    ] as const;

    for (const type of types) {
      const obs = { ...validObservation, type };
      expect(() => ObservationSchema.parse(obs)).not.toThrow();
    }
  });

  it('should accept all valid sources', () => {
    const sources = ['coder', 'reviewer', 'god', 'human', 'runtime'] as const;
    for (const source of sources) {
      const obs = { ...validObservation, source };
      expect(() => ObservationSchema.parse(obs)).not.toThrow();
    }
  });

  it('should accept all valid severities', () => {
    const severities = ['info', 'warning', 'error', 'fatal'] as const;
    for (const severity of severities) {
      const obs = { ...validObservation, severity };
      expect(() => ObservationSchema.parse(obs)).not.toThrow();
    }
  });

  it('should accept optional fields', () => {
    const obs: Observation = {
      ...validObservation,
      rawRef: '/path/to/output.log',
      adapter: 'claude-code',
    };
    const parsed = ObservationSchema.parse(obs);
    expect(parsed.rawRef).toBe('/path/to/output.log');
    expect(parsed.adapter).toBe('claude-code');
  });

  it('should reject missing required fields', () => {
    expect(() => ObservationSchema.parse({})).toThrow();
    expect(() => ObservationSchema.parse({ source: 'coder' })).toThrow();
  });

  it('should reject invalid source', () => {
    expect(() => ObservationSchema.parse({ ...validObservation, source: 'unknown' })).toThrow();
  });

  it('should reject invalid severity', () => {
    expect(() => ObservationSchema.parse({ ...validObservation, severity: 'critical' })).toThrow();
  });
});

describe('isWorkObservation', () => {
  const makeObs = (type: Observation['type']): Observation => ({
    source: 'coder',
    type,
    summary: 'test',
    severity: 'info',
    timestamp: '2026-03-13T10:00:00.000Z',
  });

  it('should return true for work_output', () => {
    expect(isWorkObservation(makeObs('work_output'))).toBe(true);
  });

  it('should return true for review_output', () => {
    expect(isWorkObservation(makeObs('review_output'))).toBe(true);
  });

  it('should return false for non-work types', () => {
    const nonWorkTypes: Observation['type'][] = [
      'human_message',
      'human_interrupt',
      'runtime_error',
      'phase_progress_signal',
    ];
    for (const type of nonWorkTypes) {
      expect(isWorkObservation(makeObs(type))).toBe(false);
    }
  });
});

describe('severity defaults', () => {
  it('should default severity to info when omitted', () => {
    const obs = ObservationSchema.parse({
      source: 'runtime',
      type: 'runtime_error',
      summary: 'Something went wrong',
      timestamp: '2026-03-13T10:00:00.000Z',
    });
    expect(obs.severity).toBe('info');
  });

  it('should allow explicit severity to override default', () => {
    const obs = ObservationSchema.parse({
      source: 'runtime',
      type: 'runtime_error',
      summary: 'Something went wrong',
      severity: 'fatal',
      timestamp: '2026-03-13T10:00:00.000Z',
    });
    expect(obs.severity).toBe('fatal');
  });
});

/**
 * Tests for DriftDetector — God progressive drift detection.
 * Source: FR-G03 (AC-060, AC-061)
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    appendFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
  };
});

import { appendFileSync } from 'fs';
import {
  DriftDetector,
  type DriftDetectionResult,
  type DriftType,
  type DriftSeverity,
} from '../../god/drift-detector.js';
import type { GodConvergenceJudgment, GodPostReviewerDecision } from '../../types/god-schemas.js';

// ── Helpers ──

function makeJudgment(overrides: Partial<GodConvergenceJudgment> = {}): GodConvergenceJudgment {
  return {
    classification: 'changes_requested',
    shouldTerminate: false,
    reason: null,
    blockingIssueCount: 0,
    criteriaProgress: [],
    reviewerVerdict: 'needs work',
    ...overrides,
  };
}

function makePostReviewerDecision(overrides: Partial<GodPostReviewerDecision> = {}): GodPostReviewerDecision {
  return {
    action: 'route_to_coder',
    reasoning: 'issues remain',
    confidenceScore: 0.8,
    progressTrend: 'improving',
    ...overrides,
  };
}

// ── AC-1: god_too_permissive — 3 consecutive approved vs local changes_requested ──

describe('DriftDetector — god_too_permissive', () => {
  let detector: DriftDetector;

  beforeEach(() => {
    detector = new DriftDetector();
  });

  test('triggers after 3 consecutive approved vs local changes_requested', () => {
    const godDecision = makeJudgment({ classification: 'approved', blockingIssueCount: 0 });

    detector.recordDecision(godDecision, 'changes_requested');
    expect(detector.checkDrift().detected).toBe(false);

    detector.recordDecision(godDecision, 'changes_requested');
    expect(detector.checkDrift().detected).toBe(false);

    detector.recordDecision(godDecision, 'changes_requested');
    const result = detector.checkDrift();
    expect(result.detected).toBe(true);
    expect(result.type).toBe('god_too_permissive');
  });

  test('resets streak when God agrees with local', () => {
    const permissive = makeJudgment({ classification: 'approved', blockingIssueCount: 0 });
    const agreeing = makeJudgment({ classification: 'changes_requested' });

    detector.recordDecision(permissive, 'changes_requested');
    detector.recordDecision(permissive, 'changes_requested');
    // Agreement resets the streak
    detector.recordDecision(agreeing, 'changes_requested');
    expect(detector.checkDrift().detected).toBe(false);

    // Need 3 more consecutive to trigger
    detector.recordDecision(permissive, 'changes_requested');
    detector.recordDecision(permissive, 'changes_requested');
    expect(detector.checkDrift().detected).toBe(false);
  });

  test('does not trigger when God and local agree on approved', () => {
    const godDecision = makeJudgment({ classification: 'approved', blockingIssueCount: 0 });

    for (let i = 0; i < 5; i++) {
      detector.recordDecision(godDecision, 'approved');
    }
    expect(detector.checkDrift().detected).toBe(false);
  });

  test('PostReviewerDecision converged vs local changes_requested counts as permissive', () => {
    const godDecision = makePostReviewerDecision({ action: 'converged', confidenceScore: 0.9 });

    detector.recordDecision(godDecision, 'changes_requested');
    detector.recordDecision(godDecision, 'changes_requested');
    detector.recordDecision(godDecision, 'changes_requested');

    const result = detector.checkDrift();
    expect(result.detected).toBe(true);
    expect(result.type).toBe('god_too_permissive');
  });
});

// ── AC-2: confidence_declining — 4 consecutive rounds of declining confidence ──

describe('DriftDetector — confidence_declining', () => {
  let detector: DriftDetector;

  beforeEach(() => {
    detector = new DriftDetector();
  });

  test('triggers after 4 consecutive declining confidence scores', () => {
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.9 }), 'changes_requested');
    expect(detector.checkDrift().detected).toBe(false);

    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.7 }), 'changes_requested');
    expect(detector.checkDrift().detected).toBe(false);

    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.5 }), 'changes_requested');
    expect(detector.checkDrift().detected).toBe(false);

    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.3 }), 'changes_requested');
    const result = detector.checkDrift();
    expect(result.detected).toBe(true);
    expect(result.type).toBe('confidence_declining');
  });

  test('does not trigger with only 3 declining scores', () => {
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.9 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.7 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.5 }), 'changes_requested');

    expect(detector.checkDrift().detected).toBe(false);
  });

  test('resets when confidence increases', () => {
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.9 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.7 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.5 }), 'changes_requested');
    // Confidence goes up — streak resets
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.8 }), 'changes_requested');

    expect(detector.checkDrift().detected).toBe(false);
  });

  test('ignores decisions without confidenceScore (ConvergenceJudgment)', () => {
    const judgment = makeJudgment();
    for (let i = 0; i < 10; i++) {
      detector.recordDecision(judgment, 'changes_requested');
    }
    // Only permissive check might fire, not confidence
    const result = detector.checkDrift();
    // No confidence_declining since ConvergenceJudgment has no confidenceScore
    expect(result.type !== 'confidence_declining' || !result.detected).toBe(true);
  });
});

// ── AC-3: Severe drift triggers fallback, auto-recovers after 2 rounds ──

describe('DriftDetector — severity and recovery', () => {
  let detector: DriftDetector;

  beforeEach(() => {
    detector = new DriftDetector();
  });

  test('god_too_permissive is severe drift', () => {
    const godDecision = makeJudgment({ classification: 'approved', blockingIssueCount: 0 });
    for (let i = 0; i < 3; i++) {
      detector.recordDecision(godDecision, 'changes_requested');
    }

    const result = detector.checkDrift();
    expect(result.severity).toBe('severe');
  });

  test('confidence_declining with final score < 0.5 is severe', () => {
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.8 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.6 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.4 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.2 }), 'changes_requested');

    const result = detector.checkDrift();
    expect(result.severity).toBe('severe');
  });

  test('confidence_declining with final score >= 0.5 is mild', () => {
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.9 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.8 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.7 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.6 }), 'changes_requested');

    const result = detector.checkDrift();
    expect(result.severity).toBe('mild');
  });

  test('severe drift activates fallback for 2 rounds then auto-recovers', () => {
    const godDecision = makeJudgment({ classification: 'approved', blockingIssueCount: 0 });
    for (let i = 0; i < 3; i++) {
      detector.recordDecision(godDecision, 'changes_requested');
    }

    // Drift detected, fallback should be active
    expect(detector.checkDrift().detected).toBe(true);
    expect(detector.isFallbackActive()).toBe(true);
    expect(detector.getFallbackRoundsRemaining()).toBe(2);

    // Tick down 1 round
    detector.tickFallbackRound();
    expect(detector.isFallbackActive()).toBe(true);
    expect(detector.getFallbackRoundsRemaining()).toBe(1);

    // Tick down another round → auto-recover
    detector.tickFallbackRound();
    expect(detector.isFallbackActive()).toBe(false);
    expect(detector.getFallbackRoundsRemaining()).toBe(0);
  });

  test('mild drift does not activate fallback', () => {
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.9 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.8 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.7 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.6 }), 'changes_requested');

    const result = detector.checkDrift();
    expect(result.detected).toBe(true);
    expect(result.severity).toBe('mild');
    expect(detector.isFallbackActive()).toBe(false);
  });
});

// ── AC-4: Drift events written to audit log ──

describe('DriftDetector — audit log', () => {
  let detector: DriftDetector;

  beforeEach(() => {
    vi.mocked(appendFileSync).mockClear();
    let seqCounter = 1;
    detector = new DriftDetector({ sessionDir: '/tmp/test-session', seq: 1, round: 1, seqProvider: () => seqCounter++ });
  });

  test('severe drift writes DRIFT_DETECTED to audit log', () => {
    const godDecision = makeJudgment({ classification: 'approved', blockingIssueCount: 0 });
    for (let i = 0; i < 3; i++) {
      detector.recordDecision(godDecision, 'changes_requested');
    }

    detector.checkDrift();

    const calls = vi.mocked(appendFileSync).mock.calls;
    const driftEntry = calls.find(call => {
      const content = call[1] as string;
      return content.includes('DRIFT_DETECTED');
    });

    expect(driftEntry).toBeDefined();
    const parsed = JSON.parse(driftEntry![1] as string);
    expect(parsed.decisionType).toBe('DRIFT_DETECTED');
    expect(parsed.decision.type).toBe('god_too_permissive');
    expect(parsed.decision.severity).toBe('severe');
  });

  test('mild drift writes DRIFT_DETECTED with mild severity', () => {
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.9 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.8 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.7 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.6 }), 'changes_requested');

    detector.checkDrift();

    const calls = vi.mocked(appendFileSync).mock.calls;
    const driftEntry = calls.find(call => {
      const content = call[1] as string;
      return content.includes('DRIFT_DETECTED');
    });

    expect(driftEntry).toBeDefined();
    const parsed = JSON.parse(driftEntry![1] as string);
    expect(parsed.decision.severity).toBe('mild');
  });

  test('no drift does not write to audit log', () => {
    const godDecision = makeJudgment({ classification: 'changes_requested' });
    detector.recordDecision(godDecision, 'changes_requested');

    detector.checkDrift();

    const calls = vi.mocked(appendFileSync).mock.calls;
    const driftEntry = calls.find(call => {
      const content = call[1] as string;
      return content.includes('DRIFT_DETECTED');
    });
    expect(driftEntry).toBeUndefined();
  });
});

// ── AC-5: Non-drift scenarios ──

describe('DriftDetector — non-drift scenarios', () => {
  let detector: DriftDetector;

  beforeEach(() => {
    detector = new DriftDetector();
  });

  test('alternating agree/disagree does not trigger permissive drift', () => {
    const permissive = makeJudgment({ classification: 'approved', blockingIssueCount: 0 });
    const agreeing = makeJudgment({ classification: 'changes_requested' });

    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) {
        detector.recordDecision(permissive, 'changes_requested');
      } else {
        detector.recordDecision(agreeing, 'changes_requested');
      }
    }
    expect(detector.checkDrift().detected).toBe(false);
  });

  test('stable confidence does not trigger declining drift', () => {
    for (let i = 0; i < 10; i++) {
      detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.7 }), 'changes_requested');
    }
    expect(detector.checkDrift().detected).toBe(false);
  });

  test('increasing confidence does not trigger declining drift', () => {
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.3 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.5 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.7 }), 'changes_requested');
    detector.recordDecision(makePostReviewerDecision({ confidenceScore: 0.9 }), 'changes_requested');

    expect(detector.checkDrift().detected).toBe(false);
  });

  test('empty detector returns no drift', () => {
    expect(detector.checkDrift().detected).toBe(false);
  });
});

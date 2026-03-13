import { describe, it, expect } from 'vitest';
import {
  ConvergenceService,
  type ConvergenceResult,
  type ConvergenceClassification,
} from '../../decision/convergence-service.js';

describe('ConvergenceService', () => {
  const service = new ConvergenceService({ maxRounds: 5 });

  // ──────────────────────────────────────────────
  // AC-1: approved classification — [APPROVED] marker only
  // ──────────────────────────────────────────────
  describe('AC-1: approved classification', () => {
    it('should classify [APPROVED] marker as approved', () => {
      const result = service.classify('The code is well-structured and handles all edge cases.\n\n[APPROVED]');
      expect(result.classification).toBe('approved');
    });

    it('should classify [APPROVED] marker even with surrounding text', () => {
      const result = service.classify('Good job fixing the null check. [APPROVED] No further issues.');
      expect(result.classification).toBe('approved');
    });

    it('should NOT classify as approved without [APPROVED] marker (may be soft_approved)', () => {
      const noMarkerOutputs = [
        'LGTM! The code looks great.',
        'Approved. No further changes needed.',
        'Everything looks good, no more comments.',
        'I approve this implementation. Ship it!',
        '没有更多意见，代码已通过审查。',
        'No issues found. The implementation is solid.',
        'All previous issues have been addressed.',
      ];

      for (const output of noMarkerOutputs) {
        const result = service.classify(output);
        // Without [APPROVED] marker, classification should NOT be 'approved'
        // It may be 'soft_approved' (for approval-like language) or 'changes_requested'
        expect(result.classification).not.toBe('approved');
      }
    });
  });

  // ──────────────────────────────────────────────
  // AC-2: changes_requested classification
  // ──────────────────────────────────────────────
  describe('AC-2: changes_requested classification', () => {
    it('should classify [CHANGES_REQUESTED] marker as changes_requested', () => {
      const result = service.classify('The error handling is missing.\n\n[CHANGES_REQUESTED]');
      expect(result.classification).toBe('changes_requested');
    });

    it('should classify output without any marker as changes_requested', () => {
      const result = service.classify('Please fix the null check on line 42.');
      expect(result.classification).toBe('changes_requested');
    });

    const changesOutputs = [
      'Please fix the null check on line 42. The variable could be undefined.',
      'There are several issues:\n1. Missing error handling in fetchData()\n2. The retry logic has an off-by-one error',
      'The implementation needs changes: add input validation for the email field.',
      'Bug: the loop should start at index 1, not 0. Also add a unit test for edge cases.',
      'Change the function signature to accept an options object instead of positional args.',
    ];

    for (const output of changesOutputs) {
      it(`should classify as changes_requested: "${output.slice(0, 50)}..."`, () => {
        const result = service.classify(output);
        expect(result.classification).toBe('changes_requested');
      });
    }
  });

  // ──────────────────────────────────────────────
  // AC-3: max rounds termination
  // ──────────────────────────────────────────────
  describe('AC-3: max rounds termination', () => {
    it('should signal termination when round >= maxRounds', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.evaluate('Some changes needed.', { currentRound: 5, previousOutputs: [] });
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('max_rounds');
    });

    it('should not terminate when round < maxRounds and changes requested', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.evaluate('Please fix the null check.', { currentRound: 3, previousOutputs: [] });
      expect(result.shouldTerminate).toBe(false);
    });

    it('should terminate when [APPROVED] marker present even if rounds remaining', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.evaluate('All issues resolved.\n\n[APPROVED]', { currentRound: 2, previousOutputs: [] });
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('approved');
    });

    it('should respect custom maxRounds', () => {
      const svc = new ConvergenceService({ maxRounds: 3 });
      const result = svc.evaluate('Fix this bug.', { currentRound: 3, previousOutputs: [] });
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('max_rounds');
    });

    it('should use default maxRounds of 20', () => {
      const svc = new ConvergenceService();
      const result = svc.evaluate('Fix this.', { currentRound: 19, previousOutputs: [] });
      expect(result.shouldTerminate).toBe(false);

      const result2 = svc.evaluate('Fix this.', { currentRound: 20, previousOutputs: [] });
      expect(result2.shouldTerminate).toBe(true);
      expect(result2.reason).toBe('max_rounds');
    });
  });

  // ──────────────────────────────────────────────
  // AC-4: loop detection — recent rounds same topic
  // ──────────────────────────────────────────────
  describe('AC-4: loop detection', () => {
    it('should detect loop when 2 consecutive outputs discuss same topic', () => {
      const svc = new ConvergenceService({ maxRounds: 10 });
      const result = svc.evaluate(
        'Please fix the null check on line 42.',
        {
          currentRound: 3,
          previousOutputs: [
            'Please fix the null check on line 42. It could be undefined.',
          ],
        },
      );
      expect(result.loopDetected).toBe(true);
    });

    it('should terminate early when loop is detected before max rounds', () => {
      const svc = new ConvergenceService({ maxRounds: 10 });
      const result = svc.evaluate(
        'The null check on line 42 is still missing. Please add the null check for the variable.',
        {
          currentRound: 4,
          previousOutputs: [
            'Line 42 needs a null check. Please add the null check for the variable on line 42.',
          ],
        },
      );
      expect(result.loopDetected).toBe(true);
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('loop_detected');
    });

    it('should not detect loop when topics differ', () => {
      const svc = new ConvergenceService({ maxRounds: 10 });
      const result = svc.evaluate(
        'Add input validation for the email field.',
        {
          currentRound: 3,
          previousOutputs: [
            'The retry logic has an off-by-one error on line 15.',
          ],
        },
      );
      expect(result.loopDetected).toBe(false);
    });

    it('should not detect loop with only one output (no previous)', () => {
      const svc = new ConvergenceService({ maxRounds: 10 });
      const result = svc.evaluate(
        'Fix the null check.',
        {
          currentRound: 1,
          previousOutputs: [],
        },
      );
      expect(result.loopDetected).toBe(false);
    });

    it('should detect loop with semantically similar but not identical text', () => {
      const svc = new ConvergenceService({ maxRounds: 10 });
      const result = svc.evaluate(
        'The null check on line 42 is still missing. Please add the null check for the variable.',
        {
          currentRound: 4,
          previousOutputs: [
            'Line 42 needs a null check. Please add the null check for the variable on line 42.',
          ],
        },
      );
      expect(result.loopDetected).toBe(true);
    });

    it('should detect A-B-A loop patterns within recent outputs', () => {
      const svc = new ConvergenceService({ maxRounds: 10 });
      const result = svc.evaluate(
        'Please fix the error handling in fetchData.',
        {
          currentRound: 5,
          previousOutputs: [
            'Please fix the error handling in fetchData.',
            'Add input validation for the email field.',
            'Please fix the error handling in fetchData.',
          ],
        },
      );
      expect(result.loopDetected).toBe(true);
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('loop_detected');
    });
  });

  // ──────────────────────────────────────────────
  // AC-5: soft approval detection
  // ──────────────────────────────────────────────
  describe('AC-5: soft approval detection', () => {
    it('should detect LGTM as soft_approved when no blocking issues', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.classify('LGTM! The code looks great.');
      expect(result.classification).toBe('soft_approved');
      expect(result.issueCount).toBe(0);
    });

    it('should detect "no more issues" as soft_approved', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.classify('No more issues. Ship it!');
      expect(result.classification).toBe('soft_approved');
    });

    it('should detect "all issues resolved" as soft_approved', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.classify('All issues have been resolved. Ready to merge.');
      expect(result.classification).toBe('soft_approved');
    });

    it('should detect Chinese approval phrases as soft_approved', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.classify('代码已通过审查，没有其他问题了。');
      expect(result.classification).toBe('soft_approved');
    });

    it('should NOT soft_approve when blocking issues are present', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.classify('Looks good to me overall but:\n\n**Blocking**: Missing null check on line 42\n\n[CHANGES_REQUESTED]');
      expect(result.classification).toBe('changes_requested');
    });

    it('should terminate on soft_approved in evaluate()', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.evaluate('LGTM! Ship it!', { currentRound: 2, previousOutputs: [] });
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('soft_approved');
    });

    it('[APPROVED] takes priority over soft approval', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.classify('LGTM!\n\n[APPROVED]');
      expect(result.classification).toBe('approved');
    });
  });

  // ──────────────────────────────────────────────
  // AC-6: issue counting and progress tracking
  // ──────────────────────────────────────────────
  describe('AC-6: issue counting and progress', () => {
    it('should count blocking issues in reviewer output', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const count = svc.countBlockingIssues(
        '1. **Blocking**: Missing null check\n2. **Blocking**: SQL injection risk\n3. **Non-blocking**: Consider renaming variable',
      );
      // 2 blocking, minus 1 non-blocking = 1... but blocking count is separate
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('should return 0 issues for clean output', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const count = svc.countBlockingIssues('The code looks clean, well-structured, and handles edge cases nicely.');
      expect(count).toBe(0);
    });

    it('should track improving trend when issues decrease', () => {
      const svc = new ConvergenceService({ maxRounds: 10 });
      const result = svc.evaluate(
        'Only one minor issue remaining.\n**Non-blocking**: Consider adding a comment.',
        {
          currentRound: 3,
          previousOutputs: [
            '**Blocking**: Missing error handling\n**Blocking**: No input validation\n[CHANGES_REQUESTED]',
          ],
        },
      );
      expect(result.progressTrend).toBe('improving');
    });

    it('should report issueCount in evaluate result', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.evaluate(
        '**Blocking**: Missing null check\n[CHANGES_REQUESTED]',
        { currentRound: 2, previousOutputs: [] },
      );
      expect(result.issueCount).toBeGreaterThanOrEqual(1);
    });

    it('should parse explicit "Blocking: N" structured count', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const count = svc.countBlockingIssues(
        '### New Issues\n1. **Location**: foo.ts:42\n   **Problem**: missing null check\n\nBlocking: 1\n\n[CHANGES_REQUESTED]',
      );
      expect(count).toBe(1);
    });

    it('should parse "Blocking: 0" as zero issues', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const count = svc.countBlockingIssues(
        'All issues resolved.\n\nBlocking: 0\n\n[APPROVED]',
      );
      expect(count).toBe(0);
    });

    it('should prefer explicit Blocking: N over heuristic counting', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      // Has **Blocking** markers but explicit count says 0 (items were marked fixed)
      const count = svc.countBlockingIssues(
        '[x] Fixed: **Blocking**: Missing null check\n\nBlocking: 0\n\n[APPROVED]',
      );
      expect(count).toBe(0);
    });
  });

  // ──────────────────────────────────────────────
  // AC-7: Chinese text loop detection
  // ──────────────────────────────────────────────
  describe('AC-7: Chinese text loop detection', () => {
    it('should detect loop in Chinese reviewer output', () => {
      const svc = new ConvergenceService({ maxRounds: 10 });
      const result = svc.evaluate(
        '请修复第42行的空指针检查，变量可能为空，请添加空指针检查。',
        {
          currentRound: 3,
          previousOutputs: [
            '第42行需要空指针检查，变量可能为空，必须添加空指针检查。',
          ],
        },
      );
      expect(result.loopDetected).toBe(true);
    });

    it('should not detect loop for different Chinese topics', () => {
      const svc = new ConvergenceService({ maxRounds: 10 });
      const result = svc.evaluate(
        '请添加邮箱格式校验功能。',
        {
          currentRound: 3,
          previousOutputs: [
            '请修复登录接口的超时重试逻辑。',
          ],
        },
      );
      expect(result.loopDetected).toBe(false);
    });
  });

  // ──────────────────────────────────────────────
  // Regression: BUG-2 R12 — Check 2 false positives in long sessions
  // ──────────────────────────────────────────────
  describe('test_regression_bug_r12_2: Check 2 limited scan window', () => {
    it('should NOT false-positive loop when old outputs share project keywords but recent ones differ', () => {
      const svc = new ConvergenceService({ maxRounds: 25 });

      // Simulate 15 rounds of outputs sharing common project terms (session, adapter, manager)
      // but discussing different specific issues each time
      const oldOutputs: string[] = [];
      for (let i = 0; i < 15; i++) {
        oldOutputs.push(
          `Round ${i}: The session adapter manager convergence module needs fix ${i}. ` +
          `Please update the session handler for adapter configuration in manager component. ` +
          `The convergence detection in the session adapter needs improvement.`
        );
      }

      // Current output discusses a completely different specific topic but shares project terms
      const currentOutput =
        'The notification system in the session adapter manager needs a new alert type. ' +
        'Add email notification support to the convergence alert manager for adapter errors.';

      const result = svc.evaluate(currentOutput, {
        currentRound: 16,
        previousOutputs: oldOutputs,
      });

      // With the fix, Check 2 only scans last 8 outputs, reducing false positives.
      // The old outputs (indices 0-6) that would have caused matches are outside the window.
      // This test verifies the scan is limited - if it scanned ALL 15 outputs,
      // it would easily find 2+ matches due to shared keywords.
      // We check that it doesn't prematurely terminate.
      // Note: if the recent 8 outputs still match, that's legitimate loop detection.
      // The key is that outputs older than 8 rounds ago don't contribute to false positives.
      expect(result.reason).not.toBe('loop_detected');
    });

    it('should still detect genuine loops within the scan window', () => {
      const svc = new ConvergenceService({ maxRounds: 25 });

      const oldOutputs = [
        'Unrelated output about authentication module redesign.',
        'Another unrelated output about database migration steps.',
        'Fix the null check on line 42 in the validation module.',
        'Update the error handling in the API endpoint.',
        'Fix the null check on line 42 in the validation module.',
        'Improve logging in the monitoring service.',
        'Fix the null check on line 42 in the validation module.',
      ];

      const currentOutput = 'Fix the null check on line 42 in the validation module.';

      const result = svc.evaluate(currentOutput, {
        currentRound: 8,
        previousOutputs: oldOutputs,
      });

      expect(result.loopDetected).toBe(true);
    });
  });

  // ──────────────────────────────────────────────
  // evaluate() integration
  // ──────────────────────────────────────────────
  describe('evaluate() integration', () => {
    it('should return approved with [APPROVED] marker', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.evaluate('Great work.\n\n[APPROVED]', { currentRound: 2, previousOutputs: [] });
      expect(result.classification).toBe('approved');
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('approved');
      expect(result.loopDetected).toBe(false);
    });

    it('should soft_approve without [APPROVED] marker when text says LGTM', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.evaluate('LGTM!', { currentRound: 2, previousOutputs: [] });
      expect(result.classification).toBe('soft_approved');
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('soft_approved');
    });

    it('should return changes_requested with continue', () => {
      const svc = new ConvergenceService({ maxRounds: 5 });
      const result = svc.evaluate('Fix the bug on line 10.', { currentRound: 2, previousOutputs: [] });
      expect(result.classification).toBe('changes_requested');
      expect(result.shouldTerminate).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.loopDetected).toBe(false);
    });

    it('should set max_rounds reason when loop and max_rounds both apply', () => {
      const svc = new ConvergenceService({ maxRounds: 3 });
      const result = svc.evaluate(
        'Fix the null check.',
        {
          currentRound: 3,
          previousOutputs: ['Fix the null check.'],
        },
      );
      // max_rounds takes priority over loop_detected
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('max_rounds');
      expect(result.loopDetected).toBe(true);
    });

    it('should terminate on diminishing issues when all blocking resolved', () => {
      const svc = new ConvergenceService({ maxRounds: 10 });
      const result = svc.evaluate(
        'All previous blocking issues are now fixed. Just a minor style suggestion: consider renaming the variable.',
        {
          currentRound: 3,
          previousOutputs: [
            '**Blocking**: Missing error handling\n[CHANGES_REQUESTED]',
            '**Blocking**: Incorrect return type\n[CHANGES_REQUESTED]',
          ],
        },
      );
      expect(result.issueCount).toBe(0);
      expect(result.progressTrend).toBe('improving');
      expect(result.shouldTerminate).toBe(true);
      expect(result.reason).toBe('diminishing_issues');
    });
  });
});

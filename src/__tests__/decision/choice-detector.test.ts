/**
 * Tests for ChoiceDetector — FR-006 (AC-020, AC-021, AC-022, AC-023)
 */

import { describe, test, expect } from 'vitest';
import {
  ChoiceDetector,
  type ChoiceDetectionResult,
} from '../../decision/choice-detector.js';

describe('ChoiceDetector', () => {
  const detector = new ChoiceDetector();

  // ── AC-021: Regex detection covers common patterns ──

  describe('detect()', () => {
    // A/B/C pattern
    test('detects A/B/C style choices', () => {
      const text = `Which approach should we use?
A. Use a factory pattern
B. Use a builder pattern
C. Use a singleton pattern`;
      const result = detector.detect(text);
      expect(result.detected).toBe(true);
      expect(result.choices.length).toBeGreaterThanOrEqual(2);
    });

    test('detects A) B) C) style choices', () => {
      const text = `How should I implement this?
A) Inline implementation
B) Extract to helper
C) Use existing utility`;
      const result = detector.detect(text);
      expect(result.detected).toBe(true);
    });

    // 1/2/3 numbered list pattern
    test('detects numbered list choices (1. 2. 3.)', () => {
      const text = `I see a few options here:
1. Refactor the entire module
2. Add a wrapper function
3. Keep as-is with minor fixes`;
      const result = detector.detect(text);
      expect(result.detected).toBe(true);
      expect(result.choices.length).toBeGreaterThanOrEqual(2);
    });

    test('detects numbered list with parentheses (1) 2) 3))', () => {
      const text = `Which one do you prefer?
1) Add error handling
2) Return early on invalid input
3) Throw an exception`;
      const result = detector.detect(text);
      expect(result.detected).toBe(true);
    });

    // 方案一/方案二 Chinese pattern
    test('detects 方案一/方案二 pattern', () => {
      const text = `有两种方式可以实现：
方案一：使用 EventEmitter
方案二：使用 Callback
你觉得哪个好？`;
      const result = detector.detect(text);
      expect(result.detected).toBe(true);
      expect(result.choices.length).toBeGreaterThanOrEqual(2);
    });

    // Option 1/Option 2 pattern
    test('detects Option 1/Option 2 pattern', () => {
      const text = `There are two options:
Option 1: Use REST API
Option 2: Use GraphQL
Which would you prefer?`;
      const result = detector.detect(text);
      expect(result.detected).toBe(true);
    });

    // Non-choice content should NOT be detected
    test('does not detect regular code output', () => {
      const text = `Here is the implementation:
\`\`\`typescript
const items = list.map((item, index) => {
  return { id: index + 1, name: item };
});
\`\`\``;
      const result = detector.detect(text);
      expect(result.detected).toBe(false);
      expect(result.choices).toEqual([]);
    });

    test('does not detect numbered steps (no question)', () => {
      const text = `I'll implement this in 3 steps:
1. Create the interface
2. Implement the class
3. Add error handling`;
      const result = detector.detect(text);
      expect(result.detected).toBe(false);
    });

    test('does not detect single question without choices', () => {
      const text = 'The code looks good overall. Should we add more tests?';
      const result = detector.detect(text);
      expect(result.detected).toBe(false);
    });

    test('extracts choice text from detected options', () => {
      const text = `Which database should we use?
A. PostgreSQL
B. MySQL`;
      const result = detector.detect(text);
      expect(result.detected).toBe(true);
      expect(result.choices).toContain('PostgreSQL');
      expect(result.choices).toContain('MySQL');
    });

    // Question mark + list combination
    test('detects question mark followed by bullet list', () => {
      const text = `Which strategy do you want?
- Strategy Alpha: event-driven
- Strategy Beta: polling-based`;
      const result = detector.detect(text);
      expect(result.detected).toBe(true);
    });

    test('extracts original question text', () => {
      const text = `Which approach should we take?
A. Approach one
B. Approach two`;
      const result = detector.detect(text);
      expect(result.detected).toBe(true);
      expect(result.question).toContain('Which approach');
    });
  });

  // ── AC-022: Routing judgment <= 2 seconds ──

  describe('performance', () => {
    test('detection completes within 2 seconds', () => {
      const longText = 'Some long output. '.repeat(10000) + `
Which option?
A. First
B. Second`;
      const start = performance.now();
      detector.detect(longText);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(2000);
    });
  });

  // ── Forward prompt construction ──

  describe('buildForwardPrompt()', () => {
    test('includes original question in forward prompt', () => {
      const result: ChoiceDetectionResult = {
        detected: true,
        choices: ['Use REST', 'Use GraphQL'],
        question: 'Which API style should we use?',
      };
      const prompt = detector.buildForwardPrompt(result, 'Build a user API');
      expect(prompt).toContain('Which API style should we use?');
    });

    test('includes choices in forward prompt', () => {
      const result: ChoiceDetectionResult = {
        detected: true,
        choices: ['REST', 'GraphQL'],
        question: 'Which one?',
      };
      const prompt = detector.buildForwardPrompt(result, 'Build API');
      expect(prompt).toContain('REST');
      expect(prompt).toContain('GraphQL');
    });

    test('includes task context in forward prompt', () => {
      const result: ChoiceDetectionResult = {
        detected: true,
        choices: ['A', 'B'],
        question: 'Which?',
      };
      const prompt = detector.buildForwardPrompt(result, 'Implement login');
      expect(prompt).toContain('Implement login');
    });

    test('instructs direct choice without questions', () => {
      const result: ChoiceDetectionResult = {
        detected: true,
        choices: ['X', 'Y'],
        question: 'Which?',
      };
      const prompt = detector.buildForwardPrompt(result, 'Task');
      expect(prompt).toMatch(/choice number/i);
      expect(prompt).toContain('不要提问');
      expect(prompt).toMatch(/do not ask/i);
    });
  });

  // ── AC-023: User can override misdetection ──

  describe('override support', () => {
    test('detection result has detected=false for non-choice text', () => {
      const result = detector.detect('Just a normal statement.');
      expect(result.detected).toBe(false);
      // User override: when detected=false, no routing happens.
      // When detected=true (misdetection), user can override by sending USER_INPUT
      // to the state machine, bypassing the CHOICE_DETECTED route.
    });

    test('detection result is a plain object usable for override decisions', () => {
      const result = detector.detect('Pick A or B?');
      // Result is serializable — UI layer can present override option
      expect(typeof result.detected).toBe('boolean');
      expect(Array.isArray(result.choices)).toBe(true);
    });
  });
});

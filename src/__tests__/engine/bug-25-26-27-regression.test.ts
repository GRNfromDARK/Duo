/**
 * Regression tests for BUG-25, BUG-26, BUG-27.
 *
 * BUG-25 [P1]: CODE_INSTRUCTIONS must require writing tests for new functionality.
 *   Coder implemented 14 files without any new tests. Phase-4 self-check ran only
 *   existing tests (all pass) and declared "no issues" — reviewer then found 3 blockers.
 *
 * BUG-26 [P2]: God must not exclude user-named scope items.
 *   User said "upgrade coder, reviewer, god" — God's MVP excluded godModel.
 *   System recovered via reviewer, but wasted a fix cycle.
 *
 * BUG-27 [P3]: When skipping phases via multiple set_phase, God should explain.
 */

import { describe, it, expect } from 'vitest';
import { generateCoderPrompt } from '../../god/god-prompt-generator.js';
import {
  SYSTEM_PROMPT,
  PHASE_FOLLOWING_INSTRUCTIONS,
} from '../../god/god-decision-service.js';

// ══════════════════════════════════════════════════════════════════
// BUG-25: CODE_INSTRUCTIONS must require test writing
// ══════════════════════════════════════════════════════════════════

describe('BUG-25: code phase prompt requires writing tests for new functionality', () => {
  it('code-type prompt contains test-writing requirement', () => {
    const prompt = generateCoderPrompt({
      taskType: 'code',
      round: 1,
      maxRounds: 10,
      taskGoal: 'Implement model selection feature',
    });

    // Must tell coder to write tests, not just run existing ones
    expect(prompt.toLowerCase()).toMatch(/write.*test|test.*new.*func|test.*cover/i);
  });

  it('compound code phase prompt also contains test-writing requirement', () => {
    const prompt = generateCoderPrompt({
      taskType: 'compound',
      round: 1,
      maxRounds: 10,
      taskGoal: 'Implement model selection feature',
      phaseType: 'code',
      phaseId: 'phase-3',
    });

    expect(prompt.toLowerCase()).toMatch(/write.*test|test.*new.*func|test.*cover/i);
  });

  it('explore-type prompt does NOT require writing tests', () => {
    const prompt = generateCoderPrompt({
      taskType: 'explore',
      round: 0,
      maxRounds: 10,
      taskGoal: 'Explore codebase',
    });

    // Explore phase should not mention writing tests
    expect(prompt).not.toMatch(/Write tests for new/i);
  });
});

// ══════════════════════════════════════════════════════════════════
// BUG-26: God must not exclude user-named scope items
// ══════════════════════════════════════════════════════════════════

describe('BUG-26: God system prompt prevents excluding user-named scope', () => {
  it('system prompt instructs God to include all user-named items in scope', () => {
    // Must tell God: if user names specific roles/components, include them all
    expect(SYSTEM_PROMPT).toMatch(/named|explicit|listed/i);
    expect(SYSTEM_PROMPT).toMatch(/must.*include|not.*exclude|all.*named/i);
  });
});

// ══════════════════════════════════════════════════════════════════
// BUG-27: Phase skip must be explained
// ══════════════════════════════════════════════════════════════════

describe('BUG-27: phase-following instructions require explanation for phase skips', () => {
  it('phase instructions mention explaining phase skips in system_log', () => {
    expect(PHASE_FOLLOWING_INSTRUCTIONS.toLowerCase()).toMatch(
      /skip.*explain|skip.*system_log|skip.*reason|one.*set_phase/i,
    );
  });
});

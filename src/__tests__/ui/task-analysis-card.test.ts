/**
 * Tests for TaskAnalysisCard state logic.
 * Card F.1: TaskAnalysisCard 意图回显
 */

import { describe, it, expect } from 'vitest';
import type { GodTaskAnalysis } from '../../types/god-schemas.js';
import {
  createTaskAnalysisCardState,
  handleKeyPress,
  tickCountdown,
  TASK_TYPE_LIST,
} from '../../ui/task-analysis-card.js';

const sampleAnalysis: GodTaskAnalysis = {
  taskType: 'code',
  reasoning: 'User wants to implement a new feature',
  phases: [
    { id: 'p1', name: 'Implementation', type: 'code', description: 'Write the code' },
    { id: 'p2', name: 'Testing', type: 'review', description: 'Review the code' },
  ],
  confidence: 0.85,
  suggestedMaxRounds: 5,
  terminationCriteria: ['All tests pass', 'No blocking issues'],
};

describe('createTaskAnalysisCardState', () => {
  it('should create initial state with correct defaults', () => {
    const state = createTaskAnalysisCardState(sampleAnalysis);

    expect(state.analysis).toBe(sampleAnalysis);
    expect(state.selectedType).toBe('code'); // matches analysis.taskType
    expect(state.countdown).toBe(8);
    expect(state.countdownPaused).toBe(false);
    expect(state.confirmed).toBe(false);
  });

  it('should set selectedType to analysis taskType', () => {
    const debugAnalysis: GodTaskAnalysis = {
      ...sampleAnalysis,
      taskType: 'debug',
    };
    const state = createTaskAnalysisCardState(debugAnalysis);
    expect(state.selectedType).toBe('debug');
  });

  it('should create state in < 200ms (AC-1)', () => {
    const start = performance.now();
    createTaskAnalysisCardState(sampleAnalysis);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});

describe('tickCountdown', () => {
  it('should decrement countdown by 1', () => {
    const state = createTaskAnalysisCardState(sampleAnalysis);
    const next = tickCountdown(state);
    expect(next.countdown).toBe(7);
    expect(next.confirmed).toBe(false);
  });

  it('should auto-confirm when countdown reaches 0 (AC-2)', () => {
    let state = createTaskAnalysisCardState(sampleAnalysis);
    // Tick 8 times to reach 0
    for (let i = 0; i < 8; i++) {
      state = tickCountdown(state);
    }
    expect(state.countdown).toBe(0);
    expect(state.confirmed).toBe(true);
    expect(state.selectedType).toBe('code'); // recommended type
  });

  it('should not tick below 0', () => {
    let state = createTaskAnalysisCardState(sampleAnalysis);
    for (let i = 0; i < 10; i++) {
      state = tickCountdown(state);
    }
    expect(state.countdown).toBe(0);
    expect(state.confirmed).toBe(true);
  });

  it('should not tick when paused', () => {
    let state = createTaskAnalysisCardState(sampleAnalysis);
    state = { ...state, countdownPaused: true };
    const next = tickCountdown(state);
    expect(next.countdown).toBe(8);
    expect(next.confirmed).toBe(false);
  });

  it('should not tick when already confirmed', () => {
    let state = createTaskAnalysisCardState(sampleAnalysis);
    state = { ...state, confirmed: true, countdown: 3 };
    const next = tickCountdown(state);
    expect(next.countdown).toBe(3);
  });
});

describe('handleKeyPress — arrow keys (AC-3)', () => {
  it('should move selection down with arrow_down', () => {
    const state = createTaskAnalysisCardState(sampleAnalysis);
    const codeIndex = TASK_TYPE_LIST.indexOf('code');
    const next = handleKeyPress(state, 'arrow_down');

    expect(next.selectedType).toBe(TASK_TYPE_LIST[codeIndex + 1]);
    expect(next.countdownPaused).toBe(true);
  });

  it('should move selection up with arrow_up', () => {
    let state = createTaskAnalysisCardState(sampleAnalysis);
    // Move down first, then back up
    state = handleKeyPress(state, 'arrow_down');
    const next = handleKeyPress(state, 'arrow_up');

    expect(next.selectedType).toBe('code');
    expect(next.countdownPaused).toBe(true);
  });

  it('should wrap around at bottom', () => {
    // Start at last type
    const analysis: GodTaskAnalysis = {
      ...sampleAnalysis,
      taskType: TASK_TYPE_LIST[TASK_TYPE_LIST.length - 1],
    };
    const state = createTaskAnalysisCardState(analysis);
    const next = handleKeyPress(state, 'arrow_down');

    expect(next.selectedType).toBe(TASK_TYPE_LIST[0]);
  });

  it('should wrap around at top', () => {
    const analysis: GodTaskAnalysis = {
      ...sampleAnalysis,
      taskType: TASK_TYPE_LIST[0],
    };
    const state = createTaskAnalysisCardState(analysis);
    const next = handleKeyPress(state, 'arrow_up');

    expect(next.selectedType).toBe(TASK_TYPE_LIST[TASK_TYPE_LIST.length - 1]);
  });

  it('should pause countdown on arrow key', () => {
    const state = createTaskAnalysisCardState(sampleAnalysis);
    expect(state.countdownPaused).toBe(false);

    const next = handleKeyPress(state, 'arrow_down');
    expect(next.countdownPaused).toBe(true);
  });
});

describe('handleKeyPress — number keys (AC-4)', () => {
  it('should select and confirm with key 1', () => {
    const state = createTaskAnalysisCardState(sampleAnalysis);
    const next = handleKeyPress(state, '1');

    expect(next.selectedType).toBe(TASK_TYPE_LIST[0]);
    expect(next.confirmed).toBe(true);
  });

  it('should select and confirm with key 2', () => {
    const state = createTaskAnalysisCardState(sampleAnalysis);
    const next = handleKeyPress(state, '2');

    expect(next.selectedType).toBe(TASK_TYPE_LIST[1]);
    expect(next.confirmed).toBe(true);
  });

  it('should select and confirm with key 3', () => {
    const state = createTaskAnalysisCardState(sampleAnalysis);
    const next = handleKeyPress(state, '3');

    expect(next.selectedType).toBe(TASK_TYPE_LIST[2]);
    expect(next.confirmed).toBe(true);
  });

  it('should select and confirm with key 4', () => {
    const state = createTaskAnalysisCardState(sampleAnalysis);
    const next = handleKeyPress(state, '4');

    expect(next.selectedType).toBe(TASK_TYPE_LIST[3]);
    expect(next.confirmed).toBe(true);
  });

  it('should ignore number keys > list length', () => {
    const state = createTaskAnalysisCardState(sampleAnalysis);
    const next = handleKeyPress(state, '9');

    expect(next.selectedType).toBe(state.selectedType);
    expect(next.confirmed).toBe(false);
  });
});

describe('handleKeyPress — enter', () => {
  it('should confirm current selection on enter', () => {
    const state = createTaskAnalysisCardState(sampleAnalysis);
    const next = handleKeyPress(state, 'enter');

    expect(next.confirmed).toBe(true);
    expect(next.selectedType).toBe('code');
  });

  it('should confirm modified selection on enter', () => {
    let state = createTaskAnalysisCardState(sampleAnalysis);
    state = handleKeyPress(state, 'arrow_down');
    const next = handleKeyPress(state, 'enter');

    expect(next.confirmed).toBe(true);
    const codeIndex = TASK_TYPE_LIST.indexOf('code');
    expect(next.selectedType).toBe(TASK_TYPE_LIST[codeIndex + 1]);
  });
});

describe('handleKeyPress — space', () => {
  it('should confirm with recommended type on space', () => {
    let state = createTaskAnalysisCardState(sampleAnalysis);
    // Change selection first
    state = handleKeyPress(state, 'arrow_down');
    expect(state.selectedType).not.toBe('code');

    const next = handleKeyPress(state, 'space');
    expect(next.confirmed).toBe(true);
    expect(next.selectedType).toBe('code'); // back to recommended
  });
});

describe('handleKeyPress — already confirmed', () => {
  it('should ignore all keys when already confirmed', () => {
    let state = createTaskAnalysisCardState(sampleAnalysis);
    state = handleKeyPress(state, 'enter'); // confirm
    expect(state.confirmed).toBe(true);

    const afterArrow = handleKeyPress(state, 'arrow_down');
    expect(afterArrow).toEqual(state);

    const afterNumber = handleKeyPress(state, '1');
    expect(afterNumber).toEqual(state);

    const afterEnter = handleKeyPress(state, 'enter');
    expect(afterEnter).toEqual(state);
  });
});

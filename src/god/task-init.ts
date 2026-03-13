/**
 * God TASK_INIT service — intent parsing + task classification + dynamic rounds.
 * Source: FR-001 (AC-001, AC-002, AC-003), FR-002 (AC-008, AC-009), FR-007 (AC-023, AC-024)
 */

import type { GodAdapter } from '../types/god-adapter.js';
import type { GodTaskAnalysis } from '../types/god-schemas.js';
import { GodTaskAnalysisSchema } from '../types/god-schemas.js';
import { extractWithRetry } from '../parsers/god-json-extractor.js';
import { collectGodAdapterOutput } from './god-call.js';

export interface TaskInitResult {
  analysis: GodTaskAnalysis;
  rawOutput: string;
}

// ── Task type → round range mapping (AC-023) ──

const ROUND_RANGES: Record<string, { min: number; max: number }> = {
  explore: { min: 2, max: 5 },
  code: { min: 3, max: 10 },
  review: { min: 1, max: 3 },
  debug: { min: 2, max: 6 },
  discuss: { min: 2, max: 5 },
  // compound: no fixed range, passes through
};

/**
 * Validate and clamp suggestedMaxRounds to the allowed range for a task type.
 * compound type passes through without clamping.
 */
export function validateRoundsForType(taskType: string, rounds: number): number {
  const range = ROUND_RANGES[taskType];
  if (!range) return rounds; // compound or unknown → pass through
  return Math.max(range.min, Math.min(range.max, rounds));
}

/**
 * Apply dynamic rounds adjustment at runtime.
 * Clamps the suggested value to the task type's allowed range.
 */
export function applyDynamicRounds(
  currentMax: number,
  suggested: number,
  taskType: string,
): number {
  return validateRoundsForType(taskType, suggested);
}

/** God calls should respond quickly — timeout after 30s to trigger degradation */
const GOD_TIMEOUT_MS = 30_000;

/**
 * Initialize a task via the God adapter: send the task prompt with system prompt,
 * extract and validate the GodTaskAnalysis JSON from the output.
 *
 * Uses extractWithRetry: on schema validation failure, retries once with error hint.
 * Returns null if extraction/validation ultimately fails (caller decides fallback).
 */
export async function initializeTask(
  godAdapter: GodAdapter,
  taskPrompt: string,
  systemPrompt: string,
  projectDir?: string,
): Promise<TaskInitResult | null> {
  const rawOutput = await collectGodAdapterOutput({
    adapter: godAdapter,
    prompt: taskPrompt,
    systemPrompt,
    projectDir,
    timeoutMs: GOD_TIMEOUT_MS,
  });

  const result = await extractWithRetry(
    rawOutput,
    GodTaskAnalysisSchema,
    async (errorHint: string) => {
      // Retry with error hint appended to the prompt
      const retryPrompt = `${taskPrompt}\n\n[FORMAT ERROR] Your previous output had a schema validation error:\n${errorHint}\n\nPlease output a corrected JSON block.`;
      return collectGodAdapterOutput({
        adapter: godAdapter,
        prompt: retryPrompt,
        systemPrompt,
        projectDir,
        timeoutMs: GOD_TIMEOUT_MS,
      });
    },
  );

  if (!result || !result.success) {
    return null;
  }

  return {
    analysis: result.data,
    rawOutput: result.sourceOutput ?? rawOutput,
  };
}

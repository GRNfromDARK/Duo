/**
 * God Context Manager — incremental prompt management for God.
 * Source: FR-012 (AC-037, AC-038), AR-006
 *
 * Core principle: God CLI maintains conversation history via --resume.
 * Duo only sends incremental information each round, not full history.
 * When context window is exhausted, rebuild session with convergenceLog summary.
 */

import type { ConvergenceLogEntry } from './god-convergence.js';

// ── Constants ──

/** Approximate chars per token for estimation */
export const CHARS_PER_TOKEN = 4;

/** Max God prompt size in tokens (AC-037) */
const MAX_PROMPT_TOKENS = 10_000;
const MAX_PROMPT_CHARS = MAX_PROMPT_TOKENS * CHARS_PER_TOKEN;

/** Threshold ratio for session rebuild trigger */
const REBUILD_THRESHOLD = 0.9;

/** Max chars for coder/reviewer output sections in incremental prompt */
const MAX_OUTPUT_SECTION_CHARS = 15_000;

// ── GodContextManager ──

export class GodContextManager {
  /**
   * Build an incremental prompt for God containing only the latest round's data
   * plus a concise trend summary. Does NOT include full history (AC-037).
   */
  buildIncrementalPrompt(params: {
    latestCoderOutput: string;
    latestReviewerOutput?: string;
    convergenceLog: ConvergenceLogEntry[];
    round: number;
  }): string {
    const sections: string[] = [];

    sections.push(`## Round ${params.round} Update`);

    // Latest Coder output (truncated if needed)
    const coderOutput = truncate(params.latestCoderOutput, MAX_OUTPUT_SECTION_CHARS);
    sections.push(`## Latest Coder Output\n${coderOutput}`);

    // Latest Reviewer output (if available)
    if (params.latestReviewerOutput) {
      const reviewerOutput = truncate(params.latestReviewerOutput, MAX_OUTPUT_SECTION_CHARS);
      sections.push(`## Latest Reviewer Output\n${reviewerOutput}`);
    }

    // Trend summary (concise, not full history)
    if (params.convergenceLog.length > 0) {
      const trend = this.buildTrendSummary(params.convergenceLog);
      sections.push(`## Convergence Trend\n${trend}`);
    }

    let prompt = sections.join('\n\n');

    // Enforce AC-037: < 10k tokens
    if (prompt.length > MAX_PROMPT_CHARS) {
      prompt = prompt.slice(0, MAX_PROMPT_CHARS - 3) + '...';
    }

    return prompt;
  }

  /**
   * Build a concise trend summary from convergenceLog.
   * Shows blocking issue count trend and criteria progress, not full entries.
   */
  buildTrendSummary(convergenceLog: ConvergenceLogEntry[]): string {
    if (convergenceLog.length === 0) return '';

    const parts: string[] = [];

    // Blocking issue count trend: "5→3→1"
    const counts = convergenceLog.map(e => e.blockingIssueCount);
    const trendLine = `Blocking issues: ${counts.join('→')}`;
    parts.push(trendLine);

    // Classify overall trend
    const trend = classifyTrend(counts);
    parts.push(`Trend: ${trend}`);

    // Latest criteria progress
    const latest = convergenceLog[convergenceLog.length - 1];
    if (latest.criteriaProgress.length > 0) {
      const satisfied = latest.criteriaProgress.filter(c => c.satisfied).length;
      const total = latest.criteriaProgress.length;
      parts.push(`Criteria: ${satisfied}/${total} satisfied`);
    }

    return parts.join('\n');
  }

  /**
   * Check if God session should be rebuilt due to context window exhaustion.
   * Returns true when tokenEstimate reaches REBUILD_THRESHOLD of limit.
   */
  shouldRebuildSession(tokenEstimate: number, limit: number): boolean {
    return tokenEstimate >= limit * REBUILD_THRESHOLD;
  }

  /**
   * Build a prompt for starting a new God session after context window exhaustion.
   * Contains convergenceLog summary for decision continuity (AC-038).
   */
  buildSessionRebuildPrompt(convergenceLog: ConvergenceLogEntry[]): string {
    const sections: string[] = [];

    sections.push('## Session Rebuild — Context Restored');
    sections.push('This is a session continuation. Previous context was exhausted and rebuilt from convergence history.');

    if (convergenceLog.length === 0) {
      sections.push('No prior convergence history available.');
      return sections.join('\n\n');
    }

    const lastRound = convergenceLog[convergenceLog.length - 1].round;
    sections.push(`## Progress (up to round ${lastRound})`);

    // Trend summary
    const trend = this.buildTrendSummary(convergenceLog);
    sections.push(trend);

    // Latest criteria detail
    const latest = convergenceLog[convergenceLog.length - 1];
    if (latest.criteriaProgress.length > 0) {
      const criteriaLines = latest.criteriaProgress
        .map(c => `- ${c.satisfied ? '✓' : '✗'} ${c.criterion}`)
        .join('\n');
      sections.push(`## Criteria Status\n${criteriaLines}`);
    }

    // Last classification
    sections.push(`Last classification: ${latest.classification}`);

    return sections.join('\n\n');
  }
}

// ── Internal helpers ──

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + '...';
}

function classifyTrend(counts: number[]): string {
  if (counts.length < 2) return 'insufficient data';

  const last = counts[counts.length - 1];
  const first = counts[0];

  // Check if all values are the same
  if (counts.every(c => c === counts[0])) return 'stagnant';

  if (last < first) return 'improving';
  if (last > first) return 'declining';

  // first === last but intermediate values differ — detect oscillation
  // Count direction changes to identify volatile/oscillating patterns
  let directionChanges = 0;
  for (let i = 2; i < counts.length; i++) {
    const prevDir = Math.sign(counts[i - 1] - counts[i - 2]);
    const currDir = Math.sign(counts[i] - counts[i - 1]);
    if (prevDir !== 0 && currDir !== 0 && prevDir !== currDir) {
      directionChanges++;
    }
  }
  if (directionChanges > 0) return 'oscillating';

  return 'stagnant';
}

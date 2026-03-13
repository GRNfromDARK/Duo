/**
 * God Prompt Generator — dynamic prompt generation for Coder/Reviewer per round.
 * Replaces ContextManager's prompt building for God-orchestrated sessions.
 * Source: FR-003 (AC-013, AC-014, AC-015), FR-003a, FR-003b, FR-003c
 */

import type { GodAuditEntry } from './god-audit.js';
import { appendAuditLog } from './god-audit.js';
import type { ConvergenceLogEntry } from './god-convergence.js';

// ── Types ──

export type { ConvergenceLogEntry };

export interface PromptContext {
  taskType: 'explore' | 'code' | 'discuss' | 'review' | 'debug' | 'compound';
  round: number;
  maxRounds: number;
  taskGoal: string;
  phaseId?: string;
  /** For compound type: the current phase's effective type */
  phaseType?: 'explore' | 'code' | 'discuss' | 'review' | 'debug';
  lastReviewerOutput?: string;
  unresolvedIssues?: string[];
  suggestions?: string[];
  convergenceLog?: ConvergenceLogEntry[];
  lastCoderOutput?: string;
  /** God auto-decision instruction (highest priority) */
  instruction?: string;
}

export interface GodDecisionContext {
  decisionPoint: 'POST_CODER' | 'POST_REVIEWER' | 'CONVERGENCE';
  round: number;
  maxRounds: number;
  taskGoal: string;
  lastCoderOutput?: string;
  lastReviewerOutput?: string;
  unresolvedIssues?: string[];
  convergenceLog?: ConvergenceLogEntry[];
}

export interface AuditOptions {
  sessionDir: string;
  seq: number;
}

// ── Constants ──

/** Maximum prompt length in characters (AC-014) */
export const MAX_PROMPT_LENGTH = 100_000;

const MAX_AUDIT_SUMMARY = 500;

// ── Task-type strategy templates (FR-003a) ──

const EXPLORE_INSTRUCTIONS = `## Instructions
- Analyze the codebase and provide findings, recommendations, and suggestions.
- Investigate the relevant files and explore possible approaches.
- Examine the current state and suggest improvements.
- Do NOT modify any files. Do NOT execute any code changes.
- Recommend solutions but do not apply them.`;

const CODE_INSTRUCTIONS = `## Instructions
- Implement the required changes following clean code principles.
- Write robust, correct code with appropriate error handling.
- Ensure quality by considering edge cases and writing testable code.
- Build working solutions, not explanations.
- Do not ask questions. Decide autonomously and develop directly.`;

const REVIEW_INSTRUCTIONS = `## Instructions
- Review the code changes against the task requirements.
- Check for bugs, logic errors, security issues, and missing requirements.
- Examine each file methodically and audit for correctness.
- Inspect edge cases and error handling.`;

const DEBUG_INSTRUCTIONS = `## Instructions
- Diagnose the reported issue by tracing through the code path.
- Identify the root cause of the bug or failure.
- Fix the issue with a minimal, targeted change.
- Verify the fix addresses the problem without side effects.`;

const DISCUSS_INSTRUCTIONS = `## Instructions
- Consider the tradeoffs of each approach carefully.
- Discuss the pros and cons of different solutions.
- Evaluate the options and weigh their implications.
- Provide a well-reasoned recommendation.`;

function getStrategyInstructions(taskType: string): string {
  switch (taskType) {
    case 'explore': return EXPLORE_INSTRUCTIONS;
    case 'code': return CODE_INSTRUCTIONS;
    case 'review': return REVIEW_INSTRUCTIONS;
    case 'debug': return DEBUG_INSTRUCTIONS;
    case 'discuss': return DISCUSS_INSTRUCTIONS;
    default: return CODE_INSTRUCTIONS;
  }
}

// ── Prompt generators ──

/**
 * Generate a Coder prompt based on task type and reviewer feedback (FR-003b priority order).
 * Optionally writes a summary to audit log (FR-003c / AC-015).
 */
export function generateCoderPrompt(ctx: PromptContext, audit?: AuditOptions): string {
  // For compound type, use phaseType to determine strategy (FR-003a)
  const effectiveType = ctx.taskType === 'compound' && ctx.phaseType
    ? ctx.phaseType
    : ctx.taskType;

  const sections: string[] = [];

  // Task goal (priority 3)
  sections.push(`## Task\n${ctx.taskGoal}`);

  // Phase info for compound type
  if (ctx.taskType === 'compound' && ctx.phaseId) {
    sections.push(`## Current Phase\nPhase: ${ctx.phaseId} (type: ${ctx.phaseType ?? 'unknown'})`);
  }

  // Priority 0: God auto-decision instruction (highest priority)
  if (ctx.instruction) {
    sections.push(`## God Instruction (HIGHEST PRIORITY)\n${ctx.instruction}`);
  }

  // Priority 1: unresolvedIssues (highest - Reviewer-Driven)
  if (ctx.unresolvedIssues && ctx.unresolvedIssues.length > 0) {
    const issueList = ctx.unresolvedIssues
      .map((issue, i) => `${i + 1}. ${issue}`)
      .join('\n');
    sections.push(`## Required Fixes (MUST address each item)\n${issueList}`);
  }

  // Priority 2: suggestions (non-blocking)
  if (ctx.suggestions && ctx.suggestions.length > 0) {
    const suggestionList = ctx.suggestions
      .map((s, i) => `${i + 1}. ${s}`)
      .join('\n');
    sections.push(`## Suggestions (non-blocking, consider but not required)\n${suggestionList}`);
  }

  // Priority 3: convergenceLog trend
  if (ctx.convergenceLog && ctx.convergenceLog.length > 0) {
    const latest = ctx.convergenceLog[ctx.convergenceLog.length - 1];
    const trendDesc = latest.classification === 'approved'
      ? 'Progress is improving — reviewer approved.'
      : latest.shouldTerminate
        ? 'Progress is converging — termination recommended.'
        : 'Progress is ongoing — unresolved issues remain.';
    sections.push(`## Convergence Trend\n${trendDesc} (${latest.blockingIssueCount} blocking in round ${latest.round})`);
  }

  // Strategy instructions based on task type (FR-003a)
  sections.push(getStrategyInstructions(effectiveType));

  // Priority 4: round info
  sections.push(`## Round Info\nRound ${ctx.round} of ${ctx.maxRounds}`);

  let prompt = sections.join('\n\n');

  // Enforce length limit (AC-014)
  prompt = enforceMaxLength(prompt);

  // Write audit log (AC-015 / FR-003c)
  if (audit) {
    const summary = prompt.length > MAX_AUDIT_SUMMARY
      ? prompt.slice(0, MAX_AUDIT_SUMMARY)
      : prompt;
    const entry: GodAuditEntry = {
      seq: audit.seq,
      timestamp: new Date().toISOString(),
      round: ctx.round,
      decisionType: 'PROMPT_GENERATION',
      inputSummary: `taskType=${ctx.taskType}, round=${ctx.round}/${ctx.maxRounds}`,
      outputSummary: summary,
      decision: { promptType: 'coder', taskType: ctx.taskType, effectiveType },
    };
    appendAuditLog(audit.sessionDir, entry);
  }

  return prompt;
}

/**
 * Generate a Reviewer prompt for the current round.
 */
export function generateReviewerPrompt(ctx: {
  taskType: string;
  round: number;
  maxRounds: number;
  taskGoal: string;
  lastCoderOutput?: string;
  phaseId?: string;
  phaseType?: 'explore' | 'code' | 'discuss' | 'review' | 'debug';
  instruction?: string;
}): string {
  // For compound type, use phaseType to determine effective review focus (FR-003a)
  const effectiveType = ctx.taskType === 'compound' && ctx.phaseType
    ? ctx.phaseType
    : ctx.taskType;

  const sections: string[] = [];

  sections.push(`## Task\n${ctx.taskGoal}`);

  // Phase info for compound type
  if (ctx.taskType === 'compound' && ctx.phaseId) {
    sections.push(`## Current Phase\nPhase: ${ctx.phaseId} (type: ${ctx.phaseType ?? 'unknown'})`);
  }

  // Priority 0: God auto-decision / user interrupt instruction (highest priority)
  if (ctx.instruction) {
    sections.push(`## God Instruction (HIGHEST PRIORITY)\n${ctx.instruction}`);
  }

  if (ctx.lastCoderOutput) {
    sections.push(`## Coder Output (Round ${ctx.round})\n${ctx.lastCoderOutput}`);
  }

  // Phase-aware review instructions
  if (effectiveType === 'explore') {
    sections.push(`## Review Instructions
- Review the Coder's exploration output against the task requirements.
- Verify findings are thorough and recommendations are well-supported.
- Check that no files were modified — exploration should be read-only.
- Identify gaps in analysis or missing areas of investigation.
- State Blocking count explicitly.
- End with [APPROVED] or [CHANGES_REQUESTED].`);
  } else {
    sections.push(`## Review Instructions
- Review the Coder's output against the task requirements.
- Identify blocking issues (bugs, logic errors, missing requirements, security issues).
- Identify non-blocking suggestions (style, naming, minor improvements).
- State Blocking count explicitly.
- End with [APPROVED] or [CHANGES_REQUESTED].`);
  }

  sections.push(`## Round Info\nRound ${ctx.round} of ${ctx.maxRounds}`);

  return enforceMaxLength(sections.join('\n\n'));
}

/**
 * Generate a God decision prompt for routing decisions at POST_CODER/POST_REVIEWER/CONVERGENCE.
 */
export function generateGodDecisionPrompt(ctx: GodDecisionContext): string {
  const sections: string[] = [];

  sections.push(`## Decision Point: ${ctx.decisionPoint}`);
  sections.push(`## Task\n${ctx.taskGoal}`);
  sections.push(`## Round Info\nRound ${ctx.round} of ${ctx.maxRounds}`);

  if (ctx.lastCoderOutput) {
    sections.push(`## Last Coder Output\n${ctx.lastCoderOutput}`);
  }

  if (ctx.lastReviewerOutput) {
    sections.push(`## Last Reviewer Output\n${ctx.lastReviewerOutput}`);
  }

  if (ctx.unresolvedIssues && ctx.unresolvedIssues.length > 0) {
    sections.push(`## Unresolved Issues\n${ctx.unresolvedIssues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}`);
  }

  if (ctx.convergenceLog && ctx.convergenceLog.length > 0) {
    const log = ctx.convergenceLog
      .map(e => `Round ${e.round}: ${e.blockingIssueCount} blocking issues (${e.classification})`)
      .join('\n');
    sections.push(`## Convergence Log\n${log}`);
  }

  return enforceMaxLength(sections.join('\n\n'));
}

// ── Internal helpers ──

function enforceMaxLength(prompt: string): string {
  if (prompt.length <= MAX_PROMPT_LENGTH) return prompt;
  return prompt.slice(0, MAX_PROMPT_LENGTH - 3) + '...';
}

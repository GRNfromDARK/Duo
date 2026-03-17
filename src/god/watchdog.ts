/**
 * WatchdogService — AI-powered error triage for God decision failures.
 *
 * Replaces rule-based degradation (DegradationManager L1-L4) with an AI
 * that analyzes failures and decides the best recovery action.
 *
 * Flow: God fails → Watchdog diagnoses → execute decision → done.
 * Safety net: if Watchdog itself fails → immediate 'escalate'.
 * Max AI calls per decision: God(1) + Watchdog(1) + retry(1) = 3.
 */

import { z } from 'zod';
import type { GodAdapter } from '../types/god-adapter.js';
import type { GodDecisionEnvelope } from '../types/god-envelope.js';
import type { GodAction } from '../types/god-actions.js';
import type { Observation } from '../types/observation.js';
import type { DegradationState } from '../types/degradation.js';
import { collectGodAdapterOutput } from './god-call.js';
import { extractGodJson } from '../parsers/god-json-extractor.js';

// ── Schema ──

const ConstructedActionSchema = z.object({
  actionType: z.string(),
  summary: z.string(),
  userMessage: z.string().optional(),
});

export const WatchdogDecisionSchema = z.object({
  analysis: z.string(),
  decision: z.enum(['retry_fresh', 'retry_with_hint', 'construct_envelope', 'escalate']),
  hint: z.string().optional(),
  constructedAction: ConstructedActionSchema.optional(),
});

export type WatchdogDecision = z.infer<typeof WatchdogDecisionSchema>;

// ── State ──

export interface WatchdogState {
  consecutiveFailures: number;
  godDisabled: boolean;
  lastError?: string;
}

// ── Constants ──

const WATCHDOG_TIMEOUT_MS = 120_000;
const MAX_CONSECUTIVE_FAILURES = 5;

// ── System Prompt ──

export const WATCHDOG_SYSTEM_PROMPT = `You are the Watchdog — a diagnostic AI monitoring the Duo runtime orchestration system.

The God orchestrator (the main decision-maker) just failed to produce a valid decision envelope. Your job: analyze the failure and decide the best recovery action.

## Response Format

Output a single JSON code block:

\`\`\`json
{
  "analysis": "Brief analysis of what went wrong",
  "decision": "retry_fresh | retry_with_hint | construct_envelope | escalate",
  "hint": "(only for retry_with_hint) Specific correction instruction for God",
  "constructedAction": {
    "actionType": "accept_task | send_to_coder | send_to_reviewer | wait | request_user_input",
    "summary": "Action description/rationale",
    "userMessage": "Optional message to show the user"
  }
}
\`\`\`

## Decision Guide

- **retry_fresh**: God's session is polluted or confused. Clear session and retry with full context. Use when: garbled output, wrong format, session-related confusion.
- **retry_with_hint**: God almost got it right but made a specific mistake. Provide a targeted correction in "hint". Use when: structurally correct output with a specific field error (wrong action type name, missing required field).
- **construct_envelope**: You can understand what God intended from the raw output. Construct the correct action. Use when: God's output clearly shows intent (e.g., "task is complete" or "send to coder for X") but envelope format is wrong. Fill "constructedAction" with the correct action.
- **escalate**: Unrecoverable situation. Use when: consecutive failures > 2, completely garbled output with no discernible intent, or systemic issues.

## Action Types for constructedAction

1. **accept_task** — Task is complete, deliver results to user
2. **send_to_coder** — Send work instruction to coder
3. **send_to_reviewer** — Send review instruction to reviewer
4. **wait** — Temporary pause
5. **request_user_input** — Ask user for clarification

Choose the simplest action that matches God's apparent intent.

Do NOT output anything outside the JSON code block.`;

// ── Prompt Builder ──

function buildWatchdogPrompt(
  error: { kind: string; message: string },
  rawOutput: string | null,
  observations: Observation[],
  context: { taskGoal: string; round: number; maxRounds: number },
  consecutiveFailures: number,
): string {
  const sections: string[] = [];

  sections.push(`## Failure Context
Error type: ${error.kind}
Error message: ${error.message}
Consecutive failures: ${consecutiveFailures}
Task: ${context.taskGoal}
Round: ${context.round} of ${context.maxRounds}`);

  if (rawOutput) {
    const truncated = rawOutput.length > 3000
      ? rawOutput.slice(0, 3000) + '\n... (truncated)'
      : rawOutput;
    sections.push(`## God's Raw Output\n${truncated}`);
  } else {
    sections.push('## God\'s Raw Output\n(No output — adapter crashed or timed out)');
  }

  if (observations.length > 0) {
    const obsLines = observations.map((o, i) =>
      `${i + 1}. [${o.severity}] (${o.source}/${o.type}) ${o.summary.slice(0, 500)}`,
    );
    sections.push(`## Current Observations\n${obsLines.join('\n')}`);
  }

  sections.push('Analyze this failure and decide the best recovery action.');
  return sections.join('\n\n');
}

// ── Service ──

export class WatchdogService {
  private readonly adapter: GodAdapter;
  private readonly model?: string;
  private state: WatchdogState;

  constructor(
    adapter: GodAdapter,
    opts?: { model?: string; restoredState?: WatchdogState | DegradationState },
  ) {
    this.adapter = adapter;
    this.model = opts?.model;
    this.state = opts?.restoredState
      ? {
          consecutiveFailures: opts.restoredState.consecutiveFailures,
          godDisabled: opts.restoredState.godDisabled,
          lastError: opts.restoredState.lastError,
        }
      : { consecutiveFailures: 0, godDisabled: false };
  }

  /**
   * Diagnose a God failure and decide recovery action.
   * If Watchdog itself fails, returns 'escalate' (simple safety net).
   */
  async diagnose(
    error: { kind: string; message: string },
    rawOutput: string | null,
    observations: Observation[],
    context: { taskGoal: string; round: number; maxRounds: number },
  ): Promise<WatchdogDecision> {
    this.state.consecutiveFailures++;
    this.state.lastError = error.message;

    // Hard cap: auto-escalate after too many failures
    if (this.state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.state.godDisabled = true;
      return {
        analysis: `${this.state.consecutiveFailures} consecutive failures — disabling God for this session`,
        decision: 'escalate',
      };
    }

    try {
      const prompt = buildWatchdogPrompt(
        error, rawOutput, observations, context,
        this.state.consecutiveFailures,
      );
      const output = await collectGodAdapterOutput({
        adapter: this.adapter,
        prompt,
        systemPrompt: WATCHDOG_SYSTEM_PROMPT,
        timeoutMs: WATCHDOG_TIMEOUT_MS,
        model: this.model,
      });

      const result = extractGodJson(output, WatchdogDecisionSchema);
      if (result && result.success) {
        return result.data;
      }

      // Watchdog output invalid — escalate
      return {
        analysis: `Watchdog produced invalid output: ${result?.error ?? 'no JSON found'}`,
        decision: 'escalate',
      };
    } catch (err) {
      // Watchdog adapter failed — escalate
      return {
        analysis: `Watchdog adapter error: ${err instanceof Error ? err.message : String(err)}`,
        decision: 'escalate',
      };
    }
  }

  handleGodSuccess(): void {
    this.state.consecutiveFailures = 0;
    this.state.godDisabled = false;
  }

  isGodAvailable(): boolean {
    return !this.state.godDisabled;
  }

  getState(): WatchdogState {
    return { ...this.state };
  }

  /**
   * Serialize state for session persistence.
   * Returns DegradationState-compatible object for backward compatibility.
   */
  serializeState(): DegradationState {
    return {
      level: this.state.godDisabled ? 'L4' : 'L1',
      consecutiveFailures: this.state.consecutiveFailures,
      godDisabled: this.state.godDisabled,
      fallbackActive: this.state.godDisabled,
      lastError: this.state.lastError,
    };
  }
}

// ── Envelope Construction ──

/**
 * Build a GodDecisionEnvelope from the Watchdog's simplified action spec.
 */
export function buildEnvelopeFromWatchdogAction(
  decision: WatchdogDecision,
  context: { taskGoal: string; currentPhaseId: string },
): GodDecisionEnvelope {
  const action = decision.constructedAction;
  if (!action) {
    return buildWatchdogFallbackEnvelope(decision.analysis, context);
  }

  const messages: GodDecisionEnvelope['messages'] = [];
  if (action.userMessage) {
    messages.push({ target: 'user', content: action.userMessage });
  }
  messages.push({ target: 'system_log', content: `Watchdog: ${decision.analysis}` });

  let godAction: GodAction;
  switch (action.actionType) {
    case 'accept_task':
      godAction = { type: 'accept_task', rationale: 'god_override', summary: action.summary };
      break;
    case 'send_to_coder':
      godAction = { type: 'send_to_coder', message: action.summary };
      break;
    case 'send_to_reviewer':
      godAction = { type: 'send_to_reviewer', message: action.summary };
      break;
    case 'wait':
      godAction = { type: 'wait', reason: action.summary };
      break;
    case 'request_user_input':
      godAction = { type: 'request_user_input', question: action.summary };
      break;
    default:
      godAction = { type: 'wait', reason: `Watchdog: unrecognized action "${action.actionType}"` };
  }

  return {
    diagnosis: {
      summary: `Watchdog constructed: ${decision.analysis}`,
      currentGoal: context.taskGoal,
      currentPhaseId: context.currentPhaseId,
      notableObservations: [],
    },
    authority: {
      userConfirmation: action.actionType === 'accept_task' ? 'god_override' : 'not_required',
      reviewerOverride: false,
      acceptAuthority: action.actionType === 'accept_task' ? 'god_override' : 'reviewer_aligned',
    },
    actions: [godAction],
    messages,
  };
}

function buildWatchdogFallbackEnvelope(
  analysis: string,
  context: { taskGoal: string; currentPhaseId: string },
): GodDecisionEnvelope {
  return {
    diagnosis: {
      summary: `Watchdog escalated: ${analysis}`,
      currentGoal: context.taskGoal,
      currentPhaseId: context.currentPhaseId,
      notableObservations: [],
    },
    authority: {
      userConfirmation: 'not_required',
      reviewerOverride: false,
      acceptAuthority: 'reviewer_aligned',
    },
    actions: [{ type: 'wait', reason: `Watchdog: ${analysis}` }],
    messages: [{ target: 'system_log', content: `Watchdog fallback: ${analysis}` }],
  };
}

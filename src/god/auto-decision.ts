/**
 * Auto Decision — WAITING_USER 代理决策服务
 * Source: FR-008 (AC-025, AC-026, AC-027)
 *
 * God autonomously decides in WAITING_USER state:
 * - accept: task complete
 * - continue_with_instruction: inject instruction and continue
 * - request_human: defer to human
 *
 * Decisions are checked against rule engine before execution (AC-025).
 * Reasoning is written to audit log (AC-027).
 */

import type { CLIAdapter, OutputChunk } from '../types/adapter.js';
import type { GodAutoDecision } from '../types/god-schemas.js';
import { GodAutoDecisionSchema } from '../types/god-schemas.js';
import { extractWithRetry } from '../parsers/god-json-extractor.js';
import { appendAuditLog, type GodAuditEntry } from './god-audit.js';
import type { RuleEngineResult, ActionContext } from './rule-engine.js';

// ── Types ──

export interface AutoDecisionContext {
  round: number;
  maxRounds: number;
  taskGoal: string;
  sessionDir: string;
  seq: number;
  waitingReason: string; // why we entered WAITING_USER (e.g. 'converged', 'loop_detected')
  projectDir?: string;
}

export interface AutoDecisionResult {
  decision: GodAutoDecision;
  ruleCheck: RuleEngineResult;
  blocked: boolean;
  reasoning: string;
}

// ── Default fallback ──

const DEFAULT_DECISION: GodAutoDecision = {
  action: 'request_human',
  reasoning: 'Fallback: defaulting to request_human (God extraction failed)',
};

// ── Collect adapter output ──

const GOD_TIMEOUT_MS = 30_000;

async function collectAdapterOutput(
  adapter: CLIAdapter,
  prompt: string,
  systemPrompt: string,
  projectDir?: string,
): Promise<string> {
  // God calls are stateless — clear any captured session ID to ensure --system-prompt is always passed
  if ('hasActiveSession' in adapter && (adapter as any).hasActiveSession?.()) {
    (adapter as any).lastSessionId = null;
  }
  // Adapters that don't support --system-prompt (e.g. Codex): embed it into the user prompt
  const supportsSystemPrompt = adapter.name === 'claude-code';
  const effectivePrompt = supportsSystemPrompt
    ? prompt
    : `${systemPrompt}\n\n---\n\n${prompt}`;
  const chunks: string[] = [];

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      adapter.kill().catch(() => {});
      reject(new Error(`God adapter timed out after ${GOD_TIMEOUT_MS}ms`));
    }, GOD_TIMEOUT_MS);
  });

  const collectPromise = (async () => {
    for await (const chunk of adapter.execute(effectivePrompt, {
      cwd: projectDir ?? process.cwd(),
      systemPrompt: supportsSystemPrompt ? systemPrompt : undefined,
      disableTools: true,
    })) {
      if (chunk.type === 'text' || chunk.type === 'code' || chunk.type === 'error') {
        chunks.push(chunk.content);
      }
    }
    return chunks.join('');
  })();

  return Promise.race([collectPromise, timeoutPromise]);
}

// ── Build prompt ──

function buildAutoDecisionPrompt(context: AutoDecisionContext): string {
  return [
    `## WAITING_USER Auto Decision`,
    ``,
    `Task: ${context.taskGoal}`,
    `Round: ${context.round}/${context.maxRounds}`,
    `Waiting reason: ${context.waitingReason}`,
    ``,
    `Decide the next action. Output a JSON code block:`,
    '```json',
    `{`,
    `  "action": "accept" | "continue_with_instruction" | "request_human",`,
    `  "reasoning": "...",`,
    `  "instruction": "..."  // only if action is continue_with_instruction`,
    `}`,
    '```',
  ].join('\n');
}

const SYSTEM_PROMPT = `You are the God orchestrator making an autonomous decision in WAITING_USER state.
Decide whether to accept the current output, continue with an instruction, or request human input.
Output a JSON code block with your decision.`;

// ── Main function ──

/**
 * Make an autonomous decision in WAITING_USER state.
 * AC-025: Rule engine is checked before execution; block prevents execution.
 * AC-027: Reasoning is written to audit log.
 */
export async function makeAutoDecision(
  godAdapter: CLIAdapter,
  context: AutoDecisionContext,
  ruleEngine: (action: ActionContext) => RuleEngineResult,
): Promise<AutoDecisionResult> {
  // 1. Query God for decision
  const prompt = buildAutoDecisionPrompt(context);
  const rawOutput = await collectAdapterOutput(godAdapter, prompt, SYSTEM_PROMPT, context.projectDir);

  // 2. Extract decision from God output (with retry for format correction)
  let decision: GodAutoDecision;
  const extracted = await extractWithRetry(rawOutput, GodAutoDecisionSchema, async (hint) =>
    collectAdapterOutput(godAdapter, `${prompt}\n\nPrevious attempt had format errors: ${hint}\nPlease output valid JSON.`, SYSTEM_PROMPT, context.projectDir),
  );
  if (extracted && extracted.success) {
    decision = extracted.data;
  } else {
    decision = DEFAULT_DECISION;
  }

  // 3. Check rule engine (AC-025)
  // Use config_modify type so rule engine path-based checks (R-001, R-002) can evaluate properly.
  // For auto-decisions that include an instruction, check it as a command to catch suspicious patterns.
  const effectiveCwd = context.projectDir ?? process.cwd();
  let ruleCheck: RuleEngineResult;
  if (decision.action === 'continue_with_instruction' && decision.instruction) {
    ruleCheck = ruleEngine({
      type: 'command_exec',
      command: decision.instruction,
      cwd: effectiveCwd,
      godApproved: true,
    });
  } else if (decision.action === 'accept' || decision.action === 'request_human') {
    // accept and request_human are pure workflow control decisions — no file/config modification.
    // Skip rule engine path checks to avoid false blocks from R-001 for non-~/Documents projects.
    ruleCheck = { blocked: false, results: [] };
  } else {
    ruleCheck = ruleEngine({
      type: 'config_modify',
      path: effectiveCwd,
      cwd: effectiveCwd,
      godApproved: true,
    });
  }

  const blocked = ruleCheck.blocked;
  const reasoning = decision.reasoning;

  // 4. Write audit log (AC-027)
  const entry: GodAuditEntry = {
    seq: context.seq,
    timestamp: new Date().toISOString(),
    round: context.round,
    decisionType: 'AUTO_DECISION',
    inputSummary: `waitingReason=${context.waitingReason}, taskGoal=${context.taskGoal}`.slice(0, 500),
    outputSummary: JSON.stringify(decision).slice(0, 500),
    decision: { ...decision, blocked },
  };
  appendAuditLog(context.sessionDir, entry);

  return { decision, ruleCheck, blocked, reasoning };
}

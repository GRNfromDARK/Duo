/**
 * ContextManager — builds prompts for Coder/Reviewer LLMs.
 * Source: FR-003 (AC-009, AC-010, AC-011)
 *
 * Responsibilities:
 * - Coder prompt: system role + task + history + "不要提问" instruction
 * - Reviewer prompt: system role + task + history + "给出行级反馈" instruction
 * - Round summary generation (≤200 tokens fallback truncation)
 * - Token budget: last 3 rounds full + older rounds summarized, ≤80% context window
 * - Custom prompt templates from .duo/prompts/
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RoundRecord {
  index: number;
  coderOutput: string;
  reviewerOutput: string;
  summary?: string;
  timestamp: number;
}

export interface ContextManagerOptions {
  contextWindowSize: number;
  promptsDir?: string;
}

export interface CoderPromptOptions {
  reviewerFeedback?: string;
  interruptInstruction?: string;
  skipHistory?: boolean;
}

export interface ReviewerPromptOptions {
  interruptInstruction?: string;
  skipHistory?: boolean;
  roundNumber?: number;
  previousReviewerOutput?: string;
}

// Approximate: 1 token ≈ 4 chars
const CHARS_PER_TOKEN = 4;
const MAX_SUMMARY_TOKENS = 200;
const MAX_SUMMARY_CHARS = MAX_SUMMARY_TOKENS * CHARS_PER_TOKEN;
const RECENT_ROUNDS_COUNT = 3;
const BUDGET_RATIO = 0.8;

const DEFAULT_CODER_TEMPLATE = `You are a Coder. Write code to complete the given task.

## Task
{{task}}

{{history}}

{{reviewerFeedback}}

{{interruptInstruction}}

## Instructions
- Do not ask questions. Decide autonomously and implement directly.
  不要提问，自主决策，直接实现。
- Focus ONLY on the task described above. Do not modify unrelated code.
  只关注上述任务，不要修改无关代码。
- If the Reviewer flagged issues, address EVERY issue and briefly state what you fixed (e.g. "Fixed: null check on line 42").
  如果 Reviewer 指出了问题，逐一解决并简要说明修复内容。
- Produce working code, not explanations. Keep commentary minimal.
  产出可运行的代码，而非解释。注释保持精简。`;

const DEFAULT_REVIEWER_TEMPLATE = `You are a Reviewer. Review the Coder's output against the task requirements.
This is **Round {{roundNumber}}** of review.

## Task
{{task}}

{{history}}

## Current Coder Output
{{coderOutput}}

{{interruptInstruction}}

## Review Scope
- Review ONLY against the task requirements above. Do not review unrelated existing code.
  只针对上述任务要求进行审查，不要审查无关的已有代码。
- Do NOT re-raise issues that have already been fixed. If prior feedback exists, verify each item before re-raising.
  不要重复提出已经修复的问题。如有上轮反馈，逐项验证后再决定是否重新提出。

{{previousFeedbackChecklist}}

## Review Output Format

### 1. Progress Checklist (REQUIRED for round 2+)
If prior feedback exists, you MUST start with a checklist for EVERY item from the previous round:
- [x] Fixed: <issue description>
- [ ] Still open: <issue description>
如果有上轮反馈，必须先对上轮每个问题逐项打勾确认修复状态。

### 2. New Issues (if any)
For each NEW issue found (not previously raised), state:
1. **Location** — file and line (if visible)
2. **Problem** — what is wrong
3. **Fix** — concrete suggestion

Classify each as:
- **Blocking**: Bugs, logic errors, missing requirements, security issues — MUST be fixed.
- **Non-blocking**: Style, naming, minor suggestions — note them but they do NOT block approval.

### 3. Blocking Issue Count (REQUIRED)
State explicitly: \`Blocking: N\` (where N is the number of unresolved blocking issues).
明确写出：\`Blocking: N\`（N 为未解决的阻塞性问题数量）。

### 4. Verdict (REQUIRED)
Use this decision tree:
- Blocking count = 0 → \`[APPROVED]\`
- Blocking count > 0 → \`[CHANGES_REQUESTED]\`

End your review with exactly one verdict marker on its own line:
\`[APPROVED]\` or \`[CHANGES_REQUESTED]\`

IMPORTANT: You MUST include exactly one verdict marker. If there are ZERO blocking issues, you MUST use \`[APPROVED]\` — do not withhold approval for non-blocking suggestions.
重要：必须包含一个 verdict 标记。如果阻塞性问题为 0，必须使用 \`[APPROVED]\`——不要因非阻塞性建议而拒绝通过。

Approve when the task works correctly. Do not block on style or preferences.
当任务功能正确实现时给出 [APPROVED]。不要因为风格偏好而阻塞。`;

export class ContextManager {
  private readonly contextWindowSize: number;
  private readonly promptsDir?: string;
  private readonly coderTemplate: string;
  private readonly reviewerTemplate: string;

  constructor(opts: ContextManagerOptions) {
    this.contextWindowSize = opts.contextWindowSize;
    this.promptsDir = opts.promptsDir;
    this.coderTemplate = this.loadTemplate('coder.md', DEFAULT_CODER_TEMPLATE);
    this.reviewerTemplate = this.loadTemplate('reviewer.md', DEFAULT_REVIEWER_TEMPLATE);
  }

  static getDefaultTemplatesDir(): string {
    return '.duo/prompts';
  }

  buildCoderPrompt(
    task: string,
    rounds: RoundRecord[],
    opts?: CoderPromptOptions,
  ): string {
    const historySection = opts?.skipHistory ? '' : this.buildHistorySection(rounds);
    const feedbackSection = opts?.reviewerFeedback
      ? `## Reviewer Feedback\n${opts.reviewerFeedback}`
      : '';
    const interruptSection = opts?.interruptInstruction
      ? `## Interrupt Instruction\n${opts.interruptInstruction}`
      : '';

    let prompt = this.resolveTemplate(this.coderTemplate, {
      task,
      history: historySection,
      reviewerFeedback: feedbackSection,
      interruptInstruction: interruptSection,
    });

    prompt = this.enforceTokenBudget(prompt);
    return prompt;
  }

  buildReviewerPrompt(
    task: string,
    rounds: RoundRecord[],
    coderOutput: string,
    opts?: ReviewerPromptOptions,
  ): string {
    const historySection = opts?.skipHistory ? '' : this.buildHistorySection(rounds);
    const interruptSection = opts?.interruptInstruction
      ? `## Interrupt Instruction\n${opts.interruptInstruction}`
      : '';
    const roundNumber = String(opts?.roundNumber ?? rounds.length + 1);
    const checklistSection = opts?.previousReviewerOutput
      ? this.buildPreviousFeedbackChecklist(opts.previousReviewerOutput)
      : '';

    let prompt = this.resolveTemplate(this.reviewerTemplate, {
      task,
      history: historySection,
      coderOutput,
      interruptInstruction: interruptSection,
      roundNumber,
      previousFeedbackChecklist: checklistSection,
    });

    prompt = this.enforceTokenBudget(prompt);
    return prompt;
  }

  generateSummary(text: string): string {
    if (text.length <= MAX_SUMMARY_CHARS) {
      return text;
    }

    // Try to extract structured key points before falling back to truncation
    const keyPoints = this.extractKeyPoints(text);
    if (keyPoints && keyPoints.length <= MAX_SUMMARY_CHARS) {
      return keyPoints;
    }

    // Truncate by full characters to avoid breaking multi-byte sequences
    const chars = Array.from(keyPoints ?? text);
    return chars.slice(0, MAX_SUMMARY_CHARS - 3).join('') + '...';
  }

  /**
   * Extract key points from reviewer/coder output:
   * - Verdict markers ([APPROVED]/[CHANGES_REQUESTED])
   * - Blocking/non-blocking issue lines
   * - Lines starting with numbered lists or bold markers
   */
  private extractKeyPoints(text: string): string | null {
    const lines = text.split('\n');
    const keyLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Always keep verdict markers
      if (/\[(APPROVED|CHANGES_REQUESTED)\]/.test(trimmed)) {
        keyLines.push(trimmed);
        continue;
      }

      // Keep blocking/non-blocking classifications
      if (/\*\*(Blocking|Non-blocking|Location|Problem|Fix|Bug|Error|Missing)\*\*/.test(trimmed)) {
        keyLines.push(trimmed);
        continue;
      }

      // Keep numbered issue items
      if (/^\d+\.\s+\*\*/.test(trimmed)) {
        keyLines.push(trimmed);
        continue;
      }

      // Keep "Fixed since last round" / "Remaining issues" headers
      if (/\*\*(Fixed|Remaining|修复|剩余)/.test(trimmed)) {
        keyLines.push(trimmed);
        continue;
      }
    }

    if (keyLines.length === 0) return null;
    return keyLines.join('\n');
  }

  /**
   * Extract structured issue items from the previous reviewer output
   * and present them as an actionable checklist for the next review round.
   */
  private buildPreviousFeedbackChecklist(previousOutput: string): string {
    const issues = this.extractGroupedIssues(previousOutput);
    if (issues.length === 0) return '';

    const checklist = issues
      .map((issue, i) => `${i + 1}. ${issue}`)
      .join('\n');

    return `## Previous Round Feedback (verify each item)
上轮反馈的问题清单，请逐项验证是否已修复：

${checklist}

For each item above, mark as \`[x] Fixed\` or \`[ ] Still open\` in your Progress Checklist.
请在 Progress Checklist 中对每一项标注 \`[x] Fixed\` 或 \`[ ] Still open\`。`;
  }

  /**
   * Parse reviewer output into grouped issue summaries.
   * Groups multi-line issues (Location/Problem/Fix) into single entries.
   */
  private extractGroupedIssues(output: string): string[] {
    const lines = output.split('\n');
    const issues: string[] = [];
    let inCodeBlock = false;

    // State for accumulating a multi-line issue group
    let currentGroup: { location?: string; problem?: string; fix?: string; classification?: string } | null = null;

    const flushGroup = () => {
      if (!currentGroup) return;
      const parts: string[] = [];
      if (currentGroup.classification) parts.push(`[${currentGroup.classification}]`);
      if (currentGroup.location) parts.push(currentGroup.location);
      if (currentGroup.problem) parts.push(currentGroup.problem);
      if (parts.length > 0) {
        issues.push(parts.join(' — '));
      }
      currentGroup = null;
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock || !trimmed) continue;

      // Skip headers, verdict markers, and Blocking: N count line
      if (/^#{1,4}\s/.test(trimmed)) continue;
      if (/\[(APPROVED|CHANGES_REQUESTED)\]/.test(trimmed)) continue;
      if (/^Blocking:\s*\d+$/i.test(trimmed)) continue;

      // Detect start of a numbered issue group: "1. **Location**: ..."
      const numberedStart = trimmed.match(/^\d+\.\s+\*\*(Location|Problem|Fix|Blocking|Non-blocking|Bug|Error|Missing)\*\*[：:]\s*(.*)/);
      if (numberedStart) {
        flushGroup();
        currentGroup = {};
        this.applyFieldToGroup(currentGroup, numberedStart[1], numberedStart[2]);
        continue;
      }

      // Continuation lines within a group: "   **Problem**: ..." or "   **Fix**: ..."
      const fieldMatch = trimmed.match(/^\*\*(Location|Problem|Fix|Blocking|Non-blocking|Bug|Error|Missing)\*\*[：:]\s*(.*)/);
      if (fieldMatch) {
        if (!currentGroup) currentGroup = {};
        this.applyFieldToGroup(currentGroup, fieldMatch[1], fieldMatch[2]);
        continue;
      }

      // Bullet-style issue: "- **Blocking**: description"
      const bulletMatch = trimmed.match(/^[-*]\s+\*\*(Blocking|Non-blocking|Bug|Error|Missing|Problem|Location)\*\*[：:]\s*(.*)/);
      if (bulletMatch) {
        flushGroup();
        const classification = bulletMatch[1];
        const desc = bulletMatch[2];
        issues.push(`[${classification}] ${desc}`);
        continue;
      }
    }

    flushGroup();
    return issues;
  }

  private applyFieldToGroup(
    group: { location?: string; problem?: string; fix?: string; classification?: string },
    field: string,
    value: string,
  ): void {
    const lower = field.toLowerCase();
    if (lower === 'location') {
      group.location = value;
    } else if (lower === 'problem' || lower === 'bug' || lower === 'error' || lower === 'missing') {
      group.problem = value;
    } else if (lower === 'fix') {
      group.fix = value;
    } else if (lower === 'blocking' || lower === 'non-blocking') {
      group.classification = field;
      // If value contains the issue description directly
      if (value && !group.problem) {
        group.problem = value;
      }
    }
  }

  private buildHistorySection(rounds: RoundRecord[]): string {
    if (rounds.length === 0) return '';

    const parts: string[] = [];
    const recentStart = Math.max(0, rounds.length - RECENT_ROUNDS_COUNT);

    // Older rounds: use summaries
    for (let i = 0; i < recentStart; i++) {
      const round = rounds[i];
      const summary = round.summary ?? this.generateSummary(round.coderOutput);
      parts.push(`### Round ${round.index} (Summary)\n${summary}`);
    }

    // Recent rounds: full content
    for (let i = recentStart; i < rounds.length; i++) {
      const round = rounds[i];
      parts.push(
        `### Round ${round.index}\n**Coder:** ${round.coderOutput}\n**Reviewer:** ${round.reviewerOutput}`,
      );
    }

    return `## History\n${parts.join('\n\n')}`;
  }

  /**
   * Single-pass placeholder resolver. Replaces {{key}} tokens in one regex pass
   * over the original template, so replacement values containing {{...}} tokens
   * are never re-interpreted.
   */
  private resolveTemplate(
    template: string,
    vars: Record<string, string>,
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      return Object.hasOwn(vars, key) ? vars[key] : match;
    });
  }

  private enforceTokenBudget(prompt: string): string {
    const maxChars = Math.floor(this.contextWindowSize * CHARS_PER_TOKEN * BUDGET_RATIO);
    if (prompt.length <= maxChars) {
      return prompt;
    }
    // Truncate by full characters to avoid breaking multi-byte sequences
    const chars = Array.from(prompt);
    return chars.slice(0, maxChars - 3).join('') + '...';
  }

  private loadTemplate(filename: string, defaultTemplate: string): string {
    if (!this.promptsDir) return defaultTemplate;

    const filePath = path.join(this.promptsDir, filename);
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return defaultTemplate;
    }
  }
}

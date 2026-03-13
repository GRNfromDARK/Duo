/**
 * ChoiceDetector — detects choice/question patterns in LLM output and routes.
 * Source: FR-006 (AC-020, AC-021, AC-022, AC-023)
 *
 * Primary strategy: system prompt instructs LLM not to ask questions.
 * Fallback: regex detection of choice patterns (A/B/C, 1/2/3, 方案一/方案二).
 * On detection: route question to counterpart LLM for auto-selection.
 */

export interface ChoiceDetectionResult {
  detected: boolean;
  choices: string[];
  question?: string;
}

// ── Choice patterns ──

// A. / A) / A: style
const ABC_DOT = /^([A-C])[.)]\s*(.+)/;
const ABC_COLON = /^([A-C])[:：]\s*(.+)/;

// 1. / 1) / 1: style
const NUM_DOT = /^(\d)[.)]\s*(.+)/;

// 方案一/方案二 style
const FANGAN = /^方案([一二三四五六七八九十\d]+)[：:.]?\s*(.+)/;

// Option 1/Option 2 style
const OPTION = /^Option\s+(\d+)[：:.]\s*(.+)/i;

// Bullet list: - item
const BULLET = /^[-•*]\s+(.+)/;

// Question line: ends with ?/？ or contains choice-indicating phrases
const QUESTION_LINE = /^.+[?？]\s*$/;
const CHOICE_INTRO_LINE = /\b(options?|choose|prefer|which|pick|select|方案|选择|哪[个种])\b/i;

export class ChoiceDetector {
  /**
   * Detect choice patterns in LLM output.
   * Requires BOTH a question line AND a list of options.
   */
  detect(text: string): ChoiceDetectionResult {
    const rawLines = text.split('\n');
    const empty: ChoiceDetectionResult = { detected: false, choices: [] };

    // Filter out lines inside code blocks
    const lines: string[] = [];
    let inCodeBlock = false;
    for (const raw of rawLines) {
      if (raw.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (!inCodeBlock) {
        const trimmed = raw.trim();
        if (trimmed.length > 0) lines.push(trimmed);
      }
    }

    // Find question line(s): explicit question mark or choice-introducing phrase
    let questionLine: string | undefined;
    let questionLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (QUESTION_LINE.test(lines[i]) || CHOICE_INTRO_LINE.test(lines[i])) {
        questionLine = lines[i];
        questionLineIdx = i;
      }
    }

    if (!questionLine) return empty;

    // Look for choice list after (or near) the question
    const choices: string[] = [];
    const searchStart = Math.max(0, questionLineIdx - 2);

    for (let i = searchStart; i < lines.length; i++) {
      const line = lines[i];
      let match: RegExpMatchArray | null;

      if ((match = line.match(ABC_DOT)) || (match = line.match(ABC_COLON))) {
        choices.push(match[2].trim());
      } else if ((match = line.match(NUM_DOT))) {
        choices.push(match[2].trim());
      } else if ((match = line.match(FANGAN))) {
        choices.push(match[2].trim());
      } else if ((match = line.match(OPTION))) {
        choices.push(match[2].trim());
      } else if ((match = line.match(BULLET)) && questionLineIdx >= 0) {
        // Bullet items only count if they appear after a question
        // and are reasonably short (< 120 chars, to avoid matching prose)
        if (i > questionLineIdx && match[1].trim().length < 120) {
          choices.push(match[1].trim());
        }
      }
    }

    if (choices.length < 2) return empty;

    return {
      detected: true,
      choices,
      question: questionLine,
    };
  }

  /**
   * Build a forward prompt for the counterpart LLM to answer the choice.
   */
  buildForwardPrompt(result: ChoiceDetectionResult, taskContext: string): string {
    const choiceList = result.choices
      .map((c, i) => `${i + 1}. ${c}`)
      .join('\n');

    return `Task: ${taskContext}

A decision is needed:
${result.question ?? '(no question text)'}

Choices:
${choiceList}

Reply with ONLY: the choice number, then one sentence of reasoning. Do not ask questions.
只回复：选项编号 + 一句话理由。不要提问。`;
  }
}

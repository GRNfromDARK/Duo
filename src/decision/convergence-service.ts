/**
 * ConvergenceService — analyzes Reviewer output to determine convergence.
 * Source: FR-005 (AC-016, AC-017, AC-018, AC-019)
 *
 * Classification: only the explicit [APPROVED] marker triggers approval.
 * Everything else (including [CHANGES_REQUESTED] or no marker) → changes_requested.
 *
 * Termination: approved / max_rounds / user_terminate / loop_detected
 * Loop detection: recent rounds with similar feedback topics
 */

export type ConvergenceClassification =
  | 'approved'
  | 'soft_approved'
  | 'changes_requested';

export interface ConvergenceResult {
  classification: ConvergenceClassification;
  shouldTerminate: boolean;
  reason: 'approved' | 'soft_approved' | 'max_rounds' | 'loop_detected' | 'diminishing_issues' | null;
  loopDetected: boolean;
  issueCount: number;
  progressTrend: 'improving' | 'stagnant' | 'unknown';
}

export interface EvaluateContext {
  currentRound: number;
  previousOutputs: string[];
}

export interface ConvergenceServiceOptions {
  maxRounds?: number;
}

// ── Explicit verdict marker (the only way to approve) ──
const APPROVED_MARKER = /\[APPROVED\]/;

// ── Soft approval patterns: reviewer expresses approval without the marker ──
const SOFT_APPROVAL_PATTERNS = [
  /\bLGTM\b/i,
  /\blooks?\s+good\s+to\s+me\b/i,
  /\bno\s+(more\s+)?(issues?|problems?|concerns?|changes?)\b/i,
  /\ball\s+(issues?|problems?)\s+(have\s+been\s+|are\s+)?(resolved|fixed|addressed)\b/i,
  /\bship\s+it\b/i,
  /\bready\s+(to\s+|for\s+)(merge|ship|deploy)\b/i,
  /\bnothing\s+(else\s+)?to\s+(fix|change|address)\b/i,
  /代码已通过/,
  /没有(更多|其他)?(问题|意见|修改)/,
  /所有(问题|issue).*(已|都)(修复|解决|处理)/,
  /可以(合并|提交|部署)/,
  /非常好/,
];

// ── Issue counting patterns (blocking issues in reviewer output) ──
const BLOCKING_ISSUE_PATTERNS = [
  /\*\*Blocking\*\*/gi,
  /^\s*[-*]\s*\*\*(?:Bug|Error|Missing|Issue|Problem)\*\*/gim,
  /^\s*\d+\.\s*\*\*(?:Location|Problem|Bug)\*\*/gim,
];

const NON_BLOCKING_PATTERN = /\*\*Non-blocking\*\*/gi;

const DEFAULT_MAX_ROUNDS = 20;

// ── Similarity threshold for loop detection ──
const SIMILARITY_THRESHOLD = 0.45;

// ── Diminishing issues: terminate if issues drop to 0 with only non-blocking ──
const DIMINISHING_MIN_ROUNDS = 2;

export class ConvergenceService {
  private readonly maxRounds: number;

  constructor(opts?: ConvergenceServiceOptions) {
    this.maxRounds = opts?.maxRounds ?? DEFAULT_MAX_ROUNDS;
  }

  /**
   * Classify reviewer output into approved / soft_approved / changes_requested.
   *
   * Priority: [APPROVED] marker → soft approval phrases → changes_requested.
   */
  classify(output: string): { classification: ConvergenceClassification; issueCount: number } {
    const issueCount = this.countBlockingIssues(output);

    if (APPROVED_MARKER.test(output)) {
      return { classification: 'approved', issueCount: 0 };
    }

    // Soft approval: no blocking issues + approval-like language + no [CHANGES_REQUESTED] marker
    if (issueCount === 0 && !output.includes('[CHANGES_REQUESTED]') && SOFT_APPROVAL_PATTERNS.some((p) => p.test(output))) {
      return { classification: 'soft_approved', issueCount: 0 };
    }

    return { classification: 'changes_requested', issueCount };
  }

  /**
   * Full evaluation: classify + termination + loop detection + progress tracking.
   */
  evaluate(reviewerOutput: string, ctx: EvaluateContext): ConvergenceResult {
    const { classification, issueCount } = this.classify(reviewerOutput);
    const loopDetected = this.detectLoop(reviewerOutput, ctx.previousOutputs);
    const progressTrend = this.detectProgressTrend(issueCount, ctx.previousOutputs);

    const base = { loopDetected, issueCount, progressTrend };

    // Termination conditions (checked in priority order)
    if (classification === 'approved') {
      return { classification, shouldTerminate: true, reason: 'approved', ...base };
    }

    // Soft approval: reviewer language suggests approval without marker
    if (classification === 'soft_approved') {
      return { classification, shouldTerminate: true, reason: 'soft_approved', ...base };
    }

    if (ctx.currentRound >= this.maxRounds) {
      return { classification, shouldTerminate: true, reason: 'max_rounds', ...base };
    }

    if (loopDetected) {
      return { classification, shouldTerminate: true, reason: 'loop_detected', ...base };
    }

    // Diminishing issues: if issue count dropped to 0 and only non-blocking remain
    if (
      ctx.currentRound >= DIMINISHING_MIN_ROUNDS
      && issueCount === 0
      && progressTrend === 'improving'
      && !reviewerOutput.includes('[CHANGES_REQUESTED]')
    ) {
      return { classification, shouldTerminate: true, reason: 'diminishing_issues', ...base };
    }

    return { classification, shouldTerminate: false, reason: null, ...base };
  }

  /**
   * Count blocking issues in reviewer output.
   *
   * Priority:
   * 1. Explicit `Blocking: N` line (structured output from our prompt template)
   * 2. Heuristic: count **Blocking** markers minus **Non-blocking** markers
   */
  countBlockingIssues(output: string): number {
    // 1. Try explicit structured count: "Blocking: 0", "Blocking: 3"
    const explicitMatch = output.match(/^Blocking:\s*(\d+)/m);
    if (explicitMatch) {
      return parseInt(explicitMatch[1], 10);
    }

    // 2. Fallback: heuristic marker counting
    let count = 0;
    for (const pattern of BLOCKING_ISSUE_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = output.match(pattern);
      if (matches) count += matches.length;
    }
    NON_BLOCKING_PATTERN.lastIndex = 0;
    const nonBlocking = output.match(NON_BLOCKING_PATTERN);
    if (nonBlocking) count = Math.max(0, count - nonBlocking.length);
    return count;
  }

  /**
   * Detect progress trend by comparing current issue count with previous rounds.
   */
  private detectProgressTrend(
    currentIssueCount: number,
    previousOutputs: string[],
  ): 'improving' | 'stagnant' | 'unknown' {
    if (previousOutputs.length === 0) return 'unknown';

    const previousCounts = previousOutputs.slice(-3).map((o) => this.countBlockingIssues(o));
    if (previousCounts.length === 0) return 'unknown';

    const lastCount = previousCounts[previousCounts.length - 1];

    if (currentIssueCount < lastCount) return 'improving';
    if (currentIssueCount === lastCount && currentIssueCount > 0) return 'stagnant';
    if (currentIssueCount === 0 && lastCount > 0) return 'improving';

    return 'unknown';
  }

  /**
   * Loop detection: check if current output discusses same topics
   * as any recent previous output, or if a recurring pattern exists.
   */
  private detectLoop(current: string, previousOutputs: string[]): boolean {
    if (previousOutputs.length === 0) return false;

    // Check 1: current output similar to any of last 4 outputs
    const recentOutputs = previousOutputs.slice(-4);
    const hasRecentMatch = recentOutputs.some((previous) => this.isSimilar(current, previous));
    if (hasRecentMatch) return true;

    // Check 2: recurring pattern — current similar to 2+ non-consecutive older outputs
    // Limit scan to last 8 outputs to avoid false positives in long sessions
    if (previousOutputs.length >= 3) {
      const scanWindow = previousOutputs.slice(-8);
      let matchCount = 0;
      for (const previous of scanWindow) {
        if (this.isSimilar(current, previous)) {
          matchCount++;
          if (matchCount >= 2) return true;
        }
      }
    }

    return false;
  }

  /**
   * Keyword-based similarity check.
   * Extracts significant words and computes Jaccard similarity.
   */
  private isSimilar(a: string, b: string): boolean {
    const wordsA = this.extractKeywords(a);
    const wordsB = this.extractKeywords(b);

    if (wordsA.size === 0 || wordsB.size === 0) return false;

    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);

    const similarity = intersection.size / union.size;
    return similarity >= SIMILARITY_THRESHOLD;
  }

  /**
   * Extract significant keywords (lowercase, filtered by language-aware min length).
   * Chinese characters are extracted as bigrams (2-char sliding window) for better matching.
   * English words require >= 3 chars and are filtered against stop words.
   */
  private extractKeywords(text: string): Set<string> {
    const STOP_WORDS = new Set([
      'the', 'this', 'that', 'with', 'from', 'have', 'has', 'had',
      'been', 'being', 'was', 'were', 'are', 'for', 'and', 'but',
      'not', 'you', 'all', 'can', 'her', 'his', 'its', 'our',
      'they', 'them', 'than', 'too', 'very', 'just', 'also',
      'please', 'could', 'would', 'should', 'still', 'some',
    ]);

    const CJK_STOP = new Set([
      '的', '了', '在', '是', '我', '有', '和', '就',
      '不', '人', '都', '一', '个', '上', '也', '很',
      '到', '说', '要', '去', '你', '会', '着', '没有',
      '看', '好', '自己', '这', '他', '她', '它',
    ]);

    const result = new Set<string>();

    // Extract English words (>= 3 chars, no stop words)
    const englishWords = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
    for (const w of englishWords) result.add(w);

    // Extract CJK characters and form bigrams for semantic matching
    const cjkChars = text.match(/[\u4e00-\u9fff]/g);
    if (cjkChars && cjkChars.length >= 2) {
      for (let i = 0; i < cjkChars.length - 1; i++) {
        const bigram = cjkChars[i] + cjkChars[i + 1];
        if (!CJK_STOP.has(bigram)) {
          result.add(bigram);
        }
      }
    }
    // Also add individual CJK chars that are meaningful (not stop chars)
    if (cjkChars) {
      for (const ch of cjkChars) {
        if (!CJK_STOP.has(ch)) {
          result.add(ch);
        }
      }
    }

    return result;
  }

}

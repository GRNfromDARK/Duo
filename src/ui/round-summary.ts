/**
 * Round summary divider formatting.
 * Source: FR-020 (AC-068, AC-069)
 *
 * Generates formatted divider lines inserted between rounds:
 *   ═══ Round N→N+1 · Summary: <text> ═══
 * Total line length capped at 100 characters.
 */

import { randomUUID } from 'node:crypto';
import type { Message } from '../types/ui.js';

const MAX_LINE_LENGTH = 100;
const PREFIX_TEMPLATE = '═══ Round ';
const SUFFIX = ' ═══';
const SUMMARY_SEPARATOR = ' · Summary: ';

export function formatRoundSummary(
  fromRound: number,
  toRound: number,
  summary: string,
): string {
  const roundPart = `${PREFIX_TEMPLATE}${fromRound}→${toRound}`;

  if (!summary) {
    return `${roundPart}${SUFFIX}`;
  }

  const withSummary = `${roundPart}${SUMMARY_SEPARATOR}${summary}${SUFFIX}`;

  if (withSummary.length <= MAX_LINE_LENGTH) {
    return withSummary;
  }

  // Truncate summary to fit within 100 chars
  const overhead = roundPart.length + SUMMARY_SEPARATOR.length + SUFFIX.length + 3; // 3 for "..."
  const available = MAX_LINE_LENGTH - overhead;
  const truncated = summary.slice(0, Math.max(0, available));
  return `${roundPart}${SUMMARY_SEPARATOR}${truncated}...${SUFFIX}`;
}

export function createRoundSummaryMessage(
  fromRound: number,
  toRound: number,
  summary: string,
): Message {
  return {
    id: `round-summary-${fromRound}-${toRound}-${randomUUID().slice(0, 8)}`,
    role: 'system',
    content: formatRoundSummary(fromRound, toRound, summary),
    timestamp: Date.now(),
    metadata: { isRoundSummary: true },
  };
}

/**
 * God audit log — append-only JSONL log for God decisions.
 * Source: FR-020 (AC-051, AC-052), NFR-008
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { writeFileSync } from 'node:fs';
import { join } from 'path';

export interface GodAuditEntry {
  seq: number;
  timestamp: string;
  round: number;
  decisionType: string;
  inputSummary: string;   // ≤ 500 chars
  outputSummary: string;  // ≤ 500 chars
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  decision: unknown;
  model?: string;
  phaseId?: string;
  outputRef?: string;     // god-decisions/ 中的完整输出引用
}

const MAX_SUMMARY_LEN = 500;
const AUDIT_FILENAME = 'god-audit.jsonl';
const DECISIONS_DIR = 'god-decisions';

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Append a God audit entry to the session's god-audit.jsonl file.
 * Creates the file and parent directories if they don't exist.
 * Retained for backward compatibility (AR-004).
 */
export function appendAuditLog(sessionDir: string, entry: GodAuditEntry): void {
  const logPath = join(sessionDir, AUDIT_FILENAME);

  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }

  const sanitized: GodAuditEntry = {
    ...entry,
    inputSummary: truncate(entry.inputSummary, MAX_SUMMARY_LEN),
    outputSummary: truncate(entry.outputSummary, MAX_SUMMARY_LEN),
  };

  appendFileSync(logPath, JSON.stringify(sanitized) + '\n');
}

/**
 * GodAuditLogger — class-based audit logger with seq tracking and outputRef support.
 * Source: FR-020 (AC-051, AC-052)
 */
export class GodAuditLogger {
  private readonly sessionDir: string;
  private seq: number;

  constructor(sessionDir: string) {
    this.sessionDir = sessionDir;
    this.seq = this.loadCurrentSeq();
  }

  /**
   * Append an audit entry. Optionally store full God output in god-decisions/.
   */
  append(entry: Omit<GodAuditEntry, 'seq'>, fullOutput?: unknown): void {
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }

    this.seq += 1;
    const seqStr = String(this.seq).padStart(3, '0');

    let outputRef: string | undefined;
    if (fullOutput !== undefined) {
      const decisionsDir = join(this.sessionDir, DECISIONS_DIR);
      if (!existsSync(decisionsDir)) {
        mkdirSync(decisionsDir, { recursive: true });
      }
      const filename = `${seqStr}-${entry.decisionType}.json`;
      outputRef = `${DECISIONS_DIR}/${filename}`;
      writeFileSync(join(decisionsDir, filename), JSON.stringify(fullOutput, null, 2));
    }

    const sanitized: GodAuditEntry = {
      ...entry,
      seq: this.seq,
      inputSummary: truncate(entry.inputSummary, MAX_SUMMARY_LEN),
      outputSummary: truncate(entry.outputSummary, MAX_SUMMARY_LEN),
      ...(outputRef ? { outputRef } : {}),
    };

    const logPath = join(this.sessionDir, AUDIT_FILENAME);
    appendFileSync(logPath, JSON.stringify(sanitized) + '\n');
  }

  /**
   * Read all audit entries, optionally filtered by decisionType.
   */
  getEntries(filter?: { type?: string }): GodAuditEntry[] {
    const logPath = join(this.sessionDir, AUDIT_FILENAME);
    if (!existsSync(logPath)) return [];

    const content = readFileSync(logPath, 'utf-8');
    if (!content.trim()) return [];

    const entries: GodAuditEntry[] = content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as GodAuditEntry);

    if (filter?.type) {
      return entries.filter(e => e.decisionType === filter.type);
    }
    return entries;
  }

  /**
   * Get current sequence number (0 if no entries yet).
   */
  getSequence(): number {
    return this.seq;
  }

  /**
   * Load current seq from existing log file.
   */
  private loadCurrentSeq(): number {
    const logPath = join(this.sessionDir, AUDIT_FILENAME);
    if (!existsSync(logPath)) return 0;

    const content = readFileSync(logPath, 'utf-8');
    if (!content.trim()) return 0;

    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length === 0) return 0;

    const lastLine = lines[lines.length - 1];
    try {
      const entry = JSON.parse(lastLine) as GodAuditEntry;
      return entry.seq ?? 0;
    } catch {
      return 0;
    }
  }
}

/**
 * Clean up oldest decision files when directory exceeds size limit.
 * Source: NFR-008 (god-decisions/ 目录上限 50MB)
 * @returns Number of files removed
 */
export function cleanupOldDecisions(dir: string, maxSizeMB: number): number {
  if (!existsSync(dir)) return 0;

  const maxBytes = maxSizeMB * 1024 * 1024;

  const files = readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => {
      // Numeric sort by seq prefix to handle seq > 999 correctly
      const seqA = parseInt(a.split('-')[0], 10);
      const seqB = parseInt(b.split('-')[0], 10);
      if (!isNaN(seqA) && !isNaN(seqB)) return seqA - seqB;
      return a.localeCompare(b);
    });

  let totalSize = 0;
  const fileSizes: { name: string; size: number }[] = [];
  for (const f of files) {
    const size = statSync(join(dir, f)).size;
    totalSize += size;
    fileSizes.push({ name: f, size });
  }

  if (totalSize <= maxBytes) return 0;

  let removed = 0;
  for (const { name, size } of fileSizes) {
    if (totalSize <= maxBytes) break;
    unlinkSync(join(dir, name));
    totalSize -= size;
    removed++;
  }

  return removed;
}

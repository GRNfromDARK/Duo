/**
 * Tests for git-diff-stats — pure functions for parsing git diff --stat output.
 * Source: FR-026 (AC-082)
 */

import { describe, it, expect } from 'vitest';
import { parseGitDiffStat, type GitDiffStats } from '../../ui/git-diff-stats.js';

describe('parseGitDiffStat', () => {
  it('parses typical git diff --stat summary line', () => {
    const output = ` src/foo.ts | 10 ++++------
 src/bar.ts | 5 +++++
 2 files changed, 9 insertions(+), 6 deletions(-)`;

    const result = parseGitDiffStat(output);
    expect(result).toEqual<GitDiffStats>({
      filesChanged: 2,
      insertions: 9,
      deletions: 6,
    });
  });

  it('parses insertions only', () => {
    const output = ` src/new.ts | 50 +++++
 1 file changed, 50 insertions(+)`;

    const result = parseGitDiffStat(output);
    expect(result).toEqual<GitDiffStats>({
      filesChanged: 1,
      insertions: 50,
      deletions: 0,
    });
  });

  it('parses deletions only', () => {
    const output = ` src/old.ts | 23 -----------------------
 1 file changed, 23 deletions(-)`;

    const result = parseGitDiffStat(output);
    expect(result).toEqual<GitDiffStats>({
      filesChanged: 1,
      insertions: 0,
      deletions: 23,
    });
  });

  it('returns zeros for empty output', () => {
    const result = parseGitDiffStat('');
    expect(result).toEqual<GitDiffStats>({
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
    });
  });

  it('returns zeros for non-matching output', () => {
    const result = parseGitDiffStat('no changes');
    expect(result).toEqual<GitDiffStats>({
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
    });
  });

  it('parses plural files changed', () => {
    const output = ` a.ts | 1 +
 b.ts | 2 ++
 c.ts | 3 +++
 3 files changed, 6 insertions(+)`;

    const result = parseGitDiffStat(output);
    expect(result).toEqual<GitDiffStats>({
      filesChanged: 3,
      insertions: 6,
      deletions: 0,
    });
  });
});

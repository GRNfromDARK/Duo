/**
 * Pure functions for parsing git diff --stat output.
 * Source: FR-026 (AC-082)
 */

export interface GitDiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/**
 * Parse the summary line of `git diff --stat` output.
 * Example: " 3 files changed, 10 insertions(+), 5 deletions(-)"
 */
export function parseGitDiffStat(output: string): GitDiffStats {
  const zero: GitDiffStats = { filesChanged: 0, insertions: 0, deletions: 0 };
  if (!output) return zero;

  const filesMatch = output.match(/(\d+)\s+files?\s+changed/);
  const insMatch = output.match(/(\d+)\s+insertions?\(\+\)/);
  const delMatch = output.match(/(\d+)\s+deletions?\(-\)/);

  if (!filesMatch) return zero;

  return {
    filesChanged: parseInt(filesMatch[1], 10),
    insertions: insMatch ? parseInt(insMatch[1], 10) : 0,
    deletions: delMatch ? parseInt(delMatch[1], 10) : 0,
  };
}

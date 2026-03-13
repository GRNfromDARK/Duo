/**
 * God JSON extractor: extracts the last ```json ... ``` block from God CLI output
 * and validates it against a Zod schema.
 * Source: AR-002, OQ-002, OQ-003
 */

import { z, type ZodError } from 'zod';

export type ExtractResult<T> =
  | { success: true; data: T; sourceOutput?: string }
  | { success: false; error: string };

/**
 * Extract the last JSON code block from CLI text output and validate with Zod schema.
 * Returns null if no JSON block found (pure text output).
 * Returns ExtractResult with structured error if JSON parse or schema validation fails.
 */
export function extractGodJson<T>(
  output: string,
  schema: z.ZodSchema<T>,
): ExtractResult<T> | null {
  const jsonBlock = extractLastJsonBlock(output);
  if (jsonBlock === null) {
    return null;
  }

  return parseAndValidate(jsonBlock, schema);
}

/**
 * Extract the last ```json ... ``` code block from text.
 * Returns null if no JSON block found.
 */
function extractLastJsonBlock(text: string): string | null {
  // Match ```json ... ``` blocks (greedy per-block, but we take the last match)
  const pattern = /```json\s*\n([\s\S]*?)```/g;
  let lastMatch: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    lastMatch = match[1].trim();
  }

  return lastMatch;
}

/**
 * Parse JSON string and validate against Zod schema.
 */
function parseAndValidate<T>(
  jsonString: string,
  schema: z.ZodSchema<T>,
): ExtractResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    return {
      success: false,
      error: `JSON parse error: ${(e as Error).message}`,
    };
  }

  const result = schema.safeParse(parsed);
  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: formatZodError(result.error),
  };
}

/**
 * Extract with retry: if first extraction fails (JSON parse or schema validation),
 * call retryFn with error hint, then try once more.
 * Pure text (no JSON block) does NOT retry — returns null immediately.
 */
export async function extractWithRetry<T>(
  output: string,
  schema: z.ZodSchema<T>,
  retryFn: (errorHint: string) => Promise<string>,
): Promise<ExtractResult<T> | null> {
  const firstResult = extractGodJson(output, schema);

  // No JSON block found → no retry
  if (firstResult === null) {
    return null;
  }

  // First attempt succeeded
  if (firstResult.success) {
    return { ...firstResult, sourceOutput: output };
  }

  // First attempt failed → retry once with error hint
  const retryOutput = await retryFn(firstResult.error);
  const retryResult = extractGodJson(retryOutput, schema);

  // Retry produced no JSON block or failed → return null
  if (retryResult === null || !retryResult.success) {
    return null;
  }

  return { ...retryResult, sourceOutput: retryOutput };
}

/**
 * Format Zod validation error into a human-readable string with paths.
 */
function formatZodError(error: ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  return `Schema validation failed: ${issues.join('; ')}`;
}

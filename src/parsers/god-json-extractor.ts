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
 *
 * BUG-23 fix: tries multiple extraction strategies in order:
 * 1. Code-fenced JSON block (case-insensitive: ```json, ```JSON, ```Json)
 * 2. Bare JSON object (first { to last } in text)
 *
 * Returns null only if no JSON can be found at all.
 * Returns ExtractResult with structured error if JSON parse or schema validation fails.
 */
export function extractGodJson<T>(
  output: string,
  schema: z.ZodSchema<T>,
): ExtractResult<T> | null {
  // Strategy 1: code-fenced JSON block (case-insensitive)
  const jsonBlock = extractLastJsonBlock(output);
  if (jsonBlock !== null) {
    return parseAndValidate(jsonBlock, schema);
  }

  // Strategy 2: bare JSON object (BUG-23 fix)
  const bareJson = extractBareJsonObject(output);
  if (bareJson !== null) {
    return parseAndValidate(bareJson, schema);
  }

  return null;
}

/**
 * Extract the last ```json ... ``` code block from text.
 *
 * Uses a state-machine JSON scanner instead of regex to handle JSON strings
 * that contain triple backticks (e.g. Markdown code fences in message fields).
 * The scanner tracks braceDepth, inString, and escaped states to find the
 * complete top-level JSON object regardless of string content.
 *
 * Returns null if no JSON block found.
 */
function extractLastJsonBlock(text: string): string | null {
  // Find all ```json fence openings (case-insensitive)
  const fencePattern = /```json\s*\n/gi;
  let lastJsonBody: string | null = null;
  let fenceMatch: RegExpExecArray | null;

  while ((fenceMatch = fencePattern.exec(text)) !== null) {
    const bodyStart = fenceMatch.index + fenceMatch[0].length;
    const jsonBody = extractJsonObjectByScanning(text, bodyStart);
    if (jsonBody !== null) {
      lastJsonBody = jsonBody;
    }
  }

  return lastJsonBody;
}

/**
 * State-machine scanner: starting from `offset`, find the first '{' and scan
 * forward tracking brace depth, string boundaries, and escape sequences
 * to locate the matching '}' that closes the top-level object.
 *
 * Returns the trimmed JSON substring, or null if no complete object is found.
 */
function extractJsonObjectByScanning(text: string, offset: number): string | null {
  // Find the opening brace
  let i = offset;
  while (i < text.length && text[i] !== '{') {
    i++;
  }
  if (i >= text.length) return null;

  const jsonStart = i;
  let braceDepth = 0;
  let inString = false;
  let escaped = false;

  for (; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      braceDepth++;
    } else if (ch === '}') {
      braceDepth--;
      if (braceDepth === 0) {
        return text.slice(jsonStart, i + 1).trim();
      }
    }
  }

  // Unbalanced braces — no complete object found
  return null;
}

/**
 * BUG-23 fix: Extract a bare JSON object from text.
 * Finds the first '{' and the matching last '}' to extract a JSON object.
 * Returns null if no valid JSON object boundary found.
 */
function extractBareJsonObject(text: string): string | null {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return text.slice(firstBrace, lastBrace + 1).trim();
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
 *
 * BUG-23 fix: never returns null — always returns ExtractResult with error details
 * so callers can log the specific failure reason and raw output.
 */
export async function extractWithRetry<T>(
  output: string,
  schema: z.ZodSchema<T>,
  retryFn: (errorHint: string) => Promise<string>,
): Promise<ExtractResult<T>> {
  const firstResult = extractGodJson(output, schema);

  // No JSON found at all → return error with details (BUG-23: was returning null)
  if (firstResult === null) {
    return {
      success: false,
      error: `No JSON found in output (no code-fenced block, no bare JSON object). Output length: ${output.length} chars`,
    };
  }

  // First attempt succeeded
  if (firstResult.success) {
    return { ...firstResult, sourceOutput: output };
  }

  // First attempt found JSON but validation failed → retry once with error hint
  const retryOutput = await retryFn(firstResult.error);
  const retryResult = extractGodJson(retryOutput, schema);

  // Retry produced no JSON
  if (retryResult === null) {
    return {
      success: false,
      error: `Retry also failed: no JSON found in retry output. Original error: ${firstResult.error}`,
    };
  }

  // Retry found JSON but validation still failed
  if (!retryResult.success) {
    return {
      success: false,
      error: `Retry validation failed: ${retryResult.error}. Original error: ${firstResult.error}`,
    };
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

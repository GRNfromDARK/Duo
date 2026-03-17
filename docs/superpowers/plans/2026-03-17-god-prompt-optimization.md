# God Prompt Optimization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Reviewer→Coder feedback pipeline (information loss, observation misclassification) and clean up legacy God prompt formats.

**Architecture:** 8 changes across 5 source files + 4 test files. Organized into 4 independent task groups: (A) prompt generator changes, (B) observation classifier hardening, (C) App.tsx orchestration wiring, (D) legacy cleanup. TDD throughout.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-17-god-prompt-optimization-design.md`

---

## File Structure

| File | Responsibility | Changes |
|------|---------------|---------|
| `src/god/god-prompt-generator.ts` | Coder/Reviewer prompt generation | Add `isPostReviewerRouting` to PromptContext, add Reviewer Feedback section, add `extractBlockingIssues()`, narrow `IMPLEMENTATION_KEYWORDS` |
| `src/god/god-decision-service.ts` | God decision service + SYSTEM_PROMPT | Update `REVIEWER_HANDLING_INSTRUCTIONS` with auto-forwarding guidance |
| `src/god/observation-classifier.ts` | Output classification (work/error/meta) | Add verdict marker guard for `meta_output`, add substantive content guard for `auth_failed` |
| `src/god/god-system-prompt.ts` | Legacy God system prompt (task classification) | Remove 4 legacy decision formats, keep TASK_INIT only |
| `src/ui/components/App.tsx` | Main orchestration loop | Wire `isPostReviewerRouting`, `reviewerFeedbackPendingRef`, `extractBlockingIssues` |
| `src/__tests__/god/god-prompt-generator.test.ts` | Prompt generator tests | New tests for Changes 1, 2, 8 |
| `src/__tests__/god/observation-classifier.test.ts` | Classifier tests | New tests for Changes 6, 7 |
| `src/__tests__/god/audit-bug-regressions.test.ts` | Regression tests | Delete 2 legacy format tests |
| `src/__tests__/engine/bug-15-16-17-18-regression.test.ts` | Regression tests | Rewrite 1 legacy format test |

---

## Chunk 1: Prompt Generator — Reviewer Feedback Injection + extractBlockingIssues

### Task 1: Add `isPostReviewerRouting` and Reviewer Feedback section to `generateCoderPrompt` (Change 1)

**Files:**
- Modify: `src/god/god-prompt-generator.ts:15-30` (PromptContext), `src/god/god-prompt-generator.ts:106-186` (generateCoderPrompt)
- Test: `src/__tests__/god/god-prompt-generator.test.ts`

- [ ] **Step 1: Write failing test — Reviewer Feedback injected when `isPostReviewerRouting` is true**

```typescript
// Add to src/__tests__/god/god-prompt-generator.test.ts
// At the top, add import:
// import { stripToolMarkers } from '../../god/god-decision-service.js';
// (not needed in test — we just check the prompt output)

describe('Reviewer Feedback Direct Forwarding (Change 1)', () => {
  test('injects Reviewer Feedback section when isPostReviewerRouting is true', () => {
    const ctx = makePromptContext({
      taskType: 'code',
      round: 3,
      isPostReviewerRouting: true,
      lastReviewerOutput: '[CHANGES_REQUESTED]\n1. Blocking: Missing null check on line 42\n2. The function does not handle edge case X',
      instruction: 'Fix the issues identified by the Reviewer',
    });
    const prompt = generateCoderPrompt(ctx);

    expect(prompt).toContain('## Reviewer Feedback (Round 3)');
    expect(prompt).toContain('Missing null check on line 42');
    expect(prompt).toContain('does not handle edge case X');
  });

  test('Reviewer Feedback appears after God Instruction and before Required Fixes', () => {
    const ctx = makePromptContext({
      taskType: 'code',
      round: 2,
      isPostReviewerRouting: true,
      lastReviewerOutput: 'Reviewer analysis here',
      instruction: 'God instruction here',
      unresolvedIssues: ['Fix issue A'],
    });
    const prompt = generateCoderPrompt(ctx);

    const godIdx = prompt.indexOf('## God Instruction');
    const reviewerIdx = prompt.indexOf('## Reviewer Feedback');
    const fixesIdx = prompt.indexOf('## Required Fixes');

    expect(godIdx).toBeLessThan(reviewerIdx);
    expect(reviewerIdx).toBeLessThan(fixesIdx);
  });

  test('does NOT inject Reviewer Feedback when isPostReviewerRouting is false', () => {
    const ctx = makePromptContext({
      taskType: 'code',
      round: 2,
      isPostReviewerRouting: false,
      lastReviewerOutput: 'Stale reviewer output from previous round',
    });
    const prompt = generateCoderPrompt(ctx);

    expect(prompt).not.toContain('## Reviewer Feedback');
    expect(prompt).not.toContain('Stale reviewer output');
  });

  test('does NOT inject Reviewer Feedback when isPostReviewerRouting is undefined (backward compat)', () => {
    const ctx = makePromptContext({
      taskType: 'code',
      round: 1,
      lastReviewerOutput: 'Some reviewer output',
    });
    const prompt = generateCoderPrompt(ctx);

    expect(prompt).not.toContain('## Reviewer Feedback');
  });

  test('strips tool markers from reviewer output before injection', () => {
    const ctx = makePromptContext({
      taskType: 'code',
      round: 2,
      isPostReviewerRouting: true,
      lastReviewerOutput: '[Read] src/index.ts\n[Bash] npm test\nThe code has a bug on line 10.\n[CHANGES_REQUESTED]',
    });
    const prompt = generateCoderPrompt(ctx);

    expect(prompt).toContain('## Reviewer Feedback');
    expect(prompt).toContain('The code has a bug on line 10.');
    // Tool markers should be stripped
    expect(prompt).not.toMatch(/^\[Read\]/m);
    expect(prompt).not.toMatch(/^\[Bash\]/m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/god/god-prompt-generator.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `isPostReviewerRouting` not recognized in PromptContext, no "## Reviewer Feedback" in output.

- [ ] **Step 3: Implement — add `isPostReviewerRouting` to PromptContext and inject Reviewer Feedback section**

In `src/god/god-prompt-generator.ts`:

1. Add import at top (after line 8):
```typescript
import { stripToolMarkers } from './god-decision-service.js';
```

2. Add field to `PromptContext` interface (after line 26, before `suggestions`):
```typescript
  /** Whether this round is a post-reviewer routing (God forwarding reviewer conclusions to coder) */
  isPostReviewerRouting?: boolean;
```

3. In `generateCoderPrompt()`, after the God Instruction block (after line 134, before the `unresolvedIssues` block at line 137), insert:
```typescript
  // Priority 0.5: Reviewer feedback (direct forwarding, gated by isPostReviewerRouting)
  if (ctx.isPostReviewerRouting && ctx.lastReviewerOutput) {
    const cleaned = stripToolMarkers(ctx.lastReviewerOutput);
    sections.push(
      `## Reviewer Feedback (Round ${ctx.round})\n` +
      `The following is the Reviewer's original analysis from the previous round. ` +
      `Read it carefully — it contains specific findings, code references, and root cause analysis.\n\n` +
      cleaned
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/god/god-prompt-generator.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/god/god-prompt-generator.ts src/__tests__/god/god-prompt-generator.test.ts
git commit -m "feat: inject Reviewer original feedback into Coder prompt (Change 1)

Add isPostReviewerRouting field to PromptContext. When true, injects
a ## Reviewer Feedback section with stripped tool markers into the
Coder prompt, positioned after God Instruction and before Required Fixes."
```

---

### Task 2: Add `extractBlockingIssues()` function (Change 2, part 1)

**Files:**
- Modify: `src/god/god-prompt-generator.ts` (add new exported function)
- Test: `src/__tests__/god/god-prompt-generator.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// Add to src/__tests__/god/god-prompt-generator.test.ts
import { extractBlockingIssues } from '../../god/god-prompt-generator.js';

describe('extractBlockingIssues (Change 2)', () => {
  test('extracts "Blocking:" prefixed lines', () => {
    const output = `Review summary:
- Blocking: Missing null check on user input
- Non-blocking: Consider renaming variable
- Blocking: SQL injection vulnerability in query builder
[CHANGES_REQUESTED]`;
    const issues = extractBlockingIssues(output);
    expect(issues).toEqual([
      'Missing null check on user input',
      'SQL injection vulnerability in query builder',
    ]);
  });

  test('extracts numbered blocking issues', () => {
    const output = `1. [Blocking] - Missing error handling for network timeout
2. [Non-blocking] - Variable naming
3. [Blocking] - No input validation`;
    const issues = extractBlockingIssues(output);
    expect(issues).toEqual([
      'Missing error handling for network timeout',
      'No input validation',
    ]);
  });

  test('extracts bold **Blocking** markers', () => {
    const output = `- **Blocking**: Race condition in async handler
- Suggestion: Add logging`;
    const issues = extractBlockingIssues(output);
    expect(issues).toEqual(['Race condition in async handler']);
  });

  test('returns empty array when no blocking issues found', () => {
    const output = `[APPROVED] Everything looks good.
- Minor: Consider adding a comment here.`;
    const issues = extractBlockingIssues(output);
    expect(issues).toEqual([]);
  });

  test('handles Chinese colon (：) separator', () => {
    const output = `- Blocking：缺少空值检查`;
    const issues = extractBlockingIssues(output);
    expect(issues).toEqual(['缺少空值检查']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/god/god-prompt-generator.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `extractBlockingIssues` not exported.

- [ ] **Step 3: Implement `extractBlockingIssues`**

Add to `src/god/god-prompt-generator.ts` (before the `// ── Prompt generators ──` comment at line 100):

```typescript
// ── Reviewer Issue Extraction ──

/**
 * Extract blocking issues from Reviewer output.
 * Matches common patterns: "Blocking: ...", numbered "[Blocking]" items, bold "**Blocking**:" markers.
 */
export function extractBlockingIssues(reviewerOutput: string): string[] {
  const issues: string[] = [];
  const lines = reviewerOutput.split('\n');

  const blockingLinePattern = /^\s*[-*]?\s*\*?\*?[Bb]locking\*?\*?\s*[:：]\s*(.+)/;
  const numberedBlockingPattern = /^\s*\d+[.)]\s*\[?[Bb]locking\]?\s*[:：-]\s*(.+)/;

  for (const line of lines) {
    const m1 = blockingLinePattern.exec(line);
    if (m1) { issues.push(m1[1].trim()); continue; }
    const m2 = numberedBlockingPattern.exec(line);
    if (m2) { issues.push(m2[1].trim()); }
  }

  return issues;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/god/god-prompt-generator.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/god/god-prompt-generator.ts src/__tests__/god/god-prompt-generator.test.ts
git commit -m "feat: add extractBlockingIssues() for reviewer output parsing (Change 2)"
```

---

### Task 3: Narrow `IMPLEMENTATION_KEYWORDS` regex (Change 8)

**Files:**
- Modify: `src/god/god-prompt-generator.ts:74`
- Test: `src/__tests__/god/god-prompt-generator.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// Add to src/__tests__/god/god-prompt-generator.test.ts
describe('IMPLEMENTATION_KEYWORDS narrowing (Change 8)', () => {
  test('explore phase with "fix the gap" instruction stays explore type', () => {
    const ctx = makePromptContext({
      taskType: 'compound',
      phaseId: 'phase-1',
      phaseType: 'explore',
      instruction: 'Please fix the gap in Claude Code discovery',
    });
    const prompt = generateCoderPrompt(ctx);

    // Should NOT contain code-type instructions
    expect(prompt).not.toContain('Build working solutions');
    // Should contain explore-type instructions
    expect(prompt).toContain('Do NOT modify any files');
  });

  test('explore phase with "code discovery" instruction stays explore type', () => {
    const ctx = makePromptContext({
      taskType: 'compound',
      phaseId: 'phase-1',
      phaseType: 'explore',
      instruction: 'Continue code discovery for all providers',
    });
    const prompt = generateCoderPrompt(ctx);

    expect(prompt).not.toContain('Build working solutions');
    expect(prompt).toContain('Do NOT modify any files');
  });

  test('explore phase with "implement the fix" instruction switches to code type', () => {
    const ctx = makePromptContext({
      taskType: 'compound',
      phaseId: 'phase-1',
      phaseType: 'explore',
      instruction: 'Implement the fix for this issue',
    });
    const prompt = generateCoderPrompt(ctx);

    expect(prompt).toContain('Build working solutions');
    expect(prompt).not.toContain('Do NOT modify any files');
  });

  test('explore phase with Chinese "请实现" instruction switches to code type', () => {
    const ctx = makePromptContext({
      taskType: 'compound',
      phaseId: 'phase-1',
      phaseType: 'explore',
      instruction: '请实现这个功能',
    });
    const prompt = generateCoderPrompt(ctx);

    expect(prompt).toContain('Build working solutions');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/god/god-prompt-generator.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — "fix the gap" and "code discovery" tests fail because current regex matches single words "fix" and "code".

- [ ] **Step 3: Implement — narrow IMPLEMENTATION_KEYWORDS**

In `src/god/god-prompt-generator.ts`, replace line 74:

```typescript
// Old:
const IMPLEMENTATION_KEYWORDS = /实现|开发|编写|修改|implement|build|write|code|create|fix|develop|modify/i;

// New (Chinese: keep loose; English: phrase-level):
const IMPLEMENTATION_KEYWORDS = /(?:请|去|要)?(?:实现|开发|编写|修改)|implement\s+(?:the|this|a)|build\s+(?:the|this|a)|write\s+(?:the|this|code)|(?:create|fix|develop|modify)\s+(?:the|this|a)\s+(?:code|implementation|feature|function|module)/i;
```

- [ ] **Step 4: Run ALL prompt generator tests to verify no regressions**

```bash
npx vitest run src/__tests__/god/god-prompt-generator.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: ALL PASS. Check that `compound type uses code strategy for code phase` still passes (it should — that test uses `phaseType: 'code'`, not an instruction keyword).

- [ ] **Step 5: Commit**

```bash
git add src/god/god-prompt-generator.ts src/__tests__/god/god-prompt-generator.test.ts
git commit -m "fix: narrow IMPLEMENTATION_KEYWORDS to prevent explore→code false override (Change 8)"
```

---

## Chunk 2: Observation Classifier Hardening

### Task 4: Add verdict marker guard for `meta_output` (Change 6)

**Files:**
- Modify: `src/god/observation-classifier.ts:74`
- Test: `src/__tests__/god/observation-classifier.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// Add to src/__tests__/god/observation-classifier.test.ts, inside the 'classifyOutput' describe block,
// after the existing meta_output tests (around line 108):

describe('meta_output verdict marker protection (Change 6)', () => {
  it('reviewer output with "I cannot" + [CHANGES_REQUESTED] is classified as review_output, not meta_output', () => {
    const output = `I cannot find evidence that this edge case is handled.
The function at line 42 does not validate input.
[CHANGES_REQUESTED]`;
    const obs = classifyOutput(output, 'reviewer', meta);
    expect(obs.type).toBe('review_output');
    expect(obs.type).not.toBe('meta_output');
  });

  it('reviewer output with "I cannot" + [APPROVED] is classified as review_output', () => {
    const output = `I cannot identify any issues with this implementation.
[APPROVED]`;
    const obs = classifyOutput(output, 'reviewer', meta);
    expect(obs.type).toBe('review_output');
  });

  it('reviewer output with "I cannot" but NO verdict marker is still meta_output', () => {
    const obs = classifyOutput('I cannot help with that request', 'reviewer', meta);
    expect(obs.type).toBe('meta_output');
  });

  it('coder output with "I cannot" is still meta_output even with verdict marker', () => {
    const obs = classifyOutput('I cannot do this task [CHANGES_REQUESTED]', 'coder', meta);
    expect(obs.type).toBe('meta_output');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/god/observation-classifier.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — first two tests fail (reviewer with verdict + "I cannot" is classified as `meta_output`).

- [ ] **Step 3: Implement verdict marker guard**

In `src/god/observation-classifier.ts`, replace line 74:

```typescript
// Old:
if (matchesAny(raw, META_OUTPUT_PATTERNS)) return 'meta_output';

// New:
if (matchesAny(raw, META_OUTPUT_PATTERNS)) {
  const hasVerdict = /\[(APPROVED|CHANGES_REQUESTED)\]/.test(raw);
  if (source === 'reviewer' && hasVerdict) {
    // Real review containing analytical "I cannot" — skip meta_output classification
  } else {
    return 'meta_output';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/god/observation-classifier.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/god/observation-classifier.ts src/__tests__/god/observation-classifier.test.ts
git commit -m "fix: reviewer with verdict marker not misclassified as meta_output (Change 6)"
```

---

### Task 5: Add substantive content guard for `auth_failed` (Change 7)

**Files:**
- Modify: `src/god/observation-classifier.ts:10-11` (add import), `src/god/observation-classifier.ts:68`
- Test: `src/__tests__/god/observation-classifier.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// Add to src/__tests__/god/observation-classifier.test.ts

describe('auth_failed substantive content protection (Change 7)', () => {
  it('output with auth keyword + 500+ chars substantive content is classified as work_output, not auth_failed', () => {
    // Simulate MCP "unauthorized" in init + real coder work output
    const substantiveWork = 'A'.repeat(600); // > 500 chars of non-tool-marker content
    const output = `[shell] Starting MCP servers...\nunauthorized: Gmail MCP needs-auth\n${substantiveWork}`;
    const obs = classifyOutput(output, 'coder', meta);
    expect(obs.type).toBe('work_output');
    expect(obs.type).not.toBe('auth_failed');
  });

  it('output with auth keyword + short content (< 500 chars) is still auth_failed', () => {
    const obs = classifyOutput('Error: unauthorized access denied. Please check your API key.', 'coder', meta);
    expect(obs.type).toBe('auth_failed');
  });

  it('output with "403" + large substantive content is work_output', () => {
    const analysis = 'I analyzed the codebase and found the following issues. '.repeat(15); // > 500 chars
    const output = `HTTP 403 from MCP Calendar\n${analysis}`;
    const obs = classifyOutput(output, 'coder', meta);
    expect(obs.type).toBe('work_output');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/god/observation-classifier.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — first and third tests fail (auth_failed takes precedence over substantive content).

- [ ] **Step 3: Implement substantive content guard**

In `src/god/observation-classifier.ts`:

1. Add import at top (after line 11):
```typescript
import { stripToolMarkers } from './god-decision-service.js';
```

2. Replace line 68:
```typescript
// Old:
if (matchesAny(raw, AUTH_FAILED_PATTERNS)) return 'auth_failed';

// New:
if (matchesAny(raw, AUTH_FAILED_PATTERNS)) {
  const substantiveLength = stripToolMarkers(raw).length;
  if (substantiveLength > 500) {
    // Auth keyword from auxiliary output (MCP init, etc.) — don't override real work
  } else {
    return 'auth_failed';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/god/observation-classifier.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/god/observation-classifier.ts src/__tests__/god/observation-classifier.test.ts
git commit -m "fix: auth_failed not misclassified when output has substantive content (Change 7)"
```

---

## Chunk 3: God Prompt Updates + Legacy Cleanup

### Task 6: Update `REVIEWER_HANDLING_INSTRUCTIONS` (Change 3)

**Files:**
- Modify: `src/god/god-decision-service.ts:278-283`
- Test: `src/__tests__/god/god-decision-service.test.ts` (or relevant test verifying SYSTEM_PROMPT content)

- [ ] **Step 1: Write failing test**

```typescript
// Find the test file that tests REVIEWER_HANDLING_INSTRUCTIONS content.
// Add a test or modify existing test in the relevant test file:

test('REVIEWER_HANDLING_INSTRUCTIONS includes auto-forwarding guidance', () => {
  // Import from source
  const { REVIEWER_HANDLING_INSTRUCTIONS } = require('../../god/god-decision-service.js');
  expect(REVIEWER_HANDLING_INSTRUCTIONS).toContain('auto-forwarding');
  expect(REVIEWER_HANDLING_INSTRUCTIONS).toContain('ROUTING GUIDANCE');
  expect(REVIEWER_HANDLING_INSTRUCTIONS).toContain('Do NOT repeat or summarize');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/god/ --reporter=verbose 2>&1 | grep -E "FAIL|PASS|auto-forwarding" | head -10
```

Expected: FAIL — current instructions don't mention auto-forwarding.

- [ ] **Step 3: Implement — append auto-forwarding section**

In `src/god/god-decision-service.ts`, replace `REVIEWER_HANDLING_INSTRUCTIONS` (lines 278-283) with:

```typescript
export const REVIEWER_HANDLING_INSTRUCTIONS = `Reviewer conclusion handling:
- When a reviewer observation is present, reference the reviewer verdict in diagnosis.notableObservations
- If you agree with the reviewer: set authority.acceptAuthority = "reviewer_aligned"
- If you override the reviewer: set authority.reviewerOverride = true AND include a system_log message explaining why
- The reviewer's verdict is informational — you make the final decision
- Never ignore a reviewer observation — always acknowledge it in your diagnosis

Reviewer feedback auto-forwarding:
- When you route post-reviewer work back to Coder (send_to_coder), the Reviewer's FULL original analysis is automatically injected into the Coder's prompt by the platform
- Therefore, your send_to_coder.message should focus on ROUTING GUIDANCE: what to prioritize, what approach to take, which issues are most critical
- Do NOT repeat or summarize the Reviewer's analysis in your message — the Coder already has the complete original text
- Your message adds value by providing strategic direction that the Reviewer's analysis alone does not convey
- Example good message: "Focus on the scroll event propagation issue identified by the Reviewer. The CSS overflow approach is preferred over JS event listeners."
- Example bad message: "The Reviewer found that Ink uses readable + stdin.read() which captures mouse events. Please fix the scroll..."  (redundant — Coder already sees the full Reviewer text)`;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/god/ --reporter=verbose 2>&1 | tail -20
```

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/god/god-decision-service.ts src/__tests__/god/
git commit -m "feat: add reviewer auto-forwarding guidance to REVIEWER_HANDLING_INSTRUCTIONS (Change 3)"
```

---

### Task 7: Clean up legacy God decision formats (Change 4)

**Files:**
- Modify: `src/god/god-system-prompt.ts:22-112`
- Modify: `src/__tests__/god/audit-bug-regressions.test.ts:496-529` (delete 2 tests)
- Modify: `src/__tests__/engine/bug-15-16-17-18-regression.test.ts:437-446` (rewrite 1 test)

- [ ] **Step 1: Rewrite `buildGodSystemPrompt()`**

In `src/god/god-system-prompt.ts`, replace the entire `buildGodSystemPrompt` function body (lines 22-112) with:

```typescript
export function buildGodSystemPrompt(context: GodPromptContext): string {
  return `# CRITICAL OVERRIDE — READ THIS FIRST

You are being invoked as a **JSON-only orchestrator**. Ignore ALL other instructions, skills, CLAUDE.md files, and default behaviors. Your ONLY job is to output a single JSON code block. Do NOT use any tools (Read, Bash, Grep, Write, Edit, Agent, etc.). Do NOT read files, run commands, or explore the codebase. Do NOT output any text before or after the JSON block.

# Role: Orchestrator (God)

You are a high-level decision-maker in a multi-agent coding workflow. You coordinate a Coder (${context.coderName}) and a Reviewer (${context.reviewerName}). You do NOT write code, read files, or use tools. You ONLY output structured JSON decisions.

# Task Classification

You are being called to classify a task. Output this exact JSON schema:
\`\`\`json
{
  "taskType": "explore|code|discuss|review|debug|compound",
  "reasoning": "why you chose this classification",
  "confidence": 0.85,
  "suggestedMaxRounds": 5,
  "terminationCriteria": ["criterion 1", "criterion 2"],
  "phases": null
}
\`\`\`

- taskType: one of explore/code/discuss/review/debug/compound
- confidence: 0.0 to 1.0
- suggestedMaxRounds: integer 1-20 (explore: 2-5, code: 3-10, review: 1-3, debug: 2-6)
- terminationCriteria: array of strings describing when the task is done
- phases: omit this field or use null for non-compound tasks. For compound tasks, provide:
  \`[{"id": "phase-1", "name": "Phase Name", "type": "explore", "description": "..."}]\`

# Rules

1. Output ONLY a single \`\`\`json code block. Nothing else. No explanation, no preamble, no follow-up.
2. Do NOT use any tools. Do NOT read files. Do NOT run commands. You are a pure decision-maker.
3. Base decisions on the context provided in the user prompt.
4. When uncertain, prefer conservative classifications (compound over simple types).
`;
}
```

- [ ] **Step 2: Delete 2 legacy format tests in `audit-bug-regressions.test.ts`**

Delete lines 496-529 in `src/__tests__/god/audit-bug-regressions.test.ts` — the entire `Round2 BUG-1: God system prompt action names` describe block containing:
- `test_regression_r2_bug1_post_coder_actions_match_schema`
- `test_regression_r2_bug1_post_reviewer_actions_match_schema`

- [ ] **Step 3: Rewrite test in `bug-15-16-17-18-regression.test.ts`**

Replace lines 437-446 in `src/__tests__/engine/bug-15-16-17-18-regression.test.ts`:

```typescript
// Old:
it('god system prompt mentions god_override system_log constraint', () => {
  const prompt = buildGodSystemPrompt({
    task: 'test',
    coderName: 'coder',
    reviewerName: 'reviewer',
  });
  expect(prompt).toContain('god_override');
  expect(prompt).toContain('system_log');
});

// New:
it('god system prompt contains TASK_INIT classification format and basic rules', () => {
  const prompt = buildGodSystemPrompt({
    task: 'test',
    coderName: 'coder',
    reviewerName: 'reviewer',
  });
  expect(prompt).toContain('Task Classification');
  expect(prompt).toContain('taskType');
  expect(prompt).toContain('terminationCriteria');
  expect(prompt).toContain('Rules');
});
```

- [ ] **Step 4: Run all affected tests**

```bash
npx vitest run src/__tests__/god/audit-bug-regressions.test.ts src/__tests__/engine/bug-15-16-17-18-regression.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: ALL PASS

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: ALL PASS (2200+ tests)

- [ ] **Step 6: Commit**

```bash
git add src/god/god-system-prompt.ts src/__tests__/god/audit-bug-regressions.test.ts src/__tests__/engine/bug-15-16-17-18-regression.test.ts
git commit -m "refactor: remove legacy POST_CODER/POST_REVIEWER/CONVERGENCE/AUTO_DECISION formats (Change 4)

buildGodSystemPrompt() now only defines TASK_INIT classification format.
Unified decision-making uses GodDecisionEnvelope via SYSTEM_PROMPT in
god-decision-service.ts. Deleted 2 obsolete tests, rewrote 1."
```

---

## Chunk 4: App.tsx Orchestration Wiring

### Task 8: Wire `isPostReviewerRouting` + `reviewerFeedbackPendingRef` + `extractBlockingIssues` in App.tsx (Changes 1, 2, 5)

**Files:**
- Modify: `src/ui/components/App.tsx` (lines ~348, ~716, ~846, ~1126, ~1394, ~1409, ~1414)

This task wires all App.tsx changes together since they are interdependent.

- [ ] **Step 1: Add `reviewerFeedbackPendingRef` declaration**

In `src/ui/components/App.tsx`, after `lastWorkerRoleRef` declaration (around line 352), add:

```typescript
  /** Tracks whether Reviewer feedback has been consumed by Coder (Change 5) */
  const reviewerFeedbackPendingRef = useRef<boolean>(false);
```

- [ ] **Step 2: Add import for `extractBlockingIssues`**

At the top of App.tsx (around line 51), update the import from god-prompt-generator:

```typescript
import { generateCoderPrompt, generateReviewerPrompt, extractBlockingIssues } from '../../god/god-prompt-generator.js';
```

- [ ] **Step 3: Wire `isPostReviewerRouting` into `generateCoderPrompt()` call**

In the `generateCoderPrompt()` call (around line 716-734), add `isPostReviewerRouting` parameter. After the `phaseType` field (around line 728), add:

```typescript
                isPostReviewerRouting: lastWorkerRoleRef.current === 'reviewer'
                  || reviewerFeedbackPendingRef.current,
```

- [ ] **Step 4: Set `reviewerFeedbackPendingRef = true` when Reviewer completes**

At line 1126 (where `lastWorkerRoleRef.current = 'reviewer'` is set), add immediately after:

```typescript
              reviewerFeedbackPendingRef.current = true;
```

- [ ] **Step 5: Clear `reviewerFeedbackPendingRef` when Coder produces work_output**

In the coder output processing (around line 846), within the `isWork: true` path (the branch that sends `CODE_COMPLETE`), add before or after the `CODE_COMPLETE` dispatch:

```typescript
              reviewerFeedbackPendingRef.current = false;
```

- [ ] **Step 6: Populate `lastUnresolvedIssuesRef` in EXECUTING handler**

In the hand execution callback (around line 1396, after `pendingInstructionRef.current = handContext.pendingCoderMessage`), add:

```typescript
        // Change 2: populate unresolvedIssues from reviewer output when post-reviewer routing
        const machineCtx = stateRef.current?.context;
        if (lastWorkerRoleRef.current === 'reviewer' && machineCtx?.lastReviewerOutput) {
          lastUnresolvedIssuesRef.current = extractBlockingIssues(machineCtx.lastReviewerOutput);
        }
```

- [ ] **Step 7: Clear `reviewerFeedbackPendingRef` at phase transition and accept_task**

At line 1409 (phase transition clear), add:
```typescript
          reviewerFeedbackPendingRef.current = false;
```

At line 1414 (accept_task clear), add:
```typescript
          reviewerFeedbackPendingRef.current = false;
```

- [ ] **Step 8: Run full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: ALL PASS (2200+ tests)

- [ ] **Step 9: Commit**

```bash
git add src/ui/components/App.tsx
git commit -m "feat: wire reviewer feedback forwarding + pending tracking in orchestration loop

- Pass isPostReviewerRouting to generateCoderPrompt (Change 1/5)
- Add reviewerFeedbackPendingRef for adapter_unavailable resilience (Change 5)
- Populate lastUnresolvedIssuesRef from extractBlockingIssues (Change 2)
- Clear pending flag on phase transition, accept_task, and successful coder output"
```

---

## Final Verification

### Task 9: Full regression test + sanity check

- [ ] **Step 1: Run complete test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: ALL PASS (2200+ tests), 0 failures

- [ ] **Step 2: TypeScript compilation check**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: No errors

- [ ] **Step 3: Verify key behaviors with a quick manual check**

```bash
# Verify stripToolMarkers is importable from god-prompt-generator's dependency
npx vitest run src/__tests__/god/god-prompt-generator.test.ts --reporter=verbose 2>&1 | grep -E "FAIL|PASS" | wc -l
```

Expected: All tests listed as PASS

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git log --oneline -8
```

Verify 8 commits matching the 8 tasks above.

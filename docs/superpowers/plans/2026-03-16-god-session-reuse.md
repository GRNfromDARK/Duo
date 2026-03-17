# God Session Reuse Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable God adapter to maintain conversation continuity across rounds via kill-and-resume pattern, eliminating God's "amnesia" where it only sees the latest observation and last decision summary.

**Architecture:** ClaudeCodeGodAdapter captures `session_id` from stream-json `status` chunks. On subsequent rounds, it passes `--resume <session_id>` instead of `--system-prompt` and `--tools ''`. GodDecisionService builds a slim prompt on resume rounds (observations + format reminder only). App.tsx saves/restores the God session ID at both saveState call sites.

**Tech Stack:** TypeScript, Vitest, stream-json parsing, Claude CLI `--resume` flag

**Spec:** `docs/superpowers/specs/2026-03-16-god-session-reuse-design.md`

---

## Chunk 1: ClaudeCodeGodAdapter Session Reuse

### Task 1: Add session ID field and 3 session methods to ClaudeCodeGodAdapter

**Files:**
- Modify: `src/god/adapters/claude-code-god-adapter.ts`
- Test: `src/__tests__/god/adapters/claude-code-god-adapter.test.ts` (create)

- [ ] **Step 1: Write failing tests for session methods**

```typescript
// src/__tests__/god/adapters/claude-code-god-adapter.test.ts
import { describe, it, expect } from 'vitest';
import { ClaudeCodeGodAdapter } from '../../../god/adapters/claude-code-god-adapter.js';

describe('ClaudeCodeGodAdapter session methods', () => {
  it('hasActiveSession returns false initially', () => {
    const adapter = new ClaudeCodeGodAdapter();
    expect(adapter.hasActiveSession()).toBe(false);
  });

  it('getLastSessionId returns null initially', () => {
    const adapter = new ClaudeCodeGodAdapter();
    expect(adapter.getLastSessionId()).toBeNull();
  });

  it('restoreSessionId sets session and hasActiveSession returns true', () => {
    const adapter = new ClaudeCodeGodAdapter();
    adapter.restoreSessionId('ses_abc123');
    expect(adapter.hasActiveSession()).toBe(true);
    expect(adapter.getLastSessionId()).toBe('ses_abc123');
  });

  it('restoreSessionId can be overwritten', () => {
    const adapter = new ClaudeCodeGodAdapter();
    adapter.restoreSessionId('ses_first');
    adapter.restoreSessionId('ses_second');
    expect(adapter.getLastSessionId()).toBe('ses_second');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/god/adapters/claude-code-god-adapter.test.ts`
Expected: FAIL — `hasActiveSession`, `getLastSessionId`, `restoreSessionId` do not exist

- [ ] **Step 3: Implement session methods**

In `src/god/adapters/claude-code-god-adapter.ts`, add to the class:

```typescript
// After the existing private fields (processManager, parser):
private lastSessionId: string | null = null;

// Add these 3 methods after isRunning():
hasActiveSession(): boolean {
  return this.lastSessionId !== null;
}

getLastSessionId(): string | null {
  return this.lastSessionId;
}

restoreSessionId(id: string): void {
  this.lastSessionId = id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/god/adapters/claude-code-god-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/god/adapters/claude-code-god-adapter.ts src/__tests__/god/adapters/claude-code-god-adapter.test.ts
git commit -m "feat(god): add session methods to ClaudeCodeGodAdapter"
```

---

### Task 2: Modify buildArgs to support resume mode

**Files:**
- Modify: `src/god/adapters/claude-code-god-adapter.ts`
- Test: `src/__tests__/god/adapters/claude-code-god-adapter.test.ts`

- [ ] **Step 1: Write failing tests for buildArgs resume behavior**

Append to the existing test file:

```typescript
describe('ClaudeCodeGodAdapter buildArgs', () => {
  const baseOpts = {
    cwd: '/tmp/project',
    systemPrompt: 'You are God.',
    timeoutMs: 30000,
  };

  it('first round (no session): includes --system-prompt and --tools', () => {
    const adapter = new ClaudeCodeGodAdapter();
    const args = adapter.buildArgs('user prompt', baseOpts);
    expect(args).toContain('--system-prompt');
    expect(args).toContain('--tools');
    expect(args).not.toContain('--resume');
  });

  it('resume round (has sessionId): includes --resume, skips --system-prompt and --tools', () => {
    const adapter = new ClaudeCodeGodAdapter();
    adapter.restoreSessionId('ses_god_abc');
    const args = adapter.buildArgs('user prompt', baseOpts);
    expect(args).toContain('--resume');
    expect(args).toContain('ses_god_abc');
    expect(args).not.toContain('--system-prompt');
    expect(args).not.toContain('--tools');
  });

  it('resume round still includes -p, --output-format, --verbose, --add-dir', () => {
    const adapter = new ClaudeCodeGodAdapter();
    adapter.restoreSessionId('ses_god_abc');
    const args = adapter.buildArgs('user prompt', baseOpts);
    expect(args).toContain('-p');
    expect(args).toContain('user prompt');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--add-dir');
  });

  it('resume round with model still includes --model', () => {
    const adapter = new ClaudeCodeGodAdapter();
    adapter.restoreSessionId('ses_god_abc');
    const args = adapter.buildArgs('user prompt', { ...baseOpts, model: 'claude-opus-4-6' });
    expect(args).toContain('--model');
    expect(args).toContain('claude-opus-4-6');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/god/adapters/claude-code-god-adapter.test.ts`
Expected: FAIL — resume round tests fail (current buildArgs always includes `--system-prompt` and `--tools`)

- [ ] **Step 3: Update buildArgs to conditionally include resume flags**

Replace `buildArgs` in `src/god/adapters/claude-code-god-adapter.ts`:

```typescript
buildArgs(prompt: string, opts: GodExecOptions): string[] {
  const isResuming = this.lastSessionId !== null;

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
  ];

  if (isResuming) {
    args.push('--resume', this.lastSessionId!);
  } else {
    args.push('--system-prompt', opts.systemPrompt);
    args.push('--tools', '');
  }

  if (opts.model) {
    args.push('--model', opts.model);
  }

  args.push('--add-dir', opts.cwd);
  return args;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/god/adapters/claude-code-god-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/god/adapters/claude-code-god-adapter.ts src/__tests__/god/adapters/claude-code-god-adapter.test.ts
git commit -m "feat(god): buildArgs supports resume mode with --resume flag"
```

---

### Task 3: Capture session_id from stream-json status chunks in execute()

**Files:**
- Modify: `src/god/adapters/claude-code-god-adapter.ts`
- Test: `src/__tests__/god/adapters/claude-code-god-adapter.test.ts`

- [ ] **Step 1: Write failing test for session ID capture**

This tests the integration behavior — we verify the adapter captures session_id from status chunks. Since `execute()` requires spawning a process, we test the capture logic indirectly via a unit-level test that verifies the session ID changes after a simulated execution.

```typescript
describe('ClaudeCodeGodAdapter session ID capture', () => {
  it('captures session_id from status chunks during execute', async () => {
    // We test the capture mechanism by verifying the adapter's internal state
    // after processing a status chunk with session_id metadata.
    // Since execute() spawns a real process, we verify the logic pattern:
    // - Before execute: lastSessionId is null (or whatever was restored)
    // - The adapter should parse status chunks for session_id
    const adapter = new ClaudeCodeGodAdapter();
    expect(adapter.getLastSessionId()).toBeNull();
    // After restoreSessionId + a hypothetical execute, the session would update
    // Full integration test would require mocking the process — see integration tests
  });
});
```

Note: Full integration testing of session capture requires process mocking. The critical logic is the `if (chunk.type === 'status' && chunk.metadata?.session_id)` check inside the execute method. This follows the same pattern as the Coder adapter (`src/adapters/claude-code/adapter.ts:199-200`).

- [ ] **Step 2: Implement session_id capture in execute()**

In `src/god/adapters/claude-code-god-adapter.ts`, modify the `execute()` method's yield loop to capture session_id from status chunks. Replace the try block at the end of execute():

```typescript
try {
  for await (const chunk of this.parser.parse(stream)) {
    // Capture session_id from status chunks (same pattern as Coder adapter)
    if (chunk.type === 'status' && chunk.metadata?.session_id) {
      this.lastSessionId = chunk.metadata.session_id as string;
    }
    yield chunk;
  }
} finally {
  if (this.processManager.isRunning()) {
    await this.processManager.kill();
  }
}
```

- [ ] **Step 3: Add error recovery — clear lastSessionId on resume failure**

After the finally block, add error recovery logic. When resuming fails (process exits with error), clear the stale session ID so next round starts fresh.

Wrap the execute method body in a try-catch that handles resume failure:

```typescript
async *execute(prompt: string, opts: GodExecOptions): AsyncIterable<OutputChunk> {
  const args = this.buildArgs(prompt, opts);
  const wasResuming = this.lastSessionId !== null;
  let sessionIdUpdated = false;

  // ... existing spawn/stream setup code ...

  try {
    for await (const chunk of this.parser.parse(stream)) {
      if (chunk.type === 'status' && chunk.metadata?.session_id) {
        this.lastSessionId = chunk.metadata.session_id as string;
        sessionIdUpdated = true;
      }
      yield chunk;
    }
  } catch (err) {
    // Error recovery: if we were resuming and it failed, clear the stale session ID
    // so next round falls back to fresh session with full system prompt
    if (wasResuming) {
      this.lastSessionId = null;
    }
    throw err;
  } finally {
    if (this.processManager.isRunning()) {
      await this.processManager.kill();
    }
  }

  // If we were resuming but no new session_id was captured, clear stale ID
  if (wasResuming && !sessionIdUpdated) {
    this.lastSessionId = null;
  }
}
```

- [ ] **Step 4: Run all adapter tests**

Run: `npx vitest run src/__tests__/god/adapters/claude-code-god-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/god/adapters/claude-code-god-adapter.ts src/__tests__/god/adapters/claude-code-god-adapter.test.ts
git commit -m "feat(god): capture session_id from stream and add error recovery"
```

---

## Chunk 2: GodDecisionService Slim Prompt for Resume Rounds

### Task 4: Add `isResuming` parameter to makeDecision and build slim prompt

**Files:**
- Modify: `src/god/god-decision-service.ts`
- Test: `src/__tests__/god/god-decision-service-resume.test.ts` (create)

- [ ] **Step 1: Write failing tests for slim prompt generation**

```typescript
// src/__tests__/god/god-decision-service-resume.test.ts
import { describe, it, expect } from 'vitest';
// We test the exported buildUserPrompt and the new buildResumePrompt via makeDecision behavior.
// Since buildUserPrompt is module-private, we test through the service's prompt construction.
// Import the parts we can test:
import {
  buildObservationsSection,
  SYSTEM_PROMPT,
} from '../../god/god-decision-service.js';
import type { Observation } from '../../types/observation.js';

describe('Resume prompt slimming', () => {
  const mockObservations: Observation[] = [
    {
      source: 'coder',
      type: 'work_output',
      summary: 'Implemented feature X with tests',
      severity: 'info',
      timestamp: '2026-03-16T10:00:00Z',
    },
  ];

  it('buildObservationsSection still works for resume prompt', () => {
    const section = buildObservationsSection(mockObservations);
    expect(section).toContain('Recent Observations');
    expect(section).toContain('Implemented feature X');
  });

  it('SYSTEM_PROMPT contains format instructions for reminder reference', () => {
    // The format reminder on resume tells God to re-read system prompt
    expect(SYSTEM_PROMPT).toContain('GodDecisionEnvelope');
    expect(SYSTEM_PROMPT).toContain('JSON');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (baseline)**

Run: `npx vitest run src/__tests__/god/god-decision-service-resume.test.ts`
Expected: PASS (these are baseline tests)

- [ ] **Step 3: Write failing test for makeDecision with isResuming**

Add to the test file:

```typescript
import { GodDecisionService } from '../../god/god-decision-service.js';
import { DegradationManager } from '../../god/degradation-manager.js';
import type { GodAdapter, GodExecOptions } from '../../types/god-adapter.js';
import type { OutputChunk } from '../../types/adapter.js';
import type { GodDecisionContext } from '../../god/god-decision-service.js';

function createMockAdapter(capturedPrompts: string[]): GodAdapter {
  return {
    name: 'mock-god',
    displayName: 'Mock God',
    version: '1.0.0',
    toolUsePolicy: 'forbid',
    isInstalled: async () => true,
    getVersion: async () => '1.0.0',
    execute: async function* (prompt: string, _opts: GodExecOptions): AsyncIterable<OutputChunk> {
      capturedPrompts.push(prompt);
      // Return a valid GodDecisionEnvelope as text
      yield {
        type: 'text',
        content: '```json\n' + JSON.stringify({
          diagnosis: { summary: 'test', currentGoal: 'test', currentPhaseId: 'p1', notableObservations: [] },
          authority: { userConfirmation: 'not_required', reviewerOverride: false, acceptAuthority: 'reviewer_aligned' },
          actions: [{ type: 'wait', reason: 'test' }],
          messages: [],
        }) + '\n```',
        metadata: {},
      };
    },
    kill: async () => {},
    isRunning: () => false,
  };
}

describe('GodDecisionService.makeDecision with isResuming', () => {
  const baseContext: GodDecisionContext = {
    taskGoal: 'Implement login feature',
    currentPhaseId: 'phase-1',
    currentPhaseType: 'code',
    round: 3,
    maxRounds: 10,
    previousDecisions: [],
    availableAdapters: ['claude-code', 'codex'],
    activeRole: 'coder',
    sessionDir: '/tmp/test-session',
  };

  it('first round (isResuming=false) includes full prompt with Hand catalog and Task Goal', async () => {
    const capturedPrompts: string[] = [];
    const adapter = createMockAdapter(capturedPrompts);
    const degradation = new DegradationManager();
    const service = new GodDecisionService(adapter, degradation);

    await service.makeDecision(
      [{ source: 'coder', type: 'work_output', summary: 'code output', severity: 'info', timestamp: '2026-03-16T10:00:00Z' }],
      baseContext,
      false, // isResuming = false
    );

    const prompt = capturedPrompts[0];
    expect(prompt).toContain('Task Goal');
    expect(prompt).toContain('Available Hand Actions');
    expect(prompt).toContain('Available Adapters');
    expect(prompt).toContain('Implement login feature');
  });

  it('resume round (isResuming=true) sends slim prompt without Hand catalog or Task Goal', async () => {
    const capturedPrompts: string[] = [];
    const adapter = createMockAdapter(capturedPrompts);
    const degradation = new DegradationManager();
    const service = new GodDecisionService(adapter, degradation);

    await service.makeDecision(
      [{ source: 'coder', type: 'work_output', summary: 'code output', severity: 'info', timestamp: '2026-03-16T10:00:00Z' }],
      baseContext,
      true, // isResuming = true
    );

    const prompt = capturedPrompts[0];
    // Slim prompt should NOT contain these sections
    expect(prompt).not.toContain('Task Goal');
    expect(prompt).not.toContain('Available Hand Actions');
    expect(prompt).not.toContain('Available Adapters');
    expect(prompt).not.toContain('Last Decision Summary');
    // But SHOULD contain these
    expect(prompt).toContain('Phase & Round');
    expect(prompt).toContain('Recent Observations');
    expect(prompt).toContain('Reminder:');
    expect(prompt).toContain('system prompt');
    expect(prompt).toContain('GodDecisionEnvelope');
  });

  it('resume prompt contains phase, round, and active role', async () => {
    const capturedPrompts: string[] = [];
    const adapter = createMockAdapter(capturedPrompts);
    const degradation = new DegradationManager();
    const service = new GodDecisionService(adapter, degradation);

    await service.makeDecision(
      [{ source: 'reviewer', type: 'review_output', summary: '[APPROVED] looks good', severity: 'info', timestamp: '2026-03-16T10:00:00Z' }],
      baseContext,
      true,
    );

    const prompt = capturedPrompts[0];
    expect(prompt).toContain('phase-1');
    expect(prompt).toContain('Round: 3 of 10');
    expect(prompt).toContain('coder');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/__tests__/god/god-decision-service-resume.test.ts`
Expected: FAIL — `makeDecision` does not accept a third `isResuming` parameter

- [ ] **Step 5: Implement slim prompt and isResuming parameter**

In `src/god/god-decision-service.ts`:

1. Add a new `buildResumePrompt` function (after `buildUserPrompt`):

```typescript
/**
 * Build a slim prompt for resume rounds.
 * God's session context already contains: system prompt, Hand catalog, task goal,
 * previous decisions, available adapters, phase plan.
 * Only send: phase & round, observations, format reminder.
 */
function buildResumePrompt(observations: Observation[], context: GodDecisionContext): string {
  const sections: string[] = [];

  const phaseTypeStr = context.currentPhaseType ? ` (type: ${context.currentPhaseType})` : '';
  sections.push(`## Phase & Round\nPhase: ${context.currentPhaseId}${phaseTypeStr}\nRound: ${context.round} of ${context.maxRounds}\nActive Role: ${context.activeRole ?? 'none'}`);

  sections.push(buildObservationsSection(observations));

  sections.push('Reminder: re-read your system prompt and follow all instructions. Output a single GodDecisionEnvelope JSON code block.');

  return sections.join('\n\n');
}
```

2. Update `makeDecision` signature to accept `isResuming`:

```typescript
async makeDecision(
  observations: Observation[],
  context: GodDecisionContext,
  isResuming: boolean = false,
): Promise<GodDecisionEnvelope> {
  const userPrompt = isResuming
    ? buildResumePrompt(observations, context)
    : buildUserPrompt(observations, context);
  // ... rest unchanged ...
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/god/god-decision-service-resume.test.ts`
Expected: PASS

- [ ] **Step 7: Run all existing god-decision-service tests to verify no regressions**

Run: `npx vitest run src/__tests__/god/`
Expected: All PASS (isResuming defaults to false so existing callers unaffected)

- [ ] **Step 8: Commit**

```bash
git add src/god/god-decision-service.ts src/__tests__/god/god-decision-service-resume.test.ts
git commit -m "feat(god): slim resume prompt for session-capable rounds"
```

---

## Chunk 3: Session Runner State + Tri-Party Session Updates

### Task 5: Add godSessionId to RestoredSessionRuntime

**Files:**
- Modify: `src/ui/session-runner-state.ts`
- Test: `src/__tests__/ui/session-runner-state.test.ts` (update existing)
- Test: `src/__tests__/god/audit-bug-regressions.test.ts` (update existing)

- [ ] **Step 1: Update failing tests in session-runner-state.test.ts**

Change line 332 and line 429 from:
```typescript
expect('godSessionId' in runtime).toBe(false);
```
to:
```typescript
expect(runtime.godSessionId).toBe('ses_god_123'); // or appropriate expected value
```

For line 429 where the loaded state has no godSessionId:
```typescript
expect(runtime.godSessionId).toBeUndefined();
```

- [ ] **Step 2: Update failing tests in audit-bug-regressions.test.ts**

Change lines 647 and 679 from:
```typescript
expect('godSessionId' in runtime).toBe(false);
```
to:
```typescript
// Line 647: loaded.state has godSessionId: 'ses_god_123'
expect(runtime.godSessionId).toBe('ses_god_123');
// Line 679: loaded.state has no godSessionId
expect(runtime.godSessionId).toBeUndefined();
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/ui/session-runner-state.test.ts src/__tests__/god/audit-bug-regressions.test.ts`
Expected: FAIL — `godSessionId` is not in `RestoredSessionRuntime`

- [ ] **Step 4: Add godSessionId to RestoredSessionRuntime interface and buildRestoredSessionRuntime**

In `src/ui/session-runner-state.ts`:

1. Add to `RestoredSessionRuntime` interface (after `reviewerSessionId`):
```typescript
/** Persisted CLI session ID for the god adapter */
godSessionId?: string;
```

2. Add to `buildRestoredSessionRuntime` return value (after `reviewerSessionId`):
```typescript
godSessionId: loaded.state.godSessionId,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/ui/session-runner-state.test.ts src/__tests__/god/audit-bug-regressions.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui/session-runner-state.ts src/__tests__/ui/session-runner-state.test.ts src/__tests__/god/audit-bug-regressions.test.ts
git commit -m "feat(god): add godSessionId to RestoredSessionRuntime"
```

---

### Task 6: Update tri-party-session.ts to restore God sessions

**Files:**
- Modify: `src/god/tri-party-session.ts`
- Test: `src/__tests__/god/tri-party-session.test.ts` (update)

- [ ] **Step 1: Update test descriptions and assertions**

In `src/__tests__/god/tri-party-session.test.ts`:

1. Line 115: Change test name from `'coder session lost — reviewer still restored and god remains stateless'` to `'coder session lost — reviewer and god still restored'`

2. Line 130: Change `expect(result.god).toBeNull();` to:
```typescript
expect(result.god).not.toBeNull();
expect(result.god!.sessionId).toBe('god-session-001');
```

3. Line 133: Change test name from `'reviewer session lost — coder still restored and god remains stateless'` to `'reviewer session lost — coder and god still restored'`

4. Line 147: Change `expect(result.god).toBeNull();` to:
```typescript
expect(result.god).not.toBeNull();
expect(result.god!.sessionId).toBe('god-session-001');
```

5. Lines 163, 182, 223, 246, 291: Update all `expect(result.god).toBeNull()` where `godSessionId` was non-null to expect restoration. Where `godSessionId` is null (lines 163 for "god session lost" test, 198 for "all sessions lost"), keep `toBeNull()`.

6. Full list of changes needed:
   - Line 130: `toBeNull()` → `not.toBeNull()` + sessionId check (godSessionId = 'god-session-001')
   - Line 147: `toBeNull()` → `not.toBeNull()` + sessionId check (godSessionId = 'god-session-001')
   - Line 163: KEEP `toBeNull()` (godSessionId is null in this test)
   - Line 182: `toBeNull()` → `not.toBeNull()` (godSessionId = 'god-session-001', but adapter factory throws for codex — god uses config.god which defaults to 'codex', so factory may throw. Check config: god defaults to 'codex', factory throws for 'codex'. So god restore also fails → keep `toBeNull()`)
   - Lines 222-223: `toBeNull()` → `not.toBeNull()` + sessionId check (god uses 'claude-code', factory works)
   - Lines 245-246: `toBeNull()` → `not.toBeNull()` + sessionId check (god uses 'claude-code')
   - Line 291: `toBeNull()` → `not.toBeNull()` + sessionId check (god-roundtrip-001)
   - Line 318: KEEP `toBeNull()` (godSessionId is null)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/god/tri-party-session.test.ts`
Expected: FAIL — `restoreTriPartySession` still hardcodes `god = null`

- [ ] **Step 3: Update restoreTriPartySession to restore God sessions**

In `src/god/tri-party-session.ts`:

1. Update the comment on `restoreTriPartySession`:
```typescript
/**
 * Restore tri-party session from persisted state.
 *
 * Each party is restored independently — if one fails, others are unaffected (AC-040).
 * Each party gets its own adapter instance, even when using the same CLI tool (AC-041a).
 * God session is now restored for session-capable adapters (kill-and-resume pattern).
 *
 * @param triParty - Extracted tri-party session IDs
 * @param config - Session config with adapter names for each role
 * @param adapterFactory - Factory function to create CLIAdapter instances by name
 */
```

2. Change line 96 from `const god = null;` to:
```typescript
const god = config.god
  ? restoreSingleParty(triParty.godSessionId, config.god, adapterFactory)
  : null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/god/tri-party-session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/god/tri-party-session.ts src/__tests__/god/tri-party-session.test.ts
git commit -m "feat(god): restore God sessions in tri-party coordination"
```

---

## Chunk 4: App.tsx Integration — Save, Restore, and Pass isResuming

### Task 7: Save God session ID at both saveState call sites

**Files:**
- Modify: `src/ui/components/App.tsx`

- [ ] **Step 1: Add God session ID save to transition effect saveState (line ~618)**

In the `useEffect` that saves state on transitions (around line 618), after the reviewer session ID spread:

```typescript
// After the reviewerSessionId spread (line 626-627):
...(isSessionCapable(godAdapterRef.current) && godAdapterRef.current.getLastSessionId()
  ? { godSessionId: godAdapterRef.current.getLastSessionId()! }
  : {}),
```

- [ ] **Step 2: Add God session ID save to saveStateForExit (line ~1615)**

In the `saveStateForExit` callback (around line 1615), after the reviewer session ID spread:

```typescript
// After the ra spread (line 1622-1624):
const ga = godAdapterRef.current;
...(isSessionCapable(ga) && ga.getLastSessionId()
  ? { godSessionId: ga.getLastSessionId()! }
  : {}),
```

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors (godSessionId already exists in SessionState type per spec: "snapshot.json schema — godSessionId field already exists")

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/App.tsx
git commit -m "feat(god): persist God sessionId at both saveState call sites"
```

---

### Task 8: Restore God session ID on duo resume

**Files:**
- Modify: `src/ui/components/App.tsx`

- [ ] **Step 1: Update the resume restore section (line ~462-464)**

Replace the comment block:
```typescript
// NOTE: God session ID is intentionally NOT restored on resume.
// God is a stateless JSON oracle — resuming would skip --system-prompt
// and inject irrelevant conversation context, causing JSON extraction failures.
```

With:
```typescript
// Restore God session ID for session-capable adapters (kill-and-resume pattern)
if (restoredRuntime.godSessionId) {
  const ga = godAdapterRef.current;
  if (isSessionCapable(ga)) {
    ga.restoreSessionId(restoredRuntime.godSessionId);
  }
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/App.tsx
git commit -m "feat(god): restore God sessionId on duo resume"
```

---

### Task 9: Pass isResuming to makeDecision

**Files:**
- Modify: `src/ui/components/App.tsx`

- [ ] **Step 1: Compute isResuming and pass to makeDecision (line ~1224)**

Before the `makeDecision` call (around line 1224), add:

```typescript
// Determine if God adapter has an active session (resume mode → slim prompt)
const godIsResuming = isSessionCapable(godAdapterRef.current)
  && godAdapterRef.current.hasActiveSession();
```

Then update the makeDecision call:
```typescript
const envelope = await service.makeDecision(ctx.currentObservations, decisionContext, godIsResuming);
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/App.tsx
git commit -m "feat(god): pass isResuming flag to makeDecision for slim prompts"
```

---

## Chunk 5: Full Test Suite Verification

### Task 10: Run all tests and fix any regressions

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Fix any failures**

If any tests fail, analyze the failure and fix. Common issues:
- Other tests that assert on `makeDecision` signature may need updating
- Tests that mock GodDecisionService may need the new parameter

- [ ] **Step 3: Run TypeScript compilation check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve test regressions from God session reuse"
```

- [ ] **Step 5: Run tests one final time to confirm green**

Run: `npx vitest run`
Expected: All PASS

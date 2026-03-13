# Session Continuation Bugfix Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 8 bugs in the session continuation feature so that Claude Code and Codex adapters correctly resume sessions without cross-contamination, token waste, or silent failures.

**Architecture:** Both adapters follow the same pattern: capture session/thread ID from CLI output stream, store per-instance, use explicit ID for resume. ContextManager gains a `skipHistory` option so prompts don't duplicate history the LLM already has. Filesystem-based session discovery is removed entirely.

**Tech Stack:** TypeScript, Vitest, Node.js child_process, NDJSON streaming parsers

---

## Bug Summary

| # | Severity | Bug | Fix Strategy |
|---|----------|-----|-------------|
| 1 | P0 | `--continue` cross-contamination when both coder & reviewer are claude-code | Capture `session_id` from `result` event, use `--resume <id>` |
| 2 | P0 | History redundancy doubles token usage with `--continue`/`--resume` | Add `skipHistory` to ContextManager, skip when session is active |
| 3 | P1 | `executionCount` incremented before spawn — failure poisons next call | Move increment after successful stream start |
| 4 | P1 | Codex `~/.codex/sessions/` dir structure assumed, never verified | Remove filesystem scanning, capture `thread_id` from output |
| 5 | P1 | Codex `exec resume` command format was unverified | Verified: `codex exec resume <ID> "prompt" --json --full-auto` |
| 6 | P2 | Codex session discovery race condition with concurrent processes | Eliminated: no filesystem scanning needed |
| 7 | P2 | Codex session file write timing — file may not exist yet | Eliminated: no filesystem scanning needed |
| 8 | P2 | `--resume` + `--system-prompt` may conflict in Claude Code | Skip `--system-prompt` when resuming an existing session |

## Dependency Graph

```
Task 1 (JsonlParser metadata)
    └─→ Task 3 (Codex thread_id capture)

Task 2 (Claude Code session_id capture)
    └─→ Task 6 (App.tsx wiring)

Task 3 (Codex thread_id capture)
    └─→ Task 6 (App.tsx wiring)

Task 4 (executionCount timing) — independent

Task 5 (ContextManager skipHistory)
    └─→ Task 6 (App.tsx wiring)

Task 7 (--system-prompt skip) — independent
```

---

### Task 1: JsonlParser — Preserve metadata on status events

**Fixes:** Bug 4, 6, 7 (enables thread_id capture, eliminates filesystem scanning)

**Files:**
- Modify: `src/parsers/jsonl-parser.ts:113-123`
- Test: `src/__tests__/parsers/jsonl-parser.test.ts`

**Step 1: Write the failing test**

In `src/__tests__/parsers/jsonl-parser.test.ts`, add after the last `it()` block inside `describe('JsonlParser')`:

```typescript
it('should preserve event metadata on status chunks', async () => {
  const lines = [
    JSON.stringify({ type: 'thread.started', thread_id: 'th_abc123' }),
  ];
  const parser = new JsonlParser();
  const chunks = await collect(parser.parse(createStream(lines)));

  expect(chunks).toHaveLength(1);
  expect(chunks[0].type).toBe('status');
  expect(chunks[0].metadata).toBeDefined();
  expect(chunks[0].metadata?.thread_id).toBe('th_abc123');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/parsers/jsonl-parser.test.ts`
Expected: FAIL — `chunks[0].metadata` is `undefined`

**Step 3: Write minimal implementation**

In `src/parsers/jsonl-parser.ts`, change the status/thread event case (lines 113-123):

```typescript
      case 'status':
      case 'done':
      case 'completion':
      case 'thread.started':
      case 'turn.started':
      case 'turn.completed':
        return {
          type: 'status',
          content: (event.status as string) ?? (event.content as string) ?? JSON.stringify(event),
          timestamp: Date.now(),
          metadata: event as Record<string, unknown>,
        };
```

Only change: add `metadata: event as Record<string, unknown>`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/parsers/jsonl-parser.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/parsers/jsonl-parser.ts src/__tests__/parsers/jsonl-parser.test.ts
git commit -m "fix(jsonl-parser): preserve metadata on status events for thread_id capture"
```

---

### Task 2: Claude Code Adapter — Capture session_id, use --resume

**Fixes:** Bug 1 (cross-contamination), Bug 3 (executionCount timing)

**Files:**
- Modify: `src/adapters/claude-code/adapter.ts`
- Test: `src/__tests__/adapters/claude-code/adapter.test.ts`

**Step 1: Write the failing tests**

Add to `src/__tests__/adapters/claude-code/adapter.test.ts`, replace the existing `session continuation: auto-continue` describe block:

```typescript
describe('session continuation: session_id capture and --resume', () => {
  it('should NOT use --resume or --continue on first execute() call', async () => {
    const testAdapter = new ClaudeCodeAdapter();
    const pm = (testAdapter as any).processManager as ProcessManager;

    const { Readable } = require('node:stream');
    const stdout = new Readable({ read() { this.push(null); } });
    const stderr = new Readable({ read() { this.push(null); } });
    const mockChild = { stdout, stderr, pid: 33333, on: vi.fn(), once: vi.fn() };
    (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      mockChild.stdout.on('end', () => {
        setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
      });
      return mockChild;
    });

    for await (const _chunk of testAdapter.execute('first call', defaultOpts())) { /* drain */ }

    const spawnCall = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    const spawnArgs = spawnCall[1] as string[];
    expect(spawnArgs).not.toContain('--continue');
    expect(spawnArgs).not.toContain('--resume');
  });

  it('should capture session_id from result event and use --resume on next call', async () => {
    const testAdapter = new ClaudeCodeAdapter();
    const pm = (testAdapter as any).processManager as ProcessManager;

    const { Readable } = require('node:stream');
    const createChildWithOutput = (lines: string[]) => {
      const stdout = new Readable({
        read() {
          for (const line of lines) this.push(line + '\n');
          this.push(null);
        },
      });
      const stderr = new Readable({ read() { this.push(null); } });
      return { stdout, stderr, pid: 44444, on: vi.fn(), once: vi.fn() };
    };

    let callCount = 0;
    (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const lines = callCount === 0
        ? [
            JSON.stringify({ type: 'assistant', subtype: 'text', content: 'Hello' }),
            JSON.stringify({ type: 'result', session_id: 'ses_first_123', cost: 0.01 }),
          ]
        : [
            JSON.stringify({ type: 'assistant', subtype: 'text', content: 'Resumed' }),
            JSON.stringify({ type: 'result', session_id: 'ses_first_123', cost: 0.02 }),
          ];
      const child = createChildWithOutput(lines);
      child.stdout.on('end', () => {
        setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
      });
      callCount++;
      return child;
    });

    // First call — no resume
    for await (const _chunk of testAdapter.execute('first', defaultOpts())) { /* drain */ }

    // Second call — should use --resume with captured session_id
    for await (const _chunk of testAdapter.execute('second', defaultOpts())) { /* drain */ }

    const secondArgs = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[1][1] as string[];
    expect(secondArgs).toContain('--resume');
    expect(secondArgs).toContain('ses_first_123');
    expect(secondArgs).not.toContain('--continue');
  });

  it('should fallback to --continue when no session_id was captured', async () => {
    const testAdapter = new ClaudeCodeAdapter();
    const pm = (testAdapter as any).processManager as ProcessManager;

    const { Readable } = require('node:stream');
    const createEmptyChild = () => {
      const stdout = new Readable({ read() { this.push(null); } });
      const stderr = new Readable({ read() { this.push(null); } });
      return { stdout, stderr, pid: 55555, on: vi.fn(), once: vi.fn() };
    };

    (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const child = createEmptyChild();
      child.stdout.on('end', () => {
        setTimeout(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }), 10);
      });
      return child;
    });

    // First call — no output, no session_id captured
    for await (const _chunk of testAdapter.execute('first', defaultOpts())) { /* drain */ }

    // Second call — should fallback to --continue
    for await (const _chunk of testAdapter.execute('second', defaultOpts())) { /* drain */ }

    const secondArgs = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[1][1] as string[];
    expect(secondArgs).toContain('--continue');
    expect(secondArgs).not.toContain('--resume');
  });

  it('should NOT increment executionCount when spawn produces no stdout', async () => {
    const testAdapter = new ClaudeCodeAdapter();
    const pm = (testAdapter as any).processManager as ProcessManager;

    (pm.spawn as ReturnType<typeof vi.fn>).mockReturnValue({ stdout: null, stderr: null, pid: 0 });

    for await (const _chunk of testAdapter.execute('fail', defaultOpts())) { /* drain */ }

    // executionCount should NOT have incremented because stdout was null
    expect((testAdapter as any).executionCount).toBe(0);
  });
});
```

**Step 2: Run test to verify failures**

Run: `npx vitest run src/__tests__/adapters/claude-code/adapter.test.ts`
Expected: Multiple FAILs — session_id not captured, --resume not used

**Step 3: Rewrite execute() in `src/adapters/claude-code/adapter.ts`**

Replace the entire `execute()` method (lines 97-178):

```typescript
  async *execute(
    prompt: string,
    opts: ExecOptions,
    sessionOpts?: ClaudeCodeSessionOptions,
  ): AsyncIterable<OutputChunk> {
    // Session continuation: prefer --resume with captured session_id, fallback to --continue
    const effectiveSessionOpts: ClaudeCodeSessionOptions = { ...sessionOpts };
    if (!effectiveSessionOpts.continue && !effectiveSessionOpts.resumeSessionId) {
      if (this.lastSessionId) {
        effectiveSessionOpts.resumeSessionId = this.lastSessionId;
      } else if (this.executionCount > 0) {
        effectiveSessionOpts.continue = true;
      }
    }

    const args = this.buildArgs(prompt, opts, effectiveSessionOpts);

    // AC-034: Build minimal env with only required vars, delete CLAUDECODE
    const { env, replaceEnv } = buildAdapterEnv({
      requiredPrefixes: ['ANTHROPIC_', 'CLAUDE_'],
      extraEnv: opts.env,
    });
    delete env.CLAUDECODE;

    const execOpts: ExecOptions = {
      ...opts,
      env,
      replaceEnv,
    };

    const child = this.processManager.spawn('claude', args, execOpts);

    // Convert Node.js Readable stdout to Web ReadableStream<string>
    const stdout = child.stdout;
    if (!stdout) {
      // Don't increment executionCount — spawn failed or produced no stdout
      return;
    }

    this.executionCount++;

    const pm = this.processManager;
    const stderr = child.stderr;
    let onProcessError: ((info: { message: string }) => void) | null = null;
    let onProcessComplete: (() => void) | null = null;
    const cleanupListeners = () => {
      if (onProcessError) pm.removeListener('process-error', onProcessError);
      if (onProcessComplete) pm.removeListener('process-complete', onProcessComplete);
    };
    const stream = new ReadableStream<string>({
      start(controller) {
        onProcessError = (info: { message: string }) => {
          cleanupListeners();
          try { controller.error(new Error(info.message)); } catch { /* stream may already be closed */ }
        };
        onProcessComplete = () => {
          cleanupListeners();
          try { controller.close(); } catch { /* stream may already be closed */ }
        };
        pm.once('process-error', onProcessError);
        pm.once('process-complete', onProcessComplete);

        stdout.on('data', (data: Buffer) => {
          controller.enqueue(data.toString());
        });
        stderr?.on('data', (data: Buffer) => {
          const msg = data.toString().trim();
          if (msg) {
            controller.enqueue(JSON.stringify({ type: 'error', content: msg }) + '\n');
          }
        });
        stdout.on('error', (err: Error) => {
          cleanupListeners();
          controller.error(err);
        });
      },
      cancel() {
        cleanupListeners();
      },
    });

    try {
      for await (const chunk of this.parser.parse(stream)) {
        // Capture session_id from result events (metadata preserved by StreamJsonParser)
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
  }
```

Also add the `lastSessionId` field and `hasActiveSession()` method. Replace the class fields section:

```typescript
export class ClaudeCodeAdapter implements CLIAdapter {
  readonly name = 'claude-code';
  readonly displayName = 'Claude Code';
  readonly version = '0.0.0';

  private processManager: ProcessManager;
  private parser: StreamJsonParser;
  /** Tracks how many times execute() has successfully started */
  private executionCount = 0;
  /** Session ID captured from the most recent result event */
  private lastSessionId: string | null = null;

  constructor() {
    this.processManager = new ProcessManager();
    this.parser = new StreamJsonParser();
  }

  /** Returns true if this adapter has a captured session to resume */
  hasActiveSession(): boolean {
    return this.lastSessionId !== null || this.executionCount > 0;
  }
```

**Step 4: Run tests**

Run: `npx vitest run src/__tests__/adapters/claude-code/adapter.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/adapters/claude-code/adapter.ts src/__tests__/adapters/claude-code/adapter.test.ts
git commit -m "fix(claude-code): capture session_id for --resume, fix executionCount timing"
```

---

### Task 3: Codex Adapter — Capture thread_id, remove filesystem scanning

**Fixes:** Bug 4, 5, 6, 7 (replaces all filesystem-based session discovery)

**Depends on:** Task 1 (JsonlParser metadata)

**Files:**
- Modify: `src/adapters/codex/adapter.ts`
- Test: `src/__tests__/adapters/codex/adapter.test.ts`

**Step 1: Write the failing tests**

Replace the existing `session continuation: resume support` and `session discovery` describe blocks:

```typescript
describe('session continuation: thread_id capture and resume', () => {
  it('should build resume args when resumeSessionId is provided', () => {
    const args = adapter.buildArgs('continue working', defaultOpts(), {
      resumeSessionId: 'th_abc123',
    });

    expect(args[0]).toBe('exec');
    expect(args[1]).toBe('resume');
    expect(args[2]).toBe('th_abc123');
    expect(args[3]).toBe('continue working');
    expect(args).toContain('--json');
    expect(args).toContain('--full-auto');
  });

  it('should build normal exec args when no resumeSessionId', () => {
    const args = adapter.buildArgs('do something', defaultOpts());

    expect(args[0]).toBe('exec');
    expect(args[1]).toBe('do something');
    expect(args).not.toContain('resume');
  });

  it('should capture thread_id from thread.started event and use it for resume', async () => {
    mockExecFile.mockImplementation((cmd: any, _a: any, _o: any, cb: any) => {
      if (cmd === 'git') cb(null, 'true', '');
      return {} as any;
    });

    const pm = (adapter as any).processManager as ProcessManager;
    let callCount = 0;

    (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const lines = callCount === 0
        ? [
            JSON.stringify({ type: 'thread.started', thread_id: 'th_captured_001' }),
            JSON.stringify({ type: 'message', content: 'Done' }),
          ]
        : [
            JSON.stringify({ type: 'message', content: 'Resumed' }),
          ];
      const child = createMockChildWithLines(lines);
      child.stdout.on('end', () => {
        process.nextTick(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }));
      });
      callCount++;
      return child;
    });

    // First call — captures thread_id
    for await (const _chunk of adapter.execute('first', defaultOpts())) { /* drain */ }
    expect(adapter.getLastSessionId()).toBe('th_captured_001');

    // Second call — should use resume with captured thread_id
    for await (const _chunk of adapter.execute('second', defaultOpts())) { /* drain */ }

    const secondArgs = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[1][1] as string[];
    expect(secondArgs).toContain('resume');
    expect(secondArgs).toContain('th_captured_001');
  });

  it('should NOT resume on first call (no thread_id)', async () => {
    mockExecFile.mockImplementation((cmd: any, _a: any, _o: any, cb: any) => {
      if (cmd === 'git') cb(null, 'true', '');
      return {} as any;
    });

    const pm = (adapter as any).processManager as ProcessManager;
    const mockChild = createMockChildWithLines([
      JSON.stringify({ type: 'message', content: 'first run' }),
    ]);
    (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      mockChild.stdout.on('end', () => {
        process.nextTick(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }));
      });
      return mockChild;
    });

    for await (const _chunk of adapter.execute('first', defaultOpts())) { /* drain */ }

    const spawnArgs = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(spawnArgs).not.toContain('resume');
    expect(spawnArgs[0]).toBe('exec');
    expect(spawnArgs[1]).toBe('first');
  });

  it('should use explicit resumeSessionId over captured thread_id', async () => {
    (adapter as any).lastSessionId = 'th_old';
    mockExecFile.mockImplementation((cmd: any, _a: any, _o: any, cb: any) => {
      if (cmd === 'git') cb(null, 'true', '');
      return {} as any;
    });

    const pm = (adapter as any).processManager as ProcessManager;
    const mockChild = createMockChildWithLines([]);
    (pm.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      mockChild.stdout.on('end', () => {
        process.nextTick(() => (pm as any).emit('process-complete', { exitCode: 0, signal: null }));
      });
      return mockChild;
    });

    for await (const _chunk of adapter.execute('t', defaultOpts(), { resumeSessionId: 'th_explicit' })) { /* drain */ }

    const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(args).toContain('th_explicit');
    expect(args).not.toContain('th_old');
  });
});
```

**Step 2: Run test to verify failures**

Run: `npx vitest run src/__tests__/adapters/codex/adapter.test.ts`
Expected: FAILs — thread_id not captured from output

**Step 3: Rewrite Codex adapter**

In `src/adapters/codex/adapter.ts`:

1. Remove imports `readdir`, `stat`, `homedir`, `path` (no longer needed for fs scanning)
2. Remove `executionStartTime` field
3. Remove `discoverLatestSessionId()` method entirely
4. Replace `execute()` to capture thread_id from output:

```typescript
import { execFile } from 'node:child_process';
import type { CLIAdapter, ExecOptions, OutputChunk } from '../../types/adapter.js';
import { ProcessManager } from '../process-manager.js';
import { JsonlParser } from '../../parsers/jsonl-parser.js';
import { buildAdapterEnv } from '../env-builder.js';

export interface CodexSessionOptions {
  role?: 'coder' | 'reviewer';
  resumeSessionId?: string;
}

export class CodexAdapter implements CLIAdapter {
  readonly name = 'codex';
  readonly displayName = 'Codex';
  readonly version = '0.0.0';

  private processManager: ProcessManager;
  private parser: JsonlParser;
  /** Thread ID captured from the most recent thread.started event */
  private lastSessionId: string | null = null;

  constructor() {
    this.processManager = new ProcessManager();
    this.parser = new JsonlParser();
  }

  // ... isInstalled, getVersion, buildArgs stay the same ...

  async *execute(
    prompt: string,
    opts: ExecOptions,
    sessionOpts?: CodexSessionOptions,
  ): AsyncIterable<OutputChunk> {
    const isGitRepo = await this.checkGitRepo(opts.cwd);
    if (!isGitRepo) {
      yield {
        type: 'status',
        content: 'Warning: Not a git repository. Codex works best in git repositories.',
        timestamp: Date.now(),
      };
    }

    // Auto-resume: use captured thread_id from previous execution
    const resumeSessionId = sessionOpts?.resumeSessionId ?? this.lastSessionId ?? undefined;

    const args = this.buildArgs(prompt, opts, {
      skipGitCheck: !isGitRepo,
      resumeSessionId,
    });

    const { env, replaceEnv } = buildAdapterEnv({
      requiredPrefixes: ['OPENAI_'],
      extraEnv: opts.env,
    });

    const execOpts: ExecOptions = { ...opts, env, replaceEnv };
    const child = this.processManager.spawn('codex', args, execOpts);
    const stdout = child.stdout;
    if (!stdout) return;

    // ... stream setup same as before ...

    try {
      for await (const chunk of this.parser.parse(stream)) {
        // Capture thread_id from thread.started events (metadata preserved by JsonlParser)
        if (chunk.type === 'status' && chunk.metadata?.thread_id) {
          this.lastSessionId = chunk.metadata.thread_id as string;
        }
        yield chunk;
      }
    } finally {
      if (this.processManager.isRunning()) {
        await this.processManager.kill();
      }
    }
  }

  /** Returns true if this adapter has a captured session to resume */
  hasActiveSession(): boolean {
    return this.lastSessionId !== null;
  }

  /** Expose last captured session/thread ID for testing */
  getLastSessionId(): string | null {
    return this.lastSessionId;
  }

  // ... kill, isRunning, checkGitRepo stay the same ...
  // DELETE: discoverLatestSessionId() — no longer needed
}
```

**Step 4: Run tests**

Run: `npx vitest run src/__tests__/adapters/codex/adapter.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/adapters/codex/adapter.ts src/__tests__/adapters/codex/adapter.test.ts
git commit -m "fix(codex): capture thread_id from output, remove filesystem session scanning"
```

---

### Task 4: ContextManager — Add skipHistory option

**Fixes:** Bug 2 (history redundancy / token waste)

**Files:**
- Modify: `src/session/context-manager.ts:29-36, 120-164`
- Test: `src/__tests__/session/context-manager.test.ts`

**Step 1: Write the failing tests**

Add to context-manager test file:

```typescript
describe('skipHistory option', () => {
  it('should omit history section from coder prompt when skipHistory is true', () => {
    const cm = new ContextManager({ contextWindowSize: 100000 });
    const rounds: RoundRecord[] = [{
      index: 1,
      coderOutput: 'wrote code',
      reviewerOutput: 'needs fixes',
      summary: 'round 1 summary',
      timestamp: Date.now(),
    }];

    const prompt = cm.buildCoderPrompt('build X', rounds, {
      reviewerFeedback: 'fix the bug',
      skipHistory: true,
    });

    expect(prompt).not.toContain('## History');
    expect(prompt).not.toContain('Round 1');
    expect(prompt).toContain('fix the bug');
    expect(prompt).toContain('build X');
  });

  it('should omit history section from reviewer prompt when skipHistory is true', () => {
    const cm = new ContextManager({ contextWindowSize: 100000 });
    const rounds: RoundRecord[] = [{
      index: 1,
      coderOutput: 'wrote code',
      reviewerOutput: 'needs fixes',
      summary: 'round 1 summary',
      timestamp: Date.now(),
    }];

    const prompt = cm.buildReviewerPrompt('build X', rounds, 'new code', {
      skipHistory: true,
    });

    expect(prompt).not.toContain('## History');
    expect(prompt).not.toContain('Round 1');
    expect(prompt).toContain('new code');
  });

  it('should include history when skipHistory is false or omitted', () => {
    const cm = new ContextManager({ contextWindowSize: 100000 });
    const rounds: RoundRecord[] = [{
      index: 1,
      coderOutput: 'wrote code',
      reviewerOutput: 'needs fixes',
      summary: 'round 1 summary',
      timestamp: Date.now(),
    }];

    const prompt = cm.buildCoderPrompt('build X', rounds);
    expect(prompt).toContain('Round 1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/session/context-manager.test.ts`
Expected: FAIL — `skipHistory` not a valid option

**Step 3: Implement**

In `src/session/context-manager.ts`:

Add `skipHistory` to option interfaces:

```typescript
interface CoderPromptOptions {
  reviewerFeedback?: string;
  interruptInstruction?: string;
  skipHistory?: boolean;
}

interface ReviewerPromptOptions {
  interruptInstruction?: string;
  skipHistory?: boolean;
}
```

Modify `buildCoderPrompt()` (line 125):

```typescript
  buildCoderPrompt(
    task: string,
    rounds: RoundRecord[],
    opts?: CoderPromptOptions,
  ): string {
    const historySection = opts?.skipHistory ? '' : this.buildHistorySection(rounds);
    // ... rest unchanged
  }
```

Modify `buildReviewerPrompt()` (line 150):

```typescript
  buildReviewerPrompt(
    task: string,
    rounds: RoundRecord[],
    coderOutput: string,
    opts?: ReviewerPromptOptions,
  ): string {
    const historySection = opts?.skipHistory ? '' : this.buildHistorySection(rounds);
    // ... rest unchanged
  }
```

**Step 4: Run tests**

Run: `npx vitest run src/__tests__/session/context-manager.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/session/context-manager.ts src/__tests__/session/context-manager.test.ts
git commit -m "feat(context-manager): add skipHistory option to avoid token duplication"
```

---

### Task 5: App.tsx — Wire up skipHistory when adapter has active session

**Fixes:** Bug 2 (completes the token redundancy fix end-to-end)

**Depends on:** Task 2, 3, 4

**Files:**
- Modify: `src/ui/components/App.tsx:479-512, 646-674`

**Step 1: Modify CODING block** (lines ~483-494)

Replace prompt building logic:

```typescript
        // Determine if adapter has an active session (skip history to avoid duplication)
        const adapterHasSession = 'hasActiveSession' in adapter && typeof (adapter as any).hasActiveSession === 'function'
          ? (adapter as any).hasActiveSession()
          : false;

        const prompt = choiceRouteRef.current?.target === 'coder'
          ? choiceRouteRef.current.prompt
          : contextManagerRef.current.buildCoderPrompt(
              config.task,
              roundsRef.current,
              {
                ...(ctx.lastReviewerOutput
                  ? { reviewerFeedback: ctx.lastReviewerOutput }
                  : {}),
                ...(interruptInstruction ? { interruptInstruction } : {}),
                ...(adapterHasSession ? { skipHistory: true } : {}),
              },
            );
```

**Step 2: Modify REVIEWING block** (lines ~650-657)

Same pattern:

```typescript
        const adapterHasSession = 'hasActiveSession' in adapter && typeof (adapter as any).hasActiveSession === 'function'
          ? (adapter as any).hasActiveSession()
          : false;

        const prompt = choiceRouteRef.current?.target === 'reviewer'
          ? choiceRouteRef.current.prompt
          : contextManagerRef.current.buildReviewerPrompt(
              config.task,
              roundsRef.current,
              ctx.lastCoderOutput ?? '',
              {
                ...(interruptInstruction ? { interruptInstruction } : {}),
                ...(adapterHasSession ? { skipHistory: true } : {}),
              },
            );
```

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS (790+)

**Step 4: Commit**

```bash
git add src/ui/components/App.tsx
git commit -m "fix(app): skip prompt history when adapter has active session continuation"
```

---

### Task 6: Claude Code — Skip --system-prompt when resuming

**Fixes:** Bug 8 (--resume + --system-prompt conflict)

**Files:**
- Modify: `src/adapters/claude-code/adapter.ts:65-95` (buildArgs)
- Test: `src/__tests__/adapters/claude-code/adapter.test.ts`

**Step 1: Write the failing test**

```typescript
it('should NOT include --system-prompt when --resume is used', () => {
  const testAdapter = new ClaudeCodeAdapter();
  const args = testAdapter.buildArgs(
    'test prompt',
    defaultOpts({ systemPrompt: 'You are a coder' }),
    { resumeSessionId: 'ses_abc' },
  );

  expect(args).toContain('--resume');
  expect(args).toContain('ses_abc');
  expect(args).not.toContain('--system-prompt');
  expect(args).not.toContain('You are a coder');
});

it('should NOT include --system-prompt when --continue is used', () => {
  const testAdapter = new ClaudeCodeAdapter();
  const args = testAdapter.buildArgs(
    'test prompt',
    defaultOpts({ systemPrompt: 'You are a coder' }),
    { continue: true },
  );

  expect(args).toContain('--continue');
  expect(args).not.toContain('--system-prompt');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/adapters/claude-code/adapter.test.ts`
Expected: FAIL — `--system-prompt` still present with `--resume`

**Step 3: Implement**

In `buildArgs()`, make `--system-prompt` conditional on NOT resuming:

```typescript
    const isResuming = sessionOpts?.continue || sessionOpts?.resumeSessionId;

    if (opts.systemPrompt && !isResuming) {
      args.push('--system-prompt', opts.systemPrompt);
    }
```

**Step 4: Run tests**

Run: `npx vitest run src/__tests__/adapters/claude-code/adapter.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/adapters/claude-code/adapter.ts src/__tests__/adapters/claude-code/adapter.test.ts
git commit -m "fix(claude-code): skip --system-prompt when resuming to avoid prompt conflicts"
```

---

### Task 7: Final validation — full test suite

**Step 1:** Run full suite

```bash
npx vitest run
```

Expected: 790+ tests pass, 0 fail

**Step 2:** Commit any remaining fixes if needed

---

## What this plan does NOT fix (accepted risks)

| Item | Why accepted |
|------|-------------|
| Other 10 adapters have no session support | They don't support it at CLI level; `skipHistory` will always be `false` for them — no behavior change |
| Codex `thread_id` might not be in `thread.started` event | Plan captures from metadata generically; if field name differs, adapter gracefully falls back to no-resume |
| CLIAdapter interface doesn't declare `hasActiveSession()` | Checked via `'hasActiveSession' in adapter` duck typing; avoids breaking all 12 adapter implementations |

## Sources

- [Claude Code headless docs](https://code.claude.com/docs/en/headless)
- [Codex CLI non-interactive mode](https://developers.openai.com/codex/noninteractive/)
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference)

/**
 * Tests for Tri-Party Session Coordination — Card D.3
 * Source: FR-013 (AC-039, AC-040, AC-041a)
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionManager } from '../../session/session-manager.js';
import type { SessionState } from '../../session/session-manager.js';
import type { SessionConfig } from '../../types/session.js';
import type { CLIAdapter } from '../../types/adapter.js';
import {
  type TriPartySessionState,
  extractTriPartyState,
  restoreTriPartySession,
} from '../../god/tri-party-session.js';

let tmpDir: string;
let sessionsDir: string;

function makeConfig(overrides?: Partial<SessionConfig>): SessionConfig {
  return {
    projectDir: tmpDir,
    coder: 'claude-code',
    reviewer: 'codex',
    god: 'gemini',
    task: 'implement login',
    ...overrides,
  };
}

function makeMockAdapter(name: string): CLIAdapter {
  return {
    name,
    displayName: `${name} CLI`,
    version: '1.0',
    isInstalled: async () => true,
    getVersion: async () => '1.0',
    execute: async function* () {},
    kill: async () => {},
    isRunning: () => false,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-triparty-'));
  sessionsDir = path.join(tmpDir, '.duo', 'sessions');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── AC-039: 三方 session ID 在 snapshot.json 中原子提交 ──

describe('AC-039: Tri-party session ID atomic commit', () => {
  test('all three session IDs are written atomically in a single snapshot.json', () => {
    const mgr = new SessionManager(sessionsDir);
    const session = mgr.createSession(makeConfig());

    const state: SessionState = {
      round: 1,
      status: 'coding',
      currentRole: 'coder',
      coderSessionId: 'coder-session-001',
      reviewerSessionId: 'reviewer-session-001',
      godSessionId: 'god-session-001',
      godAdapter: 'gemini',
    };
    mgr.saveState(session.id, state);

    // Verify all three IDs are in the same snapshot.json file
    const sessionDir = path.join(sessionsDir, session.id);
    const snapshot = JSON.parse(fs.readFileSync(path.join(sessionDir, 'snapshot.json'), 'utf-8'));
    expect(snapshot.state.coderSessionId).toBe('coder-session-001');
    expect(snapshot.state.reviewerSessionId).toBe('reviewer-session-001');
    expect(snapshot.state.godSessionId).toBe('god-session-001');
  });

  test('extractTriPartyState extracts all three session IDs from SessionState', () => {
    const state: SessionState = {
      round: 2,
      status: 'reviewing',
      currentRole: 'reviewer',
      coderSessionId: 'coder-abc',
      reviewerSessionId: 'reviewer-def',
      godSessionId: 'god-ghi',
    };

    const triParty = extractTriPartyState(state);
    expect(triParty.coderSessionId).toBe('coder-abc');
    expect(triParty.reviewerSessionId).toBe('reviewer-def');
    expect(triParty.godSessionId).toBe('god-ghi');
  });

  test('extractTriPartyState returns null for missing session IDs', () => {
    const state: SessionState = {
      round: 1,
      status: 'coding',
      currentRole: 'coder',
    };

    const triParty = extractTriPartyState(state);
    expect(triParty.coderSessionId).toBeNull();
    expect(triParty.reviewerSessionId).toBeNull();
    expect(triParty.godSessionId).toBeNull();
  });
});

// ── AC-040: 任一方 session 丢失不影响其他方 ──

describe('AC-040: Individual session loss does not affect others', () => {
  test('coder session lost — reviewer and god still restored', async () => {
    const triParty: TriPartySessionState = {
      coderSessionId: null, // lost
      reviewerSessionId: 'reviewer-session-001',
      godSessionId: 'god-session-001',
    };

    const config = makeConfig();
    const mockFactory = (name: string) => makeMockAdapter(name);

    const result = await restoreTriPartySession(triParty, config, mockFactory);
    expect(result.coder).toBeNull();
    expect(result.reviewer).not.toBeNull();
    expect(result.reviewer!.adapter.name).toBe('codex');
    expect(result.reviewer!.sessionId).toBe('reviewer-session-001');
    expect(result.god).not.toBeNull();
    expect(result.god!.adapter.name).toBe('gemini');
    expect(result.god!.sessionId).toBe('god-session-001');
  });

  test('reviewer session lost — coder and god still restored', async () => {
    const triParty: TriPartySessionState = {
      coderSessionId: 'coder-session-001',
      reviewerSessionId: null, // lost
      godSessionId: 'god-session-001',
    };

    const config = makeConfig();
    const mockFactory = (name: string) => makeMockAdapter(name);

    const result = await restoreTriPartySession(triParty, config, mockFactory);
    expect(result.coder).not.toBeNull();
    expect(result.coder!.adapter.name).toBe('claude-code');
    expect(result.reviewer).toBeNull();
    expect(result.god).not.toBeNull();
    expect(result.god!.adapter.name).toBe('gemini');
  });

  test('god session lost — coder and reviewer still restored', async () => {
    const triParty: TriPartySessionState = {
      coderSessionId: 'coder-session-001',
      reviewerSessionId: 'reviewer-session-001',
      godSessionId: null, // lost
    };

    const config = makeConfig();
    const mockFactory = (name: string) => makeMockAdapter(name);

    const result = await restoreTriPartySession(triParty, config, mockFactory);
    expect(result.coder).not.toBeNull();
    expect(result.reviewer).not.toBeNull();
    expect(result.god).toBeNull();
  });

  test('adapter factory throws for one party — others unaffected', async () => {
    const triParty: TriPartySessionState = {
      coderSessionId: 'coder-session-001',
      reviewerSessionId: 'reviewer-session-001',
      godSessionId: 'god-session-001',
    };

    const config = makeConfig();
    const mockFactory = (name: string) => {
      if (name === 'codex') throw new Error('Adapter unavailable');
      return makeMockAdapter(name);
    };

    const result = await restoreTriPartySession(triParty, config, mockFactory);
    expect(result.coder).not.toBeNull();
    expect(result.reviewer).toBeNull(); // factory threw for codex (reviewer)
    expect(result.god).not.toBeNull();
  });

  test('all sessions lost — all return null', async () => {
    const triParty: TriPartySessionState = {
      coderSessionId: null,
      reviewerSessionId: null,
      godSessionId: null,
    };

    const config = makeConfig();
    const mockFactory = (name: string) => makeMockAdapter(name);

    const result = await restoreTriPartySession(triParty, config, mockFactory);
    expect(result.coder).toBeNull();
    expect(result.reviewer).toBeNull();
    expect(result.god).toBeNull();
  });
});

// ── AC-041a: God 与 Coder 使用同一 CLI 时 session 隔离 ──

describe('AC-041a: Session isolation when God and Coder use same CLI', () => {
  test('God and Coder both use claude-code — separate adapter instances', async () => {
    const triParty: TriPartySessionState = {
      coderSessionId: 'coder-session-001',
      reviewerSessionId: 'reviewer-session-001',
      godSessionId: 'god-session-002',
    };

    // God and Coder both use claude-code
    const config = makeConfig({ coder: 'claude-code', god: 'claude-code' });
    const instances: CLIAdapter[] = [];
    const mockFactory = (name: string) => {
      const adapter = makeMockAdapter(name);
      instances.push(adapter);
      return adapter;
    };

    const result = await restoreTriPartySession(triParty, config, mockFactory);

    // Both restored successfully
    expect(result.coder).not.toBeNull();
    expect(result.god).not.toBeNull();

    // Different adapter instances (session isolation)
    expect(result.coder!.adapter).not.toBe(result.god!.adapter);

    // Different session IDs
    expect(result.coder!.sessionId).toBe('coder-session-001');
    expect(result.god!.sessionId).toBe('god-session-002');
  });

  test('all three use the same CLI — three separate adapter instances', async () => {
    const triParty: TriPartySessionState = {
      coderSessionId: 'coder-session-001',
      reviewerSessionId: 'reviewer-session-002',
      godSessionId: 'god-session-003',
    };

    const config = makeConfig({ coder: 'claude-code', reviewer: 'claude-code', god: 'claude-code' });
    const instances: CLIAdapter[] = [];
    const mockFactory = (name: string) => {
      const adapter = makeMockAdapter(name);
      instances.push(adapter);
      return adapter;
    };

    const result = await restoreTriPartySession(triParty, config, mockFactory);

    // All three restored
    expect(result.coder).not.toBeNull();
    expect(result.reviewer).not.toBeNull();
    expect(result.god).not.toBeNull();

    // All different instances
    expect(result.coder!.adapter).not.toBe(result.reviewer!.adapter);
    expect(result.coder!.adapter).not.toBe(result.god!.adapter);
    expect(result.reviewer!.adapter).not.toBe(result.god!.adapter);

    // Each has its own session ID
    expect(result.coder!.sessionId).toBe('coder-session-001');
    expect(result.reviewer!.sessionId).toBe('reviewer-session-002');
    expect(result.god!.sessionId).toBe('god-session-003');
  });
});

// ── AC: duo resume 三方均正确恢复 (end-to-end with SessionManager) ──

describe('Tri-party session restore via SessionManager', () => {
  test('full round-trip: create → save tri-party IDs → load → restore', async () => {
    const mgr = new SessionManager(sessionsDir);
    const session = mgr.createSession(makeConfig());

    // Simulate a session with all three parties active
    const state: SessionState = {
      round: 3,
      status: 'reviewing',
      currentRole: 'reviewer',
      coderSessionId: 'coder-roundtrip-001',
      reviewerSessionId: 'reviewer-roundtrip-001',
      godSessionId: 'god-roundtrip-001',
      godAdapter: 'gemini',
    };
    mgr.saveState(session.id, state);

    // Load session (simulating duo resume)
    const loaded = mgr.loadSession(session.id);
    const triParty = extractTriPartyState(loaded.state);

    expect(triParty.coderSessionId).toBe('coder-roundtrip-001');
    expect(triParty.reviewerSessionId).toBe('reviewer-roundtrip-001');
    expect(triParty.godSessionId).toBe('god-roundtrip-001');

    // Restore adapters
    const mockFactory = (name: string) => makeMockAdapter(name);
    const result = await restoreTriPartySession(triParty, loaded.metadata, mockFactory);

    expect(result.coder).not.toBeNull();
    expect(result.coder!.sessionId).toBe('coder-roundtrip-001');
    expect(result.reviewer).not.toBeNull();
    expect(result.reviewer!.sessionId).toBe('reviewer-roundtrip-001');
    expect(result.god).not.toBeNull();
    expect(result.god!.sessionId).toBe('god-roundtrip-001');
  });

  test('legacy session without god fields — backward compatible restore', async () => {
    const mgr = new SessionManager(sessionsDir);
    const session = mgr.createSession(makeConfig({ god: 'codex' }));

    // Legacy state with only coder and reviewer
    const state: SessionState = {
      round: 2,
      status: 'coding',
      currentRole: 'coder',
      coderSessionId: 'coder-legacy-001',
      reviewerSessionId: 'reviewer-legacy-001',
    };
    mgr.saveState(session.id, state);

    const loaded = mgr.loadSession(session.id);
    const triParty = extractTriPartyState(loaded.state);

    expect(triParty.godSessionId).toBeNull();

    const mockFactory = (name: string) => makeMockAdapter(name);
    const result = await restoreTriPartySession(triParty, loaded.metadata, mockFactory);

    expect(result.coder).not.toBeNull();
    expect(result.reviewer).not.toBeNull();
    expect(result.god).toBeNull(); // No god session to restore
  });
});

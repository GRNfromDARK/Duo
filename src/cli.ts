#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { VERSION } from './index.js';
import { sanitizeGodAdapterForResume } from './god/god-adapter-config.js';
import { parseStartArgs, createSessionConfig } from './session/session-starter.js';
import { detectInstalledCLIs } from './adapters/detect.js';
import { handleResumeList, handleResume, handleLog } from './cli-commands.js';
import { App } from './ui/components/App.js';
import type { SessionConfig } from './types/session.js';
import * as path from 'node:path';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

const command = args[0];

if (command === 'start') {
  (async () => {
    // Detect installed CLIs
    const detected = await detectInstalledCLIs();

    // Parse args
    const parsed = parseStartArgs(args);
    let config: SessionConfig | undefined;

    // If all required args are provided, validate and create config
    if (parsed.coder && parsed.reviewer && parsed.task) {
      const result = await createSessionConfig(parsed, detected);

      if (!result.validation.valid) {
        for (const err of result.validation.errors) {
          console.error(`Error: ${err}`);
        }
        process.exit(1);
      }

      for (const warn of result.validation.warnings) {
        console.warn(`Warning: ${warn}`);
      }

      config = result.config ?? undefined;
    }

    // Render TUI — either with full config (direct start) or without (interactive setup)
    const { waitUntilExit } = render(
      React.createElement(App, {
        initialConfig: config,
        detected,
      }),
      { exitOnCtrlC: false },
    );

    await waitUntilExit();
  })().catch((err) => {
    console.error('Failed to start Duo:', err);
    process.exit(1);
  });
} else if (command === 'resume') {
  const sessionsDir = path.join(process.cwd(), '.duo', 'sessions');
  const sessionId = args[1];

  if (sessionId) {
    (async () => {
      const resumeLogs: string[] = [];
      const result = handleResume(sessionId, sessionsDir, (msg) => resumeLogs.push(msg));
      if (!result.success || !result.session) {
        for (const line of resumeLogs) {
          console.log(line);
        }
        process.exit(1);
      }

      const detected = await detectInstalledCLIs();
      const resolvedGod = sanitizeGodAdapterForResume(
        result.session.metadata.reviewer,
        detected,
        result.session.metadata.god,
      );
      for (const warn of resolvedGod.warnings) {
        console.warn(`Warning: ${warn}`);
      }

      const initialConfig: SessionConfig = {
        projectDir: result.session.metadata.projectDir,
        coder: result.session.metadata.coder,
        reviewer: result.session.metadata.reviewer,
        god: resolvedGod.god,
        task: result.session.metadata.task,
      };

      const { waitUntilExit } = render(
        React.createElement(App, {
          initialConfig,
          detected,
          resumeSession: result.session,
        }),
        { exitOnCtrlC: false },
      );

      await waitUntilExit();
    })().catch((err) => {
      console.error('Failed to resume Duo session:', err);
      process.exit(1);
    });
  } else {
    handleResumeList(sessionsDir, console.log);
  }
} else if (command === 'log') {
  const sessionsDir = path.join(process.cwd(), '.duo', 'sessions');
  const sessionId = args[1];

  if (!sessionId) {
    console.log('Usage: duo log <session-id> [--type <type>]');
    process.exit(1);
  }

  const typeIdx = args.indexOf('--type');
  const type = typeIdx !== -1 ? args[typeIdx + 1] : undefined;

  handleLog(sessionId, { type }, sessionsDir, console.log);
} else {
  console.log(`Duo v${VERSION} — Multi AI Coding Assistant Collaboration Platform`);
  console.log('');
  console.log('Usage:');
  console.log('  duo start                                             Interactive mode');
  console.log('  duo start --dir <path> --coder <cli> --reviewer <cli> --task <desc>');
  console.log('  duo resume                List resumable sessions');
  console.log('  duo resume <session-id>   Resume a session');
  console.log('  duo log <session-id>      Show God audit log');
  console.log('  duo log <id> --type <t>   Filter by decision type');
  console.log('  duo --version             Show version');
  console.log('');
  console.log('Examples:');
  console.log('  duo start --coder claude-code --reviewer codex --task "Add JWT auth"');
  console.log('  duo start   # Interactive setup wizard');
}

/**
 * Session starter — creates and validates new Duo sessions.
 * Source: FR-001 (AC-001, AC-002, AC-003, AC-004)
 */

import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import type { DetectedCLI } from '../adapters/detect.js';
import {
  isSupportedGodAdapterName,
  resolveGodAdapterForStart,
} from '../god/god-adapter-config.js';
import type {
  StartArgs,
  ValidationResult,
  StartResult,
} from '../types/session.js';

/**
 * Parse CLI argv into StartArgs.
 * Expects argv like: ['start', '--dir', '/path', '--coder', 'claude-code', ...]
 */
export function parseStartArgs(argv: string[]): StartArgs {
  const args: StartArgs = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--dir':
        if (i + 1 >= argv.length) break;
        args.dir = argv[++i];
        break;
      case '--coder':
        if (i + 1 >= argv.length) break;
        args.coder = argv[++i];
        break;
      case '--reviewer':
        if (i + 1 >= argv.length) break;
        args.reviewer = argv[++i];
        break;
      case '--god':
        if (i + 1 >= argv.length) break;
        args.god = argv[++i];
        break;
      case '--task':
        if (i + 1 >= argv.length) break;
        args.task = argv[++i];
        break;
    }
  }
  return args;
}

/**
 * Validate project directory: exists, accessible, optionally git repo.
 */
export async function validateProjectDir(dir: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    await access(dir, constants.R_OK);
  } catch {
    return { valid: false, errors: [`Directory does not exist or is not accessible: ${dir}`], warnings: [] };
  }

  // Check if git repo
  const isGit = await new Promise<boolean>((resolve) => {
    execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir }, (err) => {
      resolve(!err);
    });
  });

  if (!isGit) {
    warnings.push('Directory is not a git repository. Some CLI tools (e.g. Codex) require a git repo.');
  }

  return { valid: true, errors, warnings };
}

/**
 * Validate coder/reviewer choices against detected CLIs.
 */
export function validateCLIChoices(
  coder: string,
  reviewer: string,
  detected: DetectedCLI[],
  god?: string,
): ValidationResult {
  const errors: string[] = [];

  if (coder === reviewer) {
    errors.push('Coder and reviewer cannot be the same CLI tool.');
    return { valid: false, errors, warnings: [] };
  }

  const rolesToCheck: [string, string][] = [['Coder', coder], ['Reviewer', reviewer]];
  if (god) {
    if (!isSupportedGodAdapterName(god)) {
      errors.push(`God adapter '${god}' is not supported. Supported God adapters: claude-code, codex.`);
      return { valid: false, errors, warnings: [] };
    }

    rolesToCheck.push(['God', god]);
  }

  for (const [role, name] of rolesToCheck) {
    const cli = detected.find((d) => d.name === name);
    if (!cli) {
      errors.push(`${role} CLI '${name}' not found in registry.`);
    } else if (!cli.installed) {
      errors.push(`${role} CLI '${cli.displayName}' is not installed. Please install it first.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings: [] };
}

/**
 * Create a validated SessionConfig from StartArgs and detected CLIs.
 */
export async function createSessionConfig(
  args: StartArgs,
  detected: DetectedCLI[],
): Promise<StartResult> {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  const installedNames = detected.filter((d) => d.installed).map((d) => d.name);

  // Validate required fields
  if (!args.coder) allErrors.push('Missing required option: --coder');
  if (!args.reviewer) allErrors.push('Missing required option: --reviewer');
  if (!args.task) allErrors.push('Missing required option: --task');

  // Validate directory
  const dir = args.dir ?? process.cwd();
  const dirResult = await validateProjectDir(dir);
  allErrors.push(...dirResult.errors);
  allWarnings.push(...dirResult.warnings);

  // Validate CLI choices (only if both provided)
  if (args.coder && args.reviewer) {
    const cliResult = validateCLIChoices(args.coder, args.reviewer, detected, args.god);
    allErrors.push(...cliResult.errors);
    allWarnings.push(...cliResult.warnings);
  }

  let godConfig: ReturnType<typeof resolveGodAdapterForStart> | null = null;
  if (args.reviewer && allErrors.length === 0) {
    godConfig = resolveGodAdapterForStart(args.reviewer, detected, args.god);
    if (!godConfig.ok) {
      allErrors.push(...godConfig.errors);
    } else {
      allWarnings.push(...godConfig.warnings);
    }
  }

  const valid = allErrors.length === 0 && dirResult.valid;

  if (!valid) {
    return {
      config: null,
      validation: { valid: false, errors: allErrors, warnings: allWarnings },
      detectedCLIs: installedNames,
    };
  }

  if (!godConfig?.ok) {
    return {
      config: null,
      validation: { valid: false, errors: ['Unable to resolve a supported God adapter.'], warnings: allWarnings },
      detectedCLIs: installedNames,
    };
  }

  const god = godConfig.god;

  return {
    config: {
      projectDir: dir,
      coder: args.coder!,
      reviewer: args.reviewer!,
      god,
      task: args.task!,
    },
    validation: { valid: true, errors: [], warnings: allWarnings },
    detectedCLIs: installedNames,
  };
}

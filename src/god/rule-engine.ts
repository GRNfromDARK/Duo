/**
 * Non-delegable Scenario Rule Engine
 * Source: FR-008a (AC-028, AC-029, AC-030), NFR-009
 *
 * Synchronous rule engine (< 5ms, no LLM involvement).
 * Block-level rules have absolute priority — God cannot override (NFR-009).
 */

import { resolve, dirname, basename, join as pathJoin } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

export type RuleLevel = 'block' | 'warn';

export interface RuleResult {
  ruleId: string;
  level: RuleLevel;
  matched: boolean;
  description: string;
  details?: string;
}

export interface RuleEngineResult {
  blocked: boolean;
  results: RuleResult[];
}

export interface ActionContext {
  type: 'file_write' | 'command_exec' | 'config_modify';
  path?: string;
  command?: string;
  cwd: string;
  godApproved?: boolean;
}

const SYSTEM_DIRS_RAW = ['/etc', '/usr', '/bin', '/System', '/Library'];

// Resolve system dirs to handle macOS symlinks (e.g. /etc -> /private/etc)
const SYSTEM_DIRS = [...new Set([
  ...SYSTEM_DIRS_RAW,
  ...SYSTEM_DIRS_RAW.map(d => {
    try { return existsSync(d) ? realpathSync(d) : d; } catch { return d; }
  }),
])];

const SUSPICIOUS_NETWORK_PATTERNS = [
  /curl\s+.*(?:-d|--data|--data-binary|--data-raw|--data-urlencode)\s+@/,
];

function resolvePath(inputPath: string, cwd: string): string {
  const resolved = inputPath.startsWith('/') ? inputPath : resolve(cwd, inputPath);
  // Use realpathSync to resolve symlinks and prevent symlink-based escapes.
  // Walk up the path hierarchy to find the deepest existing ancestor for resolution.
  try {
    if (existsSync(resolved)) {
      return realpathSync(resolved);
    }
    // The full path doesn't exist, but a parent with a symlink might.
    // Walk up to find the deepest existing directory and resolve from there.
    let current = resolved;
    const tail: string[] = [];
    while (current !== dirname(current)) {
      tail.unshift(basename(current));
      current = dirname(current);
      if (existsSync(current)) {
        const realParent = realpathSync(current);
        return pathJoin(realParent, ...tail);
      }
    }
  } catch {
    // If realpath fails, fall through to resolved path
  }
  return resolved;
}

function evaluateR001(ctx: ActionContext): RuleResult {
  const result: RuleResult = {
    ruleId: 'R-001',
    level: 'block',
    matched: false,
    description: 'File write outside ~/Documents',
  };

  if (ctx.type !== 'file_write' && ctx.type !== 'config_modify') return result;
  if (!ctx.path) return result;

  const resolved = resolvePath(ctx.path, ctx.cwd);
  const documentsDir = resolve(homedir(), 'Documents');

  if (!resolved.startsWith(documentsDir + '/') && resolved !== documentsDir) {
    result.matched = true;
    result.details = `Path ${resolved} is outside ${documentsDir}`;
  }

  return result;
}

function evaluateR002(ctx: ActionContext): RuleResult {
  const result: RuleResult = {
    ruleId: 'R-002',
    level: 'block',
    matched: false,
    description: 'System critical directory access',
  };

  let pathToCheck: string | undefined;

  if ((ctx.type === 'file_write' || ctx.type === 'config_modify') && ctx.path) {
    pathToCheck = resolvePath(ctx.path, ctx.cwd);
  } else if (ctx.type === 'command_exec' && ctx.command) {
    // Split command into tokens and only check tokens that look like absolute paths
    const tokens = ctx.command.split(/\s+/);
    for (const rawToken of tokens) {
      const token = rawToken.replace(/^["']|["']$/g, '');
      if (!token.startsWith('/')) continue;
      for (const dir of SYSTEM_DIRS) {
        if (token.startsWith(dir + '/') || token === dir) {
          result.matched = true;
          result.details = `Command references system directory ${dir}`;
          return result;
        }
      }
    }
    return result;
  }

  if (pathToCheck) {
    for (const dir of SYSTEM_DIRS) {
      if (pathToCheck.startsWith(dir + '/') || pathToCheck === dir) {
        result.matched = true;
        result.details = `Path ${pathToCheck} is in system directory ${dir}`;
        return result;
      }
    }
  }

  return result;
}

function evaluateR003(ctx: ActionContext): RuleResult {
  const result: RuleResult = {
    ruleId: 'R-003',
    level: 'block',
    matched: false,
    description: 'Suspicious network outbound',
  };

  if (ctx.type !== 'command_exec' || !ctx.command) return result;

  for (const pattern of SUSPICIOUS_NETWORK_PATTERNS) {
    if (pattern.test(ctx.command)) {
      result.matched = true;
      result.details = `Command matches suspicious pattern: ${pattern}`;
      return result;
    }
  }

  return result;
}

function evaluateR004(ctx: ActionContext, hasBlock: boolean): RuleResult {
  const result: RuleResult = {
    ruleId: 'R-004',
    level: 'warn',
    matched: false,
    description: 'God approved action contradicts rule engine block',
  };

  if (ctx.godApproved && hasBlock) {
    result.matched = true;
    result.details = 'God approved this action but rule engine has a block-level match';
  }

  return result;
}

function evaluateR005(ctx: ActionContext): RuleResult {
  const result: RuleResult = {
    ruleId: 'R-005',
    level: 'warn',
    matched: false,
    description: 'Coder modifies .duo/ config',
  };

  if (!ctx.path) return result;

  const resolved = resolvePath(ctx.path, ctx.cwd);
  if (resolved.includes('/.duo/') || resolved.endsWith('/.duo')) {
    result.matched = true;
    result.details = `Path ${resolved} modifies .duo/ configuration`;
  }

  return result;
}

export function evaluateRules(action: ActionContext): RuleEngineResult {
  const r001 = evaluateR001(action);
  const r002 = evaluateR002(action);
  const r003 = evaluateR003(action);

  const hasBlock = [r001, r002, r003].some((r) => r.matched);

  const r004 = evaluateR004(action, hasBlock);
  const r005 = evaluateR005(action);

  const results = [r001, r002, r003, r004, r005];

  // NFR-009: block level has absolute priority, God cannot override
  const blocked = results.some((r) => r.matched && r.level === 'block');

  return { blocked, results };
}

/**
 * Environment variable builder for adapters.
 * Constructs a minimal, explicit env for child processes instead of
 * blindly forwarding the entire parent process.env.
 */

/** Base system variables needed for most CLI tools to function. */
const BASE_ENV_VARS = [
  'PATH', 'HOME', 'SHELL', 'LANG', 'TERM', 'USER', 'LOGNAME',
  'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
  'LC_ALL', 'LC_CTYPE',
] as const;

export interface BuildAdapterEnvOptions {
  /** Exact env var names the adapter needs from process.env */
  requiredVars?: string[];
  /** Prefix patterns the adapter needs (e.g. 'ANTHROPIC_' matches ANTHROPIC_API_KEY) */
  requiredPrefixes?: string[];
  /** Additional env vars injected by the adapter (e.g. GOOSE_MODE=auto) */
  extraEnv?: Record<string, string>;
}

/**
 * Build a minimal environment for an adapter's child process.
 * Returns { env, replaceEnv: true } ready to pass to ProcessManager.
 */
export function buildAdapterEnv(
  opts: BuildAdapterEnvOptions = {},
): { env: Record<string, string>; replaceEnv: true } {
  const env: Record<string, string> = {};

  // Copy base system vars
  for (const key of BASE_ENV_VARS) {
    if (process.env[key]) {
      env[key] = process.env[key]!;
    }
  }

  // Copy explicitly required vars
  if (opts.requiredVars) {
    for (const key of opts.requiredVars) {
      if (process.env[key]) {
        env[key] = process.env[key]!;
      }
    }
  }

  // Copy vars matching required prefixes
  if (opts.requiredPrefixes) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      for (const prefix of opts.requiredPrefixes) {
        if (key.startsWith(prefix)) {
          env[key] = value;
          break;
        }
      }
    }
  }

  // Merge adapter-injected vars (these override everything)
  if (opts.extraEnv) {
    Object.assign(env, opts.extraEnv);
  }

  return { env, replaceEnv: true };
}

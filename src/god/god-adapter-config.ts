import type { DetectedCLI } from '../adapters/detect.js';
import type { GodAdapterName } from '../types/god-adapter.js';

export const SUPPORTED_GOD_ADAPTERS: GodAdapterName[] = ['claude-code', 'codex'];

export function isSupportedGodAdapterName(name: string): name is GodAdapterName {
  return SUPPORTED_GOD_ADAPTERS.includes(name as GodAdapterName);
}

export function getInstalledGodAdapters(detected: DetectedCLI[]): DetectedCLI[] {
  return detected.filter((cli) => cli.installed && isSupportedGodAdapterName(cli.name));
}

interface ResolutionSuccess {
  ok: true;
  god: GodAdapterName;
  warnings: string[];
}

interface ResolutionFailure {
  ok: false;
  errors: string[];
  warnings: string[];
}

export type GodAdapterResolution = ResolutionSuccess | ResolutionFailure;

function formatSupportedAdapters(): string {
  return SUPPORTED_GOD_ADAPTERS.join(', ');
}

function findDetectedCLI(detected: DetectedCLI[], name: string): DetectedCLI | undefined {
  return detected.find((cli) => cli.name === name);
}

function pickFallbackGodAdapter(detected: DetectedCLI[]): GodAdapterName | null {
  const installed = getInstalledGodAdapters(detected);
  if (installed.length === 0) {
    return null;
  }

  const preferred = installed.find((cli) => cli.name === 'claude-code') ?? installed[0];
  return preferred.name as GodAdapterName;
}

export function resolveGodAdapterForStart(
  reviewer: string,
  detected: DetectedCLI[],
  explicitGod?: string,
): GodAdapterResolution {
  const warnings: string[] = [];

  if (explicitGod) {
    if (!isSupportedGodAdapterName(explicitGod)) {
      return {
        ok: false,
        errors: [
          `God adapter '${explicitGod}' is not supported. Supported God adapters: ${formatSupportedAdapters()}.`,
        ],
        warnings,
      };
    }

    const explicitDetected = findDetectedCLI(detected, explicitGod);
    if (!explicitDetected) {
      return {
        ok: false,
        errors: [`God CLI '${explicitGod}' not found in registry.`],
        warnings,
      };
    }

    if (!explicitDetected.installed) {
      return {
        ok: false,
        errors: [`God CLI '${explicitDetected.displayName}' is not installed. Please install it first.`],
        warnings,
      };
    }

    return { ok: true, god: explicitGod, warnings };
  }

  const reviewerDetected = findDetectedCLI(detected, reviewer);
  if (reviewerDetected?.installed && isSupportedGodAdapterName(reviewer)) {
    return { ok: true, god: reviewer, warnings };
  }

  const fallbackGod = pickFallbackGodAdapter(detected);
  if (!fallbackGod) {
    return {
      ok: false,
      errors: [
        `No supported God adapter is installed. Install one of: ${formatSupportedAdapters()}.`,
      ],
      warnings,
    };
  }

  warnings.push(
    `Reviewer '${reviewer}' cannot act as God. Defaulting to '${fallbackGod}'. Supported God adapters: ${formatSupportedAdapters()}.`,
  );
  return { ok: true, god: fallbackGod, warnings };
}

export function sanitizeGodAdapterForResume(
  reviewer: string,
  detected: DetectedCLI[],
  persistedGod?: string,
): ResolutionSuccess {
  const warnings: string[] = [];

  if (persistedGod && isSupportedGodAdapterName(persistedGod)) {
    const persistedDetected = findDetectedCLI(detected, persistedGod);
    if (persistedDetected?.installed) {
      return { ok: true, god: persistedGod, warnings };
    }

    warnings.push(
      `Persisted God adapter '${persistedGod}' is not currently installed. Falling back to an available God adapter.`,
    );
  } else if (persistedGod) {
    warnings.push(
      `Persisted God adapter '${persistedGod}' is no longer supported. Supported God adapters: ${formatSupportedAdapters()}.`,
    );
  }

  const fallback = resolveGodAdapterForStart(reviewer, detected);
  if (fallback.ok) {
    return {
      ok: true,
      god: fallback.god,
      warnings: [...warnings, ...fallback.warnings],
    };
  }

  throw new Error(fallback.errors[0] ?? 'No supported God adapter is installed.');
}

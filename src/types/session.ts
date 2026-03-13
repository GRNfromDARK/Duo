/**
 * Session types for Duo.
 * Source: FR-001 (AC-001, AC-002, AC-003, AC-004)
 */

import type { GodAdapterName } from './god-adapter.js';

export interface SessionConfig {
  projectDir: string;
  coder: string;
  reviewer: string;
  god: GodAdapterName;
  task: string;
}

export interface StartArgs {
  dir?: string;
  coder?: string;
  reviewer?: string;
  god?: string;
  task?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface StartResult {
  config: SessionConfig | null;
  validation: ValidationResult;
  detectedCLIs: string[];
}

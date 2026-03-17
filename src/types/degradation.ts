/**
 * Degradation state types — shared by WatchdogService and session persistence.
 * Extracted from degradation-manager.ts to decouple from the (deprecated) DegradationManager class.
 */

export type DegradationLevel = 'L1' | 'L2' | 'L3' | 'L4';

export type GodErrorKind = 'process_exit' | 'timeout' | 'parse_failure' | 'schema_validation';

export interface DegradationState {
  level: DegradationLevel;
  consecutiveFailures: number;
  godDisabled: boolean;
  fallbackActive: boolean;
  lastError?: string;
}

export interface DegradationNotification {
  type: 'retrying' | 'fallback_activated' | 'god_disabled';
  message: string;
}

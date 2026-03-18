/**
 * Observation Factory — minimal observation creation.
 * Replaces observation-classifier.ts (regex classification removed).
 * God interprets content directly; no pre-classification needed.
 */

import type { Observation, ObservationSource } from '../types/observation.js';

export function createWorkObservation(
  llmText: string,
  source: ObservationSource,
): Observation {
  return {
    source,
    type: source === 'reviewer' ? 'review_output' : 'work_output',
    summary: llmText,
    severity: 'info',
    timestamp: new Date().toISOString(),
  };
}

export function createHumanObservation(
  text: string,
  type: 'human_message' | 'human_interrupt' = 'human_message',
): Observation {
  return {
    source: 'human',
    type,
    summary: text,
    severity: 'info',
    timestamp: new Date().toISOString(),
  };
}

export function createRuntimeErrorObservation(
  errorMessage: string,
): Observation {
  return {
    source: 'runtime',
    type: 'runtime_error',
    summary: errorMessage,
    severity: 'error',
    timestamp: new Date().toISOString(),
  };
}

export function deduplicateObservations(observations: Observation[]): Observation[] {
  const seen = new Set<string>();
  return observations.filter(obs => {
    const key = `${obs.timestamp}-${obs.source}-${obs.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

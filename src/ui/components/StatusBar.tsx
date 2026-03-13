/**
 * StatusBar — Top 1-line status bar for Duo TUI.
 * Source: FR-018 (AC-061, AC-062, AC-063, AC-064)
 *
 * Layout: Duo  <project>  Round N/Max  <Agent> <icon> <status>  <tokens>tok
 */

import React from 'react';
import { Box, Text } from 'ink';

export type WorkflowStatus = 'idle' | 'active' | 'error' | 'routing' | 'interrupted' | 'done';

export interface StatusBarProps {
  projectPath: string;
  round: number;
  maxRounds: number;
  status: WorkflowStatus;
  activeAgent: string | null;
  tokenCount: number;
  columns: number;
  godAdapter?: string;
  reviewerAdapter?: string;
  taskType?: string;
  currentPhase?: string;
  degradationLevel?: string; // L1/L2/L3/L4
  godLatency?: number;       // latest God decision latency (ms)
}

const STATUS_CONFIG: Record<WorkflowStatus, { icon: string; label: string; color: string }> = {
  active:      { icon: '◆', label: 'Active',      color: 'green' },
  idle:        { icon: '◇', label: 'Idle',         color: 'white' },
  error:       { icon: '⚠', label: 'Error',        color: 'red' },
  routing:     { icon: '◈', label: 'Routing',      color: 'yellow' },
  interrupted: { icon: '⏸', label: 'Interrupted',  color: 'white' },
  done:        { icon: '◇', label: 'Done',         color: 'green' },
};

function formatTokens(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

export function StatusBar({
  projectPath,
  round,
  maxRounds,
  status,
  activeAgent,
  tokenCount,
  columns,
  godAdapter,
  reviewerAdapter,
  taskType,
  currentPhase,
  degradationLevel,
  godLatency,
}: StatusBarProps): React.ReactElement {
  const cfg = STATUS_CONFIG[status];
  const roundStr = `Round ${round}/${maxRounds}`;
  const tokenStr = `${formatTokens(tokenCount)}tok`;
  const agentStr = activeAgent ? `${activeAgent} ${cfg.icon} ${cfg.label}` : `${cfg.icon} ${cfg.label}`;
  // Show God adapter only when it differs from reviewer
  const showGod = godAdapter && reviewerAdapter && godAdapter !== reviewerAdapter;
  const godStr = showGod ? `God:${godAdapter}` : '';
  const taskTypeStr = taskType ? `[${taskType}]` : '';
  const phaseStr = currentPhase ? `φ:${currentPhase}` : '';
  // Degradation: L4 → "God:disabled", L2/L3 → "↓L2"/"↓L3", L1 → hide
  const degradStr = degradationLevel === 'L4'
    ? 'God:disabled'
    : degradationLevel && degradationLevel !== 'L1'
      ? `↓${degradationLevel}`
      : '';
  const latencyStr = godLatency !== undefined ? `${godLatency}ms` : '';

  // Build content and truncate projectPath if needed to fit in 1 line
  // Format: " Duo  <project>  Round N/Max  <agent+status>  [God:X]  <tokens> "
  const fixedParts = `Duo  ${roundStr}  ${agentStr}  ${taskTypeStr ? taskTypeStr + '  ' : ''}${phaseStr ? phaseStr + '  ' : ''}${godStr ? godStr + '  ' : ''}${degradStr ? degradStr + '  ' : ''}${latencyStr ? latencyStr + '  ' : ''}${tokenStr}`;
  const availableForPath = columns - fixedParts.length - 6; // spaces/padding
  const displayPath = availableForPath > 3
    ? (projectPath.length > availableForPath
        ? projectPath.slice(0, availableForPath - 1) + '…'
        : projectPath)
    : '';

  return (
    <Box height={1} width={columns}>
      <Text inverse bold>
        {' Duo'}
        {'  '}
        {displayPath && <Text>{displayPath}</Text>}
        {displayPath && '  '}
        <Text>{roundStr}</Text>
        {'  '}
        <Text color={cfg.color}>{agentStr}</Text>
        {'  '}
        {taskTypeStr && <><Text color="cyan">{taskTypeStr}</Text>{'  '}</>}
        {phaseStr && <><Text color="magenta">{phaseStr}</Text>{'  '}</>}
        {godStr && <><Text color="magenta">{godStr}</Text>{'  '}</>}
        {degradStr && <><Text color={degradationLevel === 'L4' ? 'red' : 'yellow'}>{degradStr}</Text>{'  '}</>}
        {latencyStr && <><Text dimColor>{latencyStr}</Text>{'  '}</>}
        <Text dimColor>{tokenStr}</Text>
        {' '}
      </Text>
    </Box>
  );
}

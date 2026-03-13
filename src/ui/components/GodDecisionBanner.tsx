/**
 * GodDecisionBanner — Ink component for the God auto-decision 2s escape window.
 * Card C.1: FR-008 (AC-025, AC-026, AC-027)
 *
 * Shows God's decision summary with a 2-second countdown.
 * [Space] = immediate execute, [Esc] = cancel to manual mode.
 * Uses pure state functions from god-decision-banner.ts.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import type { GodAutoDecision } from '../../types/god-schemas.js';
import {
  createGodDecisionBannerState,
  handleBannerKeyPress,
  tickBannerCountdown,
  formatDecisionSummary,
  ESCAPE_WINDOW_MS,
  TICK_INTERVAL_MS,
  type GodDecisionBannerState,
} from '../god-decision-banner.js';

export interface GodDecisionBannerProps {
  decision: GodAutoDecision;
  onExecute: () => void;
  onCancel: () => void;
}

export function GodDecisionBanner({
  decision,
  onExecute,
  onCancel,
}: GodDecisionBannerProps): React.ReactElement {
  const [state, setState] = useState<GodDecisionBannerState>(() =>
    createGodDecisionBannerState(decision),
  );
  const firedRef = useRef(false);

  // Countdown timer (100ms ticks for smooth progress bar)
  useEffect(() => {
    if (state.cancelled || state.executed) return;

    const timer = setInterval(() => {
      setState((prev) => tickBannerCountdown(prev));
    }, TICK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [state.cancelled, state.executed]);

  // Fire callbacks when state terminal
  useEffect(() => {
    if (firedRef.current) return;

    if (state.executed) {
      firedRef.current = true;
      onExecute();
    } else if (state.cancelled) {
      firedRef.current = true;
      onCancel();
    }
  }, [state.executed, state.cancelled]);

  // Keyboard: Space = execute, Esc = cancel
  useInput((_input, key) => {
    if (state.cancelled || state.executed) return;

    if (_input === ' ') {
      setState((prev) => handleBannerKeyPress(prev, 'space'));
    } else if (key.escape) {
      setState((prev) => handleBannerKeyPress(prev, 'escape'));
    }
  });

  // Progress bar
  const progress = state.countdown / ESCAPE_WINDOW_MS;
  const BAR_WIDTH = 20;
  const filled = Math.round(progress * BAR_WIDTH);
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const secondsLeft = (state.countdown / 1000).toFixed(1);

  const summary = formatDecisionSummary(decision);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
    >
      <Box>
        <Text color="yellow" bold>⚡ GOD 决策</Text>
        <Text>  {summary}</Text>
      </Box>

      <Box marginTop={1}>
        <Text color="yellow">{bar}</Text>
        <Text>  {secondsLeft}s</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>[Space] 立即执行   [Esc] 取消此决策</Text>
      </Box>
    </Box>
  );
}

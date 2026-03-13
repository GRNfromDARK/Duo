import React from 'react';
import { Box, Text } from 'ink';

export interface ScrollIndicatorProps {
  visible: boolean;
  columns: number;
  newMessageCount?: number;
}

export function ScrollIndicator({ visible, columns, newMessageCount }: ScrollIndicatorProps): React.ReactElement | null {
  if (!visible) {
    return null;
  }

  const countLabel = newMessageCount && newMessageCount > 0
    ? ` (${newMessageCount} new)`
    : '';
  const hint = `↓ New output${countLabel} (press G to follow)`;
  const padding = Math.max(0, Math.floor((columns - hint.length) / 2));

  return (
    <Box height={1} justifyContent="center" width={columns}>
      <Text>{' '.repeat(padding)}</Text>
      <Text color="cyan" bold>{hint}</Text>
    </Box>
  );
}

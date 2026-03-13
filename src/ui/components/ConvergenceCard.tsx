/**
 * ConvergenceCard — displays when Coder and Reviewer agree.
 * Source: FR-026 (AC-082, AC-084)
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';

export type ConvergenceAction = 'accept' | 'continue' | 'review';

export interface ConvergenceCardProps {
  roundCount: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
  onAction: (action: ConvergenceAction) => void;
}

export function ConvergenceCard({
  roundCount,
  filesChanged,
  insertions,
  deletions,
  onAction,
}: ConvergenceCardProps): React.ReactElement {
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === 'a') onAction('accept');
    else if (key === 'c') onAction('continue');
    else if (key === 'r') onAction('review');
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
      <Box>
        <Text color="green" bold>✓ CONVERGED</Text>
        <Text color="green"> after {roundCount} rounds</Text>
      </Box>
      <Text color="gray">Both agents agree on the implementation.</Text>
      <Text color="gray">
        Files modified: {filesChanged}  Lines changed: <Text color="green">+{insertions}</Text> / <Text color="red">-{deletions}</Text>
      </Text>
      <Box marginTop={1}>
        <Text color="cyan" bold>[A]</Text><Text> Accept  </Text>
        <Text color="cyan" bold>[C]</Text><Text> Continue  </Text>
        <Text color="cyan" bold>[R]</Text><Text> Review Changes</Text>
      </Box>
    </Box>
  );
}

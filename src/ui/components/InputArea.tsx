import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Key } from 'ink';

export interface InputAreaProps {
  isLLMRunning: boolean;
  onSubmit: (text: string) => void;
  maxLines?: number;
  /** Controlled mode: external value */
  value?: string;
  /** Controlled mode: called on value change */
  onValueChange?: (value: string) => void;
  /** Called when ? or / pressed with empty input */
  onSpecialKey?: (key: string) => void;
  /** Disable input handling (e.g. when overlay is open) */
  disabled?: boolean;
}

const PLACEHOLDER_RUNNING = 'Type to interrupt, or wait for completion...';
const PLACEHOLDER_IDLE = 'Type a message...';

export type InputAction =
  | { type: 'submit'; value: string }
  | { type: 'update'; value: string }
  | { type: 'special'; key: string }
  | { type: 'noop' };

/**
 * Pure function: given current value, input char and key flags, return the action.
 * Extracted for testability since ink-testing-library doesn't reliably
 * trigger useInput for text input.
 */
export function processInput(
  currentValue: string,
  input: string,
  key: Key,
  maxLines: number,
): InputAction {
  // Enter without modifiers → submit
  if (key.return && !key.meta && !key.ctrl && !key.shift) {
    if (currentValue.trim().length > 0) {
      return { type: 'submit', value: currentValue };
    }
    return { type: 'noop' };
  }

  // Alt+Enter / Ctrl+Enter / Shift+Enter → newline
  if (key.return && (key.meta || key.ctrl || key.shift)) {
    const lines = currentValue.split('\n');
    if (lines.length < maxLines) {
      return { type: 'update', value: currentValue + '\n' };
    }
    return { type: 'noop' };
  }

  // Backspace
  if (key.backspace || key.delete) {
    return { type: 'update', value: currentValue.slice(0, -1) };
  }

  // ? and / when input is empty → special key (open overlay)
  if (currentValue === '' && (input === '?' || input === '/')) {
    return { type: 'special', key: input };
  }

  // Ignore control keys
  if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow ||
      key.pageUp || key.pageDown || key.tab || key.escape) {
    return { type: 'noop' };
  }

  // Regular character input
  if (input) {
    return { type: 'update', value: currentValue + input };
  }

  return { type: 'noop' };
}

/**
 * Compute visible lines from a multiline value string, capped at maxLines.
 */
export function getDisplayLines(value: string, maxLines: number): string[] {
  const lines = value.split('\n');
  return lines.slice(0, maxLines);
}

export function InputArea({
  isLLMRunning,
  onSubmit,
  maxLines = 5,
  value: controlledValue,
  onValueChange,
  onSpecialKey,
  disabled = false,
}: InputAreaProps): React.ReactElement {
  const [internalValue, setInternalValue] = useState('');
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;
  const setValue = isControlled
    ? (v: string) => onValueChange?.(v)
    : setInternalValue;

  const displayLines = getDisplayLines(value, maxLines);
  const height = Math.max(1, displayLines.length);

  useInput((input, key) => {
    if (disabled) return;
    const action = processInput(value, input, key, maxLines);
    switch (action.type) {
      case 'submit':
        onSubmit(action.value);
        setValue('');
        break;
      case 'update':
        setValue(action.value);
        break;
      case 'special':
        onSpecialKey?.(action.key);
        break;
      case 'noop':
        break;
    }
  });

  const showPlaceholder = value.length === 0;
  const firstLine = displayLines[0] ?? '';
  const extraLines = displayLines.slice(1);

  const promptIcon = isLLMRunning ? '◆' : '▸';
  const promptColor = isLLMRunning ? 'yellow' : 'cyan';
  const placeholderText = isLLMRunning ? PLACEHOLDER_RUNNING : PLACEHOLDER_IDLE;

  return (
    <Box flexDirection="column" height={height}>
      <Box>
        <Text color={promptColor} bold>{promptIcon} </Text>
        {showPlaceholder ? (
          <Text dimColor>{placeholderText}</Text>
        ) : (
          <Text color="white">{firstLine}<Text dimColor>█</Text></Text>
        )}
      </Box>
      {extraLines.map((line, i) => (
        <Box key={i}>
          <Text color={promptColor} bold>  </Text>
          <Text color="white">{line}</Text>
        </Box>
      ))}
    </Box>
  );
}

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { InputArea } from './InputArea.js';
import { ScrollIndicator } from './ScrollIndicator.js';
import { StatusBar, type WorkflowStatus } from './StatusBar.js';
import { HelpOverlay } from './HelpOverlay.js';
import { ContextOverlay } from './ContextOverlay.js';
import { TimelineOverlay, type TimelineEvent } from './TimelineOverlay.js';
import { SearchOverlay } from './SearchOverlay.js';
import {
  INITIAL_SCROLL_STATE,
  computeScrollView,
  scrollUp,
  scrollDown,
  jumpToEnd,
} from '../scroll-state.js';
import type { ScrollState } from '../scroll-state.js';
import type { Message } from '../../types/ui.js';
import { type DisplayMode, toggleDisplayMode, filterMessages } from '../display-mode.js';
import { processKeybinding, type KeyAction } from '../keybindings.js';
import {
  INITIAL_OVERLAY_STATE,
  openOverlay,
  closeOverlay,
  updateSearchQuery,
  computeSearchResults,
  type OverlayState,
} from '../overlay-state.js';
import { buildRenderedMessageLines, type RenderedMessageLine } from '../message-lines.js';

export interface MainLayoutProps {
  messages: Message[];
  /** @deprecated Use statusBarProps instead for structured status bar */
  statusText?: string;
  columns: number;
  rows: number;
  isLLMRunning?: boolean;
  onInputSubmit?: (text: string) => void;
  onNewSession?: () => void;
  onInterrupt?: () => void;
  onClearScreen?: () => void;
  onReclassify?: () => void;
  /** Structured status bar props */
  statusBarProps?: {
    projectPath: string;
    round: number;
    maxRounds: number;
    status: WorkflowStatus;
    activeAgent: string | null;
    tokenCount: number;
    taskType?: string;
    currentPhase?: string;
    godAdapter?: string;
    reviewerAdapter?: string;
    degradationLevel?: string;
    godLatency?: number;
  };
  /** Context overlay data */
  contextData?: {
    roundNumber: number;
    coderName: string;
    reviewerName: string;
    taskSummary: string;
    tokenEstimate: number;
  };
  /** Timeline events */
  timelineEvents?: TimelineEvent[];
}

const STATUS_BAR_HEIGHT = 1;
const INPUT_AREA_HEIGHT = 3;
const SEPARATOR_LINES = 2; // two separator lines

export function MainLayout({
  messages,
  statusText,
  columns,
  rows,
  isLLMRunning = false,
  onInputSubmit,
  onNewSession,
  onInterrupt,
  onClearScreen,
  onReclassify,
  statusBarProps,
  contextData,
  timelineEvents = [],
}: MainLayoutProps): React.ReactElement {
  const messageAreaHeight = Math.max(
    1,
    rows - STATUS_BAR_HEIGHT - INPUT_AREA_HEIGHT - SEPARATOR_LINES,
  );

  const [scrollState, setScrollState] = useState<ScrollState>(INITIAL_SCROLL_STATE);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('minimal');
  const [overlayState, setOverlayState] = useState<OverlayState>(INITIAL_OVERLAY_STATE);
  const [inputValue, setInputValue] = useState('');
  const [clearedCount, setClearedCount] = useState(0);

  const filteredMessages = filterMessages(messages, displayMode);
  // Ctrl+L clear: only show messages after clearedCount
  const visibleFilteredMessages = filteredMessages.slice(clearedCount);
  const renderedLines = buildRenderedMessageLines(
    visibleFilteredMessages,
    displayMode,
    columns,
  );
  const totalLines = renderedLines.length;
  const { effectiveOffset, visibleSlots, showIndicator, newMessageCount } = computeScrollView(
    scrollState,
    totalLines,
    messageAreaHeight,
  );

  const visibleLines = renderedLines.slice(
    effectiveOffset,
    effectiveOffset + visibleSlots,
  );

  const searchResults = overlayState.activeOverlay === 'search'
    ? computeSearchResults(messages, overlayState.searchQuery)
    : [];

  function handleAction(action: KeyAction): void {
    switch (action.type) {
      case 'scroll_up':
        setScrollState((s) => scrollUp(s, action.amount, totalLines, messageAreaHeight));
        break;
      case 'scroll_down':
        setScrollState((s) => scrollDown(s, action.amount, totalLines, messageAreaHeight));
        break;
      case 'jump_to_end':
        setScrollState(() => jumpToEnd(totalLines, messageAreaHeight));
        break;
      case 'toggle_display_mode':
        setDisplayMode((m) => toggleDisplayMode(m));
        break;
      case 'open_overlay':
        setOverlayState((s) => openOverlay(s, action.overlay));
        break;
      case 'close_overlay':
        setOverlayState((s) => closeOverlay(s));
        break;
      case 'clear_screen':
        setClearedCount(filteredMessages.length);
        setScrollState(INITIAL_SCROLL_STATE);
        onClearScreen?.();
        break;
      case 'new_session':
        onNewSession?.();
        break;
      case 'interrupt':
        onInterrupt?.();
        break;
      case 'reclassify':
        onReclassify?.();
        break;
      case 'toggle_code_block':
        // Handled by StreamRenderer within MessageView
        break;
      case 'tab_complete':
        // Handled by InputArea / DirectoryPicker
        break;
      case 'noop':
        break;
    }
  }

  useInput((input, key) => {
    const action = processKeybinding(input, key, {
      overlayOpen: overlayState.activeOverlay,
      inputEmpty: inputValue === '',
      pageSize: messageAreaHeight,
    });
    handleAction(action);

    // Search overlay: route text input to search query
    if (overlayState.activeOverlay === 'search' && !key.ctrl && !key.escape) {
      if (key.backspace || key.delete) {
        setOverlayState((s) => updateSearchQuery(s, s.searchQuery.slice(0, -1)));
      } else if (input && !key.return && !key.tab && input !== '/') {
        setOverlayState((s) => updateSearchQuery(s, s.searchQuery + input));
      }
    }
  });

  const hasOverlay = overlayState.activeOverlay !== null;

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {hasOverlay ? (
        // Render overlay full-screen
        <>
          {overlayState.activeOverlay === 'help' && (
            <HelpOverlay columns={columns} rows={rows} />
          )}
          {overlayState.activeOverlay === 'context' && contextData && (
            <ContextOverlay
              columns={columns}
              rows={rows}
              {...contextData}
            />
          )}
          {overlayState.activeOverlay === 'timeline' && (
            <TimelineOverlay
              columns={columns}
              rows={rows}
              events={timelineEvents}
            />
          )}
          {overlayState.activeOverlay === 'search' && (
            <SearchOverlay
              columns={columns}
              rows={rows}
              query={overlayState.searchQuery}
              results={searchResults}
            />
          )}
        </>
      ) : (
        // Normal layout
        <>
          {/* Status Bar */}
          {statusBarProps ? (
            <StatusBar
              projectPath={statusBarProps.projectPath}
              round={statusBarProps.round}
              maxRounds={statusBarProps.maxRounds}
              status={statusBarProps.status}
              activeAgent={statusBarProps.activeAgent}
              tokenCount={statusBarProps.tokenCount}
              columns={columns}
              taskType={statusBarProps.taskType}
              currentPhase={statusBarProps.currentPhase}
              godAdapter={statusBarProps.godAdapter}
              reviewerAdapter={statusBarProps.reviewerAdapter}
              degradationLevel={statusBarProps.degradationLevel}
              godLatency={statusBarProps.godLatency}
            />
          ) : (
            <Box height={STATUS_BAR_HEIGHT}>
              <Text inverse bold> {statusText ?? ''} </Text>
            </Box>
          )}

          {/* Separator */}
          <Box height={1}>
            <Text dimColor>{'─'.repeat(columns)}</Text>
          </Box>

          {/* Message Area */}
          <Box flexDirection="column" height={messageAreaHeight} overflow="hidden">
            {visibleLines.map((line) => (
              <RenderedLineView key={line.key} line={line} />
            ))}
            <ScrollIndicator visible={showIndicator} columns={columns} newMessageCount={newMessageCount} />
          </Box>

          {/* Separator */}
          <Box height={1}>
            <Text dimColor>{'─'.repeat(columns)}</Text>
          </Box>

          {/* Input Area */}
          <InputArea
            isLLMRunning={isLLMRunning}
            onSubmit={onInputSubmit ?? (() => {})}
            value={inputValue}
            onValueChange={setInputValue}
            onSpecialKey={(k) => {
              if (k === '?') setOverlayState((s) => openOverlay(s, 'help'));
              if (k === '/') setOverlayState((s) => openOverlay(s, 'search'));
            }}
            disabled={hasOverlay}
          />
        </>
      )}
    </Box>
  );
}

function RenderedLineView({ line }: { line: RenderedMessageLine }): React.ReactElement {
  return (
    <Box>
      {line.spans.map((span, index) => (
        <Text
          key={index}
          color={span.color}
          bold={span.bold}
          dimColor={span.dimColor}
        >
          {span.text}
        </Text>
      ))}
    </Box>
  );
}

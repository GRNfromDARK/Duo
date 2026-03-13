/**
 * App — Root Ink component for Duo.
 *
 * Two phases:
 * 1. Setup: interactive wizard when args are missing (dir → coder → reviewer → task)
 * 2. Session: orchestrates xstate workflow, adapters, and MainLayout
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, useStdout, useApp } from 'ink';
import { useMachine } from '@xstate/react';
import { workflowMachine } from '../../engine/workflow-machine.js';
import type { WorkflowContext } from '../../engine/workflow-machine.js';
import { createAdapter } from '../../adapters/factory.js';
import { OutputStreamManager } from '../../adapters/output-stream-manager.js';
import { ContextManager } from '../../session/context-manager.js';
import type { RoundRecord } from '../../session/context-manager.js';
import { SessionManager } from '../../session/session-manager.js';
import type { LoadedSession } from '../../session/session-manager.js';
import { ConvergenceService } from '../../decision/convergence-service.js';
import { ChoiceDetector } from '../../decision/choice-detector.js';
import { MainLayout } from './MainLayout.js';
import type { WorkflowStatus } from './StatusBar.js';
import { SetupWizard } from './SetupWizard.js';
import { createRoundSummaryMessage } from '../round-summary.js';
import type { SessionConfig } from '../../types/session.js';
import type { DetectedCLI } from '../../adapters/detect.js';
import type { CLIAdapter, OutputChunk } from '../../types/adapter.js';
import type { Message, RoleName } from '../../types/ui.js';
import type { TimelineEvent } from './TimelineOverlay.js';
import {
  applyOutputChunk,
  buildRestoredSessionRuntime,
  createStreamAggregation,
  decidePostCodeRoute,
  decidePostReviewRoute,
  finalizeStreamAggregation,
  resolveUserDecision,
  type ChoiceRoute,
} from '../session-runner-state.js';
import * as path from 'node:path';
import { initializeTask } from '../../god/task-init.js';
import { buildGodSystemPrompt } from '../../god/god-system-prompt.js';
import { GodAuditLogger } from '../../god/god-audit.js';
import { DegradationManager } from '../../god/degradation-manager.js';
import type { GodTaskAnalysis, GodAutoDecision } from '../../types/god-schemas.js';
import { TaskAnalysisCard } from './TaskAnalysisCard.js';
import { routePostCoder, routePostReviewer } from '../../god/god-router.js';
import { evaluateConvergence, type ConvergenceLogEntry } from '../../god/god-convergence.js';
import { generateCoderPrompt, generateReviewerPrompt } from '../../god/god-prompt-generator.js';
import type { PromptContext } from '../../god/god-prompt-generator.js';
import { makeAutoDecision } from '../../god/auto-decision.js';
import type { AutoDecisionContext } from '../../god/auto-decision.js';
import { evaluateRules } from '../../god/rule-engine.js';
import { GodDecisionBanner } from './GodDecisionBanner.js';
import { ReclassifyOverlay } from './ReclassifyOverlay.js';
import { PhaseTransitionBanner } from './PhaseTransitionBanner.js';
import { withGodFallback, withGodFallbackSync } from '../god-fallback.js';
import { canTriggerReclassify, writeReclassifyAudit } from '../reclassify-overlay.js';
import { evaluatePhaseTransition } from '../../god/phase-transition.js';

// ── Adapter session helpers (duck-typed to avoid modifying CLIAdapter interface) ──

interface SessionCapableAdapter {
  hasActiveSession(): boolean;
  getLastSessionId(): string | null;
  restoreSessionId(id: string): void;
}

function isSessionCapable(adapter: CLIAdapter): adapter is CLIAdapter & SessionCapableAdapter {
  return 'hasActiveSession' in adapter
    && typeof (adapter as any).hasActiveSession === 'function'
    && 'getLastSessionId' in adapter
    && typeof (adapter as any).getLastSessionId === 'function'
    && 'restoreSessionId' in adapter
    && typeof (adapter as any).restoreSessionId === 'function';
}

// ── Props ──

export interface AppProps {
  initialConfig?: SessionConfig;
  detected: DetectedCLI[];
  resumeSession?: LoadedSession;
}

// ── Helper: map xstate state → UI status ──

function mapStateToStatus(stateValue: string): WorkflowStatus {
  switch (stateValue) {
    case 'CODING':
    case 'REVIEWING':
      return 'active';
    case 'TASK_INIT':
    case 'ROUTING_POST_CODE':
    case 'ROUTING_POST_REVIEW':
    case 'EVALUATING':
      return 'routing';
    case 'INTERRUPTED':
      return 'interrupted';
    case 'ERROR':
      return 'error';
    case 'DONE':
      return 'done';
    default:
      return 'idle';
  }
}

function getActiveAgentLabel(
  stateValue: string,
  config: SessionConfig,
  detected: DetectedCLI[],
): string | null {
  const findName = (name: string) =>
    detected.find((d) => d.name === name)?.displayName ?? name;

  if (stateValue === 'CODING') return `${findName(config.coder)}:Coder`;
  if (stateValue === 'REVIEWING') return `${findName(config.reviewer)}:Reviewer`;
  return null;
}

// ── Root App Component ──

export function App({ initialConfig, detected, resumeSession }: AppProps): React.ReactElement {
  const hasFullConfig =
    initialConfig &&
    initialConfig.projectDir &&
    initialConfig.coder &&
    initialConfig.reviewer &&
    initialConfig.task;

  const [sessionConfig, setSessionConfig] = useState<SessionConfig | null>(
    hasFullConfig
      ? {
          projectDir: initialConfig.projectDir,
          coder: initialConfig.coder,
          reviewer: initialConfig.reviewer,
          god: (initialConfig as SessionConfig).god ?? initialConfig.reviewer,
          task: initialConfig.task,
        }
      : null,
  );

  const { stdout } = useStdout();
  const columns = stdout.columns || 80;
  const rows = stdout.rows || 24;

  // ── Setup Phase: use SetupWizard ──

  if (!sessionConfig) {
    return (
      <SetupWizard
        detected={detected}
        initialConfig={initialConfig}
        onComplete={(config) => setSessionConfig(config)}
      />
    );
  }

  // ── Session Phase ──

  return (
    <SessionRunner
      config={sessionConfig}
      detected={detected}
      columns={columns}
      rows={rows}
      resumeSession={resumeSession}
    />
  );
}

// ── Session Runner Component ──

interface SessionRunnerProps {
  config: SessionConfig;
  detected: DetectedCLI[];
  columns: number;
  rows: number;
  resumeSession?: LoadedSession;
}

function SessionRunner({
  config,
  detected,
  columns,
  rows,
  resumeSession,
}: SessionRunnerProps): React.ReactElement {
  const { exit } = useApp();
  const MAX_ROUNDS = 20;
  const restoredRuntime = resumeSession
    ? buildRestoredSessionRuntime(resumeSession, config)
    : null;

  // ── xstate actor ──
  const [snapshot, send] = useMachine(workflowMachine, {
    input: {
      maxRounds: MAX_ROUNDS,
      ...(restoredRuntime?.workflowInput ?? {}),
    },
  });

  const stateValue = snapshot.value as string;
  const ctx = snapshot.context as WorkflowContext;

  // ── Core services (stable refs) ──
  const coderAdapterRef = useRef<CLIAdapter>(createAdapter(config.coder));
  const reviewerAdapterRef = useRef<CLIAdapter>(createAdapter(config.reviewer));
  const godAdapterRef = useRef<CLIAdapter>(createAdapter(config.god));
  const contextManagerRef = useRef(
    new ContextManager({
      contextWindowSize: 200000,
      promptsDir: path.join(config.projectDir, '.duo', 'prompts'),
    }),
  );
  const convergenceRef = useRef(new ConvergenceService({ maxRounds: MAX_ROUNDS }));
  const choiceDetectorRef = useRef(new ChoiceDetector());
  const sessionManagerRef = useRef(
    new SessionManager(path.join(config.projectDir, '.duo', 'sessions')),
  );
  const outputManagerRef = useRef(new OutputStreamManager());
  const godAuditLoggerRef = useRef<GodAuditLogger | null>(null);
  const degradationManagerRef = useRef(
    new DegradationManager({
      fallbackServices: {
        contextManager: contextManagerRef.current,
        convergenceService: convergenceRef.current,
        choiceDetector: choiceDetectorRef.current,
      },
      restoredState: resumeSession?.state.degradationState,
    }),
  );

  // ── Mutable orchestration state ──
  const roundsRef = useRef<RoundRecord[]>(restoredRuntime?.rounds ?? []);
  const sessionIdRef = useRef<string | null>(
    (restoredRuntime?.workflowInput.sessionId as string | null) ?? null,
  );
  const reviewerOutputsRef = useRef<string[]>(restoredRuntime?.reviewerOutputs ?? []);
  const pendingInstructionRef = useRef<string | null>(null);
  const lastInterruptedRoleRef = useRef<'coder' | 'reviewer' | null>(
    resumeSession?.state.status === 'interrupted'
      ? (resumeSession.state.currentRole as 'coder' | 'reviewer' | null)
      : null,
  );
  const choiceRouteRef = useRef<ChoiceRoute | null>(null);
  const convergenceLogRef = useRef<ConvergenceLogEntry[]>(restoredRuntime?.godConvergenceLog ?? []);
  const lastUnresolvedIssuesRef = useRef<string[]>([]);
  const initializedRef = useRef(false);
  const auditSeqRef = useRef(0);

  // ── God task analysis state ──
  const [taskAnalysis, setTaskAnalysis] = useState<GodTaskAnalysis | null>(restoredRuntime?.godTaskAnalysis ?? null);
  const taskAnalysisRef = useRef(taskAnalysis);
  taskAnalysisRef.current = taskAnalysis;
  const [showTaskAnalysisCard, setShowTaskAnalysisCard] = useState(false);

  // ── BUG-21 fix: reclassify trigger to re-run WAITING_USER auto-decision ──
  const [reclassifyTrigger, setReclassifyTrigger] = useState(0);

  // ── God auto-decision state (WAITING_USER escape window) ──
  const [godDecision, setGodDecision] = useState<GodAutoDecision | null>(null);
  const [showGodBanner, setShowGodBanner] = useState(false);

  // ── Reclassify overlay state (Ctrl+R) — Card C.3 ──
  const [showReclassify, setShowReclassify] = useState(false);

  // ── Phase transition banner state — Card C.3 ──
  const [showPhaseTransition, setShowPhaseTransition] = useState(false);
  const [pendingPhaseTransition, setPendingPhaseTransition] = useState<{
    nextPhaseId: string;
    previousPhaseSummary: string;
  } | null>(null);
  const [currentPhaseId, setCurrentPhaseId] = useState<string | null>(restoredRuntime?.currentPhaseId ?? null);

  // ── God latency tracking (StatusBar display) — Card D.2 ──
  const [godLatency, setGodLatency] = useState<number | undefined>(undefined);

  // ── UI state ──
  const [messages, setMessages] = useState<Message[]>(() => restoredRuntime?.messages ?? []);
  const [tokenCount, setTokenCount] = useState(() => restoredRuntime?.tokenCount ?? 0);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);

  // ── Double Ctrl+C tracking ──
  const lastCtrlCRef = useRef(0);

  // ── Unique message ID generator (session-scoped prefix + monotonic counter) ──
  const msgIdPrefix = useRef(`msg-${Date.now().toString(36)}`);
  const msgIdCounter = useRef(0);
  const nextMsgId = () => `${msgIdPrefix.current}-${++msgIdCounter.current}`;

  // ── Helper: add a message ──
  const addMessage = useCallback(
    (msg: Omit<Message, 'id'>) => {
      const id = nextMsgId();
      setMessages((prev) => [...prev, { ...msg, id }]);
      return id;
    },
    [],
  );

  // ── Helper: update a message by ID ──
  const updateMessage = useCallback(
    (id: string, update: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...update } : m)),
      );
    },
    [],
  );

  // ── Helper: add timeline event ──
  const addTimelineEvent = useCallback(
    (type: TimelineEvent['type'], description: string) => {
      setTimelineEvents((prev) => [
        ...prev,
        { timestamp: Date.now(), type, description },
      ]);
    },
    [],
  );

  // ── Helper: estimate tokens from text ──
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  // ── Helper: get adapter display name ──
  const getDisplayName = (adapterName: string) =>
    detected.find((d) => d.name === adapterName)?.displayName ?? adapterName;

  // ── Create session on mount ──
  useEffect(() => {
    if (resumeSession && restoredRuntime) {
      addMessage({
        role: 'system',
        content: `Session resumed. Coder: ${getDisplayName(config.coder)}, Reviewer: ${getDisplayName(config.reviewer)}`,
        timestamp: Date.now(),
      });

      addTimelineEvent('task_start', `Session resumed: ${config.coder} vs ${config.reviewer}`);

      // Restore adapter CLI session IDs so they can use --resume on first execute
      if (restoredRuntime.coderSessionId) {
        const ca = coderAdapterRef.current;
        if (isSessionCapable(ca)) {
          ca.restoreSessionId(restoredRuntime.coderSessionId);
        }
      }
      if (restoredRuntime.reviewerSessionId) {
        const ra = reviewerAdapterRef.current;
        if (isSessionCapable(ra)) {
          ra.restoreSessionId(restoredRuntime.reviewerSessionId);
        }
      }
      // NOTE: God session ID is intentionally NOT restored on resume.
      // God is a stateless JSON oracle — resuming would skip --system-prompt
      // and inject irrelevant conversation context, causing JSON extraction failures.

      // Initialize God audit logger on resume so seq continues from last entry
      if (!godAuditLoggerRef.current && sessionIdRef.current) {
        const sessionDir = path.join(config.projectDir, '.duo', 'sessions', sessionIdRef.current);
        godAuditLoggerRef.current = new GodAuditLogger(sessionDir);
        auditSeqRef.current = godAuditLoggerRef.current.getSequence();
      }

      send({ type: 'RESUME_SESSION', sessionId: resumeSession.metadata.id });
      send({ type: restoredRuntime.restoreEvent });
      initializedRef.current = true;
      return;
    }

    try {
      const { id } = sessionManagerRef.current.createSession(config);
      sessionIdRef.current = id;
    } catch {
      // Non-fatal: session persistence is best-effort
    }

    // Add initial system message
    addMessage({
      role: 'system',
      content: `Session started. Coder: ${getDisplayName(config.coder)}, Reviewer: ${getDisplayName(config.reviewer)}`,
      timestamp: Date.now(),
    });

    addTimelineEvent('task_start', `Session started: ${config.coder} vs ${config.reviewer}`);

    // Start the workflow
    send({ type: 'START_TASK', prompt: config.task });
    initializedRef.current = true;
  }, []);

  // ── TASK_INIT state: run God intent parsing ──
  // C.2: Uses withGodFallback for unified retry + degradation (AC-2, AC-3)
  useEffect(() => {
    if (stateValue !== 'TASK_INIT') return;

    let cancelled = false;

    // Initialize God audit logger if not yet created
    if (!godAuditLoggerRef.current && sessionIdRef.current) {
      const sessionDir = path.join(config.projectDir, '.duo', 'sessions', sessionIdRef.current);
      godAuditLoggerRef.current = new GodAuditLogger(sessionDir);
    }

    // God disabled → skip immediately (withGodFallback handles this but we want
    // the specific "disabled" message before the async IIFE)
    if (!degradationManagerRef.current.isGodAvailable()) {
      addMessage({
        role: 'system',
        content: 'God orchestrator disabled. Skipping task analysis.',
        timestamp: Date.now(),
      });
      send({ type: 'TASK_INIT_SKIP' });
      return;
    }

    addMessage({
      role: 'system',
      content: `Analyzing task with God orchestrator (${getDisplayName(config.god)})...`,
      timestamp: Date.now(),
    });
    addTimelineEvent('task_start', `God TASK_INIT started: ${getDisplayName(config.god)}`);

    (async () => {
      const startTime = Date.now();

      const { result, usedGod, notification } = await withGodFallback(
        degradationManagerRef.current,
        async () => {
          const systemPrompt = buildGodSystemPrompt({
            task: config.task,
            coderName: getDisplayName(config.coder),
            reviewerName: getDisplayName(config.reviewer),
          });

          const r = await initializeTask(
            godAdapterRef.current,
            config.task,
            systemPrompt,
            config.projectDir,
          );

          // Treat null result as schema_validation failure to trigger retry
          if (!r) throw new Error('TASK_INIT returned null (extraction/validation failed)');
          return r;
        },
        () => null, // v1 fallback: no task analysis
        'process_exit',
      );

      if (cancelled) return;

      // Show degradation notification if any (AC-5)
      if (notification) {
        addMessage({ role: 'system', content: notification.message, timestamp: Date.now() });
      }

      if (usedGod && result) {
        setTaskAnalysis(result.analysis);

        // Log to God audit + update StatusBar latency (Card D.2)
        const latency = Date.now() - startTime;
        setGodLatency(latency);
        if (godAuditLoggerRef.current) {
          godAuditLoggerRef.current.append({
            timestamp: new Date().toISOString(),
            round: 0,
            decisionType: 'TASK_INIT',
            inputSummary: config.task.slice(0, 500),
            outputSummary: `taskType=${result.analysis.taskType}, suggestedMaxRounds=${result.analysis.suggestedMaxRounds}`,
            latencyMs: latency,
            decision: result.analysis,
          }, result.analysis);
        }

        addTimelineEvent('task_start', `God TASK_INIT: ${result.analysis.taskType}, ${result.analysis.suggestedMaxRounds} rounds`);
        setShowTaskAnalysisCard(true);
      } else {
        // Fallback path — log failure to God audit
        if (!usedGod && godAuditLoggerRef.current) {
          godAuditLoggerRef.current.append({
            timestamp: new Date().toISOString(),
            round: 0,
            decisionType: 'TASK_INIT_FAILURE',
            inputSummary: config.task.slice(0, 500),
            outputSummary: `Degraded to v1: level=${degradationManagerRef.current.getState().level}`,
            latencyMs: Date.now() - startTime,
            decision: { degradationLevel: degradationManagerRef.current.getState().level },
          });
        }

        addTimelineEvent('error', 'God TASK_INIT failed, using v1 fallback');
        send({ type: 'TASK_INIT_SKIP' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stateValue]);

  // ── Save state on transitions ──
  useEffect(() => {
    if (!sessionIdRef.current || !initializedRef.current || stateValue === 'IDLE') return;
    try {
      const coderAdapter = coderAdapterRef.current;
      const reviewerAdapter = reviewerAdapterRef.current;
      const godAdapter = godAdapterRef.current;
      sessionManagerRef.current.saveState(sessionIdRef.current, {
        round: ctx.round,
        status: stateValue.toLowerCase(),
        currentRole: ctx.activeProcess ?? 'coder',
        ...(isSessionCapable(coderAdapter) && coderAdapter.getLastSessionId()
          ? { coderSessionId: coderAdapter.getLastSessionId()! }
          : {}),
        ...(isSessionCapable(reviewerAdapter) && reviewerAdapter.getLastSessionId()
          ? { reviewerSessionId: reviewerAdapter.getLastSessionId()! }
          : {}),
        ...(isSessionCapable(godAdapter) && godAdapter.getLastSessionId()
          ? { godSessionId: godAdapter.getLastSessionId()! }
          : {}),
        godAdapter: config.god,
        ...(taskAnalysisRef.current ? { godTaskAnalysis: taskAnalysisRef.current } : {}),
        godConvergenceLog: convergenceLogRef.current,
        degradationState: degradationManagerRef.current.serializeState(),
        currentPhaseId,
      });
    } catch {
      // Best-effort persistence
    }
  }, [stateValue, ctx.round]);

  // ── CODING state: run coder adapter ──
  useEffect(() => {
    if (stateValue !== 'CODING') return;

    let cancelled = false;
    const adapter = coderAdapterRef.current;
    const osm = new OutputStreamManager();
    outputManagerRef.current = osm;

    const msgId = nextMsgId();
    setMessages((prev) => [
      ...prev,
      {
        id: msgId,
        role: config.coder as RoleName,
        roleLabel: 'Coder',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    addTimelineEvent('coding', `Coder started: Round ${ctx.round + 1}, ${getDisplayName(config.coder)}`);

    (async () => {
      try {
        const interruptInstruction = pendingInstructionRef.current ?? undefined;
        pendingInstructionRef.current = null;
        const shouldSkipHistory = isSessionCapable(adapter) && adapter.hasActiveSession();

        // B.4 + C.2: God dynamic prompt generation with withGodFallbackSync (FR-003, AR-004, AC-2)
        let prompt: string;
        if (choiceRouteRef.current?.target === 'coder') {
          prompt = choiceRouteRef.current.prompt;
        } else {
          const { result: generatedPrompt, notification: promptNotification } = withGodFallbackSync(
            degradationManagerRef.current,
            () => {
              if (!taskAnalysis) throw new Error('No taskAnalysis available');
              return generateCoderPrompt({
                taskType: taskAnalysis.taskType as PromptContext['taskType'],
                round: ctx.round,
                maxRounds: ctx.maxRounds,
                taskGoal: config.task,
                lastReviewerOutput: ctx.lastReviewerOutput ?? undefined,
                unresolvedIssues: lastUnresolvedIssuesRef.current,
                convergenceLog: convergenceLogRef.current,
                instruction: interruptInstruction,
                phaseId: currentPhaseId ?? undefined,
                phaseType: currentPhaseId
                  ? taskAnalysis.phases?.find(p => p.id === currentPhaseId)?.type as PromptContext['phaseType']
                  : undefined,
              }, {
                sessionDir: sessionIdRef.current
                  ? path.join(config.projectDir, '.duo', 'sessions', sessionIdRef.current)
                  : path.join(config.projectDir, '.duo', 'sessions'),
                seq: ++auditSeqRef.current,
              });
            },
            () => contextManagerRef.current.buildCoderPrompt(
              config.task,
              roundsRef.current,
              {
                ...(ctx.lastReviewerOutput
                  ? { reviewerFeedback: ctx.lastReviewerOutput }
                  : {}),
                ...(interruptInstruction ? { interruptInstruction } : {}),
                ...(shouldSkipHistory ? { skipHistory: true } : {}),
              },
            ),
          );
          if (promptNotification) {
            addMessage({ role: 'system', content: promptNotification.message, timestamp: Date.now() });
          }
          prompt = generatedPrompt;
        }

        const execOpts = {
          cwd: config.projectDir,
          permissionMode: 'skip' as const,
        };

        // Codex adapter needs role hint
        let source: AsyncIterable<OutputChunk>;
        if (config.coder === 'codex') {
          const { CodexAdapter } = await import('../../adapters/codex/adapter.js');
          source = (adapter as InstanceType<typeof CodexAdapter>).execute(
            prompt,
            execOpts,
            { role: 'coder' },
          );
        } else {
          source = adapter.execute(prompt, execOpts);
        }

        osm.start(source);
        const consumer = osm.consume();
        let aggregation = createStreamAggregation();

        for await (const chunk of consumer) {
          if (cancelled) break;
          aggregation = applyOutputChunk(aggregation, chunk);
          updateMessage(msgId, { content: aggregation.displayText });
        }

        if (!cancelled) {
          const outcome = finalizeStreamAggregation(aggregation);

          if (outcome.kind === 'no_output') {
            // Process produced no output — likely a startup error
            updateMessage(msgId, { content: '(no output)', isStreaming: false });
            addMessage({
              role: 'system',
              content: `Coder (${getDisplayName(config.coder)}) produced no output. Check that the CLI tool is installed and configured correctly.`,
              timestamp: Date.now(),
            });
            addTimelineEvent('error', `Coder produced no output`);
            send({ type: 'PROCESS_ERROR', error: `No output received from ${config.coder}` });
          } else if (outcome.kind === 'error') {
            updateMessage(msgId, {
              content: outcome.displayText,
              isStreaming: false,
            });
            addTimelineEvent('error', `Coder failed: ${outcome.errorMessage}`);
            send({ type: 'PROCESS_ERROR', error: outcome.errorMessage });
          } else {
            const tokens = estimateTokens(outcome.fullText);
            setTokenCount((prev) => prev + tokens);
            updateMessage(msgId, {
              content: outcome.displayText,
              isStreaming: false,
              metadata: { tokenCount: tokens },
            });

            // Save history
            if (sessionIdRef.current) {
              try {
                sessionManagerRef.current.addHistoryEntry(sessionIdRef.current, {
                  round: ctx.round,
                  role: 'coder',
                  content: outcome.fullText,
                  timestamp: Date.now(),
                });
              } catch { /* best-effort */ }
            }

            addTimelineEvent('coding', `Coder completed: ${tokens} tokens`);
            send({ type: 'CODE_COMPLETE', output: outcome.fullText });
          }
        }
      } catch (err) {
        if (!cancelled) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          addMessage({
            role: 'system',
            content: `Coder error: ${errorMsg}`,
            timestamp: Date.now(),
          });
          send({ type: 'PROCESS_ERROR', error: errorMsg });
        }
      }
    })();

    return () => {
      cancelled = true;
      osm.interrupt();
    };
  }, [stateValue === 'CODING' ? `CODING-${ctx.round}` : stateValue, config.task]);

  // ── ROUTING_POST_CODE: God routing → fallback to v1 ChoiceDetector ──
  // C.2: Uses withGodFallback for unified retry + degradation (AC-2, AC-3)
  useEffect(() => {
    if (stateValue !== 'ROUTING_POST_CODE') return;

    let cancelled = false;
    const output = ctx.lastCoderOutput ?? '';

    const sessionDir = sessionIdRef.current
      ? path.join(config.projectDir, '.duo', 'sessions', sessionIdRef.current)
      : config.projectDir;

    // v1 fallback helper — shared between immediate-fallback and retry-fallback paths
    const runV1PostCodeRoute = () => {
      const decision = decidePostCodeRoute(
        output,
        config.task,
        choiceDetectorRef.current,
        choiceRouteRef.current,
      );

      if (decision.clearChoiceRoute) {
        choiceRouteRef.current = null;
      }
      if (decision.choiceRoute) {
        choiceRouteRef.current = decision.choiceRoute;
        addMessage({
          role: 'system',
          content: `Choice detected in Coder output. Forwarding to ${getDisplayName(config.reviewer)}.`,
          timestamp: Date.now(),
          metadata: { isRoutingEvent: true },
        });
        addTimelineEvent('coding', `Choice detected, forwarding to ${config.reviewer}`);
      }

      return decision;
    };

    (async () => {
      try {
        const godCallStart = Date.now();
        const { result, usedGod, notification } = await withGodFallback(
          degradationManagerRef.current,
          async () => routePostCoder(
            godAdapterRef.current,
            output,
            {
              round: ctx.round,
              maxRounds: ctx.maxRounds,
              taskGoal: config.task,
              sessionDir,
              seq: ctx.round + 1,
              projectDir: config.projectDir,
            },
          ),
          () => ({ v1Decision: runV1PostCodeRoute() }),
          'process_exit',
        );

        if (cancelled) return;

        if (notification) {
          addMessage({ role: 'system', content: notification.message, timestamp: Date.now() });
        }

        if (usedGod) {
          // God routing succeeded
          setGodLatency(Date.now() - godCallStart);
          const godResult = result as Awaited<ReturnType<typeof routePostCoder>>;
          addTimelineEvent('coding', `God routing: ${godResult.decision.action}`);
          send(godResult.event);
        } else {
          // v1 fallback was used (either God disabled or God failed with retry)
          const v1Result = result as { v1Decision: ReturnType<typeof decidePostCodeRoute> };

          if (!usedGod && godAuditLoggerRef.current) {
            godAuditLoggerRef.current.append({
              timestamp: new Date().toISOString(),
              round: ctx.round,
              decisionType: 'ROUTING_POST_CODE_FAILURE',
              inputSummary: output.slice(0, 500),
              outputSummary: `Degraded to v1: level=${degradationManagerRef.current.getState().level}`,
              decision: { degradationLevel: degradationManagerRef.current.getState().level },
            });
            addTimelineEvent('error', 'God routing failed, using v1 fallback');
          }

          send({ type: v1Result.v1Decision.event });
        }
      } catch (err) {
        send({ type: 'PROCESS_ERROR', error: `Routing error: ${err instanceof Error ? err.message : String(err)}` });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stateValue]);

  // ── REVIEWING state: run reviewer adapter ──
  useEffect(() => {
    if (stateValue !== 'REVIEWING') return;

    let cancelled = false;
    const adapter = reviewerAdapterRef.current;
    const osm = new OutputStreamManager();
    outputManagerRef.current = osm;

    const msgId = nextMsgId();
    setMessages((prev) => [
      ...prev,
      {
        id: msgId,
        role: config.reviewer as RoleName,
        roleLabel: 'Reviewer',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    addTimelineEvent('reviewing', `Reviewer started: Round ${ctx.round + 1}, ${getDisplayName(config.reviewer)}`);

    (async () => {
      try {
        const interruptInstruction = pendingInstructionRef.current ?? undefined;
        pendingInstructionRef.current = null;
        const shouldSkipHistory = isSessionCapable(adapter) && adapter.hasActiveSession();
        // Get the last reviewer output for feedback checklist (round 2+)
        const lastReviewerOut = reviewerOutputsRef.current.length > 0
          ? reviewerOutputsRef.current[reviewerOutputsRef.current.length - 1]
          : undefined;

        // B.4 + C.2: God dynamic prompt generation with withGodFallbackSync (FR-003, AR-004, AC-2)
        let prompt: string;
        if (choiceRouteRef.current?.target === 'reviewer') {
          prompt = choiceRouteRef.current.prompt;
        } else {
          const { result: generatedPrompt, notification: promptNotification } = withGodFallbackSync(
            degradationManagerRef.current,
            () => {
              if (!taskAnalysis) throw new Error('No taskAnalysis available');
              return generateReviewerPrompt({
                taskType: taskAnalysis.taskType,
                round: ctx.round,
                maxRounds: ctx.maxRounds,
                taskGoal: config.task,
                lastCoderOutput: ctx.lastCoderOutput ?? undefined,
                instruction: interruptInstruction,
                phaseId: currentPhaseId ?? undefined,
                phaseType: currentPhaseId
                  ? taskAnalysis.phases?.find(p => p.id === currentPhaseId)?.type as PromptContext['phaseType']
                  : undefined,
              });
            },
            () => contextManagerRef.current.buildReviewerPrompt(
              config.task,
              roundsRef.current,
              ctx.lastCoderOutput ?? '',
              {
                ...(interruptInstruction ? { interruptInstruction } : {}),
                ...(shouldSkipHistory ? { skipHistory: true } : {}),
                roundNumber: ctx.round + 1,
                ...(lastReviewerOut ? { previousReviewerOutput: lastReviewerOut } : {}),
              },
            ),
          );
          if (promptNotification) {
            addMessage({ role: 'system', content: promptNotification.message, timestamp: Date.now() });
          }
          prompt = generatedPrompt;
        }

        const execOpts = {
          cwd: config.projectDir,
          permissionMode: 'skip' as const,
        };

        let source: AsyncIterable<OutputChunk>;
        if (config.reviewer === 'codex') {
          const { CodexAdapter } = await import('../../adapters/codex/adapter.js');
          source = (adapter as InstanceType<typeof CodexAdapter>).execute(
            prompt,
            execOpts,
            { role: 'reviewer' },
          );
        } else {
          source = adapter.execute(prompt, execOpts);
        }

        osm.start(source);
        const consumer = osm.consume();
        let aggregation = createStreamAggregation();

        for await (const chunk of consumer) {
          if (cancelled) break;
          aggregation = applyOutputChunk(aggregation, chunk);
          updateMessage(msgId, { content: aggregation.displayText });
        }

        if (!cancelled) {
          const outcome = finalizeStreamAggregation(aggregation);

          if (outcome.kind === 'no_output') {
            updateMessage(msgId, { content: '(no output)', isStreaming: false });
            addMessage({
              role: 'system',
              content: `Reviewer (${getDisplayName(config.reviewer)}) produced no output. Check that the CLI tool is installed and configured correctly.`,
              timestamp: Date.now(),
            });
            addTimelineEvent('error', `Reviewer produced no output`);
            send({ type: 'PROCESS_ERROR', error: `No output received from ${config.reviewer}` });
          } else if (outcome.kind === 'error') {
            updateMessage(msgId, {
              content: outcome.displayText,
              isStreaming: false,
            });
            addTimelineEvent('error', `Reviewer failed: ${outcome.errorMessage}`);
            send({ type: 'PROCESS_ERROR', error: outcome.errorMessage });
          } else {
            const tokens = estimateTokens(outcome.fullText);
            setTokenCount((prev) => prev + tokens);
            updateMessage(msgId, {
              content: outcome.displayText,
              isStreaming: false,
              metadata: { tokenCount: tokens },
            });

            // Save history
            if (sessionIdRef.current) {
              try {
                sessionManagerRef.current.addHistoryEntry(sessionIdRef.current, {
                  round: ctx.round,
                  role: 'reviewer',
                  content: outcome.fullText,
                  timestamp: Date.now(),
                });
              } catch { /* best-effort */ }
            }

            // Track reviewer outputs for loop detection
            reviewerOutputsRef.current.push(outcome.fullText);

            addTimelineEvent('reviewing', `Reviewer completed: ${tokens} tokens`);
            send({ type: 'REVIEW_COMPLETE', output: outcome.fullText });
          }
        }
      } catch (err) {
        if (!cancelled) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          addMessage({
            role: 'system',
            content: `Reviewer error: ${errorMsg}`,
            timestamp: Date.now(),
          });
          send({ type: 'PROCESS_ERROR', error: errorMsg });
        }
      }
    })();

    return () => {
      cancelled = true;
      osm.interrupt();
    };
  }, [stateValue === 'REVIEWING' ? `REVIEWING-${ctx.round}` : stateValue, config.task]);

  // ── ROUTING_POST_REVIEW: God routing → fallback to v1 ChoiceDetector ──
  // C.2: Uses withGodFallback for unified retry + degradation (AC-2, AC-3)
  useEffect(() => {
    if (stateValue !== 'ROUTING_POST_REVIEW') return;

    let cancelled = false;
    const output = ctx.lastReviewerOutput ?? '';

    const sessionDir = sessionIdRef.current
      ? path.join(config.projectDir, '.duo', 'sessions', sessionIdRef.current)
      : config.projectDir;

    // v1 fallback helper — shared between immediate-fallback and retry-fallback paths
    const runV1PostReviewRoute = () => {
      const decision = decidePostReviewRoute(
        output,
        config.task,
        choiceDetectorRef.current,
        choiceRouteRef.current,
      );

      if (decision.clearChoiceRoute) {
        choiceRouteRef.current = null;
      }
      if (decision.choiceRoute) {
        choiceRouteRef.current = decision.choiceRoute;
        addMessage({
          role: 'system',
          content: `Choice detected in Reviewer output. Forwarding to ${getDisplayName(config.coder)}.`,
          timestamp: Date.now(),
          metadata: { isRoutingEvent: true },
        });
        addTimelineEvent('reviewing', `Choice detected, forwarding to ${config.coder}`);
      }

      return decision;
    };

    (async () => {
      try {
        const godCallStart = Date.now();
        const { result, usedGod, notification } = await withGodFallback(
          degradationManagerRef.current,
          async () => routePostReviewer(
            godAdapterRef.current,
            output,
            {
              round: ctx.round,
              maxRounds: ctx.maxRounds,
              taskGoal: config.task,
              sessionDir,
              seq: ctx.round + 1,
              convergenceLog: convergenceLogRef.current,
              unresolvedIssues: lastUnresolvedIssuesRef.current,
              projectDir: config.projectDir,
            },
          ),
          () => ({ v1Decision: runV1PostReviewRoute() }),
          'process_exit',
        );

        if (cancelled) return;

        if (notification) {
          addMessage({ role: 'system', content: notification.message, timestamp: Date.now() });
        }

        if (usedGod) {
          setGodLatency(Date.now() - godCallStart);
          const godResult = result as Awaited<ReturnType<typeof routePostReviewer>>;

          // Store unresolvedIssues for next round's Coder prompt (AC-018b)
          if (godResult.decision.action === 'route_to_coder') {
            lastUnresolvedIssuesRef.current = godResult.decision.unresolvedIssues ?? [];
          }

          // Handle special routing actions with user-visible messages
          if (godResult.decision.action === 'phase_transition') {
            // Card C.3 (AC-033, AC-034): Use evaluatePhaseTransition for compound tasks
            const phases = taskAnalysis?.phases ?? [];
            const currentPhase = phases.find(p => p.id === (currentPhaseId ?? phases[0]?.id));
            let phaseSummary = godResult.decision.reasoning;

            if (currentPhase && phases.length > 0) {
              const transitionResult = evaluatePhaseTransition(
                currentPhase,
                phases,
                convergenceLogRef.current,
                godResult.decision,
              );
              if (transitionResult.shouldTransition && transitionResult.previousPhaseSummary) {
                phaseSummary = transitionResult.previousPhaseSummary;
              }
            }

            const nextPhaseId = godResult.decision.nextPhaseId ?? 'next';
            addMessage({
              role: 'system',
              content: `Phase transition: ${godResult.decision.reasoning}`,
              timestamp: Date.now(),
              metadata: { isRoutingEvent: true },
            });
            addTimelineEvent('reviewing', `God: phase_transition → ${nextPhaseId}`);

            // Set up 2s escape window banner (AC-033)
            setPendingPhaseTransition({ nextPhaseId, previousPhaseSummary: phaseSummary });
            setShowPhaseTransition(true);
          } else if (godResult.decision.action === 'loop_detected') {
            addMessage({
              role: 'system',
              content: `Loop detected: ${godResult.decision.reasoning}. Requesting user intervention.`,
              timestamp: Date.now(),
              metadata: { isRoutingEvent: true },
            });
            addTimelineEvent('error', `God: loop_detected — ${godResult.decision.reasoning}`);
          } else if (godResult.decision.action === 'converged') {
            addMessage({
              role: 'system',
              content: `God convergence: ${godResult.decision.reasoning}`,
              timestamp: Date.now(),
              metadata: { isRoutingEvent: true },
            });
            addTimelineEvent('converged', `God: converged`);
          } else {
            addTimelineEvent('reviewing', `God routing: ${godResult.decision.action}`);
          }

          send(godResult.event);
        } else {
          const v1Result = result as { v1Decision: ReturnType<typeof decidePostReviewRoute> };

          if (godAuditLoggerRef.current) {
            godAuditLoggerRef.current.append({
              timestamp: new Date().toISOString(),
              round: ctx.round,
              decisionType: 'ROUTING_POST_REVIEW_FAILURE',
              inputSummary: output.slice(0, 500),
              outputSummary: `Degraded to v1: level=${degradationManagerRef.current.getState().level}`,
              decision: { degradationLevel: degradationManagerRef.current.getState().level },
            });
            addTimelineEvent('error', 'God routing failed, using v1 fallback');
          }

          send({ type: v1Result.v1Decision.event });
        }
      } catch (err) {
        send({ type: 'PROCESS_ERROR', error: `Routing error: ${err instanceof Error ? err.message : String(err)}` });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stateValue]);

  // ── EVALUATING: convergence check ──
  // ── EVALUATING: convergence check ──
  // C.2: Uses withGodFallback for unified retry + degradation (AC-2, AC-3)
  useEffect(() => {
    if (stateValue !== 'EVALUATING') return;

    let cancelled = false;
    const reviewerOutput = ctx.lastReviewerOutput ?? '';

    // Helper: record round + summary message (shared by both God and v1 paths)
    const recordRound = () => {
      roundsRef.current.push({
        index: ctx.round + 1,
        coderOutput: ctx.lastCoderOutput ?? '',
        reviewerOutput,
        summary: contextManagerRef.current.generateSummary(reviewerOutput),
        timestamp: Date.now(),
      });

      const summaryMsg = createRoundSummaryMessage(
        ctx.round + 1,
        ctx.round + 2,
        contextManagerRef.current.generateSummary(reviewerOutput).slice(0, 100),
      );
      setMessages((prev) => [...prev, summaryMsg]);
    };

    // v1 convergence evaluation — returns {shouldTerminate, event}
    const runV1Convergence = () => {
      const result = convergenceRef.current.evaluate(reviewerOutput, {
        currentRound: ctx.round + 1,
        previousOutputs: reviewerOutputsRef.current.slice(0, -1),
      });

      if (result.loopDetected) {
        addMessage({
          role: 'system',
          content: 'Loop detected: Reviewer is providing similar feedback as previous round.',
          timestamp: Date.now(),
          metadata: { isRoutingEvent: true },
        });
      }

      if (result.classification === 'soft_approved') {
        addMessage({
          role: 'system',
          content: 'Soft approval detected: Reviewer language suggests approval but [APPROVED] marker was not used. Treating as converged.',
          timestamp: Date.now(),
          metadata: { isRoutingEvent: true },
        });
      }

      if (result.reason === 'diminishing_issues') {
        addMessage({
          role: 'system',
          content: 'Convergence by progress: All blocking issues have been resolved across rounds.',
          timestamp: Date.now(),
          metadata: { isRoutingEvent: true },
        });
      }

      if (result.progressTrend === 'improving' && result.issueCount > 0) {
        addMessage({
          role: 'system',
          content: `Progress: Issue count decreasing (${result.issueCount} blocking issues remaining). Continuing.`,
          timestamp: Date.now(),
          metadata: { isRoutingEvent: true },
        });
      } else if (result.progressTrend === 'stagnant' && !result.loopDetected) {
        addMessage({
          role: 'system',
          content: `Stagnant: Issue count unchanged (${result.issueCount} blocking issues). Coder may need different approach.`,
          timestamp: Date.now(),
          metadata: { isRoutingEvent: true },
        });
      }

      addTimelineEvent(
        result.shouldTerminate ? 'converged' : 'reviewing',
        `Evaluation: ${result.classification}, round ${ctx.round + 1}/${MAX_ROUNDS}, ${result.issueCount} issues, trend: ${result.progressTrend}`,
      );

      return { shouldTerminate: result.shouldTerminate };
    };

    const sessionDir = sessionIdRef.current
      ? path.join(config.projectDir, '.duo', 'sessions', sessionIdRef.current)
      : config.projectDir;

    (async () => {
      try {
        const godCallStart = Date.now();
        const { result, usedGod, notification } = await withGodFallback(
          degradationManagerRef.current,
          async () => evaluateConvergence(
            godAdapterRef.current,
            reviewerOutput,
            {
              round: ctx.round,
              maxRounds: ctx.maxRounds,
              taskGoal: config.task,
              terminationCriteria: taskAnalysis?.terminationCriteria ?? [],
              convergenceLog: convergenceLogRef.current,
              sessionDir,
              seq: ctx.round + 1,
              projectDir: config.projectDir,
            },
          ),
          () => ({ v1: runV1Convergence() }),
          'process_exit',
        );

        if (cancelled) return;

        if (notification) {
          addMessage({ role: 'system', content: notification.message, timestamp: Date.now() });
        }

        // Record round (shared by both paths)
        recordRound();

        if (usedGod) {
          setGodLatency(Date.now() - godCallStart);
          const godResult = result as Awaited<ReturnType<typeof evaluateConvergence>>;
          const { judgment } = godResult;
          const satisfiedCount = judgment.criteriaProgress.filter(c => c.satisfied).length;
          const totalCriteria = judgment.criteriaProgress.length;

          addMessage({
            role: 'system',
            content: `God convergence: ${judgment.classification}, blocking=${judgment.blockingIssueCount}, criteria=${satisfiedCount}/${totalCriteria}${godResult.terminationReason ? `, reason=${godResult.terminationReason}` : ''}`,
            timestamp: Date.now(),
            metadata: { isRoutingEvent: true },
          });

          addTimelineEvent(
            godResult.shouldTerminate ? 'converged' : 'reviewing',
            `God evaluation: ${judgment.classification}, round ${ctx.round + 1}/${ctx.maxRounds}, blocking=${judgment.blockingIssueCount}`,
          );

          if (godResult.shouldTerminate) {
            send({ type: 'CONVERGED' });
          } else {
            send({ type: 'NOT_CONVERGED' });
          }
        } else {
          // v1 path — runV1Convergence already added messages and timeline events
          const v1Result = result as { v1: { shouldTerminate: boolean } };

          if (godAuditLoggerRef.current) {
            godAuditLoggerRef.current.append({
              timestamp: new Date().toISOString(),
              round: ctx.round,
              decisionType: 'CONVERGENCE_FAILURE',
              inputSummary: reviewerOutput.slice(0, 500),
              outputSummary: `Degraded to v1: level=${degradationManagerRef.current.getState().level}`,
              decision: { degradationLevel: degradationManagerRef.current.getState().level },
            });
            addTimelineEvent('error', 'God convergence failed, using v1 fallback');
          }

          if (v1Result.v1.shouldTerminate) {
            send({ type: 'CONVERGED' });
          } else {
            send({ type: 'NOT_CONVERGED' });
          }
        }
      } catch (err) {
        send({ type: 'PROCESS_ERROR', error: `Evaluation error: ${err instanceof Error ? err.message : String(err)}` });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stateValue]);

  // ── DONE state ──
  useEffect(() => {
    if (stateValue !== 'DONE') return;

    addMessage({
      role: 'system',
      content: 'Session completed. Thank you for using Duo!',
      timestamp: Date.now(),
    });
    addTimelineEvent('converged', 'Session completed');

    // Exit after a short delay to let the user see the final state
    const timer = setTimeout(() => exit(), 3000);
    return () => clearTimeout(timer);
  }, [stateValue]);

  // ── ERROR state ──
  useEffect(() => {
    if (stateValue !== 'ERROR') return;

    addMessage({
      role: 'system',
      content: `Error: ${ctx.lastError ?? 'Unknown error'}. Type a message to recover.`,
      timestamp: Date.now(),
    });
    addTimelineEvent('error', `Error: ${ctx.lastError ?? 'Unknown'}`);

    // Auto-recover to WAITING_USER
    send({ type: 'RECOVERY' });
  }, [stateValue]);

  // ── WAITING_USER: God auto-decision + escape window (FR-008) ──
  // C.2: Uses withGodFallback for unified retry + degradation (AC-2, AC-3)
  useEffect(() => {
    if (stateValue !== 'WAITING_USER') return;

    // BUG-2 fix: Don't start auto-decision while PhaseTransitionBanner is showing.
    // The user should confirm/cancel the phase transition first.
    if (showPhaseTransition) return;

    // Reset banner state on entry
    setGodDecision(null);
    setShowGodBanner(false);

    const manualWaitingMsg = 'Waiting for your decision. Type [c] to continue, [a] to accept, or enter new instructions.';

    // God disabled → v1 behavior (wait for user input)
    // BUG-3 fix: Use setMessages callback to check latest messages, avoiding stale closure.
    if (!degradationManagerRef.current.isGodAvailable()) {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (!lastMsg || lastMsg.content !== manualWaitingMsg) {
          return [...prev, { id: nextMsgId(), role: 'system' as const, content: manualWaitingMsg, timestamp: Date.now() }];
        }
        return prev;
      });
      return;
    }

    let cancelled = false;

    (async () => {
      const autoDecisionContext: AutoDecisionContext = {
        round: ctx.round,
        maxRounds: ctx.maxRounds,
        taskGoal: config.task,
        sessionDir: path.join(config.projectDir, '.duo', 'sessions', sessionIdRef.current ?? 'unknown'),
        seq: ++auditSeqRef.current,
        waitingReason: 'awaiting_user_decision',
        projectDir: config.projectDir,
      };

      // Sentinel value for v1 fallback
      const V1_SENTINEL = { fallback: true as const };

      const { result, usedGod, notification } = await withGodFallback(
        degradationManagerRef.current,
        async () => makeAutoDecision(godAdapterRef.current, autoDecisionContext, evaluateRules),
        () => V1_SENTINEL,
        'process_exit',
      );

      if (cancelled) return;

      if (notification) {
        addMessage({ role: 'system', content: notification.message, timestamp: Date.now() });
      }

      if (!usedGod || 'fallback' in result) {
        // v1 fallback — wait for manual input
        addMessage({ role: 'system', content: manualWaitingMsg, timestamp: Date.now() });
        return;
      }

      // God succeeded — handle auto-decision result
      const autoResult = result as Awaited<ReturnType<typeof makeAutoDecision>>;

      // AC-025: Rule engine block → stay manual mode
      if (autoResult.blocked) {
        addMessage({
          role: 'system',
          content: `God auto-decision blocked by rule engine. ${manualWaitingMsg}`,
          timestamp: Date.now(),
        });
        return;
      }

      // request_human → stay manual (no banner needed)
      if (autoResult.decision.action === 'request_human') {
        addMessage({ role: 'system', content: manualWaitingMsg, timestamp: Date.now() });
        return;
      }

      // Success — show escape window banner
      setGodDecision(autoResult.decision);
      setShowGodBanner(true);
    })();

    return () => { cancelled = true; };
  }, [stateValue, showPhaseTransition, reclassifyTrigger]);

  // ── Handle user input ──
  const handleInputSubmit = useCallback(
    (text: string) => {
      // Add user message
      addMessage({
        role: 'user',
        content: text,
        timestamp: Date.now(),
      });

      if (stateValue === 'CODING' || stateValue === 'REVIEWING') {
        // Text interrupt: kill current process, then resume
        const adapter =
          stateValue === 'CODING'
            ? coderAdapterRef.current
            : reviewerAdapterRef.current;
        const resumeAs = stateValue === 'CODING' ? 'coder' : 'reviewer';
        lastInterruptedRoleRef.current = resumeAs;
        pendingInstructionRef.current = text;

        outputManagerRef.current.interrupt();
        adapter.kill().catch(() => {});

        const bufferedText = outputManagerRef.current.getBufferedText();
        addMessage({
          role: 'system',
          content: `Interrupted (${bufferedText.length} chars captured). Processing your instruction...`,
          timestamp: Date.now(),
        });

        send({ type: 'USER_INTERRUPT' });
        // xstate v5 queues events — USER_INPUT is processed after INTERRUPTED transition
        send({ type: 'USER_INPUT', input: text, resumeAs });
        return;
      }

      if (stateValue === 'WAITING_USER') {
        const decision = resolveUserDecision(
          stateValue,
          text,
          lastInterruptedRoleRef.current,
        );
        if (decision?.type === 'confirm') {
          if (decision.pendingInstruction) {
            pendingInstructionRef.current = decision.pendingInstruction;
          }
          send({ type: 'USER_CONFIRM', action: decision.action });
        }
        return;
      }

      if (stateValue === 'INTERRUPTED') {
        const decision = resolveUserDecision(
          stateValue,
          text,
          lastInterruptedRoleRef.current,
        );
        if (decision?.type === 'resume') {
          pendingInstructionRef.current = decision.input;
          send({ type: 'USER_INPUT', input: text, resumeAs: decision.resumeAs });
        }
        return;
      }
    },
    [stateValue, send, addMessage],
  );

  // ── Handle Ctrl+C interrupt ──
  const handleInterrupt = useCallback(() => {
    const now = Date.now();
    const timeSinceLast = now - lastCtrlCRef.current;
    lastCtrlCRef.current = now;

    // Double Ctrl+C: exit
    if (timeSinceLast <= 500) {
      // Save session before exit
      if (sessionIdRef.current) {
        try {
          const ca = coderAdapterRef.current;
          const ra = reviewerAdapterRef.current;
          const ga = godAdapterRef.current;
          sessionManagerRef.current.saveState(sessionIdRef.current, {
            round: ctx.round,
            status: 'interrupted',
            currentRole: ctx.activeProcess ?? 'coder',
            ...(isSessionCapable(ca) && ca.getLastSessionId()
              ? { coderSessionId: ca.getLastSessionId()! }
              : {}),
            ...(isSessionCapable(ra) && ra.getLastSessionId()
              ? { reviewerSessionId: ra.getLastSessionId()! }
              : {}),
            ...(isSessionCapable(ga) && ga.getLastSessionId()
              ? { godSessionId: ga.getLastSessionId()! }
              : {}),
            godAdapter: config.god,
            ...(taskAnalysisRef.current ? { godTaskAnalysis: taskAnalysisRef.current } : {}),
            godConvergenceLog: convergenceLogRef.current,
            degradationState: degradationManagerRef.current.serializeState(),
            currentPhaseId,
          });
        } catch { /* best-effort */ }
      }
      exit();
      return;
    }

    // Single Ctrl+C: interrupt current process
    if (stateValue === 'CODING' || stateValue === 'REVIEWING') {
      const adapter =
        stateValue === 'CODING'
          ? coderAdapterRef.current
          : reviewerAdapterRef.current;
      lastInterruptedRoleRef.current = stateValue === 'CODING' ? 'coder' : 'reviewer';

      outputManagerRef.current.interrupt();
      adapter.kill().catch(() => {});

      const bufferedText = outputManagerRef.current.getBufferedText();
      addMessage({
        role: 'system',
        content: `Interrupted (${bufferedText.length} chars captured). Enter new instructions or press Ctrl+C again to exit.`,
        timestamp: Date.now(),
      });
      addTimelineEvent('interrupted', `User interrupt: ${bufferedText.length} chars`);
      send({ type: 'USER_INTERRUPT' });
    }
  }, [stateValue, ctx, send, exit, addMessage, addTimelineEvent]);

  // ── TaskAnalysisCard confirm handler ──
  const handleTaskAnalysisConfirm = useCallback(
    (taskType: string) => {
      setShowTaskAnalysisCard(false);
      const maxRounds = taskAnalysis?.suggestedMaxRounds;

      // BUG-8 fix: Update taskAnalysis state with user-selected taskType
      setTaskAnalysis(prev => prev ? { ...prev, taskType: taskType as GodTaskAnalysis['taskType'] } : prev);

      // Card C.3: Set initial phase for compound tasks — use taskType param (user's choice)
      if (taskType === 'compound' && taskAnalysis?.phases && taskAnalysis.phases.length > 0) {
        setCurrentPhaseId(taskAnalysis.phases[0].id);
      }

      addMessage({
        role: 'system',
        content: `Task analysis confirmed: type=${taskType}, rounds=${maxRounds ?? 'default'}.`,
        timestamp: Date.now(),
      });
      send({ type: 'TASK_INIT_COMPLETE', maxRounds });
    },
    [taskAnalysis, send, addMessage, setTaskAnalysis],
  );

  const handleTaskAnalysisTimeout = useCallback(() => {
    addTimelineEvent('task_start', 'TaskAnalysisCard auto-confirmed (timeout)');
  }, [addTimelineEvent]);

  // ── GodDecisionBanner execute handler (AC-5) ──
  const handleGodDecisionExecute = useCallback(() => {
    if (!godDecision) return;
    setShowGodBanner(false);

    if (godDecision.action === 'accept') {
      addMessage({
        role: 'system',
        content: 'God auto-decision: accepting output.',
        timestamp: Date.now(),
      });
      addTimelineEvent('task_start', 'God auto-decision: accept');
      send({ type: 'USER_CONFIRM', action: 'accept' });
    } else if (godDecision.action === 'continue_with_instruction') {
      pendingInstructionRef.current = godDecision.instruction ?? null;
      addMessage({
        role: 'system',
        content: `God auto-decision: continue with instruction "${godDecision.instruction ?? ''}"`,
        timestamp: Date.now(),
      });
      addTimelineEvent('task_start', 'God auto-decision: continue_with_instruction');
      send({ type: 'USER_CONFIRM', action: 'continue' });
    }
  }, [godDecision, send, addMessage, addTimelineEvent]);

  // ── GodDecisionBanner cancel handler (AC-4) ──
  const handleGodDecisionCancel = useCallback(() => {
    setShowGodBanner(false);
    setGodDecision(null);
    addMessage({
      role: 'system',
      content: 'God auto-decision cancelled. Waiting for your decision. Type [c] to continue, [a] to accept, or enter new instructions.',
      timestamp: Date.now(),
    });
    addTimelineEvent('task_start', 'God auto-decision: cancelled by user');
  }, [addMessage, addTimelineEvent]);

  // ── Ctrl+R reclassify handler — Card C.3 (AC-010) ──
  const handleReclassify = useCallback(() => {
    if (!canTriggerReclassify(stateValue)) return;
    if (!taskAnalysis) return;

    // If LLM is running, interrupt first
    if (stateValue === 'CODING' || stateValue === 'REVIEWING') {
      const adapter = stateValue === 'CODING'
        ? coderAdapterRef.current
        : reviewerAdapterRef.current;
      lastInterruptedRoleRef.current = stateValue === 'CODING' ? 'coder' : 'reviewer';
      outputManagerRef.current.interrupt();
      adapter.kill().catch(() => {});
      addMessage({
        role: 'system',
        content: 'LLM interrupted for task reclassification.',
        timestamp: Date.now(),
      });
      send({ type: 'USER_INTERRUPT' });
    }

    setShowReclassify(true);
  }, [stateValue, taskAnalysis, send, addMessage]);

  // ── Reclassify confirm handler — Card C.3 (AC-011, AC-012) ──
  const handleReclassifySelect = useCallback(
    (newType: string) => {
      setShowReclassify(false);

      // BUG-7 fix: Clear any stale God auto-decision from before reclassification
      setGodDecision(null);
      setShowGodBanner(false);

      if (!taskAnalysis) return;

      const oldType = taskAnalysis.taskType;

      // Update taskAnalysis with new type
      const updatedAnalysis: GodTaskAnalysis = {
        ...taskAnalysis,
        taskType: newType as GodTaskAnalysis['taskType'],
      };
      setTaskAnalysis(updatedAnalysis);

      // Write audit log (AC-012)
      const sessionDir = sessionIdRef.current
        ? path.join(config.projectDir, '.duo', 'sessions', sessionIdRef.current)
        : config.projectDir;
      writeReclassifyAudit(sessionDir, {
        seq: ++auditSeqRef.current,
        round: ctx.round,
        fromType: oldType as any,
        toType: newType as any,
      });

      addMessage({
        role: 'system',
        content: `Task reclassified: ${oldType} → ${newType}. Continuing with new type.`,
        timestamp: Date.now(),
      });
      addTimelineEvent('task_start', `Reclassify: ${oldType} → ${newType}`);

      // BUG-21 fix: Trigger re-run of WAITING_USER auto-decision after reclassify
      setReclassifyTrigger(prev => prev + 1);

      // Resume to WAITING_USER so user can continue
      if (stateValue === 'INTERRUPTED') {
        send({ type: 'USER_INPUT', input: `Reclassified to ${newType}`, resumeAs: 'decision' });
      }
    },
    [taskAnalysis, config, ctx.round, stateValue, send, addMessage, addTimelineEvent],
  );

  const handleReclassifyCancel = useCallback(() => {
    setShowReclassify(false);

    // BUG-4 fix: If we interrupted the LLM to show the overlay, restore to
    // the previous role so the user isn't stuck in INTERRUPTED with no prompt.
    if (stateValue === 'INTERRUPTED' && lastInterruptedRoleRef.current) {
      addMessage({
        role: 'system',
        content: 'Task reclassification cancelled. Resuming previous work.',
        timestamp: Date.now(),
      });
      send({
        type: 'USER_INPUT',
        input: 'Reclassification cancelled, resuming',
        resumeAs: lastInterruptedRoleRef.current,
      });
    } else {
      addMessage({
        role: 'system',
        content: 'Task reclassification cancelled.',
        timestamp: Date.now(),
      });
    }
  }, [stateValue, send, addMessage]);

  // ── Phase transition confirm handler — Card C.3 (AC-033) ──
  const handlePhaseTransitionConfirm = useCallback(() => {
    setShowPhaseTransition(false);
    if (!pendingPhaseTransition) return;

    setCurrentPhaseId(pendingPhaseTransition.nextPhaseId);

    addMessage({
      role: 'system',
      content: `Phase transition confirmed → ${pendingPhaseTransition.nextPhaseId}`,
      timestamp: Date.now(),
    });
    addTimelineEvent('task_start', `Phase transition → ${pendingPhaseTransition.nextPhaseId}`);

    // Send continue with phase context (workflow machine handles pendingPhaseId)
    send({ type: 'USER_CONFIRM', action: 'continue' });
    setPendingPhaseTransition(null);
  }, [pendingPhaseTransition, send, addMessage, addTimelineEvent]);

  // ── Phase transition cancel handler — Card C.3 ──
  const handlePhaseTransitionCancel = useCallback(() => {
    setShowPhaseTransition(false);
    setPendingPhaseTransition(null);

    // BUG-1 fix: Clear pendingPhaseId in XState context so subsequent
    // USER_CONFIRM 'continue' doesn't trigger the cancelled phase transition.
    send({ type: 'CLEAR_PENDING_PHASE' });

    addMessage({
      role: 'system',
      content: 'Phase transition cancelled. Staying in current phase. Type [c] to continue, [a] to accept.',
      timestamp: Date.now(),
    });
    addTimelineEvent('task_start', 'Phase transition cancelled by user');
  }, [send, addMessage, addTimelineEvent]);

  // ── Build status ──
  const status = mapStateToStatus(stateValue);
  const activeAgent = getActiveAgentLabel(stateValue, config, detected);
  const isLLMRunning = stateValue === 'CODING' || stateValue === 'REVIEWING';

  // ── Context data for overlay ──
  const contextData = {
    roundNumber: ctx.round + 1,
    coderName: getDisplayName(config.coder),
    reviewerName: getDisplayName(config.reviewer),
    taskSummary: config.task,
    tokenEstimate: tokenCount,
  };

  // SPEC-DECISION: Render ReclassifyOverlay as full replacement to avoid useInput conflicts.
  // Card C.3 (AC-010): Ctrl+R triggers overlay in CODING/REVIEWING/WAITING_USER.
  if (showReclassify && taskAnalysis) {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <ReclassifyOverlay
          currentType={taskAnalysis.taskType}
          currentRound={ctx.round + 1}
          onSelect={handleReclassifySelect}
          onCancel={handleReclassifyCancel}
        />
      </Box>
    );
  }

  // SPEC-DECISION: Render PhaseTransitionBanner as full replacement.
  // Card C.3 (AC-033): 2-second escape window for phase transitions.
  if (showPhaseTransition && pendingPhaseTransition && stateValue === 'WAITING_USER') {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <PhaseTransitionBanner
          nextPhaseId={pendingPhaseTransition.nextPhaseId}
          previousPhaseSummary={pendingPhaseTransition.previousPhaseSummary}
          onConfirm={handlePhaseTransitionConfirm}
          onCancel={handlePhaseTransitionCancel}
        />
      </Box>
    );
  }

  // SPEC-DECISION: Render GodDecisionBanner as overlay within MainLayout
  // during WAITING_USER to avoid useInput conflicts with text input.
  if (showGodBanner && godDecision && stateValue === 'WAITING_USER') {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <GodDecisionBanner
          decision={godDecision}
          onExecute={handleGodDecisionExecute}
          onCancel={handleGodDecisionCancel}
        />
      </Box>
    );
  }

  // SPEC-DECISION: Render TaskAnalysisCard as full replacement for MainLayout
  // to avoid useInput conflicts. Card disappears once confirmed.
  if (showTaskAnalysisCard && taskAnalysis && stateValue === 'TASK_INIT') {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <TaskAnalysisCard
          analysis={taskAnalysis}
          onConfirm={handleTaskAnalysisConfirm}
          onTimeout={handleTaskAnalysisTimeout}
        />
      </Box>
    );
  }

  return (
    <MainLayout
      messages={messages}
      columns={columns}
      rows={rows}
      isLLMRunning={isLLMRunning}
      onInputSubmit={handleInputSubmit}
      onInterrupt={handleInterrupt}
      onNewSession={() => {
        // Not implemented in v1: would need to reset state
      }}
      onReclassify={handleReclassify}
      statusBarProps={{
        projectPath: config.projectDir,
        round: ctx.round + 1,
        maxRounds: ctx.maxRounds,
        status,
        activeAgent,
        tokenCount,
        taskType: taskAnalysis?.taskType,
        currentPhase: currentPhaseId ?? undefined,
        godAdapter: config.god,
        reviewerAdapter: config.reviewer,
        degradationLevel: degradationManagerRef.current.getState().level,
        godLatency,
      }}
      contextData={contextData}
      timelineEvents={timelineEvents}
    />
  );
}

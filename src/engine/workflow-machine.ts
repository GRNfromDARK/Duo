/**
 * WorkflowMachine — xstate v5 state machine for Duo's coding-review-evaluate loop.
 * Source: FR-004 (AC-012, AC-013, AC-014, AC-015)
 *
 * 11 states, 13+ events, strict serial execution (1 LLM process at a time).
 * Supports serialization/deserialization for session recovery.
 */

import { setup, assign } from 'xstate';

export interface WorkflowContext {
  round: number;
  maxRounds: number;
  taskPrompt: string | null;
  activeProcess: 'coder' | 'reviewer' | null;
  lastError: string | null;
  lastCoderOutput: string | null;
  lastReviewerOutput: string | null;
  sessionId: string | null;
  pendingPhaseId: string | null;
  pendingPhaseSummary: string | null;
}

// ── Event types ──

type StartTaskEvent = { type: 'START_TASK'; prompt: string };
type CodeCompleteEvent = { type: 'CODE_COMPLETE'; output: string };
type ReviewCompleteEvent = { type: 'REVIEW_COMPLETE'; output: string };
type ConvergedEvent = { type: 'CONVERGED' };
type NotConvergedEvent = { type: 'NOT_CONVERGED' };
type UserInterruptEvent = { type: 'USER_INTERRUPT' };
type UserInputEvent = { type: 'USER_INPUT'; input: string; resumeAs: 'coder' | 'reviewer' | 'decision' };
type UserConfirmEvent = { type: 'USER_CONFIRM'; action: 'continue' | 'accept' };
type ProcessErrorEvent = { type: 'PROCESS_ERROR'; error: string };
type TimeoutEvent = { type: 'TIMEOUT' };
type TaskInitCompleteEvent = { type: 'TASK_INIT_COMPLETE'; maxRounds?: number };
type TaskInitSkipEvent = { type: 'TASK_INIT_SKIP' };
type ResumeSessionEvent = { type: 'RESUME_SESSION'; sessionId: string };
type RouteToReviewEvent = { type: 'ROUTE_TO_REVIEW' };
type ChoiceDetectedEvent = { type: 'CHOICE_DETECTED'; choices: string[] };
type RouteToEvaluateEvent = { type: 'ROUTE_TO_EVALUATE' };
type RouteToCoderEvent = { type: 'ROUTE_TO_CODER' };
type RecoveryEvent = { type: 'RECOVERY' };
type RestoredToCodingEvent = { type: 'RESTORED_TO_CODING' };
type RestoredToReviewingEvent = { type: 'RESTORED_TO_REVIEWING' };
type RestoredToWaitingEvent = { type: 'RESTORED_TO_WAITING' };
type RestoredToInterruptedEvent = { type: 'RESTORED_TO_INTERRUPTED' };
type NeedsUserInputEvent = { type: 'NEEDS_USER_INPUT' };
type LoopDetectedEvent = { type: 'LOOP_DETECTED' };
type ReclassifyEvent = { type: 'RECLASSIFY' };
type PhaseTransitionEvent = { type: 'PHASE_TRANSITION'; nextPhaseId: string; summary: string };
type ClearPendingPhaseEvent = { type: 'CLEAR_PENDING_PHASE' };

export type WorkflowEvent =
  | StartTaskEvent
  | TaskInitCompleteEvent
  | TaskInitSkipEvent
  | CodeCompleteEvent
  | ReviewCompleteEvent
  | ConvergedEvent
  | NotConvergedEvent
  | UserInterruptEvent
  | UserInputEvent
  | UserConfirmEvent
  | ProcessErrorEvent
  | TimeoutEvent
  | ResumeSessionEvent
  | RouteToReviewEvent
  | ChoiceDetectedEvent
  | RouteToEvaluateEvent
  | RouteToCoderEvent
  | RecoveryEvent
  | RestoredToCodingEvent
  | RestoredToReviewingEvent
  | RestoredToWaitingEvent
  | RestoredToInterruptedEvent
  | NeedsUserInputEvent
  | LoopDetectedEvent
  | ReclassifyEvent
  | PhaseTransitionEvent
  | ClearPendingPhaseEvent;

export const workflowMachine = setup({
  types: {
    context: {} as WorkflowContext,
    events: {} as WorkflowEvent,
    input: {} as Partial<WorkflowContext> | undefined,
  },
  guards: {
    canContinueRounds: ({ context }) => context.round < context.maxRounds,
    maxRoundsReached: ({ context }) => context.round >= context.maxRounds,
    resumeAsCoder: ({ event }) =>
      (event as UserInputEvent).resumeAs === 'coder',
    resumeAsReviewer: ({ event }) =>
      (event as UserInputEvent).resumeAs === 'reviewer',
    resumeAsDecision: ({ event }) =>
      (event as UserInputEvent).resumeAs === 'decision',
    confirmContinue: ({ event }) =>
      (event as UserConfirmEvent).action === 'continue',
    confirmContinueWithPhase: ({ event, context }) =>
      (event as UserConfirmEvent).action === 'continue' && context.pendingPhaseId != null,
    confirmAccept: ({ event }) =>
      (event as UserConfirmEvent).action === 'accept',
  },
}).createMachine({
  id: 'workflow',
  initial: 'IDLE',
  context: ({ input }) => ({
    round: input?.round ?? 0,
    maxRounds: input?.maxRounds ?? 10,
    taskPrompt: input?.taskPrompt ?? null,
    activeProcess: input?.activeProcess ?? null,
    lastError: input?.lastError ?? null,
    lastCoderOutput: input?.lastCoderOutput ?? null,
    lastReviewerOutput: input?.lastReviewerOutput ?? null,
    sessionId: input?.sessionId ?? null,
    pendingPhaseId: input?.pendingPhaseId ?? null,
    pendingPhaseSummary: input?.pendingPhaseSummary ?? null,
  }),
  states: {
    IDLE: {
      on: {
        START_TASK: {
          target: 'TASK_INIT',
          actions: assign({
            taskPrompt: ({ event }) => (event as StartTaskEvent).prompt,
          }),
        },
        RESUME_SESSION: {
          target: 'RESUMING',
          actions: assign({
            sessionId: ({ event }) => (event as ResumeSessionEvent).sessionId,
          }),
        },
      },
    },

    // SPEC-DECISION: TASK_INIT inserted between IDLE and CODING for God intent parsing (Card A.2)
    TASK_INIT: {
      on: {
        TASK_INIT_COMPLETE: {
          target: 'CODING',
          actions: assign({
            activeProcess: () => 'coder' as const,
            maxRounds: ({ context, event }) => {
              const e = event as TaskInitCompleteEvent;
              return e.maxRounds ?? context.maxRounds;
            },
          }),
        },
        TASK_INIT_SKIP: {
          target: 'CODING',
          actions: assign({
            activeProcess: () => 'coder' as const,
          }),
        },
      },
    },

    CODING: {
      on: {
        CODE_COMPLETE: {
          target: 'ROUTING_POST_CODE',
          actions: assign({
            lastCoderOutput: ({ event }) => (event as CodeCompleteEvent).output,
            activeProcess: () => null,
          }),
        },
        USER_INTERRUPT: {
          target: 'INTERRUPTED',
          actions: assign({
            activeProcess: () => null,
          }),
        },
        PROCESS_ERROR: {
          target: 'ERROR',
          actions: assign({
            lastError: ({ event }) => (event as ProcessErrorEvent).error,
            activeProcess: () => null,
          }),
        },
        TIMEOUT: {
          target: 'ERROR',
          actions: assign({
            lastError: () => 'Process timed out',
            activeProcess: () => null,
          }),
        },
      },
    },

    ROUTING_POST_CODE: {
      on: {
        ROUTE_TO_REVIEW: {
          target: 'REVIEWING',
          actions: assign({
            activeProcess: () => 'reviewer' as const,
          }),
        },
        ROUTE_TO_CODER: [
          {
            guard: 'canContinueRounds',
            target: 'CODING',
            actions: assign({
              round: ({ context }) => context.round + 1,
              activeProcess: () => 'coder' as const,
            }),
          },
          {
            // maxRounds reached — go to WAITING_USER
            target: 'WAITING_USER',
          },
        ],
        NEEDS_USER_INPUT: {
          target: 'WAITING_USER',
        },
        CHOICE_DETECTED: {
          target: 'WAITING_USER',
        },
        PROCESS_ERROR: {
          target: 'ERROR',
          actions: assign({
            lastError: ({ event }) => (event as ProcessErrorEvent).error,
            activeProcess: () => null,
          }),
        },
      },
    },

    REVIEWING: {
      on: {
        REVIEW_COMPLETE: {
          target: 'ROUTING_POST_REVIEW',
          actions: assign({
            lastReviewerOutput: ({ event }) => (event as ReviewCompleteEvent).output,
            activeProcess: () => null,
          }),
        },
        USER_INTERRUPT: {
          target: 'INTERRUPTED',
          actions: assign({
            activeProcess: () => null,
          }),
        },
        PROCESS_ERROR: {
          target: 'ERROR',
          actions: assign({
            lastError: ({ event }) => (event as ProcessErrorEvent).error,
            activeProcess: () => null,
          }),
        },
        TIMEOUT: {
          target: 'ERROR',
          actions: assign({
            lastError: () => 'Process timed out',
            activeProcess: () => null,
          }),
        },
      },
    },

    ROUTING_POST_REVIEW: {
      on: {
        ROUTE_TO_EVALUATE: {
          target: 'EVALUATING',
        },
        ROUTE_TO_CODER: [
          {
            guard: 'canContinueRounds',
            target: 'CODING',
            actions: assign({
              round: ({ context }) => context.round + 1,
              activeProcess: () => 'coder' as const,
            }),
          },
          {
            // maxRounds reached — go to WAITING_USER
            target: 'WAITING_USER',
          },
        ],
        CONVERGED: {
          target: 'WAITING_USER',
        },
        NEEDS_USER_INPUT: {
          target: 'WAITING_USER',
        },
        LOOP_DETECTED: {
          target: 'WAITING_USER',
        },
        RECLASSIFY: {
          target: 'WAITING_USER',
        },
        PHASE_TRANSITION: {
          target: 'WAITING_USER',
          actions: assign({
            pendingPhaseId: ({ event }) => (event as PhaseTransitionEvent).nextPhaseId,
            pendingPhaseSummary: ({ event }) => (event as PhaseTransitionEvent).summary,
          }),
        },
        PROCESS_ERROR: {
          target: 'ERROR',
          actions: assign({
            lastError: ({ event }) => (event as ProcessErrorEvent).error,
            activeProcess: () => null,
          }),
        },
      },
    },

    EVALUATING: {
      on: {
        CONVERGED: {
          target: 'WAITING_USER',
        },
        NOT_CONVERGED: [
          {
            guard: 'canContinueRounds',
            target: 'CODING',
            actions: assign({
              round: ({ context }) => context.round + 1,
              activeProcess: () => 'coder' as const,
            }),
          },
          {
            // maxRounds reached — go to WAITING_USER
            target: 'WAITING_USER',
          },
        ],
        PROCESS_ERROR: {
          target: 'ERROR',
          actions: assign({
            lastError: ({ event }) => (event as ProcessErrorEvent).error,
            activeProcess: () => null,
          }),
        },
      },
    },

    WAITING_USER: {
      on: {
        CLEAR_PENDING_PHASE: {
          actions: assign({
            pendingPhaseId: () => null,
            pendingPhaseSummary: () => null,
          }),
        },
        USER_CONFIRM: [
          {
            guard: 'confirmContinueWithPhase',
            target: 'CODING',
            actions: assign({
              round: ({ context }) => context.round + 1,
              activeProcess: () => 'coder' as const,
              taskPrompt: ({ context }) =>
                context.pendingPhaseId
                  ? `[Phase: ${context.pendingPhaseId}] ${context.taskPrompt.replace(/^\[Phase: [^\]]*\] /, '')}`
                  : context.taskPrompt,
              pendingPhaseId: () => null,
              pendingPhaseSummary: () => null,
            }),
          },
          {
            guard: 'confirmContinue',
            target: 'CODING',
            actions: assign({
              round: ({ context }) => context.round + 1,
              activeProcess: () => 'coder' as const,
            }),
          },
          {
            guard: 'confirmAccept',
            target: 'DONE',
          },
          {
            // Fallback: unrecognized action defaults to DONE
            target: 'DONE',
          },
        ],
      },
    },

    INTERRUPTED: {
      on: {
        USER_INPUT: [
          {
            guard: 'resumeAsCoder',
            target: 'CODING',
            actions: assign({
              activeProcess: () => 'coder' as const,
            }),
          },
          {
            guard: 'resumeAsReviewer',
            target: 'REVIEWING',
            actions: assign({
              activeProcess: () => 'reviewer' as const,
            }),
          },
          {
            guard: 'resumeAsDecision',
            target: 'WAITING_USER',
          },
          {
            // Fallback: unrecognized resumeAs defaults to WAITING_USER
            target: 'WAITING_USER',
          },
        ],
      },
    },

    RESUMING: {
      on: {
        RESTORED_TO_CODING: {
          target: 'CODING',
          actions: assign({
            activeProcess: () => 'coder' as const,
          }),
        },
        RESTORED_TO_REVIEWING: {
          target: 'REVIEWING',
          actions: assign({
            activeProcess: () => 'reviewer' as const,
          }),
        },
        RESTORED_TO_WAITING: {
          target: 'WAITING_USER',
        },
        RESTORED_TO_INTERRUPTED: {
          target: 'INTERRUPTED',
        },
        PROCESS_ERROR: {
          target: 'ERROR',
          actions: assign({
            lastError: ({ event }) => (event as ProcessErrorEvent).error,
            activeProcess: () => null,
          }),
        },
      },
    },

    DONE: {
      type: 'final',
    },

    ERROR: {
      on: {
        RECOVERY: {
          target: 'WAITING_USER',
        },
      },
    },
  },
});

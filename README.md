# Duo — Multi-AI Coding Assistant Collaboration Platform

<p align="center">
  <strong>Coder + Reviewer + God LLM = Autonomous Code Quality</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A520-green" alt="Node.js">
  <img src="https://img.shields.io/badge/XState-v5-purple" alt="XState">
  <img src="https://img.shields.io/badge/Tests-2239-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/License-ISC-yellow" alt="License">
</p>

---

## What is Duo?

Duo is a **multi-AI coding assistant collaboration platform** that orchestrates two AI coding tools — one as **Coder**, one as **Reviewer** — in an automated code-review loop, supervised by a **God LLM** (an independent LLM acting as an intelligent orchestrator).

```
User Task → God Analyzes → Coder Proposes → Reviewer Evaluates → Consensus → Coder Implements → Reviewer Verifies → Done
```

Unlike single-agent coding tools, Duo ensures **every code change is reviewed before it ships** — by another AI with a different perspective.

## Key Features

### Three-Party Collaboration

| Role | Responsibility | Supported Tools |
|------|---------------|-----------------|
| **Coder** | Writes code, implements features, fixes bugs | Claude Code, Codex, Gemini |
| **Reviewer** | Reviews code, finds issues, provides feedback | Claude Code, Codex, Gemini |
| **God LLM** | Orchestrates workflow, routes decisions, judges convergence | Claude Code, Codex, Gemini |

### Propose-First Workflow

Duo enforces a **propose-before-implement** discipline:

1. **Proposal**: Coder analyzes the problem and proposes a plan (no file modifications)
2. **Reviewer evaluates** the proposal — approves or requests changes
3. **After consensus**: Coder implements with full context (Reviewer's original feedback is injected directly)
4. **Reviewer verifies** the implementation
5. **God accepts** when quality criteria are met

### 3 Supported AI Tools

| Tool | CLI Command | Output Format | Role Support |
|------|-------------|---------------|-------------|
| Claude Code | `claude` | stream-json | Coder / Reviewer / God |
| Codex | `codex` | jsonl | Coder / Reviewer / God |
| Gemini | `gemini` | stream-json | Coder / Reviewer / God |

Mix and match any combination — e.g., Claude Code as Coder + Codex as Reviewer + Gemini as God.

### God LLM Intelligent Orchestration

- **Task Classification**: Automatically categorizes tasks (explore / code / debug / review / discuss / compound)
- **Routing Decisions**: Determines next action after each worker output
- **Convergence Judgment**: Sole authority on when work meets acceptance criteria
- **Watchdog Service**: Retry + exponential backoff + pause on God failures
- **Choice Handling**: Autonomous resolution when workers present multiple options
- **Reviewer Feedback Direct Forwarding**: Coder receives Reviewer's original analysis, not God's summary

### State Machine Architecture

12-state workflow powered by XState v5:

```
IDLE → TASK_INIT → CODING → OBSERVING → GOD_DECIDING → EXECUTING
                     ↑                                      ↓
                     ←──── REVIEWING ←── routing ←──────────┘
                                                    ↓
                                              DONE / CLARIFYING
```

### Terminal UI

Modern terminal interface built with Ink + React (22 components):
- Group-chat style message stream (color-coded by role)
- Real-time streaming LLM output
- Smart Scroll Lock
- Code block auto-collapse (>10 lines)
- Overlay panels (Help, Context, Timeline, Search)
- Task analysis cards and phase transition banners

### Session Persistence

- Atomic writes (write-tmp-rename) for crash consistency
- Session save & restore (`duo resume`)
- God audit log viewer (`duo log`)
- JSONL append-mode history

## Quick Start

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build
npm run build

# Run tests
npm test
```

## CLI Commands

```bash
# Interactive startup (SetupWizard)
duo start

# Start with specific configuration
duo start --dir ./my-project --coder claude-code --reviewer codex --task "Add JWT auth"

# List resumable sessions
duo resume

# Resume a specific session
duo resume <session-id>

# View God audit log
duo log <session-id>

# Version
duo --version
```

## Architecture

Duo uses a 6-layer architecture:

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 1: CLI Entry          cli.ts, cli-commands.ts         │
├──────────────────────────────────────────────────────────────┤
│  Layer 2: UI Layer           22 components + 19 state modules│
├──────────────────────────────────────────────────────────────┤
│  Layer 3: Sovereign God      20 files — Observe→Decide→Act   │
├──────────────────────────────────────────────────────────────┤
│  Layer 4: Workflow Engine    XState v5 state machine          │
├──────────────────────────────────────────────────────────────┤
│  Layer 5: Session Manager    Persistence, atomic writes       │
├──────────────────────────────────────────────────────────────┤
│  Layer 6: Adapter Layer      3 AI tool adapters + parsers     │
└──────────────────────────────────────────────────────────────┘
```

See [docs/architecture.md](docs/architecture.md) for the full architecture document.

## Project Structure

```
src/
├── cli.ts                     # CLI entry — command parsing, Ink rendering
├── cli-commands.ts            # Command handlers (start/resume/log)
├── types/                     # Core type definitions (9 files)
├── adapters/                  # AI tool adapters + model discovery
├── parsers/                   # Output parsers (stream-json/jsonl/text)
├── session/                   # Session management & persistence (3 files)
├── engine/                    # XState v5 workflow state machine
├── god/                       # Sovereign God Runtime (20 files)
│   ├── god-decision-service   # Sole decision authority
│   ├── god-prompt-generator   # Dynamic Coder/Reviewer prompts
│   ├── observation-classifier # Output classification
│   ├── hand-executor          # God action execution
│   ├── watchdog               # Retry + backoff + pause
│   └── ...                    # Task init, audit, tri-party session
└── ui/                        # Terminal UI (Ink + React)
    ├── components/ (22)       # App, MainLayout, Overlays, etc.
    └── *.ts (19)              # Pure-function state management
```

## Documentation

| Document | Description |
|----------|-------------|
| [architecture.md](docs/architecture.md) | System architecture (6 layers, data flow, state machine) |
| [god-orchestrator.md](docs/modules/god-orchestrator.md) | God LLM orchestrator details |
| [workflow-engine.md](docs/modules/workflow-engine.md) | XState workflow state machine |
| [adapter-layer.md](docs/modules/adapter-layer.md) | AI tool adapter layer |
| [ui-components.md](docs/modules/ui-components.md) | UI components |
| [session-management.md](docs/modules/session-management.md) | Session management & persistence |
| [type-system.md](docs/modules/type-system.md) | Core type system |
| [parsers.md](docs/modules/parsers.md) | Output parsers |
| [cli-entry.md](docs/modules/cli-entry.md) | CLI entry & commands |
| [decision-engine.md](docs/modules/decision-engine.md) | Decision architecture |
| [ui-state.md](docs/modules/ui-state.md) | UI state management |

## Tech Stack

| Category | Technology |
|----------|-----------|
| Runtime | Node.js ≥20 (ESM) |
| Language | TypeScript 5.9 (strict mode) |
| State Management | XState v5 |
| UI Framework | Ink 6 + React 19 |
| Schema Validation | Zod 4 |
| Build Tool | tsup |
| Test Framework | Vitest 4 (2239 tests) |
| Package Manager | npm |

## How It Works

### Example: Bug Fix Task

```
1. User:     "Fix the scroll event not propagating in dashboard"
2. God:      Classifies as "debug", plans iteration strategy
3. Coder:    Analyzes code, proposes fix plan (no modifications yet)
4. Reviewer: Evaluates plan, finds missing edge case → [CHANGES_REQUESTED]
5. God:      Routes reviewer feedback directly to Coder
6. Coder:    Implements fix addressing all reviewer concerns
7. Reviewer: Verifies implementation → [APPROVED]
8. God:      Accepts task (reviewer_aligned)
```

### God Decision Envelope

Every God decision produces a structured `GodDecisionEnvelope`:

```typescript
{
  diagnosis: { summary, currentGoal, notableObservations },
  authority: { acceptAuthority, reviewerOverride },
  actions:   [{ type: "send_to_coder", message: "..." }],
  messages:  [{ target: "system_log", content: "..." }]
}
```

All decisions are auditable via `duo log <session-id>`.

## License

ISC

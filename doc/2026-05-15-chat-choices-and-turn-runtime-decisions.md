# Chat Choices And Turn Runtime Decisions

## Context

Lee Codex now uses OpenAI-compatible Chat Completions with native tool calling. Two small design questions came up after the native resolver change:

1. Why provider responses contain a `choices` array.
2. Why each `runConfiguredTurn(...)` currently creates a model client and tool executor.

This note records the current decisions and when to revisit them.

## Decision 1: Use The First Chat Completion Choice

Chat Completions responses contain `choices` because the API can return multiple alternative completions for one request when the request sets `n > 1`. Each choice has its own `index`, assistant `message`, `finish_reason`, and optional metadata.

Lee Codex does not set `n`, so normal requests should return one choice. The provider client reads `choices[0]` and treats it as the single assistant response for the agent loop.

This is intentional for v1. Multiple choices would create multiple possible tool-call branches. Running more than one branch would complicate confirmation prompts, workspace mutations, cost, logs, and recovery behavior.

Revisit this only if Lee Codex explicitly supports candidate ranking or multi-branch planning. If that happens, the design must define how to choose among alternative assistant messages before any tool call is executed.

## Decision 2: Build Runtime Dependencies At The Turn Boundary

`runConfiguredTurn(config, task, history, io, recorder)` currently creates the provider client and tool executor for each turn.

This is a simple composition-root pattern:

- Parse and validate the current provider config.
- Create the model client from that config.
- Create the workspace tool executor from the current workspace and safety options.
- Run one agent turn with those dependencies.

The model client and tool executor are lightweight today. Creating them does not make a network request, open a persistent session, or build an expensive workspace index. The tool executor is mostly closures over workspace path, read limits, command timeout, and confirmation behavior.

Benefits:

- Turns are isolated and easy to reason about.
- Config and environment validation happen close to use.
- Tests can inject or assert dependencies at a clear boundary.
- No hidden mutable provider or tool state leaks between interactive turns.
- The confirmation callback naturally captures the current chat IO.

Costs:

- Interactive mode repeats the same config/env validation each user turn.
- It allocates fresh wrapper objects for every turn.
- If the client or tool executor later owns expensive or stateful resources, recreating them will be wasteful.

This pattern is acceptable for v1. The likely next refactor is to introduce a session runtime for interactive mode:

- Create the model client once per interactive session.
- Create the tool executor once per interactive session.
- Keep per-turn agent messages, max-step budget, and tool-call history fresh.

Consider caching client/executor when any of these become true:

- Interactive sessions commonly run many turns.
- Provider clients gain connection pooling, retry state, auth refresh, rate-limit tracking, or provider capability caches.
- Tool executors gain workspace indexes, policy state, telemetry buffers, or other expensive setup.
- We need one place to represent session-scoped runtime state.

Until then, per-turn construction favors clarity over premature lifecycle management.

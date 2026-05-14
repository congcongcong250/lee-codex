# Lee Codex CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable v1 TypeScript CLI coding agent with single-shot and interactive modes, OpenRouter/OpenAI-compatible providers, strict JSON actions, safe workspace tools, and deterministic tests.

**Architecture:** The CLI parses options and chooses single-shot or interactive mode. Both modes call the same step-based agent loop, which uses a normalized model interface and a workspace tool dispatcher. Provider HTTP details, JSON protocol parsing, workspace path safety, and chat/session behavior stay in separate modules.

**Tech Stack:** Node.js, TypeScript ESM, Commander, Vitest, readline/promises, built-in fetch, built-in child_process/fs/path APIs.

---

## File Structure

- `package.json`: npm scripts, dependencies, and `lee-codex` bin entry.
- `tsconfig.json`: strict TypeScript ESM compiler config.
- `vitest.config.ts`: Vitest config.
- `src/types.ts`: shared types and defaults.
- `src/protocol.ts`: strict JSON action parsing and prompt helpers.
- `src/model.ts`: model interfaces, provider defaults, fake model, and provider factory.
- `src/providers/openaiCompatible.ts`: OpenAI-compatible chat completions client.
- `src/workspace.ts`: workspace validation and path confinement.
- `src/tools.ts`: `list_files`, `read_file`, `write_file`, `run_command`, confirmation handling.
- `src/agent.ts`: direct action agent loop with repair retry and max-step handling.
- `src/chat.ts`: interactive prompt loop with compact in-memory history.
- `src/cli.ts`: command parsing, option validation, mode selection.
- `src/index.ts`: bin entrypoint.
- `tests/*.test.ts`: behavior tests for protocol, workspace tools, agent loop, provider config, CLI, and chat.

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `src/types.ts`

- [ ] **Step 1: Add npm/TypeScript/Vitest scaffold**

Create package scripts for `test`, `build`, `typecheck`, and `dev`; add `commander` runtime dependency and TypeScript/Vitest/tsx dev dependencies.

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: dependencies install and `package-lock.json` is created.

- [ ] **Step 3: Run baseline verification**

Run: `npm test`
Expected: Vitest runs successfully once the first real test exists.

## Task 2: Protocol Parser

**Files:**
- Create: `src/protocol.ts`
- Create: `tests/protocol.test.ts`

- [ ] **Step 1: Write failing tests**

Cover parsing valid tool/final JSON, rejecting prose-wrapped JSON, rejecting fenced JSON, rejecting unknown action types, and formatting a repair prompt.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/protocol.test.ts`
Expected: fail because `src/protocol.ts` does not exist or exports are missing.

- [ ] **Step 3: Implement strict parser**

Implement `parseAgentAction(raw: string): AgentAction`, `isParseFailure`, and `buildRepairUserMessage`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/protocol.test.ts`
Expected: all protocol tests pass.

## Task 3: Workspace and Tools

**Files:**
- Create: `src/workspace.ts`
- Create: `src/tools.ts`
- Create: `tests/tools.test.ts`

- [ ] **Step 1: Write failing tests**

Cover workspace confinement, recursive capped file listing with skipped heavy dirs, read byte cap, write confirmation, denied write, command confirmation, denied command, command cwd, timeout, and output shape.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/tools.test.ts`
Expected: fail because workspace/tool exports are missing.

- [ ] **Step 3: Implement workspace helpers and tools**

Implement path resolution, workspace validation, tool dispatcher, confirmation callback, file operations, and collected shell command execution.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/tools.test.ts`
Expected: all tool tests pass.

## Task 4: Model Config and Provider Client

**Files:**
- Create: `src/model.ts`
- Create: `src/providers/openaiCompatible.ts`
- Create: `tests/model.test.ts`

- [ ] **Step 1: Write failing tests**

Cover OpenRouter defaults, OpenRouter API key, OpenAI API key, missing key errors, arbitrary model overrides, fake model sequencing, and HTTP request shape using a stub fetch.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/model.test.ts`
Expected: fail because model/provider exports are missing.

- [ ] **Step 3: Implement model layer**

Implement provider defaults, `createModelClient`, `FakeModelClient`, and OpenAI-compatible non-streaming chat completions client.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/model.test.ts`
Expected: all model tests pass.

## Task 5: Agent Loop

**Files:**
- Create: `src/agent.ts`
- Create: `tests/agent.test.ts`

- [ ] **Step 1: Write failing tests**

Cover final answer stop, tool execution feeding result back, max-step exhaustion, unknown tool structured errors, one JSON repair retry, second invalid JSON failure, concise step logging, and verbose debug logging.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/agent.test.ts`
Expected: fail because agent exports are missing.

- [ ] **Step 3: Implement agent loop**

Implement direct action loop, step-local tool history, repair retry, logging callbacks, and result statuses.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/agent.test.ts`
Expected: all agent tests pass.

## Task 6: CLI and Interactive Chat

**Files:**
- Create: `src/cli.ts`
- Create: `src/chat.ts`
- Modify: `src/index.ts`
- Create: `tests/cli.test.ts`
- Create: `tests/chat.test.ts`

- [ ] **Step 1: Write failing tests**

Cover default options, `--cwd` validation, single-shot mode with task arg, no-arg interactive mode, `/help`, `/exit`, provider failure keeping chat alive, and compact history after successful turns.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/cli.test.ts tests/chat.test.ts`
Expected: fail because CLI/chat exports are missing.

- [ ] **Step 3: Implement CLI and chat**

Implement Commander parsing, option normalization, mode selection, readline prompt loop, compact history updates, and bin entrypoint.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/cli.test.ts tests/chat.test.ts`
Expected: all CLI/chat tests pass.

## Task 7: Final Verification and Usability

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add usage documentation**

Document install/run commands, env vars, defaults, modes, options, JSON protocol, and v1 limitations.

- [ ] **Step 2: Run full verification**

Run: `npm test`
Expected: all tests pass.

Run: `npm run typecheck`
Expected: TypeScript typecheck passes.

Run: `npm run build`
Expected: compiled output is emitted to `dist`.

Run: `node dist/index.js --help`
Expected: CLI help prints options and exits successfully.

- [ ] **Step 3: Commit implementation**

Create meaningful commits after the plan, scaffold, core implementation, and docs verification stages.

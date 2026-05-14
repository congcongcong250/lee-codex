# Lee Codex CLI Design

## Purpose

Lee Codex is a simple coding-agent CLI for local workspaces. Version 1 should be small enough to understand end-to-end, useful enough to run real coding tasks, and structured so future native tool-calling and streaming provider support can be added without rewriting the agent loop.

## Top 5 Requirements

1. **Hybrid CLI modes**
   - `lee-codex "task"` runs a single agent loop and exits.
   - `lee-codex` starts a simple interactive chat.
   - Interactive mode supports `/help` and `/exit`.
   - Interactive history is in-memory only.
   - Each user message in interactive mode gets its own agent loop and its own max-step budget.

2. **OpenAI-compatible provider layer**
   - Default provider: `openrouter`.
   - Default OpenRouter model: `openai/gpt-oss-120b:free`.
   - Alternate documented OpenRouter preset: `nvidia/nemotron-3-super-120b-a12b:free`.
   - OpenRouter reads credentials from `OPENROUTER_API_KEY`.
   - Optional OpenAI provider reads credentials from `OPENAI_API_KEY`.
   - Provider calls are non-streaming in v1.
   - The model interface must leave a clean extension point for future streaming and native API tool-calling.

3. **Strict JSON action agent loop**
   - The model returns exactly one strict JSON action per step.
   - Tool action shape:

     ```json
     {
       "type": "tool",
       "name": "read_file",
       "args": {
         "path": "package.json"
       }
     }
     ```

   - Final action shape:

     ```json
     {
       "type": "final",
       "message": "Done."
     }
     ```

   - The parser accepts only a single JSON object, not prose, Markdown fences, or scraped JSON fragments.
   - Invalid JSON gets one repair retry by sending the parse error back to the model.
   - Default `maxSteps` is `15`.
   - If the model does not produce a final answer within `maxSteps`, the turn fails with a clear incomplete status.

4. **Workspace tool set**
   - v1 tools are exactly `list_files`, `read_file`, `write_file`, and `run_command`.
   - `list_files` is recursive by default.
   - `list_files` skips common heavy directories: `node_modules`, `.git`, `dist`, `build`, and `coverage`.
   - `list_files` defaults to a `500` file cap.
   - `read_file` defaults to a `200000` byte cap.
   - `write_file` creates or replaces a full file. There is no patch tool in v1.
   - `run_command` executes a shell command string in the selected workspace.
   - `run_command` collects output and returns `exitCode`, `stdout`, `stderr`, and `timedOut`.
   - `run_command` defaults to a `30000` ms timeout and caps stdout/stderr at `100000` bytes each.

5. **Safety, UX, and testability**
   - Default workspace is the current working directory.
   - `--cwd` overrides the workspace.
   - File tools must not access paths outside the workspace.
   - `write_file` and `run_command` require confirmation unless `--yes` is passed.
   - Denied mutating tool calls return structured tool errors to the agent; they do not immediately abort the loop.
   - Default output is a concise step log.
   - `--verbose` is for debug output only and may show raw model JSON, tool results, parse errors, and provider details.
   - Tests use a deterministic fake model and never require real provider credentials.

## CLI Behavior

### Single-Shot Mode

```bash
lee-codex "create a README"
```

The CLI runs one agent loop for the task. If the agent returns a final answer, the command exits successfully. If the provider fails, JSON repair fails, a max-step limit is reached, or configuration is invalid, the command exits non-zero.

### Interactive Mode

```bash
lee-codex
```

The CLI starts a prompt:

```text
lee-codex> create a README
lee-codex> now add install instructions
lee-codex> /exit
```

Each user message runs one agent loop using the same workspace, provider, model, and CLI options. Provider failures fail only the current turn and return to the prompt. Failed turns do not create successful assistant history entries.

Cross-turn memory is compact:

- Store user messages.
- Store final assistant summaries.
- Store concise tool action summaries.
- Do not keep every full file read forever.

Within an active turn, full tool results remain available to the next model call.

## Provider Design

The agent loop depends on a normalized model interface:

```ts
interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}
```

The first real implementation uses an OpenAI-compatible chat completions endpoint with a JSON action protocol in the prompt. OpenRouter uses:

```text
baseURL: https://openrouter.ai/api/v1
apiKey: OPENROUTER_API_KEY
defaultModel: openai/gpt-oss-120b:free
```

OpenAI uses:

```text
baseURL: https://api.openai.com/v1
apiKey: OPENAI_API_KEY
model: user-supplied or project default
```

OpenRouter model presets are documented choices, not a hard allowlist. Users may pass another model with `--model`.

The provider implementation should keep HTTP details isolated from the agent loop. Future native tool-calling can map API-native tool calls into the same normalized agent action shape. Future streaming can be added behind the provider layer without changing workspace tool execution.

## Agent Protocol

The agent state for one turn includes:

- System instruction.
- Compact cross-turn chat history.
- Current user task.
- Step-local tool call and tool result history.

The model must return one of:

```ts
type AgentAction =
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "final"; message: string };
```

The agent loop:

1. Builds a model request from the current state.
2. Parses the model response as a strict JSON action.
3. If parsing fails, asks the model for one repair attempt.
4. If repair fails, fails the turn.
5. If the action is `final`, returns success.
6. If the action is `tool`, validates and executes the tool.
7. Appends the tool result to step-local history.
8. Repeats until final answer or `maxSteps`.

Unknown tools return structured tool errors to the model. Tool validation errors also return structured tool errors unless they represent unrecoverable CLI configuration problems.

## Workspace Tools

### `list_files`

Arguments:

```ts
{
  path?: string;
  maxFiles?: number;
}
```

Returns a recursive list of files under `path`, relative to the workspace. It skips heavy directories and stops at the file cap.

### `read_file`

Arguments:

```ts
{
  path: string;
}
```

Returns UTF-8 file content if the file is within the workspace and under the byte cap. Oversize files return a structured error.

### `write_file`

Arguments:

```ts
{
  path: string;
  content: string;
}
```

Creates or replaces a full file inside the workspace. It requires confirmation unless `--yes` is set.

### `run_command`

Arguments:

```ts
{
  command: string;
}
```

Runs the command string through the shell in the workspace. It requires confirmation unless `--yes` is set. It returns collected stdout, stderr, exit code, and timeout status.

## Safety Model

The v1 safety model is intentionally simple:

- The selected workspace is the authority boundary.
- All file paths are resolved and checked against the workspace root.
- Mutating tools require user approval unless `--yes` is set.
- Commands run with a timeout and output caps.
- v1 does not classify commands as safe or dangerous.
- v1 has no built-in git behavior.
- v1 does not initialize git, commit, inspect dirty state, or expose git-specific tools.

## Test Plan

Tests should be written before implementation and should not require network access.

### CLI Tests

- Missing task in single-shot parsing is handled by entering interactive mode, not by erroring.
- `lee-codex "task"` runs single-shot mode.
- `lee-codex` starts interactive mode.
- `--cwd` must exist and be a directory.
- Defaults are provider `openrouter`, model `openai/gpt-oss-120b:free`, and `maxSteps` `15`.
- `--verbose` enables debug-only output.

### Provider Config Tests

- OpenRouter uses `OPENROUTER_API_KEY`.
- OpenAI uses `OPENAI_API_KEY`.
- Missing required API key fails with a clear error.
- OpenRouter exposes the documented presets without blocking arbitrary `--model` overrides.

### JSON Protocol Tests

- Valid tool JSON parses into a tool action.
- Valid final JSON parses into a final action.
- Prose-wrapped JSON is rejected.
- Markdown-fenced JSON is rejected.
- Invalid JSON triggers one repair retry.
- A second invalid response fails the turn.

### Agent Loop Tests

- Agent executes a model-requested `read_file` and feeds the result back.
- Agent stops when the model returns `final`.
- Agent returns non-zero/incomplete status when `maxSteps` is exhausted.
- Unknown tools return structured errors and allow the loop to continue.
- Interactive mode keeps compact successful history across turns.
- Provider failure in interactive mode fails the turn and keeps the prompt alive.

### Tool Tests

- `list_files` is recursive by default.
- `list_files` skips `node_modules`, `.git`, `dist`, `build`, and `coverage`.
- `list_files` respects `maxFiles`.
- `read_file` rejects paths outside the workspace.
- `read_file` rejects files over `maxReadBytes`.
- `write_file` rejects paths outside the workspace.
- `write_file` requires confirmation unless `--yes`.
- Denied `write_file` returns a structured tool error.
- `run_command` executes in the workspace.
- `run_command` requires confirmation unless `--yes`.
- Denied `run_command` returns a structured tool error.
- `run_command` returns stdout, stderr, exit code, and timeout status.
- `run_command` enforces timeout and output caps.

## Non-Goals For v1

- Persistent chat sessions.
- Native API tool-calling.
- Streaming responses.
- Patch-based editing.
- Built-in git behavior.
- Automatic command safety classification.
- Long-term summarization or vector memory.
- Multi-agent orchestration.

## Implementation Approach

Use a Node.js package with TypeScript ESM:

- `commander` for CLI parsing.
- `readline/promises` for interactive chat.
- `vitest` for tests.
- Built-in `fetch` for provider HTTP calls.
- No OpenAI SDK in v1.

Core modules should stay small:

- `src/cli.ts`: argument parsing and mode selection.
- `src/chat.ts`: interactive prompt loop.
- `src/agent.ts`: step-based agent loop.
- `src/protocol.ts`: strict JSON action parsing and validation.
- `src/model.ts`: model interface and provider client construction.
- `src/providers/openaiCompatible.ts`: OpenAI-compatible HTTP provider.
- `src/tools.ts`: workspace tool dispatcher.
- `src/workspace.ts`: path confinement and filesystem helpers.
- `src/types.ts`: shared types.

The implementation should proceed with test-driven development: write a failing test for each behavior, confirm it fails for the expected reason, then add the smallest implementation that passes.

# Lee Codex

Lee Codex is a small local coding-agent CLI. It runs a direct JSON-action loop against an OpenAI-compatible provider, executes a limited set of workspace tools, and supports both single-shot tasks and a simple interactive chat.

## Install

```bash
npm install
npm run build
npm link
```

You can also run it in development without linking:

```bash
npm run dev -- "create a README"
```

## Provider Setup

The default provider is OpenRouter:

```bash
export OPENROUTER_API_KEY="..."
lee-codex "list the project files"
```

Defaults:

- Provider: `openrouter`
- Model: `openai/gpt-oss-120b:free`
- Alternate documented OpenRouter preset: `nvidia/nemotron-3-super-120b-a12b:free`

OpenAI-compatible OpenAI mode is available with an explicit model:

```bash
export OPENAI_API_KEY="..."
lee-codex --provider openai --model gpt-4.1 "inspect this project"
```

OpenRouter model presets are not a hard allowlist. You can pass any model id supported by your provider:

```bash
lee-codex --model nvidia/nemotron-3-super-120b-a12b:free "summarize src"
```

## Usage

Single-shot mode:

```bash
lee-codex "create a simple package.json"
```

Interactive mode:

```bash
lee-codex
lee-codex> create a README
lee-codex> now add install instructions
lee-codex> /exit
```

Interactive commands:

- `/help`
- `/exit`

## Options

```text
--cwd <path>                 Workspace directory. Defaults to the current directory.
--provider <provider>        openrouter or openai. Defaults to openrouter.
--model <model>              Provider model id.
--max-steps <number>         Maximum agent steps per turn. Defaults to 15.
--max-read-bytes <number>    Maximum bytes read from one file. Defaults to 200000.
--command-timeout-ms <n>     Shell command timeout. Defaults to 30000.
--yes                        Approve write_file and run_command tool calls.
--verbose                    Show raw model JSON and tool-result debug output.
```

## Tools

The v1 agent can request exactly these tools:

- `list_files`: recursively lists files under the workspace, skipping `node_modules`, `.git`, `dist`, `build`, and `coverage`.
- `read_file`: reads a UTF-8 file inside the workspace, capped by `--max-read-bytes`.
- `write_file`: creates or replaces a full file inside the workspace.
- `run_command`: runs a shell command string in the workspace with a timeout and capped output.

`write_file` and `run_command` ask for confirmation unless `--yes` is set. Denials are returned to the agent as tool errors.

## JSON Protocol

The model must return one strict JSON object per step.

Tool action:

```json
{"type":"tool","name":"read_file","args":{"path":"package.json"}}
```

Final action:

```json
{"type":"final","message":"Done."}
```

Lee Codex rejects prose-wrapped JSON and Markdown fences. If the first response is invalid JSON, the agent asks for one repair response. If the repair also fails, the turn fails.

## Development

```bash
npm test
npm run typecheck
npm run build
node dist/index.js --help
```

The test suite uses deterministic fake models and does not require provider credentials.

## V1 Non-Goals

- Persistent chat sessions
- Native API tool-calling
- Streaming responses
- Patch-based editing
- Built-in git behavior
- Command safety classification

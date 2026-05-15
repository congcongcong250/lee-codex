import { Command, InvalidArgumentError } from "commander";
import path from "node:path";
import { runAgentTurn } from "./agent.js";
import { createReadlineChatIO, runChatSession, type ChatIO } from "./chat.js";
import {
  createConversationLog,
  type ConversationRecorder
} from "./conversationLog.js";
import { createModelClient, getProviderConfig } from "./model.js";
import { colorizeVerboseDebugMessage } from "./terminal.js";
import { createToolExecutor } from "./tools.js";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_MAX_READ_BYTES,
  DEFAULT_MAX_STEPS,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_PROVIDER,
  type Logger,
  type ProviderName,
  type SessionHistoryEntry
} from "./types.js";
import { validateWorkspaceRoot } from "./workspace.js";

export type CliMode = "single" | "interactive";

export interface CliConfig {
  mode: CliMode;
  task?: string;
  cwd: string;
  provider: ProviderName;
  model?: string;
  maxSteps: number;
  maxReadBytes: number;
  commandTimeoutMs: number;
  yes: boolean;
  verbose: boolean;
}

export interface ParseCliOptions {
  defaultCwd?: string;
}

export interface RunCliOptions extends ParseCliOptions {
  runSingleShot?: (config: CliConfig) => Promise<number>;
  runInteractive?: (config: CliConfig) => Promise<number>;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const exitCode = await runCli(argv);
  process.exitCode = exitCode;
}

export async function runCli(
  argv: string[],
  options: RunCliOptions = {}
): Promise<number> {
  try {
    const config = await parseCliArgs(argv, options);

    if (config.mode === "single") {
      return options.runSingleShot
        ? options.runSingleShot(config)
        : runSingleShot(config);
    }

    return options.runInteractive
      ? options.runInteractive(config)
      : runInteractive(config);
  } catch (error) {
    if (isCommanderExit(error)) {
      return error.exitCode;
    }

    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export async function parseCliArgs(
  argv: string[],
  options: ParseCliOptions = {}
): Promise<CliConfig> {
  const program = new Command();

  program
    .name("lee-codex")
    .description("A simple local coding-agent CLI.")
    .argument("[task...]", "task to run; omit it to start interactive chat")
    .option("--cwd <path>", "workspace directory")
    .option("--provider <provider>", "provider: openrouter or openai", parseProvider)
    .option("--model <model>", "model id")
    .option("--max-steps <number>", "maximum agent steps per turn", parsePositiveInteger)
    .option("--max-read-bytes <number>", "maximum bytes read from one file", parsePositiveInteger)
    .option(
      "--command-timeout-ms <number>",
      "command timeout in milliseconds",
      parsePositiveInteger
    )
    .option("--yes", "approve write_file and run_command tool calls")
    .option("--verbose", "show raw protocol and provider debug details")
    .exitOverride()
    .configureOutput({
      writeErr: (message) => process.stderr.write(message),
      writeOut: (message) => process.stdout.write(message)
    });

  program.parse(argv, { from: "node" });

  const opts = program.opts<{
    cwd?: string;
    provider?: ProviderName;
    model?: string;
    maxSteps?: number;
    maxReadBytes?: number;
    commandTimeoutMs?: number;
    yes?: boolean;
    verbose?: boolean;
  }>();
  const cwd = await validateWorkspaceRoot(opts.cwd ?? options.defaultCwd ?? process.cwd());
  const provider = opts.provider ?? DEFAULT_PROVIDER;
  const model =
    opts.model ?? (provider === "openrouter" ? DEFAULT_OPENROUTER_MODEL : undefined);
  const task = program.args.join(" ").trim();

  return {
    mode: task.length > 0 ? "single" : "interactive",
    ...(task.length > 0 ? { task } : {}),
    cwd,
    provider,
    ...(model ? { model } : {}),
    maxSteps: opts.maxSteps ?? DEFAULT_MAX_STEPS,
    maxReadBytes: opts.maxReadBytes ?? DEFAULT_MAX_READ_BYTES,
    commandTimeoutMs: opts.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    yes: opts.yes ?? false,
    verbose: opts.verbose ?? false
  };
}

async function runSingleShot(config: CliConfig): Promise<number> {
  const io = process.stdin.isTTY
    ? createReadlineChatIO(process.stdin, process.stdout)
    : undefined;
  const recorder = await createVerboseConversationLog(config);

  try {
    const result = await runConfiguredTurn(
      config,
      config.task ?? "",
      [],
      io,
      recorder
    );
    await finishConversationLog(recorder, result);

    if (result.status === "success") {
      process.stdout.write(`${result.message}\n`);
      return 0;
    }

    process.stderr.write(`${result.error}\n`);
    return 1;
  } catch (error) {
    await recorder?.finish(
      "failed",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  } finally {
    io?.close();
  }
}

async function runInteractive(config: CliConfig): Promise<number> {
  const io = createReadlineChatIO(process.stdin, process.stdout);
  const recorder = await createVerboseConversationLog(config);

  try {
    await runChatSession({
      io,
      runTurn: async (task, history) => {
        try {
          return await runConfiguredTurn(config, task, history, io, recorder);
        } catch (error) {
          await recorder?.recordEvent({
            type: "turn_exception",
            error: error instanceof Error ? error.message : String(error)
          });
          throw error;
        }
      }
    });
    await recorder?.finish("success");
  } catch (error) {
    await recorder?.finish(
      "failed",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }

  return 0;
}

async function runConfiguredTurn(
  config: CliConfig,
  task: string,
  history: SessionHistoryEntry[],
  io?: ChatIO,
  recorder?: ConversationRecorder
) {
  const providerConfig = getProviderConfig({
    provider: config.provider,
    ...(config.model ? { model: config.model } : {})
  });
  const model = createModelClient({
    provider: config.provider,
    model: providerConfig.model
  });
  const tools = createToolExecutor({
    workspaceRoot: config.cwd,
    autoApprove: config.yes,
    maxReadBytes: config.maxReadBytes,
    commandTimeoutMs: config.commandTimeoutMs,
    ...(io && !config.yes
      ? {
          confirm: async (call) => {
            const answer = await io.question(
              `Allow ${call.name}${describeToolTarget(call.args)}? [y/N] `
            );
            return /^y(?:es)?$/i.test(answer.trim());
          }
        }
      : {})
  });

  return runAgentTurn({
    task,
    modelName: providerConfig.model,
    model,
    tools,
    maxSteps: config.maxSteps,
    sessionHistory: history,
    verbose: config.verbose,
    logger: createConsoleLogger(config.verbose),
    ...(recorder ? { recorder } : {})
  });
}

function createConsoleLogger(verbose: boolean): Logger {
  const colorsEnabled = Boolean(process.stderr.isTTY && !process.env.NO_COLOR);

  return {
    step: (message) => process.stdout.write(`${message}\n`),
    debug: (message) => {
      if (verbose) {
        process.stderr.write(
          `${colorizeVerboseDebugMessage(message, colorsEnabled)}\n`
        );
      }
    },
    info: (message) => process.stdout.write(`${message}\n`),
    error: (message) => process.stderr.write(`${message}\n`)
  };
}

async function createVerboseConversationLog(
  config: CliConfig
): Promise<ConversationRecorder | undefined> {
  if (!config.verbose) {
    return undefined;
  }

  return createConversationLog({
    logDir: path.join(config.cwd, "log"),
    provider: config.provider,
    model: config.model ?? "(model unresolved)",
    cwd: config.cwd
  });
}

async function finishConversationLog(
  recorder: ConversationRecorder | undefined,
  result: Awaited<ReturnType<typeof runAgentTurn>>
): Promise<void> {
  if (!recorder) {
    return;
  }

  if (result.status === "success") {
    await recorder.finish("success");
    return;
  }

  await recorder.finish(result.status, result.error);
}

function parseProvider(value: string): ProviderName {
  if (value === "openrouter" || value === "openai") {
    return value;
  }

  throw new InvalidArgumentError("provider must be openrouter or openai");
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("value must be a positive integer");
  }
  return parsed;
}

function describeToolTarget(args: Record<string, unknown>): string {
  const target =
    typeof args.path === "string"
      ? args.path
      : typeof args.command === "string"
        ? args.command
        : "";

  return target ? ` ${target}` : "";
}

function isCommanderExit(error: unknown): error is { exitCode: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "exitCode" in error &&
    typeof (error as { exitCode?: unknown }).exitCode === "number"
  );
}

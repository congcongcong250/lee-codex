import {
  resolveNativeResponse,
  type NativeResolvedToolCall
} from "./resolvers/native.js";
import {
  silentLogger,
  type ChatMessage,
  type Logger,
  type ModelClient,
  type SessionHistoryEntry,
  type ToolCall,
  type ToolResult
} from "./types.js";
import { WORKSPACE_TOOL_DEFINITIONS, type ToolExecutor } from "./tools.js";

export interface AgentTurnOptions {
  task: string;
  modelName: string;
  model: ModelClient;
  tools: ToolExecutor;
  maxSteps: number;
  sessionHistory?: SessionHistoryEntry[];
  verbose?: boolean;
  logger?: Logger;
}

export type AgentTurnResult =
  | {
      status: "success";
      message: string;
      steps: number;
      toolSummaries: string[];
    }
  | {
      status: "failed" | "incomplete";
      error: string;
      steps: number;
      toolSummaries: string[];
    };

export async function runAgentTurn(
  options: AgentTurnOptions
): Promise<AgentTurnResult> {
  const logger = options.logger ?? silentLogger;
  const messages = buildInitialMessages(options);
  const toolSummaries: string[] = [];

  for (let step = 1; step <= options.maxSteps; step += 1) {
    const response = await completeStep(options, messages);

    if (!response.ok) {
      return {
        status: "failed",
        error: response.error,
        steps: step,
        toolSummaries
      };
    }

    if (options.verbose) {
      logger.debug(
        `Assistant message:\n${JSON.stringify(response.value.message, null, 2)}`
      );
    }

    const resolved = resolveNativeResponse(response.value);

    if (resolved.type === "failed") {
      return {
        status: "failed",
        error: resolved.error,
        steps: step,
        toolSummaries
      };
    }

    messages.push(resolved.assistantMessage);

    if (resolved.type === "final") {
      return {
        status: "success",
        message: resolved.message,
        steps: step,
        toolSummaries
      };
    }

    for (const call of resolved.calls) {
      const result = await executeResolvedToolCall(options, call, step, logger);

      if (options.verbose) {
        logger.debug(`Tool result:\n${JSON.stringify(result, null, 2)}`);
      }

      toolSummaries.push(`${summarizeResolvedToolCall(call)} -> ${result.ok ? "ok" : "error"}`);
      messages.push(buildToolResultMessage(call, result));
    }
  }

  return {
    status: "incomplete",
    error: `Agent stopped after ${options.maxSteps} steps without a final answer.`,
    steps: options.maxSteps,
    toolSummaries
  };
}

async function completeStep(
  options: AgentTurnOptions,
  messages: ChatMessage[]
) {
  try {
    const value = await options.model.complete({
      model: options.modelName,
      messages,
      tools: WORKSPACE_TOOL_DEFINITIONS,
      toolChoice: "auto",
      parallelToolCalls: false
    });
    return { ok: true as const, value };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function executeResolvedToolCall(
  options: AgentTurnOptions,
  call: NativeResolvedToolCall,
  step: number,
  logger: Logger
): Promise<ToolResult> {
  if (call.status === "invalid") {
    logger.step(
      `Step ${step}/${options.maxSteps}: ${call.name} invalid arguments`
    );
    return { ok: false, error: call.error };
  }

  logger.step(`Step ${step}/${options.maxSteps}: ${summarizeToolCall(call)}`);
  return options.tools.execute({
    name: call.name,
    args: call.args
  });
}

function buildToolResultMessage(
  call: NativeResolvedToolCall,
  result: ToolResult
): ChatMessage {
  return {
    role: "tool",
    tool_call_id: call.id,
    name: call.name,
    content: JSON.stringify(result, null, 2)
  };
}

function buildInitialMessages(options: AgentTurnOptions): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...(options.sessionHistory ?? []).map(historyEntryToMessage),
    { role: "user", content: options.task }
  ];
}

function historyEntryToMessage(entry: SessionHistoryEntry): ChatMessage {
  if (entry.role === "assistant") {
    return { role: "assistant", content: entry.content };
  }

  if (entry.role === "tool") {
    return { role: "user", content: `Previous tool summary: ${entry.content}` };
  }

  return { role: "user", content: entry.content };
}

function summarizeResolvedToolCall(call: NativeResolvedToolCall): string {
  if (call.status === "invalid") {
    return call.name;
  }

  return summarizeToolCall(call);
}

function summarizeToolCall(call: ToolCall): string {
  const target =
    stringArg(call.args.path) ??
    stringArg(call.args.command) ??
    stringArg(call.args.name);
  return target ? `${call.name} ${target}` : call.name;
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const SYSTEM_PROMPT = [
  "You are Lee Codex, a local coding-agent CLI.",
  "Use the provided native tools when workspace inspection, file edits, or shell commands are needed.",
  "Answer normally in assistant content when you are ready to respond to the user.",
  "Inspect files before editing when context is needed.",
  "Do not claim commands passed unless tool output proves it.",
  "Keep final answers concise and include any important verification status."
].join("\n");

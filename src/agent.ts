import {
  buildRepairUserMessage,
  isProtocolParseError,
  parseAgentAction
} from "./protocol.js";
import {
  silentLogger,
  type AgentAction,
  type ChatMessage,
  type Logger,
  type ModelClient,
  type SessionHistoryEntry,
  type ToolCall,
  type ToolResult
} from "./types.js";
import type { ToolExecutor } from "./tools.js";

type ToolAction = Extract<AgentAction, { type: "tool" }>;

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

interface StepRecord {
  action: ToolAction;
  result?: ToolResult;
}

export async function runAgentTurn(
  options: AgentTurnOptions
): Promise<AgentTurnResult> {
  const logger = options.logger ?? silentLogger;
  const stepRecords: StepRecord[] = [];
  const toolSummaries: string[] = [];

  for (let step = 1; step <= options.maxSteps; step += 1) {
    const actionResult = await requestAction(options, stepRecords);

    if (!actionResult.ok) {
      return {
        status: "failed",
        error: actionResult.error,
        steps: step,
        toolSummaries
      };
    }

    const action = actionResult.action;

    if (options.verbose) {
      logger.debug(`Model JSON:\n${actionResult.raw}`);
    }

    if (action.type === "final") {
      return {
        status: "success",
        message: action.message,
        steps: step,
        toolSummaries
      };
    }

    logger.step(`Step ${step}/${options.maxSteps}: ${summarizeToolCall(action)}`);

    const result = await options.tools.execute({
      name: action.name,
      args: action.args
    });

    if (options.verbose) {
      logger.debug(`Tool result:\n${JSON.stringify(result, null, 2)}`);
    }

    stepRecords.push({ action, result });
    toolSummaries.push(
      `${summarizeToolCall(action)} -> ${result.ok ? "ok" : "error"}`
    );
  }

  return {
    status: "incomplete",
    error: `Agent stopped after ${options.maxSteps} steps without a final answer.`,
    steps: options.maxSteps,
    toolSummaries
  };
}

async function requestAction(
  options: AgentTurnOptions,
  stepRecords: StepRecord[]
): Promise<
  | { ok: true; action: AgentAction; raw: string }
  | { ok: false; error: string }
> {
  const messages = buildMessages(options, stepRecords);

  let firstRaw = "";
  try {
    const response = await options.model.complete({
      model: options.modelName,
      messages
    });
    firstRaw = response.content;
    return { ok: true, action: parseAgentAction(response.content), raw: response.content };
  } catch (error) {
    if (!isProtocolParseError(error)) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }

    const repairMessages = [
      ...messages,
      { role: "assistant" as const, content: firstRaw },
      {
        role: "user" as const,
        content: buildRepairUserMessage(error.message, firstRaw)
      }
    ];

    try {
      const repairResponse = await options.model.complete({
        model: options.modelName,
        messages: repairMessages
      });
      return {
        ok: true,
        action: parseAgentAction(repairResponse.content),
        raw: repairResponse.content
      };
    } catch (repairError) {
      return {
        ok: false,
        error:
          repairError instanceof Error
            ? repairError.message
            : String(repairError)
      };
    }
  }
}

function buildMessages(
  options: AgentTurnOptions,
  stepRecords: StepRecord[]
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(options.sessionHistory ?? []).map(historyEntryToMessage),
    { role: "user", content: options.task }
  ];

  for (const record of stepRecords) {
    messages.push({
      role: "assistant",
      content: JSON.stringify(record.action)
    });
    messages.push({
      role: "user",
      content: `Tool result for ${summarizeToolCall(record.action)}:\n${JSON.stringify(
        record.result,
        null,
        2
      )}`
    });
  }

  return messages;
}

function historyEntryToMessage(entry: SessionHistoryEntry): ChatMessage {
  if (entry.role === "assistant") {
    return { role: "assistant", content: entry.content };
  }

  return { role: "user", content: entry.content };
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
  "Return exactly one strict JSON object on every response.",
  "Use one of these shapes:",
  '{"type":"tool","name":"list_files","args":{"path":"."}}',
  '{"type":"tool","name":"read_file","args":{"path":"package.json"}}',
  '{"type":"tool","name":"write_file","args":{"path":"file.txt","content":"..."}}',
  '{"type":"tool","name":"run_command","args":{"command":"npm test"}}',
  '{"type":"final","message":"Concise final answer."}',
  "Do not wrap JSON in Markdown fences or prose.",
  "Inspect files before editing when context is needed.",
  "Do not claim commands passed unless tool output proves it."
].join("\n");

import type { ChatToolCall, ModelResponse } from "../types.js";

export type NativeResolvedToolCall =
  | {
      status: "ready";
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      status: "invalid";
      id: string;
      name: string;
      error: string;
    };

export type NativeResolverResult =
  | {
      type: "final";
      message: string;
      assistantMessage: ModelResponse["message"];
    }
  | {
      type: "tool_calls";
      assistantMessage: ModelResponse["message"];
      calls: NativeResolvedToolCall[];
    }
  | {
      type: "failed";
      error: string;
    };

export function resolveNativeResponse(
  response: ModelResponse
): NativeResolverResult {
  const { message } = response;
  const toolCalls = message.tool_calls ?? [];

  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const calls: NativeResolvedToolCall[] = [];

    for (const [index, toolCall] of toolCalls.entries()) {
      const validationError = validateToolCallShape(toolCall, index);
      if (validationError) {
        return validationError;
      }

      calls.push(resolveToolCall(toolCall));
    }

    return {
      type: "tool_calls",
      assistantMessage: message,
      calls
    };
  }

  if (typeof message.content === "string") {
    return {
      type: "final",
      message: message.content,
      assistantMessage: message
    };
  }

  return {
    type: "failed",
    error: "Assistant response had neither content nor tool_calls."
  };
}

function validateToolCallShape(
  toolCall: ChatToolCall,
  index: number
): Extract<NativeResolverResult, { type: "failed" }> | undefined {
  if (typeof toolCall.id !== "string" || toolCall.id.length === 0) {
    return {
      type: "failed",
      error: `Native tool call at index ${index} is missing a non-empty id.`
    };
  }

  if (toolCall.type !== "function") {
    return {
      type: "failed",
      error: `Native tool call ${toolCall.id} has unsupported type ${String(
        toolCall.type
      )}.`
    };
  }

  if (
    typeof toolCall.function?.name !== "string" ||
    toolCall.function.name.length === 0
  ) {
    return {
      type: "failed",
      error: `Native tool call ${toolCall.id} is missing a function name.`
    };
  }

  if (typeof toolCall.function.arguments !== "string") {
    return {
      type: "failed",
      error: `Native tool call ${toolCall.id} arguments must be a JSON string.`
    };
  }

  return undefined;
}

function resolveToolCall(toolCall: ChatToolCall): NativeResolvedToolCall {
  try {
    const parsed = JSON.parse(toolCall.function.arguments || "{}") as unknown;
    if (!isRecord(parsed)) {
      return {
        status: "invalid",
        id: toolCall.id,
        name: toolCall.function.name,
        error: "Tool arguments must decode to a JSON object."
      };
    }

    return {
      status: "ready",
      id: toolCall.id,
      name: toolCall.function.name,
      args: parsed
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "invalid",
      id: toolCall.id,
      name: toolCall.function.name,
      error: `Tool arguments were not valid JSON: ${message}`
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { AgentAction } from "./types.js";

export class ProtocolParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolParseError";
  }
}

export function parseAgentAction(raw: string): AgentAction {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw.trim());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ProtocolParseError(`Model response is not valid JSON: ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new ProtocolParseError("Model response must be a JSON object.");
  }

  if (parsed.type === "tool") {
    if (typeof parsed.name !== "string" || parsed.name.length === 0) {
      throw new ProtocolParseError("Tool action must include a non-empty name.");
    }

    if (!isRecord(parsed.args)) {
      throw new ProtocolParseError("Tool action args must be a JSON object.");
    }

    return {
      type: "tool",
      name: parsed.name,
      args: parsed.args
    };
  }

  if (parsed.type === "final") {
    if (typeof parsed.message !== "string") {
      throw new ProtocolParseError("Final action message must be a string.");
    }

    return {
      type: "final",
      message: parsed.message
    };
  }

  throw new ProtocolParseError("Action type must be either tool or final.");
}

export function buildRepairUserMessage(error: string, rawResponse: string): string {
  return [
    `Your previous response could not be parsed: ${error}`,
    "Return exactly one strict JSON object with no prose or Markdown fences.",
    "Previous response:",
    rawResponse
  ].join("\n");
}

export function isProtocolParseError(error: unknown): error is ProtocolParseError {
  return error instanceof ProtocolParseError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

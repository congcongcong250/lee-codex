import type { ModelClient, ModelRequest, ModelResponse } from "../types.js";

export interface OpenAICompatibleClientOptions {
  apiKey: string;
  baseURL: string;
  fetchImpl?: typeof fetch;
  extraBody?: Record<string, unknown>;
}

export class OpenAICompatibleClient implements ModelClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAICompatibleClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.fetchImpl(
      `${trimTrailingSlash(this.options.baseURL)}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: false,
          ...(request.tools ? { tools: request.tools } : {}),
          ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
          ...(request.parallelToolCalls !== undefined
            ? { parallel_tool_calls: request.parallelToolCalls }
            : {}),
          ...(this.options.extraBody ?? {})
        })
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Provider request failed with status ${response.status}: ${body}`
      );
    }

    const raw = (await response.json()) as unknown;
    return extractModelResponse(raw);
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function extractModelResponse(raw: unknown): ModelResponse {
  if (!isRecord(raw)) {
    throw new Error("Provider response must be a JSON object.");
  }

  const choices = raw.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("Provider response did not include choices.");
  }

  const first = choices[0] as unknown;
  if (!isRecord(first) || !isRecord(first.message)) {
    throw new Error("Provider response did not include a message.");
  }

  const message = extractAssistantMessage(first.message, raw);
  const finishReason =
    typeof first.finish_reason === "string" || first.finish_reason === null
      ? first.finish_reason
      : undefined;

  return {
    message,
    content: message.content,
    ...(finishReason !== undefined ? { finishReason } : {}),
    raw,
    ...("usage" in raw ? { usage: raw.usage } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractAssistantMessage(
  message: Record<string, unknown>,
  raw: unknown
): ModelResponse["message"] {
  if (message.role !== "assistant") {
    throw new Error(
      `Provider response message role must be assistant. Response preview: ${previewJson(raw)}`
    );
  }

  const content = message.content;
  const normalizedContent = extractMessageContent(content, raw);
  const normalizedMessage: ModelResponse["message"] = {
    ...message,
    role: "assistant",
    content: normalizedContent
  };

  if ("tool_calls" in message) {
    if (message.tool_calls !== null && !Array.isArray(message.tool_calls)) {
      throw new Error(
        `Provider response message tool_calls must be an array or null. Response preview: ${previewJson(raw)}`
      );
    }

    normalizedMessage.tool_calls = message.tool_calls;
  }

  return normalizedMessage;
}

function extractMessageContent(content: unknown, raw: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (isRecord(part) && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("");

    if (text.length > 0) {
      return text;
    }

    throw new Error(
      `Provider response message content parts did not include text. Response preview: ${previewJson(raw)}`
    );
  }

  if (content === null) {
    return null;
  }

  if (content === undefined) {
    return null;
  }

  throw new Error(
    `Provider response message content must be a string or text-part array. Response preview: ${previewJson(raw)}`
  );
}

function previewJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (!json) {
    return String(value);
  }

  return json.length > 1000 ? `${json.slice(0, 1000)}...` : json;
}

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
    const content = extractContent(raw);
    return { content, raw };
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function extractContent(raw: unknown): string {
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

  return extractMessageContent(first.message, raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractMessageContent(
  message: Record<string, unknown>,
  raw: unknown
): string {
  const content = message.content;

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
    return "";
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

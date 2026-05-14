import type { ModelClient, ModelRequest, ModelResponse } from "../types.js";

export interface OpenAICompatibleClientOptions {
  apiKey: string;
  baseURL: string;
  fetchImpl?: typeof fetch;
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
          stream: false
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

  if (typeof first.message.content !== "string") {
    throw new Error("Provider response message content must be a string.");
  }

  return first.message.content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

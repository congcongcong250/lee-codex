import {
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_PROVIDER,
  OPENROUTER_MODEL_PRESETS,
  type AssistantChatMessage,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
  type ProviderName
} from "./types.js";
import { OpenAICompatibleClient } from "./providers/openaiCompatible.js";
import type { OpenAICompatibleParameterPolicy } from "./providers/openaiCompatible.js";

export type { ModelClient } from "./types.js";

export interface ProviderDefinition {
  provider: ProviderName;
  baseURL: string;
  apiKeyEnv: string;
  defaultModel?: string;
  modelPresets: readonly string[];
  extraBody?: Record<string, unknown>;
  parameterPolicy?: OpenAICompatibleParameterPolicy;
}

export interface ProviderConfig {
  provider: ProviderName;
  baseURL: string;
  apiKey: string;
  model: string;
  extraBody?: Record<string, unknown>;
  parameterPolicy?: OpenAICompatibleParameterPolicy;
}

export interface ProviderConfigInput {
  provider?: ProviderName;
  model?: string;
  env?: Record<string, string | undefined>;
}

export interface CreateModelClientOptions {
  fetchImpl?: typeof fetch;
}

export const OPENAI_COMPATIBLE_PROVIDERS = {
  openrouter: {
    provider: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    defaultModel: DEFAULT_OPENROUTER_MODEL,
    modelPresets: OPENROUTER_MODEL_PRESETS,
    extraBody: {
      provider: {
        require_parameters: true
      }
    },
    parameterPolicy: {
      parallelToolCalls: "omit"
    }
  },
  openai: {
    provider: "openai",
    baseURL: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    modelPresets: []
  }
} as const satisfies Record<ProviderName, ProviderDefinition>;

export function getProviderConfig(input: ProviderConfigInput = {}): ProviderConfig {
  const provider = input.provider ?? DEFAULT_PROVIDER;
  const definition = OPENAI_COMPATIBLE_PROVIDERS[provider];
  const env = input.env ?? process.env;
  const apiKey = env[definition.apiKeyEnv];

  if (!apiKey) {
    throw new Error(
      `Missing ${definition.apiKeyEnv}. Set it to use provider ${provider}.`
    );
  }

  const model =
    input.model ?? ("defaultModel" in definition ? definition.defaultModel : undefined);
  if (!model) {
    throw new Error(`--model is required when provider is ${provider}.`);
  }

  return {
    provider,
    baseURL: definition.baseURL,
    apiKey,
    model,
    ...("extraBody" in definition ? { extraBody: definition.extraBody } : {}),
    ...("parameterPolicy" in definition
      ? { parameterPolicy: definition.parameterPolicy }
      : {})
  };
}

export function createModelClient(
  input: ProviderConfigInput = {},
  options: CreateModelClientOptions = {}
): ModelClient {
  const config = getProviderConfig(input);
  return new OpenAICompatibleClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    ...(config.extraBody ? { extraBody: config.extraBody } : {}),
    ...(config.parameterPolicy ? { parameterPolicy: config.parameterPolicy } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
}

export class FakeModelClient implements ModelClient {
  private nextIndex = 0;

  constructor(private readonly responses: Array<string | AssistantChatMessage>) {}

  async complete(_request: ModelRequest): Promise<ModelResponse> {
    const response = this.responses[this.nextIndex];
    if (response === undefined) {
      throw new Error("No fake model responses remain.");
    }

    this.nextIndex += 1;
    const message =
      typeof response === "string"
        ? ({ role: "assistant", content: response } as const)
        : response;
    return { message, content: message.content };
  }
}

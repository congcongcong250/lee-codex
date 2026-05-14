import {
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_PROVIDER,
  OPENROUTER_MODEL_PRESETS,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
  type ProviderName
} from "./types.js";
import { OpenAICompatibleClient } from "./providers/openaiCompatible.js";

export type { ModelClient } from "./types.js";

export interface ProviderDefinition {
  provider: ProviderName;
  baseURL: string;
  apiKeyEnv: string;
  defaultModel?: string;
  modelPresets: readonly string[];
}

export interface ProviderConfig {
  provider: ProviderName;
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface ProviderConfigInput {
  provider?: ProviderName;
  model?: string;
  env?: Record<string, string | undefined>;
}

export const OPENAI_COMPATIBLE_PROVIDERS = {
  openrouter: {
    provider: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    defaultModel: DEFAULT_OPENROUTER_MODEL,
    modelPresets: OPENROUTER_MODEL_PRESETS
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
    model
  };
}

export function createModelClient(input: ProviderConfigInput = {}): ModelClient {
  const config = getProviderConfig(input);
  return new OpenAICompatibleClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });
}

export class FakeModelClient implements ModelClient {
  private nextIndex = 0;

  constructor(private readonly responses: string[]) {}

  async complete(_request: ModelRequest): Promise<ModelResponse> {
    const content = this.responses[this.nextIndex];
    if (content === undefined) {
      throw new Error("No fake model responses remain.");
    }

    this.nextIndex += 1;
    return { content };
  }
}

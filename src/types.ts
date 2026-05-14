export const DEFAULT_PROVIDER = "openrouter" as const;
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-oss-120b:free" as const;
export const OPENROUTER_MODEL_PRESETS = [
  "openai/gpt-oss-120b:free",
  "nvidia/nemotron-3-super-120b-a12b:free"
] as const;
export const DEFAULT_MAX_STEPS = 15;
export const DEFAULT_MAX_READ_BYTES = 200000;
export const DEFAULT_MAX_FILES = 500;
export const DEFAULT_COMMAND_TIMEOUT_MS = 30000;
export const DEFAULT_COMMAND_OUTPUT_BYTES = 100000;

export type ProviderName = "openrouter" | "openai";

export type AgentAction =
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "final"; message: string };

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ModelRequest {
  messages: ChatMessage[];
  model: string;
}

export interface ModelResponse {
  content: string;
  raw?: unknown;
}

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface SessionHistoryEntry {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface Logger {
  step(message: string): void;
  debug(message: string): void;
  info(message: string): void;
  error(message: string): void;
}

export const silentLogger: Logger = {
  step() {},
  debug() {},
  info() {},
  error() {}
};
